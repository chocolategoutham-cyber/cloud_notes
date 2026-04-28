const API_BASE = "https://cloud-notes-api.cloud-notes-api.workers.dev";
const PBKDF2_ITERATIONS = 250000;

const state = {
  installPrompt: null,
  toastTimeout: null,
  session: null,
  vault: null,
  encryptedVault: null,
  selectedId: null,
  search: "",
  loading: false,
  encryptionPassword: "",
  // TOTP state
  totp2faRequired: false,   // true when login returned totpRequired
  totpSecret: null,         // secret generated client-side during setup
  totpUri: null,
  totpSetupMode: false,     // true when showing the setup screen after signup
  // Temporary password held until TOTP verify completes
  pendingPassword: "",
};

const refs = {
  // Pages
  authPage: document.querySelector("#auth-page"),
  vaultPage: document.querySelector("#vault-page"),
  // Auth screens container
  authMainScreen: document.querySelector("#auth-main-screen"),
  totpVerifyScreen: document.querySelector("#totp-verify-screen"),
  totpSetupScreen: document.querySelector("#totp-setup-screen"),
  // Login/Signup forms
  loginForm: document.querySelector("#login-form"),
  signupForm: document.querySelector("#signup-form"),
  loginUsername: document.querySelector("#login-username"),
  loginPassword: document.querySelector("#login-password"),
  passkeyLoginButton: document.querySelector("#passkey-login-button"),
  signupUsername: document.querySelector("#signup-username"),
  signupPassword: document.querySelector("#signup-password"),
  signupPasswordConfirm: document.querySelector("#signup-password-confirm"),
  // TOTP Verify
  totpVerifyForm: document.querySelector("#totp-verify-form"),
  totpVerifyInput: document.querySelector("#totp-verify-input"),
  // TOTP Setup
  totpSetupForm: document.querySelector("#totp-setup-form"),
  totpSetupInput: document.querySelector("#totp-setup-input"),
  totpSecretText: document.querySelector("#totp-secret-text"),
  qrcodeContainer: document.querySelector("#qrcode-container"),
  copySecretButton: document.querySelector("#copy-secret-button"),
  skipTotpButton: document.querySelector("#skip-totp-button"),
  // Vault header
  currentUser: document.querySelector("#current-user"),
  lockButton: document.querySelector("#lock-button"),
  logoutButton: document.querySelector("#logout-button"),
  // Vault main
  entryCount: document.querySelector("#entry-count"),
  searchInput: document.querySelector("#search-input"),
  entryList: document.querySelector("#entry-list"),
  newEntryButton: document.querySelector("#new-entry-button"),
  syncButton: document.querySelector("#sync-button"),
  registerPasskeyButton: document.querySelector("#register-passkey-button"),
  syncStatus: document.querySelector("#sync-status"),
  // Vault editor
  editorEmpty: document.querySelector("#editor-empty"),
  editorContent: document.querySelector("#editor-content"),
  editorTitle: document.querySelector("#editor-title"),
  editorUpdated: document.querySelector("#editor-updated"),
  entryForm: document.querySelector("#entry-form"),
  entryWebsite: document.querySelector("#entry-website"),
  entryUsername: document.querySelector("#entry-username"),
  entryPassword: document.querySelector("#entry-password"),
  entryNotes: document.querySelector("#entry-notes"),
  togglePasswordButton: document.querySelector("#toggle-password-button"),
  copyPasswordButton: document.querySelector("#copy-password-button"),
  generatePasswordButton: document.querySelector("#generate-password-button"),
  deleteEntryButton: document.querySelector("#delete-entry-button"),
  // Toast
  toast: document.querySelector("#toast"),
};

document.addEventListener("DOMContentLoaded", () => {
  void initializeApp();
});

async function initializeApp() {
  bindEvents();
  registerServiceWorker();
  await hydrateSession();
}

