import {
  handlePasskeyLoginOptions,
  handlePasskeyLoginVerify,
  handlePasskeyRegisterOptions,
  handlePasskeyRegisterVerify,
} from "./passkeys.js";

const SESSION_COOKIE = "cloud_vault_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

let schemaReadyPromise = null;

async function ensureDatabaseSchema(env) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const userColumnsResult = await env.DB.prepare("PRAGMA table_info(users);").all();
      const userColumns = new Set((userColumnsResult.results || []).map((column) => column.name));

      if (!userColumns.has("totp_secret")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN totp_secret TEXT;").run();
      }

      if (!userColumns.has("totp_enabled")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;").run();
      }

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS passkeys (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          credential_id TEXT NOT NULL UNIQUE,
          public_key_jwk TEXT NOT NULL,
          counter INTEGER NOT NULL DEFAULT 0,
          label TEXT,
          created_at TEXT NOT NULL,
          last_used_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS webauthn_challenges (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          challenge TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL,
          rp_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `).run();

      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkeys(user_id);").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_passkeys_credential_id ON passkeys(credential_id);").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_challenge ON webauthn_challenges(challenge);").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user_id ON webauthn_challenges(user_id);").run();
    })();
  }

  return schemaReadyPromise;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    try {
      const url = new URL(request.url);

      await ensureDatabaseSchema(env);

      if (!url.pathname.startsWith("/api/")) {
        return json({ ok: true, service: "cloud-vault-api" }, 200, env, request);
      }

      if (url.pathname === "/api/signup" && request.method === "POST") {
        return await handleSignup(request, env);
      }

      if (url.pathname === "/api/login" && request.method === "POST") {
        return await handleLogin(request, env);
      }

      if (url.pathname === "/api/logout" && request.method === "POST") {
        return await handleLogout(request, env);
      }

      if (url.pathname === "/api/session" && request.method === "GET") {
        return await handleSession(request, env);
      }

      if (url.pathname === "/api/vault" && request.method === "PUT") {
        return await handleSaveVault(request, env);
      }

      if (url.pathname === "/api/setup-totp" && request.method === "POST") {
        return await handleSetupTotp(request, env);
      }

      if (url.pathname === "/api/verify-totp" && request.method === "POST") {
        return await handleVerifyTotp(request, env);
      }

      if (url.pathname === "/api/disable-totp" && request.method === "POST") {
        return await handleDisableTotp(request, env);
      }

      if (url.pathname === "/api/webauthn/register/options" && request.method === "POST") {
        return json(await handlePasskeyRegisterOptions(request, env), 200, env, request);
      }

      if (url.pathname === "/api/webauthn/register/verify" && request.method === "POST") {
        return json(await handlePasskeyRegisterVerify(request, env), 200, env, request);
      }

      if (url.pathname === "/api/webauthn/login/options" && request.method === "POST") {
        return json(await handlePasskeyLoginOptions(request, env), 200, env, request);
      }

      if (url.pathname === "/api/webauthn/login/verify" && request.method === "POST") {
        const result = await handlePasskeyLoginVerify(request, env);
        const session = await createSession(env, request, result.userId, true);
        return json(
          { success: true, session: { id: session.id, expiresAt: session.expiresAt }, user: { id: result.userId, username: result.username } },
          200,
          env,
          request,
          { "Set-Cookie": session.cookie }
        );
      }

      return json({ error: "Not found." }, 404, env, request);
    } catch (error) {
      return json({ error: error.message || "Unexpected error." }, error.status || 500, env, request);
    }
  },
};

// ─── Auth Handlers ────────────────────────────────────────────────────────────

async function handleSignup(request, env) {
  const body = await readJson(request);
  const username = sanitizeUsername(body.username);
  const password = body.password || "";

  if (username.length < 3) {
    throw httpError(400, "Username must be at least 3 characters.");
  }

  if (password.length < 10) {
    throw httpError(400, "Password must be at least 10 characters.");
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) {
    throw httpError(409, "That username already exists.");
  }

  const userId = crypto.randomUUID();
  const salt = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const passwordHash = await hashPassword(password, salt);
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO users (id, username, password_hash, password_salt, totp_secret, totp_enabled, created_at) VALUES (?, ?, ?, ?, NULL, 0, ?)"
  )
    .bind(userId, username, passwordHash, salt, createdAt)
    .run();

  // Session is created but totp_verified = 1 since no TOTP is set up yet
  const session = await createSession(env, userId, true);
  return json(
    {
      user: { id: userId, username },
      vault: null,
      totpEnabled: false,
    },
    201,
    env,
    request,
    { "Set-Cookie": buildSessionCookie(session.token) }
  );
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  const username = sanitizeUsername(body.username);
  const password = body.password || "";

  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  if (!user) {
    throw httpError(401, "Invalid username or password.");
  }

  const passwordHash = await hashPassword(password, user.password_salt);
  if (passwordHash !== user.password_hash) {
    throw httpError(401, "Invalid username or password.");
  }

  const totpEnabled = Boolean(user.totp_enabled);

  if (totpEnabled) {
    // Create a session that is NOT yet totp_verified — used as a pending token
    const session = await createSession(env, user.id, false);
    return json(
      {
        totpRequired: true,
      },
      200,
      env,
      request,
      { "Set-Cookie": buildSessionCookie(session.token) }
    );
  }

  // No TOTP — create a fully verified session
  const session = await createSession(env, user.id, true);
  const vault = await env.DB.prepare("SELECT encrypted_vault FROM vaults WHERE user_id = ?").bind(user.id).first();

  return json(
    {
      user: { id: user.id, username: user.username },
      vault: vault?.encrypted_vault ? JSON.parse(vault.encrypted_vault) : null,
      totpEnabled: false,
    },
    200,
    env,
    request,
    { "Set-Cookie": buildSessionCookie(session.token) }
  );
}

async function handleLogout(request, env) {
  const cookieToken = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (cookieToken) {
    const tokenHash = await sha256(cookieToken);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }

  return json({ ok: true }, 200, env, request, { "Set-Cookie": buildExpiredCookie() });
}

async function handleSession(request, env) {
  const user = await requireSession(request, env);
  const vault = await env.DB.prepare("SELECT encrypted_vault FROM vaults WHERE user_id = ?").bind(user.id).first();
  const userRow = await env.DB.prepare("SELECT totp_enabled FROM users WHERE id = ?").bind(user.id).first();

  return json(
    {
      user: { id: user.id, username: user.username },
      vault: vault?.encrypted_vault ? JSON.parse(vault.encrypted_vault) : null,
      totpEnabled: Boolean(userRow?.totp_enabled),
    },
    200,
    env,
    request
  );
}

async function handleSaveVault(request, env) {
  const user = await requireSession(request, env);
  const body = await readJson(request);
  const encryptedVault = body.encryptedVault;

  if (!encryptedVault || typeof encryptedVault !== "object") {
    throw httpError(400, "Encrypted vault payload is required.");
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO vaults (user_id, encrypted_vault, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET encrypted_vault = excluded.encrypted_vault, updated_at = excluded.updated_at`
  )
    .bind(user.id, JSON.stringify(encryptedVault), now)
    .run();

  return json({ ok: true, updatedAt: now }, 200, env, request);
}

