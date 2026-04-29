const SESSION_COOKIE = "cloud_vault_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const OTP_TTL_MS = 1000 * 60 * 10;

let schemaReadyPromise = null;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    try {
      await ensureDatabaseSchema(env);
      const url = new URL(request.url);

      if (!url.pathname.startsWith("/api/")) {
        return json({ ok: true, service: "cloud-vault-phone-api" }, 200, env, request);
      }

      if (url.pathname === "/api/request-otp" && request.method === "POST") {
        return await handleRequestOtp(request, env);
      }

      if (url.pathname === "/api/verify-otp" && request.method === "POST") {
        return await handleVerifyOtp(request, env);
      }

      if (url.pathname === "/api/session" && request.method === "GET") {
        return await handleSession(request, env);
      }

      if (url.pathname === "/api/vault" && request.method === "PUT") {
        return await handleSaveVault(request, env);
      }

      if (url.pathname === "/api/logout" && request.method === "POST") {
        return await handleLogout(request, env);
      }

      return json({ error: "Not found." }, 404, env, request);
    } catch (error) {
      return json({ error: error.message || "Unexpected error." }, error.status || 500, env, request);
    }
  },
};

async function ensureDatabaseSchema(env) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS phone_users (
          id TEXT PRIMARY KEY,
          phone TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          last_login_at TEXT
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS otp_codes (
          id TEXT PRIMARY KEY,
          phone_user_id TEXT NOT NULL,
          phone TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (phone_user_id) REFERENCES phone_users(id) ON DELETE CASCADE
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS phone_sessions (
          id TEXT PRIMARY KEY,
          phone_user_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (phone_user_id) REFERENCES phone_users(id) ON DELETE CASCADE
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS password_vaults (
          phone_user_id TEXT PRIMARY KEY,
          vault_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (phone_user_id) REFERENCES phone_users(id) ON DELETE CASCADE
        )
      `).run();

      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON otp_codes(phone);").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_otp_codes_user_id ON otp_codes(phone_user_id);").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_phone_sessions_token_hash ON phone_sessions(token_hash);").run();
    })();
  }

  return schemaReadyPromise;
}

async function handleRequestOtp(request, env) {
  const body = await readJson(request);
  const phone = normalizePhone(body.phone);
  if (!phone) {
    throw httpError(400, "Enter a valid phone number.");
  }

  const user = await getOrCreatePhoneUser(env, phone);
  const code = selectOtpCode(env);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString();

  await env.DB.prepare("DELETE FROM otp_codes WHERE phone_user_id = ?").bind(user.id).run();
  await env.DB.prepare(
    "INSERT INTO otp_codes (id, phone_user_id, phone, code_hash, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)"
  )
    .bind(crypto.randomUUID(), user.id, phone, await sha256(code), expiresAt, now.toISOString())
    .run();

  const payload = {
    ok: true,
    phone,
    expiresAt,
  };

  if (String(env.OTP_DEV_MODE || "true").toLowerCase() === "true") {
    payload.devCode = code;
  } else {
    throw httpError(501, "SMS delivery is not configured. Cloudflare alone cannot send OTP SMS.");
  }

  return json(payload, 200, env, request);
}

async function handleVerifyOtp(request, env) {
  const body = await readJson(request);
  const phone = normalizePhone(body.phone);
  const code = String(body.code || "").trim();

  if (!phone) {
    throw httpError(400, "Phone number is required.");
  }

  if (!/^\d{6}$/.test(code)) {
    throw httpError(400, "A 6-digit OTP is required.");
  }

  const now = new Date().toISOString();
  const otp = await env.DB.prepare(
    `SELECT otp_codes.id, otp_codes.phone_user_id, phone_users.phone
     FROM otp_codes
     JOIN phone_users ON phone_users.id = otp_codes.phone_user_id
     WHERE otp_codes.phone = ? AND otp_codes.code_hash = ? AND otp_codes.consumed_at IS NULL AND otp_codes.expires_at > ?
     ORDER BY otp_codes.created_at DESC
     LIMIT 1`
  )
    .bind(phone, await sha256(code), now)
    .first();

  if (!otp) {
    throw httpError(401, "Invalid or expired OTP.");
  }

  await env.DB.prepare("UPDATE otp_codes SET consumed_at = ? WHERE id = ?").bind(now, otp.id).run();
  await env.DB.prepare("UPDATE phone_users SET last_login_at = ? WHERE id = ?").bind(now, otp.phone_user_id).run();

  const session = await createSession(env, otp.phone_user_id);
  const vault = await loadVault(env, otp.phone_user_id);

  return json(
    {
      user: { id: otp.phone_user_id, phone: otp.phone },
      vault,
    },
    200,
    env,
    request,
    { "Set-Cookie": buildSessionCookie(session.token) }
  );
}

async function handleSession(request, env) {
  const user = await requireSession(request, env);
  return json(
    {
      user: { id: user.id, phone: user.phone },
      vault: await loadVault(env, user.id),
    },
    200,
    env,
    request
  );
}

async function handleSaveVault(request, env) {
  const user = await requireSession(request, env);
  const body = await readJson(request);
  const vault = sanitizeVault(body.vault);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO password_vaults (phone_user_id, vault_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(phone_user_id) DO UPDATE SET vault_json = excluded.vault_json, updated_at = excluded.updated_at`
  )
    .bind(user.id, JSON.stringify(vault), now)
    .run();

  return json({ ok: true, updatedAt: now }, 200, env, request);
}

async function handleLogout(request, env) {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (token) {
    await env.DB.prepare("DELETE FROM phone_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }

  return json({ ok: true }, 200, env, request, { "Set-Cookie": buildExpiredCookie() });
}

async function getOrCreatePhoneUser(env, phone) {
  let user = await env.DB.prepare("SELECT id, phone FROM phone_users WHERE phone = ?").bind(phone).first();
  if (user) {
    return user;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO phone_users (id, phone, created_at, last_login_at) VALUES (?, ?, ?, NULL)")
    .bind(id, phone, now)
    .run();

  return { id, phone };
}

async function requireSession(request, env) {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) {
    throw httpError(401, "Not logged in.");
  }

  const session = await env.DB.prepare(
    `SELECT phone_sessions.phone_user_id, phone_users.phone
     FROM phone_sessions
     JOIN phone_users ON phone_users.id = phone_sessions.phone_user_id
     WHERE phone_sessions.token_hash = ? AND phone_sessions.expires_at > ?
     LIMIT 1`
  )
    .bind(await sha256(token), new Date().toISOString())
    .first();

  if (!session) {
    throw httpError(401, "Session expired. Please log in again.");
  }

  return {
    id: session.phone_user_id,
    phone: session.phone,
  };
}

async function createSession(env, phoneUserId) {
  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  await env.DB.prepare("DELETE FROM phone_sessions WHERE phone_user_id = ?").bind(phoneUserId).run();
  await env.DB.prepare(
    "INSERT INTO phone_sessions (id, phone_user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), phoneUserId, await sha256(token), expiresAt, now.toISOString())
    .run();

  return { token, expiresAt };
}

async function loadVault(env, phoneUserId) {
  const row = await env.DB.prepare("SELECT vault_json FROM password_vaults WHERE phone_user_id = ?").bind(phoneUserId).first();
  return sanitizeVault(row?.vault_json ? JSON.parse(row.vault_json) : null);
}

function sanitizeVault(vault) {
  if (!vault || typeof vault !== "object" || !Array.isArray(vault.entries)) {
    return { version: 1, entries: [] };
  }

  return {
    version: 1,
    entries: vault.entries.map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      website: String(entry.website || ""),
      username: String(entry.username || ""),
      password: String(entry.password || ""),
      notes: String(entry.notes || ""),
      createdAt: String(entry.createdAt || new Date().toISOString()),
      updatedAt: String(entry.updatedAt || new Date().toISOString()),
    })),
  };
}

function selectOtpCode(env) {
  const fixed = String(env.OTP_FIXED_CODE || "").trim();
  if (/^\d{6}$/.test(fixed)) {
    return fixed;
  }

  const random = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(random).padStart(6, "0");
}

function normalizePhone(value) {
  const cleaned = String(value || "").trim().replace(/[^\d+]/g, "");
  if (!/^\+?\d{8,15}$/.test(cleaned)) {
    return "";
  }
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function buildSessionCookie(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
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
  const isAllowedOrigin = Boolean(origin && allowedOrigin && origin === allowedOrigin);

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

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
