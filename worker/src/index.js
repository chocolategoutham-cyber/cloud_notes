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
        return json({ ok: true, service: "cloud-vault-email-api" }, 200, env, request);
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
        CREATE TABLE IF NOT EXISTS email_users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          last_login_at TEXT
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS otp_codes (
          id TEXT PRIMARY KEY,
          email_user_id TEXT NOT NULL,
          email TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (email_user_id) REFERENCES email_users(id) ON DELETE CASCADE
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS email_sessions (
          id TEXT PRIMARY KEY,
          email_user_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (email_user_id) REFERENCES email_users(id) ON DELETE CASCADE
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS password_vaults (
          email_user_id TEXT PRIMARY KEY,
          vault_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (email_user_id) REFERENCES email_users(id) ON DELETE CASCADE
        )
      `).run();

      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_otp_codes_email ON otp_codes(email);").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_otp_codes_user_id ON otp_codes(email_user_id);").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_email_sessions_token_hash ON email_sessions(token_hash);").run();
    })();
  }

  return schemaReadyPromise;
}

async function handleRequestOtp(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!email) {
    throw httpError(400, "Enter a valid email address.");
  }

  const user = await getOrCreateEmailUser(env, email);
  const code = selectOtpCode(env);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString();

  await env.DB.prepare("DELETE FROM otp_codes WHERE email_user_id = ?").bind(user.id).run();
  await env.DB.prepare(
    "INSERT INTO otp_codes (id, email_user_id, email, code_hash, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)"
  )
    .bind(crypto.randomUUID(), user.id, email, await sha256(code), expiresAt, now.toISOString())
    .run();

  const messageSent = await sendOtpEmail(env, email, code).catch(() => false);
  const payload = { ok: true, email, expiresAt };

  if (!messageSent) {
    payload.devCode = code;
  }

  return json(payload, 200, env, request);
}

async function handleVerifyOtp(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const code = String(body.code || "").trim();

  if (!email) {
    throw httpError(400, "Email is required.");
  }

  if (!/^\d{6}$/.test(code)) {
    throw httpError(400, "A 6-digit OTP is required.");
  }

  const now = new Date().toISOString();
  const otp = await env.DB.prepare(
    `SELECT otp_codes.id, otp_codes.email_user_id, email_users.email
     FROM otp_codes
     JOIN email_users ON email_users.id = otp_codes.email_user_id
     WHERE otp_codes.email = ? AND otp_codes.code_hash = ? AND otp_codes.consumed_at IS NULL AND otp_codes.expires_at > ?
     ORDER BY otp_codes.created_at DESC
     LIMIT 1`
  )
    .bind(email, await sha256(code), now)
    .first();

  if (!otp) {
    throw httpError(401, "Invalid or expired OTP.");
  }

  await env.DB.prepare("UPDATE otp_codes SET consumed_at = ? WHERE id = ?").bind(now, otp.id).run();
  await env.DB.prepare("UPDATE email_users SET last_login_at = ? WHERE id = ?").bind(now, otp.email_user_id).run();

  const session = await createSession(env, otp.email_user_id);
  const vault = await loadVault(env, otp.email_user_id);

  return json(
    {
      user: { id: otp.email_user_id, email: otp.email },
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
      user: { id: user.id, email: user.email },
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
    `INSERT INTO password_vaults (email_user_id, vault_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(email_user_id) DO UPDATE SET vault_json = excluded.vault_json, updated_at = excluded.updated_at`
  )
    .bind(user.id, JSON.stringify(vault), now)
    .run();

  return json({ ok: true, updatedAt: now }, 200, env, request);
}

async function handleLogout(request, env) {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (token) {
    await env.DB.prepare("DELETE FROM email_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }

  return json({ ok: true }, 200, env, request, { "Set-Cookie": buildExpiredCookie() });
}

async function getOrCreateEmailUser(env, email) {
  let user = await env.DB.prepare("SELECT id, email FROM email_users WHERE email = ?").bind(email).first();
  if (user) {
    return user;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO email_users (id, email, created_at, last_login_at) VALUES (?, ?, ?, NULL)")
    .bind(id, email, now)
    .run();

  return { id, email };
}

async function requireSession(request, env) {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) {
    throw httpError(401, "Not logged in.");
  }

  const session = await env.DB.prepare(
    `SELECT email_sessions.email_user_id, email_users.email
     FROM email_sessions
     JOIN email_users ON email_users.id = email_sessions.email_user_id
     WHERE email_sessions.token_hash = ? AND email_sessions.expires_at > ?
     LIMIT 1`
  )
    .bind(await sha256(token), new Date().toISOString())
    .first();

  if (!session) {
    throw httpError(401, "Session expired. Please log in again.");
  }

  return {
    id: session.email_user_id,
    email: session.email,
  };
}

async function createSession(env, emailUserId) {
  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  await env.DB.prepare("DELETE FROM email_sessions WHERE email_user_id = ?").bind(emailUserId).run();
  await env.DB.prepare(
    "INSERT INTO email_sessions (id, email_user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), emailUserId, await sha256(token), expiresAt, now.toISOString())
    .run();

  return { token, expiresAt };
}

async function loadVault(env, emailUserId) {
  const row = await env.DB.prepare("SELECT vault_json FROM password_vaults WHERE email_user_id = ?").bind(emailUserId).first();
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

async function sendOtpEmail(env, email, code) {
  const resendApiKey = String(env.RESEND_API_KEY || "").trim();
  const from = String(env.OTP_EMAIL_FROM || "").trim();
  if (!resendApiKey || !from) {
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your Cloud Vault OTP",
      html: `<div style="font-family:Arial,sans-serif;color:#10213c"><h1 style="margin-bottom:12px">Cloud Vault</h1><p>Your one-time code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes.</p></div>`,
    }),
  });

  return response.ok;
}

function selectOtpCode(env) {
  const fixed = String(env.OTP_FIXED_CODE || "").trim();
  if (/^\d{6}$/.test(fixed)) {
    return fixed;
  }

  const random = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(random).padStart(6, "0");
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "";
  }
  return email;
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