// ─── TOTP Handlers ────────────────────────────────────────────────────────────

/**
 * POST /api/setup-totp
 * Body: { secret: string, code: string }
 * Requires a valid (totp_verified) session.
 * Verifies the TOTP code against the provided secret, then stores it.
 */
async function handleSetupTotp(request, env) {
  const user = await requireSession(request, env);
  const body = await readJson(request);
  const { secret, code } = body;

  if (!secret || typeof secret !== "string" || secret.length < 16) {
    throw httpError(400, "Invalid TOTP secret.");
  }

  if (!code || !/^\d{6}$/.test(code)) {
    throw httpError(400, "A 6-digit TOTP code is required.");
  }

  const valid = await verifyTotpCode(secret, code);
  if (!valid) {
    return json({ success: false, error: "Invalid code. Please try again." }, 400, env, request);
  }

  await env.DB.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?")
    .bind(secret, user.id)
    .run();

  return json({ success: true }, 200, env, request);
}

/**
 * POST /api/verify-totp
 * Body: { code: string }
 * Requires a pending session (totp_verified = 0).
 * On success, marks the session as totp_verified and returns user + vault.
 */
async function handleVerifyTotp(request, env) {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) {
    throw httpError(401, "Not logged in.");
  }

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();

  // Allow pending (totp_verified = 0) sessions here
  const session = await env.DB.prepare(
    `SELECT sessions.id, sessions.user_id, sessions.totp_verified, users.username, users.totp_secret, users.totp_enabled
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
  )
    .bind(tokenHash, now)
    .first();

  if (!session) {
    throw httpError(401, "Session expired. Please log in again.");
  }

  if (!session.totp_enabled || !session.totp_secret) {
    throw httpError(400, "2FA is not enabled for this account.");
  }

  if (session.totp_verified) {
    // Already verified — just return the user data
    const vault = await env.DB.prepare("SELECT encrypted_vault FROM vaults WHERE user_id = ?").bind(session.user_id).first();
    return json(
      {
        verified: true,
        user: { id: session.user_id, username: session.username },
        vault: vault?.encrypted_vault ? JSON.parse(vault.encrypted_vault) : null,
      },
      200,
      env,
      request
    );
  }

  const body = await readJson(request);
  const { code } = body;

  if (!code || !/^\d{6}$/.test(code)) {
    throw httpError(400, "A 6-digit TOTP code is required.");
  }

  const valid = await verifyTotpCode(session.totp_secret, code);
  if (!valid) {
    return json({ verified: false, error: "Invalid code." }, 200, env, request);
  }

  // Mark session as totp_verified
  await env.DB.prepare("UPDATE sessions SET totp_verified = 1 WHERE id = ?")
    .bind(session.id)
    .run();

  const vault = await env.DB.prepare("SELECT encrypted_vault FROM vaults WHERE user_id = ?").bind(session.user_id).first();

  return json(
    {
      verified: true,
      user: { id: session.user_id, username: session.username },
      vault: vault?.encrypted_vault ? JSON.parse(vault.encrypted_vault) : null,
    },
    200,
    env,
    request
  );
}

/**
 * POST /api/disable-totp
 * Requires a valid (totp_verified) session.
 */
async function handleDisableTotp(request, env) {
  const user = await requireSession(request, env);

  await env.DB.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?")
    .bind(user.id)
    .run();

  return json({ ok: true }, 200, env, request);
}

// ─── TOTP Crypto ──────────────────────────────────────────────────────────────

/**
 * RFC 6238 TOTP verification using Web Crypto (HMAC-SHA1).
 * Accepts codes from the current window and ±1 window (30-second steps).
 */
async function verifyTotpCode(base32Secret, code) {
  const secretBytes = base32Decode(base32Secret);
  const now = Math.floor(Date.now() / 1000);
  const step = 30;

  for (const delta of [-1, 0, 1]) {
    const counter = Math.floor(now / step) + delta;
    const expected = await computeTotp(secretBytes, counter);
    if (expected === code) {
      return true;
    }
  }
  return false;
}

async function computeTotp(secretBytes, counter) {
  // Pack counter as big-endian 8-byte buffer
  const counterBuffer = new ArrayBuffer(8);
  const view = new DataView(counterBuffer);
  // JavaScript numbers are safe up to 2^53; split into two 32-bit halves
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, counterBuffer);
  const hmac = new Uint8Array(signature);

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 1_000_000).padStart(6, "0");
}

function base32Decode(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const input = base32.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output = [];

  for (const char of input) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue; // skip padding / spaces
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}

// ─── Session Helpers ──────────────────────────────────────────────────────────

async function requireSession(request, env) {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) {
    throw httpError(401, "Not logged in.");
  }

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const session = await env.DB.prepare(
    `SELECT sessions.user_id, sessions.totp_verified, users.username, users.totp_enabled
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
  )
    .bind(tokenHash, now)
    .first();

  if (!session) {
    throw httpError(401, "Session expired. Please log in again.");
  }

  // If TOTP is enabled but not yet verified for this session, reject
  if (session.totp_enabled && !session.totp_verified) {
    throw httpError(403, "2FA verification required.");
  }

  return {
    id: session.user_id,
    username: session.username,
  };
}

