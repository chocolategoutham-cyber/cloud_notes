const SESSION_COOKIE = "cloud_notes_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    try {
      const url = new URL(request.url);

      if (!url.pathname.startsWith("/api/")) {
        return json({ ok: true, service: "cloud-notes-api" }, 200, env, request);
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

      const user = await requireSession(request, env);

      if (url.pathname === "/api/notes" && request.method === "GET") {
        return handleListNotes(request, env, user);
      }

      if (url.pathname === "/api/notes" && request.method === "POST") {
        return handleCreateNote(request, env, user);
      }

      const noteMatch = url.pathname.match(/^\/api\/notes\/([^/]+)$/);
      if (noteMatch && request.method === "PUT") {
        return handleUpdateNote(request, env, user, decodeURIComponent(noteMatch[1]));
      }

      if (noteMatch && request.method === "DELETE") {
        return handleDeleteNote(request, env, user, decodeURIComponent(noteMatch[1]));
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
  const headers = {
    ...corsHeaders(env, request),
    "Set-Cookie": buildSessionCookie(session.token),
  };

  return json(
    {
      user: { id: userId, username },
      repo: formatRepo(env),
    },
    201,
    env,
    request,
    headers
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
  const headers = {
    ...corsHeaders(env, request),
    "Set-Cookie": buildSessionCookie(session.token),
  };

  return json(
    {
      user: { id: user.id, username: user.username },
      repo: formatRepo(env),
    },
    200,
    env,
    request,
    headers
  );
}

async function handleLogout(request, env) {
  const cookieToken = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (cookieToken) {
    const tokenHash = await sha256(cookieToken);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }

  const headers = {
    ...corsHeaders(env, request),
    "Set-Cookie": buildExpiredCookie(),
  };
  return json({ ok: true }, 200, env, request, headers);
}

async function handleSession(request, env) {
  const user = await requireSession(request, env);
  return json(
    {
      user: { id: user.id, username: user.username },
      repo: formatRepo(env),
    },
    200,
    env,
    request
  );
}

async function handleListNotes(request, env, user) {
  const notes = await loadNotes(env, user.username);
  return json({ notes }, 200, env, request);
}

async function handleCreateNote(request, env, user) {
  const body = await readJson(request);
  const notes = await loadNotes(env, user.username);
  const now = new Date().toISOString();
  const note = {
    id: crypto.randomUUID(),
    title: sanitizeTitle(body.title),
    content: String(body.content || ""),
    createdAt: now,
    updatedAt: now,
  };

  notes.unshift(note);
  await saveNotes(env, user.username, notes);
  return json({ note }, 201, env, request);
}

async function handleUpdateNote(request, env, user, noteId) {
  const body = await readJson(request);
  const notes = await loadNotes(env, user.username);
  const index = notes.findIndex((note) => note.id === noteId);
  if (index === -1) {
    throw httpError(404, "Note not found.");
  }

  const updated = {
    ...notes[index],
    title: sanitizeTitle(body.title),
    content: String(body.content || ""),
    updatedAt: new Date().toISOString(),
  };

  notes[index] = updated;
  notes.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  await saveNotes(env, user.username, notes);
  return json({ note: updated }, 200, env, request);
}

async function handleDeleteNote(request, env, user, noteId) {
  const notes = await loadNotes(env, user.username);
  const nextNotes = notes.filter((note) => note.id !== noteId);
  if (nextNotes.length === notes.length) {
    throw httpError(404, "Note not found.");
  }

  await saveNotes(env, user.username, nextNotes);
  return json({ ok: true }, 200, env, request);
}

async function requireSession(request, env) {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) {
    throw httpError(401, "Not logged in.");
  }

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const session = await env.DB.prepare(
    `SELECT sessions.id, sessions.user_id, sessions.expires_at, users.username
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
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64UrlEncode(tokenBytes);
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), userId, tokenHash, expiresAt, now.toISOString())
    .run();

  return { token, expiresAt };
}

async function loadNotes(env, username) {
  const repoFile = await getGitHubFile(env, notesPath(username));
  if (!repoFile) {
    return [];
  }

  const decrypted = await decryptForUser(env, username, repoFile.content);
  const notes = JSON.parse(decrypted);
  return Array.isArray(notes) ? notes : [];
}

async function saveNotes(env, username, notes) {
  const normalized = notes
    .map((note) => ({
      id: note.id,
      title: sanitizeTitle(note.title),
      content: String(note.content || ""),
      createdAt: note.createdAt || new Date().toISOString(),
      updatedAt: note.updatedAt || new Date().toISOString(),
    }))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  const encrypted = await encryptForUser(env, username, JSON.stringify(normalized));
  const path = notesPath(username);
  const existing = await getGitHubFile(env, path);
  await putGitHubFile(env, path, encrypted, existing?.sha);
}

function notesPath(username) {
  return `users/${username}/notes.enc.json`;
}

async function getGitHubFile(env, path) {
  const url = buildGitHubUrl(env, path, true);
  const response = await fetch(url, {
    headers: githubHeaders(env),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw httpError(502, `GitHub read failed: ${await readGitHubError(response)}`);
  }

  const data = await response.json();
  return {
    sha: data.sha,
    content: decodeBase64(data.content.replaceAll("\n", "")),
  };
}

async function putGitHubFile(env, path, content, sha) {
  const body = {
    message: `Sync notes for ${path}`,
    content: encodeBase64(content),
    branch: env.GITHUB_BRANCH || "main",
  };

  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(buildGitHubUrl(env, path, false), {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw httpError(502, `GitHub write failed: ${await readGitHubError(response)}`);
  }
}

function githubHeaders(env) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function buildGitHubUrl(env, path, includeRef) {
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${encodedPath}`
  );
  if (includeRef) {
    url.searchParams.set("ref", env.GITHUB_BRANCH || "main");
  }
  return url.toString();
}

async function encryptForUser(env, username, plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveUserKey(env.APP_ENCRYPTION_SECRET, username, salt);
  const data = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);

  return JSON.stringify({
    version: 1,
    salt: base64UrlEncode(salt),
    iv: base64UrlEncode(iv),
    cipherText: base64UrlEncode(new Uint8Array(cipherBuffer)),
  });
}

async function decryptForUser(env, username, encryptedJson) {
  const payload = JSON.parse(encryptedJson);
  const salt = base64UrlDecode(payload.salt);
  const iv = base64UrlDecode(payload.iv);
  const cipherText = base64UrlDecode(payload.cipherText);
  const key = await deriveUserKey(env.APP_ENCRYPTION_SECRET, username, salt);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherText);
  return new TextDecoder().decode(plainBuffer);
}

async function deriveUserKey(secret, username, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${secret}:${username}`),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 200000,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
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
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

function sanitizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function sanitizeTitle(value) {
  const title = String(value || "").trim();
  return title || "Untitled note";
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
    return {
      Vary: "Origin",
    };
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    Vary: "Origin",
  };
}

function formatRepo(env) {
  return `${env.GITHUB_OWNER}/${env.GITHUB_REPO}@${env.GITHUB_BRANCH || "main"}`;
}

async function readGitHubError(response) {
  try {
    const payload = await response.json();
    return payload.message || `status ${response.status}`;
  } catch {
    return `status ${response.status}`;
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