function bindEvents() {
  // Tab switching
  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      tabBtns.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active-tab"));

      btn.classList.add("active");
      if (tab === "login") {
        refs.loginForm.classList.add("active-tab");
      } else {
        refs.signupForm.classList.add("active-tab");
      }
    });
  });

  refs.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void login();
  });

  refs.passkeyLoginButton?.addEventListener("click", () => void loginWithPasskey());

  refs.signupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void signup();
  });

  refs.totpVerifyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void verifyTotp();
  });

  refs.totpSetupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void confirmTotpSetup();
  });

  refs.skipTotpButton.addEventListener("click", () => void skipTotpSetup());
  refs.copySecretButton.addEventListener("click", () => copyTotpSecret());

  // Auto-format TOTP inputs (only accept numbers)
  [refs.totpVerifyInput, refs.totpSetupInput].forEach((input) => {
    if (input) {
      input.addEventListener("input", (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, "");
      });
    }
  });

  refs.logoutButton.addEventListener("click", () => void logout());
  refs.lockButton.addEventListener("click", () => lockVault("Vault locked."));
  refs.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderEntryList();
  });
  refs.newEntryButton.addEventListener("click", () => startNewEntry());
  refs.syncButton.addEventListener("click", () => void persistVaultToBackend("Vault saved to Cloudflare."));
  refs.entryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveEntry();
  });
  refs.deleteEntryButton.addEventListener("click", () => void deleteEntry());

  refs.registerPasskeyButton?.addEventListener("click", () => void registerPasskey());

  refs.togglePasswordButton.addEventListener("click", () => {
    refs.entryPassword.type = refs.entryPassword.type === "password" ? "text" : "password";
    refs.togglePasswordButton.textContent = refs.entryPassword.type === "password" ? "👁️" : "🙈";
  });

  refs.copyPasswordButton.addEventListener("click", async () => {
    if (!refs.entryPassword.value) {
      showToast("No password to copy.");
      return;
    }
    await navigator.clipboard.writeText(refs.entryPassword.value);
    showToast("Password copied.");
  });

  refs.generatePasswordButton.addEventListener("click", () => {
    refs.entryPassword.value = generatePassword();
    refs.entryPassword.type = "text";
    refs.togglePasswordButton.textContent = "🙈";
    showToast("Strong password generated.");
  });
}

// ─── Screen Management ────────────────────────────────────────────────────────

function setActiveAuthForm(form) {
  document.querySelectorAll(".auth-form").forEach((item) => {
    item.classList.remove("active-tab");
  });

  if (form) {
    form.classList.add("active-tab");
  }
}

function showScreen(screenName) {
  document.querySelectorAll(".auth-screen").forEach((screen) => {
    screen.classList.remove("active-auth-screen");
  });

  const screen = document.querySelector(`#${screenName}`);
  if (screen) {
    screen.classList.add("active-auth-screen");
  }

  if (screenName === "totp-verify-screen") {
    setActiveAuthForm(refs.totpVerifyForm);
    return;
  }

  if (screenName === "totp-setup-screen") {
    setActiveAuthForm(refs.totpSetupForm);
    return;
  }

  if (screenName === "auth-main-screen") {
    const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab || "login";
    setActiveAuthForm(activeTab === "signup" ? refs.signupForm : refs.loginForm);
  }
}

// ─── Page Navigation ──────────────────────────────────────────────────────────

function showAuthPage() {
  refs.authPage.classList.add("active-page");
  refs.vaultPage.classList.remove("active-page");
}

function showVaultPage() {
  refs.authPage.classList.remove("active-page");
  refs.vaultPage.classList.add("active-page");
}

// ─── TOTP Utilities ───────────────────────────────────────────────────────────

function generateTotpSecret() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const random = crypto.getRandomValues(new Uint8Array(32));
  let secret = "";
  for (const byte of random) {
    secret += chars[byte % chars.length];
  }
  return secret;
}

