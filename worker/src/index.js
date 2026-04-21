const SESSION_COOKIE = "cloud_vault_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    try {
      const url = new URL(request.url);

      if (!url.pathname.startsWith("/api/")) {
        return json({ ok: true, service: "cloud-vault-api" }, 200, env, request);
      }

      if (url.pathname === "/api/signup" && request.method === "POST") {
        return handleSignup(request, env);
      }

      if (url.pathname === "/api/login" && request.method === "POST") {
        return handleLogin(request, env);
      }

      if (url.pathname === "/api/logout" && request.method === "POST") {
        return handleLogout(request, env);
      }

      if (url.pathname === "/api/session" && request.method === "GET") {
        return handleSession(request, env);
      }

      if (url.pathname === "/api/vault" && request.method === "PUT") {
        return handleSaveVault(request, env);
      }

      return json({ error: "Not found." }, 404, env, request);
    } catch (error) {
      return json({ error: error.message || "Unexpected error." }, error.status || 500, env, request);
    }
  },
};

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
    "INSERT INTO users (id, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(userId, username, passwordHash, salt, createdAt)
    .run();

  const session = await createSession(env, userId);
  return json(
    {
      user: { id: userId, username },
      vault: null,
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

  const session = await createSession(env, user.id);
  const vault = await env.DB.prepare("SELECT encrypted_vault FROM vaults WHERE user_id = ?").bind(user.id).first();

  return json(
    {
      user: { id: user.id, username: user.username },
      vault: vault?.encrypted_vault ? JSON.parse(vault.encrypted_vault) : null,
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

  return json(
    {
      user: { id: user.id, username: user.username },
      vault: vault?.encrypted_vault ? JSON.parse(vault.encrypted_vault) : null,
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

async function requireSession(request, env) {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) {
    throw httpError(401, "Not logged in.");
  }

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const session = await env.DB.prepare(
    `SELECT sessions.user_id, users.username
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
  )
    .bind(tokenHash, now)
    .first();

  if (!session) {
    throw httpError(401, "Session expired. Please log in again.");
  }

  return {
    id: session.user_id,
    username: session.username,
  };
}

async function createSession(env, userId) {
  const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), userId, tokenHash, expiresAt, now.toISOString())
    .run();

  return { token };
}

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
      iterations: 310000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return base64UrlEncode(new Uint8Array(bits));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${envSafeSalt(value)}`));
  return base64UrlEncode(new Uint8Array(digest));
}

function envSafeSalt(value) {
  return String(value || "");
}

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
  if (!origin || !allowedOrigin || origin !== allowedOrigin) {
    return { Vary: "Origin" };
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
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