async function createSession(env, userId, totpVerified) {
  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, totp_verified) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), userId, tokenHash, expiresAt, now.toISOString(), totpVerified ? 1 : 0)
    .run();

  return { token };
}

// ─── Crypto Utilities ─────────────────────────────────────────────────────────

async function hashPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return base64UrlEncode(new Uint8Array(bits));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return base64UrlEncode(new Uint8Array(digest));
}

// ─── HTTP / Cookie Utilities ──────────────────────────────────────────────────

function sanitizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function buildSessionCookie(token) {
  const maxAge = SESSION_TTL_MS / 1000;
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=None`;
}

function buildExpiredCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None`;
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";").map((part) => part.trim());
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) {
      return part.slice(name.length + 1);
    }
  }
  return null;
}

function readJson(request) {
  return request.json().catch(() => {
    throw httpError(400, "Invalid JSON payload.");
  });
}

function json(payload, status, env, request, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(env, request),
      ...extraHeaders,
    },
  });
}

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = env.FRONTEND_ORIGIN;
  const devOrigins = new Set([
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);

  const isAllowedOrigin = Boolean(
    origin && ((allowedOrigin && origin === allowedOrigin) || devOrigins.has(origin))
  );

  if (!isAllowedOrigin) {
    return { Vary: "Origin" };
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