function generateTotpUri(secret, username, issuer = "Cloud Vault") {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedUser = encodeURIComponent(username);
  return `otpauth://totp/${encodedIssuer}:${encodedUser}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

function generateQrCode(uri) {
  const container = refs.qrcodeContainer;
  if (!container) return;

  container.innerHTML = "";

  if (window.QRCode) {
    const qrHost = document.createElement("div");
    qrHost.className = "qrcode-render";
    container.appendChild(qrHost);

    new window.QRCode(qrHost, {
      text: uri,
      width: 220,
      height: 220,
      colorDark: "#152238",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M,
    });

    return;
  }

  const fallback = document.createElement("div");
  fallback.className = "qrcode-fallback";

  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent = "QR generator failed to load. Copy the secret below into your authenticator app.";

  const code = document.createElement("code");
  code.className = "totp-uri";
  code.textContent = uri;

  fallback.append(note, code);
  container.appendChild(fallback);
}

function copyTotpSecret() {
  const secret = state.totpSecret;
  if (!secret) return;

  navigator.clipboard.writeText(secret).then(() => {
    const btn = refs.copySecretButton;
    const originalText = btn.textContent;
    btn.textContent = "✓ Copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove("copied");
    }, 2000);
  });
}

// ─── TOTP Verify (during login) ───────────────────────────────────────────────

async function verifyTotp() {
  const code = refs.totpVerifyInput.value.trim();

  if (code.length !== 6) {
    showToast("Please enter a 6-digit code.");
    return;
  }

  await withLoading(async () => {
    const response = await api("/verify-totp", {
      method: "POST",
      body: JSON.stringify({ code }),
    });

    if (response.verified) {
      // Backend returns user + vault after successful TOTP
      state.session = response.user;
      state.encryptedVault = response.vault;
      state.totp2faRequired = false;
      refs.totpVerifyInput.value = "";

      // Decrypt vault with the password saved before TOTP step
      if (state.encryptedVault && state.pendingPassword) {
        try {
          state.vault = await decryptVault(state.encryptedVault, state.pendingPassword);
          state.selectedId = state.vault.entries[0]?.id ?? null;
        } catch {
          showToast("Failed to decrypt vault. Password may be incorrect.");
          state.vault = null;
          state.selectedId = null;
        }
      } else {
        state.vault = createEmptyVault();
        state.selectedId = null;
      }

      state.encryptionPassword = state.pendingPassword;
      state.rememberedPassword = state.pendingPassword;
      state.pendingPassword = "";
      render();
      showToast("2FA verified. Welcome back!");
    } else {
      showToast("Invalid code. Please try again.");
    }
  });
}

// ─── TOTP Setup (after signup) ────────────────────────────────────────────────

async function confirmTotpSetup() {
  const code = refs.totpSetupInput.value.trim();

  if (code.length !== 6) {
    showToast("Please enter a 6-digit code.");
    return;
  }

  await withLoading(async () => {
    const response = await api("/setup-totp", {
      method: "POST",
      body: JSON.stringify({
        secret: state.totpSecret,
        code,
      }),
    });

    if (response.success) {
      state.totpSetupMode = false;
      state.totpSecret = null;
      state.totpUri = null;
      refs.totpSetupInput.value = "";
      showToast("2FA enabled! Your authenticator is now active.");
      render();
    } else {
      showToast(response.error || "Invalid code. Please check and try again.");
    }
  });
}

async function skipTotpSetup() {
  state.totpSetupMode = false;
  state.totpSecret = null;
  state.totpUri = null;
  render();
}

// ─── Session ──────────────────────────────────────────────────────────────────

async function hydrateSession() {
  try {
    const session = await api("/session");
    state.session = session.user;
    state.encryptedVault = session.vault;
  } catch {
    state.session = null;
    state.encryptedVault = null;
  }
  render();
}

// ─── Signup ───────────────────────────────────────────────────────────────────

async function signup() {
  const username = refs.signupUsername.value.trim();
  const password = refs.signupPassword.value;
  const confirm = refs.signupPasswordConfirm.value;

  if (username.length < 3) {
    showToast("Username must be at least 3 characters.");
    return;
  }
  if (password.length < 10) {
    showToast("Password must be at least 10 characters.");
    return;
  }
  if (password !== confirm) {
    showToast("Passwords do not match.");
    return;
  }

  await withLoading(async () => {
    const response = await api("/signup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.session = response.user;
    state.encryptionPassword = password;
    state.rememberedPassword = password;
    state.vault = createEmptyVault();
    state.encryptedVault = null;

    // Offer TOTP setup — generate secret client-side
    state.totpSetupMode = true;
    state.totpSecret = generateTotpSecret();
    state.totpUri = generateTotpUri(state.totpSecret, username);

    refs.signupForm.reset();
    refs.loginForm.reset();
    refs.totpSecretText.textContent = state.totpSecret;
    generateQrCode(state.totpUri);
    refs.totpSetupInput.value = "";

    render(); // will call showScreen("totp-setup-screen")
    // Focus after render so the element is visible
    setTimeout(() => refs.totpSetupInput.focus(), 50);
    showToast("Account created! Set up 2FA for extra security.");
  });
}

// ─── Login ────────────────────────────────────────────────────────────────────

async function login() {
  const username = refs.loginUsername.value.trim();
  const password = refs.loginPassword.value;

  await withLoading(async () => {
    const response = await api("/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    if (response.totpRequired) {
      // Save password so we can decrypt vault after TOTP succeeds
      state.pendingPassword = password;
      state.totp2faRequired = true;
      refs.loginForm.reset();
      refs.totpVerifyInput.value = "";
      render(); // will call showScreen("totp-verify-screen")
      setTimeout(() => refs.totpVerifyInput.focus(), 50);
      showToast("Enter your authenticator code.");
      return;
    }

    // No TOTP required
    state.session = response.user;
    state.encryptedVault = response.vault;
    state.encryptionPassword = password;
    state.rememberedPassword = password;

    if (state.encryptedVault) {
      try {
        state.vault = await decryptVault(state.encryptedVault, password);
        state.selectedId = state.vault.entries[0]?.id ?? null;
      } catch {
        showToast("Failed to decrypt vault. Password may be incorrect.");
        state.vault = null;
        state.selectedId = null;
      }
    } else {
      state.vault = createEmptyVault();
      state.selectedId = null;
    }

    refs.loginForm.reset();
    render();
    showToast("Logged in successfully.");
  });
}

// ─── Logout / Lock ────────────────────────────────────────────────────────────

async function logout() {
  await withLoading(async () => {
    await api("/logout", { method: "POST" });
    state.session = null;
    state.vault = null;
    state.encryptedVault = null;
    state.encryptionPassword = "";
    state.pendingPassword = "";
    state.selectedId = null;
    state.search = "";
    state.totp2faRequired = false;
    state.totpSecret = null;
    state.totpUri = null;
    state.totpSetupMode = false;
    refs.searchInput.value = "";
    render();
    showToast("Logged out.");
  });
}

function lockVault(message) {
  state.vault = null;
  state.encryptionPassword = "";
  state.selectedId = null;
  render();
  if (message) {
    showToast(message);
  }
}

// ─── Vault Entries ────────────────────────────────────────────────────────────

function startNewEntry() {
  state.selectedId = null;
  refs.entryForm.hidden = false;
  refs.editorEmpty.hidden = true;
  refs.editorTitle.textContent = "New password entry";
  refs.editorUpdated.textContent = "Unsaved";
  refs.entryForm.reset();
  refs.entryPassword.type = "password";
  refs.togglePasswordButton.textContent = "Show";
}

async function saveEntry() {
  const entry = {
    id: state.selectedId || crypto.randomUUID(),
    website: refs.entryWebsite.value.trim(),
    username: refs.entryUsername.value.trim(),
    password: refs.entryPassword.value,
    notes: refs.entryNotes.value,
    updatedAt: new Date().toISOString(),
  };

  if (!entry.website) {
    showToast("Website is required.");
    return;
  }

  const existingIndex = state.vault.entries.findIndex((item) => item.id === entry.id);
  if (existingIndex === -1) {
    entry.createdAt = entry.updatedAt;
    state.vault.entries.unshift(entry);
  } else {
    entry.createdAt = state.vault.entries[existingIndex].createdAt;
    state.vault.entries[existingIndex] = entry;
  }

  state.vault.entries.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  state.selectedId = entry.id;
  await persistVaultToBackend("Vault saved.");
  render();
}

async function deleteEntry() {
  const entry = getSelectedEntry();
  if (!entry) {
    return;
  }
  const confirmed = window.confirm(`Delete the entry for "${entry.website}"?`);
  if (!confirmed) {
    return;
  }
  state.vault.entries = state.vault.entries.filter((item) => item.id !== entry.id);
  state.selectedId = state.vault.entries[0]?.id ?? null;
  await persistVaultToBackend("Entry deleted.");
  render();
}

async function persistVaultToBackend(successMessage) {
  if (!state.session || !state.vault || !state.encryptionPassword) {
    return;
  }

  await withLoading(async () => {
    state.encryptedVault = await encryptVault(state.vault, state.encryptionPassword);
    await api("/vault", {
      method: "PUT",
      body: JSON.stringify({ encryptedVault: state.encryptedVault }),
    });
    if (successMessage) {
      showToast(successMessage);
    }
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const loggedIn = Boolean(state.session);
  const unlocked = Boolean(state.vault);

  // Show auth page if not logged in or in TOTP setup mode
  if (!loggedIn || state.totpSetupMode) {
    showAuthPage();

    if (state.totpSetupMode) {
      showScreen("totp-setup-screen");
      if (state.totpSecret && refs.qrcodeContainer.children.length === 0) {
        refs.totpSecretText.textContent = state.totpSecret;
        generateQrCode(state.totpUri);
      }
    } else if (state.totp2faRequired) {
      showScreen("totp-verify-screen");
    } else {
      showScreen("auth-main-screen");
    }

    return;
  }

  // Show vault page if logged in and not in TOTP setup
  showVaultPage();

  if (!unlocked) {
    return;
  }

  refs.currentUser.textContent = state.session.username;
  refs.entryCount.textContent = String(state.vault.entries.length);
  refs.syncStatus.textContent = state.loading ? "Saving" : "Ready";
  renderEntryList();
  renderEditor();
}

function renderEntryList() {
  refs.entryList.innerHTML = "";
  const entries = visibleEntries();

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.style.padding = "16px";
    empty.style.textAlign = "center";
    empty.style.color = "var(--ink-soft)";
    empty.textContent = state.search ? "No matching passwords found." : "No saved passwords yet.";
    refs.entryList.append(empty);
    return;
  }

  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entry-card";
    button.classList.toggle("is-selected", entry.id === state.selectedId);
    button.addEventListener("click", () => {
      state.selectedId = entry.id;
      renderEntryList();
      renderEditor();
    });

    const title = document.createElement("h4");
    title.textContent = entry.website;

    const summary = document.createElement("p");
    summary.textContent = entry.username || entry.notes || "Saved password";

    button.append(title, summary);
    refs.entryList.append(button);
  }
}

function renderEditor() {
  const entry = getSelectedEntry();
  refs.editorContent.hidden = !entry;
  refs.editorEmpty.hidden = Boolean(entry);

  if (!entry) {
    return;
  }

  refs.editorTitle.textContent = entry.website;
  refs.editorUpdated.textContent = `Updated ${formatDate(entry.updatedAt)}`;
  refs.entryWebsite.value = entry.website;
  refs.entryUsername.value = entry.username;
  refs.entryPassword.value = entry.password;
  refs.entryNotes.value = entry.notes;
  refs.entryPassword.type = "password";
  refs.togglePasswordButton.textContent = "👁️";
}

function visibleEntries() {
  const entries = state.vault?.entries || [];
  if (!state.search) {
    return entries;
  }

  return entries.filter((entry) => {
    const haystack = `${entry.website} ${entry.username} ${entry.notes}`.toLowerCase();
    return haystack.includes(state.search);
  });
}

function getSelectedEntry() {
  if (!state.vault || !state.selectedId) {
    return null;
  }
  return state.vault.entries.find((entry) => entry.id === state.selectedId) || null;
}

function createEmptyVault() {
  return {
    version: 1,
    entries: [],
  };
}

// ─── Vault Encryption ─────────────────────────────────────────────────────────

async function encryptVault(vault, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encoded = new TextEncoder().encode(JSON.stringify(vault));
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    version: 1,
    salt: encodeBase64Bytes(salt),
    iv: encodeBase64Bytes(iv),
    cipherText: encodeBase64Bytes(new Uint8Array(cipherBuffer)),
  };
}

async function decryptVault(payload, password) {
  const salt = decodeBase64Bytes(payload.salt);
  const iv = decodeBase64Bytes(payload.iv);
  const cipherText = decodeBase64Bytes(payload.cipherText);
  const key = await deriveKey(password, salt);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherText);
  return JSON.parse(new TextDecoder().decode(plainBuffer));
}

async function deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ─── Password Generator ───────────────────────────────────────────────────────

function generatePassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";
  const random = new Uint32Array(length);
  crypto.getRandomValues(random);
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += alphabet[random[index] % alphabet.length];
  }
  return output;
}

// ─── Base64 Helpers ───────────────────────────────────────────────────────────

function encodeBase64Bytes(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64Bytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// ─── Loading Wrapper ──────────────────────────────────────────────────────────

async function withLoading(task) {
  state.loading = true;
  render();
  try {
    await task();
  } catch (error) {
    showToast(error.message || "Something went wrong.");
  } finally {
    state.loading = false;
    render();
  }
}

// ─── API Client ───────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "include",
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;
    try {
      const data = await response.json();
      if (data?.error) {
        message = data.error;
      }
    } catch {
      // Ignore parse failures.
    }
    throw new Error(message);
  }

  return response.json();
}

function bufferToBase64Url(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBuffer(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4 || 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizePublicKeyOptions(publicKey) {
  const normalized = {
    ...publicKey,
    user: publicKey.user ? { ...publicKey.user } : undefined,
    excludeCredentials: Array.isArray(publicKey.excludeCredentials)
      ? publicKey.excludeCredentials.map((credential) => ({
          ...credential,
          id: base64UrlToBuffer(credential.id),
        }))
      : undefined,
    allowCredentials: Array.isArray(publicKey.allowCredentials)
      ? publicKey.allowCredentials.map((credential) => ({
          ...credential,
          id: base64UrlToBuffer(credential.id),
        }))
      : undefined,
  };

  normalized.challenge = base64UrlToBuffer(publicKey.challenge);
  if (normalized.user?.id) {
    normalized.user.id = base64UrlToBuffer(normalized.user.id);
  }

  return normalized;
}

function serializeAttestationCredential(credential) {
  const response = credential.response;
  const publicKey = response.getPublicKey?.();

  if (!publicKey) {
    throw new Error("This browser does not expose the passkey public key.");
  }

  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      attestationObject: bufferToBase64Url(response.attestationObject),
      publicKey: bufferToBase64Url(publicKey),
      publicKeyAlgorithm: response.getPublicKeyAlgorithm?.() ?? -7,
    },
  };
}

function serializeAssertionCredential(credential) {
  const response = credential.response;

  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : undefined,
    },
  };
}

async function loginWithPasskey() {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) {
    showToast("Passkeys are not supported in this browser.");
    return;
  }

  const username = refs.loginUsername.value.trim();

  await withLoading(async () => {
    const options = await api("/webauthn/login/options", {
      method: "POST",
      body: JSON.stringify({ username }),
    });

    const credential = await navigator.credentials.get({
      publicKey: normalizePublicKeyOptions(options.publicKey),
    });

    if (!credential) {
      throw new Error("Passkey sign-in was cancelled.");
    }

    await api("/webauthn/login/verify", {
      method: "POST",
      body: JSON.stringify(serializeAssertionCredential(credential)),
    });

    await hydrateSession();

    const passwordToUse =
      state.rememberedPassword || refs.loginPassword.value || state.encryptionPassword || window.prompt("Enter your vault password to unlock your notes.");

    if (!passwordToUse) {
      showToast("Passkey verified. Enter your vault password to unlock your notes.");
      render();
      return;
    }

    try {
      state.vault = await decryptVault(state.encryptedVault, passwordToUse);
      state.encryptionPassword = passwordToUse;
      state.rememberedPassword = passwordToUse;
      state.selectedId = state.vault.entries[0]?.id ?? null;
      refs.loginPassword.value = "";
      render();
      showToast("Logged in with passkey.");
    } catch {
      state.vault = null;
      state.selectedId = null;
      render();
      showToast("Passkey verified, but the vault password was incorrect.");
    }
  });
}

async function registerPasskey() {
  if (!state.session) {
    showToast("Please log in first.");
    return;
  }

  if (!window.PublicKeyCredential || !navigator.credentials?.create) {
    showToast("Passkeys are not supported in this browser.");
    return;
  }

  const label = window.prompt("Name this passkey", "Passkey")?.trim() || "Passkey";

  await withLoading(async () => {
    const options = await api("/webauthn/register/options", {
      method: "POST",
      body: JSON.stringify({ label }),
    });

    const credential = await navigator.credentials.create({
      publicKey: normalizePublicKeyOptions(options.publicKey),
    });

    if (!credential) {
      throw new Error("Passkey registration was cancelled.");
    }

    await api("/webauthn/register/verify", {
      method: "POST",
      body: JSON.stringify({
        ...serializeAttestationCredential(credential),
        label,
      }),
    });

    showToast("Passkey registered successfully.");
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function registerInstallPrompt() {
  // Passkeys are now the primary auth method
  // Install prompt disabled - relies on browser's web app install
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  }
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("is-visible");
  clearTimeout(state.toastTimeout);
  state.toastTimeout = window.setTimeout(() => {
    refs.toast.classList.remove("is-visible");
  }, 2600);
}
