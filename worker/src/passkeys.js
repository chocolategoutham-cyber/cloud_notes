const SESSION_COOKIE = "cloud_vault_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const CHALLENGE_TTL_MS = 1000 * 60 * 5;
const PASSKEY_ALG_ES256 = -7;
const PASSKEY_LABEL_DEFAULT = "Passkey";

function nowIso() {
  return new Date().toISOString();
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function base64UrlEncode(bytes) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = "";
  for (let i = 0; i < array.length; i += 1) {
    binary += String.fromCharCode(array[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4 || 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sha256Bytes(value) {
  const data = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

function randomToken(size = 32) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(size)));
}

function getOrigin(request, env) {
  const origin = request.headers.get("Origin") || env.FRONTEND_ORIGIN || "";
  return origin;
}

function getRpId(origin, fallbackHost) {
  try {
    return new URL(origin).hostname;
  } catch {
    return fallbackHost;
  }
}

function buildJson(payload, status, env, request, extraHeaders = {}) {
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

function normalizeCredentialId(body) {
  return String(body?.id || body?.rawId || "");
}

function decodeClientDataJSON(body) {
  const clientDataJSON = body?.response?.clientDataJSON;
  if (!clientDataJSON) {
    throw new Error("Missing clientDataJSON.");
  }
  const bytes = base64UrlDecode(clientDataJSON);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

function decodeBytesField(field, label) {
  if (!field) {
    throw new Error(`Missing ${label}.`);
  }
  return base64UrlDecode(field);
}

function parseAuthenticatorData(authenticatorDataBytes) {
  if (!(authenticatorDataBytes instanceof Uint8Array) || authenticatorDataBytes.length < 37) {
    throw new Error("Invalid authenticatorData.");
  }

  const flags = authenticatorDataBytes[32];
  const counter =
    ((authenticatorDataBytes[33] << 24) >>> 0) |
    ((authenticatorDataBytes[34] << 16) >>> 0) |
    ((authenticatorDataBytes[35] << 8) >>> 0) |
    (authenticatorDataBytes[36] >>> 0);

  return {
    flags,
    counter,
    userPresent: Boolean(flags & 0x01),
  };
}

async function verifySignature({ publicKeyBytes, authenticatorDataBytes, clientDataJSONBytes, signatureBytes }) {
  const publicKey = await crypto.subtle.importKey(
    "spki",
    publicKeyBytes.buffer.slice(publicKeyBytes.byteOffset, publicKeyBytes.byteOffset + publicKeyBytes.byteLength),
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false,
    ["verify"]
  );

  const clientHash = await sha256Bytes(clientDataJSONBytes);
  const signedData = new Uint8Array(authenticatorDataBytes.length + clientHash.length);
  signedData.set(authenticatorDataBytes, 0);
  signedData.set(clientHash, authenticatorDataBytes.length);

  return crypto.subtle.verify(
    {
      name: "ECDSA",
      hash: "SHA-256",
    },
    publicKey,
    signatureBytes.buffer.slice(signatureBytes.byteOffset, signatureBytes.byteOffset + signatureBytes.byteLength),
    signedData.buffer
  );
}

async function getUserBySession(request, env) {
  const cookieHeader = request.headers.get("Cookie");
  const cookieToken = getCookie(cookieHeader, SESSION_COOKIE);
  if (!cookieToken) {
    return null;
  }

  const tokenHash = await sha256(cookieToken);
  const session = await env.DB.prepare(
    `SELECT s.user_id, s.totp_verified, u.id, u.username, u.totp_enabled
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now')
     LIMIT 1`
  )
    .bind(tokenHash)
    .first();

  if (!session) {
    return null;
  }

  return {
    id: session.id,
    username: session.username,
    totpEnabled: Boolean(session.totp_enabled),
    totpVerified: Boolean(session.totp_verified),
  };
}

async function requireSession(request, env) {
  const user = await getUserBySession(request, env);
  if (!user) {
    throw httpError(401, "Not logged in.");
  }
  return user;
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").map((pair) => pair.trim());
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const cookieName = cookie.slice(0, separator).trim();
    const cookieValue = cookie.slice(separator + 1).trim();
    if (cookieName === name) {
      return cookieValue;
    }
  }
  return null;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildSessionCookie(env, request, token) {
  const origin = request.headers.get("Origin") || env.FRONTEND_ORIGIN || "";
  const sameSite = origin ? "None" : "Lax";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

async function createSession(env, request, userId, totpVerified = true) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const createdAt = nowIso();
  const sessionId = randomToken(16);

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, totp_verified)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(sessionId, userId, tokenHash, expiresAt, createdAt, totpVerified ? 1 : 0)
    .run();

  const cookie = await buildSessionCookie(env, request, token);
  return {
    id: sessionId,
    token,
    cookie,
    expiresAt,
  };
}

async function cleanupExpiredChallenges(env) {
  await env.DB.prepare(`DELETE FROM webauthn_challenges WHERE expires_at <= datetime('now')`).run();
}

function buildRegistrationOptions({ challenge, rpId, userId, username }) {
  const encodedUserId = base64UrlEncode(new TextEncoder().encode(String(userId || username)));
  return {
    challenge,
    rp: {
      name: "Cloud Vault",
      id: rpId,
    },
    user: {
      id: encodedUserId,
      name: username,
      displayName: username,
    },
    pubKeyCredParams: [{ type: "public-key", alg: PASSKEY_ALG_ES256 }],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
    excludeCredentials: [],
  };
}

function buildLoginOptions({ challenge, rpId, allowCredentials = [] }) {
  return {
    challenge,
    rpId,
    timeout: 60000,
    userVerification: "preferred",
    allowCredentials,
  };
}

async function storeChallenge(env, { userId = null, challenge, kind, rpId }) {
  const id = randomToken(16);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO webauthn_challenges (id, user_id, challenge, kind, rp_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, userId, challenge, kind, rpId, expiresAt, nowIso())
    .run();
  return { id, expiresAt };
}

async function loadChallenge(env, challenge, kind, userId = null) {
  const query = userId
    ? `SELECT * FROM webauthn_challenges WHERE challenge = ? AND kind = ? AND user_id = ? AND expires_at > datetime('now') LIMIT 1`
    : `SELECT * FROM webauthn_challenges WHERE challenge = ? AND kind = ? AND expires_at > datetime('now') LIMIT 1`;
  const statement = userId
    ? env.DB.prepare(query).bind(challenge, kind, userId)
    : env.DB.prepare(query).bind(challenge, kind);
  return statement.first();
}

async function deleteChallenge(env, challengeId) {
  await env.DB.prepare(`DELETE FROM webauthn_challenges WHERE id = ?`).bind(challengeId).run();
}

async function getPasskeysForUser(env, userId) {
  return env.DB.prepare(
    `SELECT credential_id, label FROM passkeys WHERE user_id = ? ORDER BY created_at DESC`
  )
    .bind(userId)
    .all();
}

async function getPasskeyByCredential(env, credentialId) {
  return env.DB.prepare(
    `SELECT p.*, u.id AS user_id, u.username, u.totp_enabled
     FROM passkeys p
     INNER JOIN users u ON u.id = p.user_id
     WHERE p.credential_id = ?
     LIMIT 1`
  )
    .bind(credentialId)
    .first();
}

function credentialListToAllowCredentials(items = []) {
  return items.map((item) => ({
    type: "public-key",
    id: item.credential_id,
  }));
}

export async function handlePasskeyRegisterOptions(request, env) {
  const user = await requireSession(request, env);
  await cleanupExpiredChallenges(env);

  const origin = getOrigin(request, env);
  const rpId = getRpId(origin, new URL(origin || request.url).hostname);
  const challenge = randomToken(32);
  await storeChallenge(env, { userId: user.id, challenge, kind: "register", rpId });

  const publicKey = buildRegistrationOptions({
    challenge,
    rpId,
    userId: user.id,
    username: user.username,
  });

  const existing = await getPasskeysForUser(env, user.id);
  publicKey.excludeCredentials = credentialListToAllowCredentials(existing.results || []);

  return {
    publicKey,
  };
}

export async function handlePasskeyRegisterVerify(request, env) {
  const user = await requireSession(request, env);
  const body = await request.json();

  const clientData = decodeClientDataJSON(body);
  if (clientData.type !== "webauthn.create") {
    throw new Error("Invalid WebAuthn response type.");
  }

  const origin = getOrigin(request, env);
  if (clientData.origin !== origin) {
    throw new Error("Invalid WebAuthn origin.");
  }

  const challengeRow = await loadChallenge(env, clientData.challenge, "register", user.id);
  if (!challengeRow) {
    throw new Error("Passkey registration challenge expired.");
  }

  const rpId = getRpId(origin, new URL(origin || request.url).hostname);
  const authenticatorDataField = body?.response?.authenticatorData;
  let authenticatorDataBytes = null;
  if (authenticatorDataField) {
    authenticatorDataBytes = decodeBytesField(authenticatorDataField, "authenticatorData");
    const parsed = parseAuthenticatorData(authenticatorDataBytes);
    if (!parsed.userPresent) {
      throw new Error("Passkey registration must include user presence.");
    }

    const expectedRpHash = await sha256Bytes(new TextEncoder().encode(rpId));
    const rpHash = authenticatorDataBytes.slice(0, 32);
    if (!bufferEquals(rpHash, expectedRpHash)) {
      throw new Error("Invalid relying party.");
    }
  }

  const credentialId = normalizeCredentialId(body);
  const publicKey = body?.response?.publicKey;
  const publicKeyAlgorithm = Number(body?.response?.publicKeyAlgorithm ?? PASSKEY_ALG_ES256);
  if (!credentialId || !publicKey) {
    throw new Error("Missing passkey credential data.");
  }

  const label = String(body?.label || PASSKEY_LABEL_DEFAULT);
  const counter = authenticatorDataBytes ? parseAuthenticatorData(authenticatorDataBytes).counter : 0;

  await env.DB.prepare(
    `INSERT INTO passkeys (id, user_id, credential_id, public_key_jwk, counter, label, public_key_algorithm, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      randomToken(16),
      user.id,
      credentialId,
      publicKey,
      counter,
      label,
      publicKeyAlgorithm,
      nowIso(),
      nowIso()
    )
    .run();

  await deleteChallenge(env, challengeRow.id);
  return {
    ok: true,
  };
}

export async function handlePasskeyLoginOptions(request, env) {
  await cleanupExpiredChallenges(env);
  const body = await request.json().catch(() => ({}));
  const username = String(body?.username || "").trim();

  const origin = getOrigin(request, env);
  const rpId = getRpId(origin, new URL(origin || request.url).hostname);
  const challenge = randomToken(32);

  let allowCredentials = [];
  let userId = null;
  if (username) {
    const user = await env.DB.prepare(`SELECT id FROM users WHERE username = ? LIMIT 1`).bind(username).first();
    if (user) {
      userId = user.id;
      const passkeys = await getPasskeysForUser(env, user.id);
      allowCredentials = credentialListToAllowCredentials(passkeys.results || []);
    }
  }

  await storeChallenge(env, { userId, challenge, kind: "login", rpId });

  return {
    publicKey: buildLoginOptions({
      challenge,
      rpId,
      allowCredentials,
    }),
  };
}

export async function handlePasskeyLoginVerify(request, env) {
  const body = await request.json();
  const credentialId = normalizeCredentialId(body);
  if (!credentialId) {
    throw new Error("Missing passkey credential id.");
  }

  const passkey = await getPasskeyByCredential(env, credentialId);
  if (!passkey) {
    throw new Error("Unknown passkey.");
  }

  const clientData = decodeClientDataJSON(body);
  if (clientData.type !== "webauthn.get") {
    throw new Error("Invalid WebAuthn response type.");
  }

  const origin = getOrigin(request, env);
  if (clientData.origin !== origin) {
    throw new Error("Invalid WebAuthn origin.");
  }

  const challengeRow = await loadChallenge(env, clientData.challenge, "login");
  if (!challengeRow) {
    throw new Error("Passkey login challenge expired.");
  }

  const authenticatorDataBytes = decodeBytesField(body?.response?.authenticatorData, "authenticatorData");
  const signatureBytes = decodeBytesField(body?.response?.signature, "signature");
  const clientDataBytes = decodeBytesField(body?.response?.clientDataJSON, "clientDataJSON");

  const parsed = parseAuthenticatorData(authenticatorDataBytes);
  if (!parsed.userPresent) {
    throw new Error("Passkey login must include user presence.");
  }

  const rpId = getRpId(origin, new URL(origin || request.url).hostname);
  const expectedRpHash = await sha256Bytes(new TextEncoder().encode(rpId));
  const rpHash = authenticatorDataBytes.slice(0, 32);
  if (!bufferEquals(rpHash, expectedRpHash)) {
    throw new Error("Invalid relying party.");
  }

  const publicKeyBytes = base64UrlDecode(passkey.public_key_jwk);
  if (Number(passkey.public_key_algorithm || PASSKEY_ALG_ES256) !== PASSKEY_ALG_ES256) {
    throw new Error("Unsupported passkey algorithm.");
  }

  const verified = await verifySignature({
    publicKeyBytes,
    authenticatorDataBytes,
    clientDataJSONBytes: clientDataBytes,
    signatureBytes,
  });

  if (!verified) {
    throw new Error("Invalid passkey signature.");
  }

  const counter = parsed.counter;
  if (typeof counter === "number" && counter > Number(passkey.counter || 0)) {
    await env.DB.prepare(
      `UPDATE passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?`
    )
      .bind(counter, nowIso(), credentialId)
      .run();
  } else {
    await env.DB.prepare(`UPDATE passkeys SET last_used_at = ? WHERE credential_id = ?`)
      .bind(nowIso(), credentialId)
      .run();
  }

  await deleteChallenge(env, challengeRow.id);
  return {
    userId: passkey.user_id,
    username: passkey.username,
  };
}

function bufferEquals(left, right) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
