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
  masterPassword: "",
};

const refs = {
  accountSurface: document.querySelector("#account-surface"),
  vaultSurface: document.querySelector("#vault-surface"),
  appShell: document.querySelector("#app-shell"),
  installButton: document.querySelector("#install-button"),
  logoutButton: document.querySelector("#logout-button"),
  lockButton: document.querySelector("#lock-button"),
  loginForm: document.querySelector("#login-form"),
  signupForm: document.querySelector("#signup-form"),
  loginUsername: document.querySelector("#login-username"),
  loginPassword: document.querySelector("#login-password"),
  signupUsername: document.querySelector("#signup-username"),
  signupPassword: document.querySelector("#signup-password"),
  vaultAuthTitle: document.querySelector("#vault-auth-title"),
  vaultCreateForm: document.querySelector("#vault-create-form"),
  vaultUnlockForm: document.querySelector("#vault-unlock-form"),
  masterPassword: document.querySelector("#master-password"),
  masterPasswordConfirm: document.querySelector("#master-password-confirm"),
  unlockMasterPassword: document.querySelector("#unlock-master-password"),
  currentUser: document.querySelector("#current-user"),
  entryCount: document.querySelector("#entry-count"),
  syncStatus: document.querySelector("#sync-status"),
  searchInput: document.querySelector("#search-input"),
  newEntryButton: document.querySelector("#new-entry-button"),
  syncButton: document.querySelector("#sync-button"),
  entryList: document.querySelector("#entry-list"),
  visibleCount: document.querySelector("#visible-count"),
  editorTitle: document.querySelector("#editor-title"),
  editorUpdated: document.querySelector("#editor-updated"),
  entryForm: document.querySelector("#entry-form"),
  editorEmpty: document.querySelector("#editor-empty"),
  entryWebsite: document.querySelector("#entry-website"),
  entryUsername: document.querySelector("#entry-username"),
  entryPassword: document.querySelector("#entry-password"),
  entryNotes: document.querySelector("#entry-notes"),
  togglePasswordButton: document.querySelector("#toggle-password-button"),
  copyPasswordButton: document.querySelector("#copy-password-button"),
  generatePasswordButton: document.querySelector("#generate-password-button"),
  deleteEntryButton: document.querySelector("#delete-entry-button"),
  apiStatus: document.querySelector("#api-status"),
  apiBaseValue: document.querySelector("#api-base-value"),
  vaultHeadline: document.querySelector("#vault-headline"),
  toast: document.querySelector("#toast"),
};

document.addEventListener("DOMContentLoaded", () => {
  void initializeApp();
});

async function initializeApp() {
  bindEvents();
  registerInstallPrompt();
  registerServiceWorker();
  refs.apiBaseValue.textContent = API_BASE;
  await hydrateSession();
}

function bindEvents() {
  refs.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void login();
  });

  refs.signupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void signup();
  });

  refs.vaultCreateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void createVault();
  });

  refs.vaultUnlockForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void unlockVault();
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

  refs.togglePasswordButton.addEventListener("click", () => {
    refs.entryPassword.type = refs.entryPassword.type === "password" ? "text" : "password";
    refs.togglePasswordButton.textContent = refs.entryPassword.type === "password" ? "Show" : "Hide";
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
    refs.togglePasswordButton.textContent = "Hide";
    showToast("Strong password generated.");
  });

  refs.installButton.addEventListener("click", async () => {
    if (!state.installPrompt) {
      return;
    }
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    refs.installButton.hidden = true;
  });
}

async function hydrateSession() {
  try {
    const session = await api("/session");
    state.session = session.user;
    state.encryptedVault = session.vault;
    refs.apiStatus.textContent = "Connected";
  } catch {
    state.session = null;
    state.encryptedVault = null;
    refs.apiStatus.textContent = "Backend ready";
  }
  render();
}

async function signup() {
  const username = refs.signupUsername.value.trim();
  const password = refs.signupPassword.value;

  if (username.length < 3) {
    showToast("Username must be at least 3 characters.");
    return;
  }
  if (password.length < 10) {
    showToast("Login password must be at least 10 characters.");
    return;
  }

  await withLoading(async () => {
    const response = await api("/signup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.session = response.user;
    state.encryptedVault = null;
    refs.signupForm.reset();
    refs.loginForm.reset();
    render();
    showToast("Account created.");
  });
}

async function login() {
  await withLoading(async () => {
    const response = await api("/login", {
      method: "POST",
      body: JSON.stringify({
        username: refs.loginUsername.value.trim(),
        password: refs.loginPassword.value,
      }),
    });
    state.session = response.user;
    state.encryptedVault = response.vault;
    refs.loginForm.reset();
    render();
    showToast("Logged in.");
  });
}

async function logout() {
  await withLoading(async () => {
    await api("/logout", { method: "POST" });
    state.session = null;
    state.vault = null;
    state.encryptedVault = null;
    state.masterPassword = "";
    state.selectedId = null;
    state.search = "";
    refs.searchInput.value = "";
    render();
    showToast("Logged out.");
  });
}

async function createVault() {
  const password = refs.masterPassword.value;
  const confirm = refs.masterPasswordConfirm.value;
  if (password.length < 10) {
    showToast("Master password must be at least 10 characters.");
    return;
  }
  if (password !== confirm) {
    showToast("Master passwords do not match.");
    return;
  }

  state.masterPassword = password;
  state.vault = createEmptyVault();
  state.selectedId = null;
  refs.vaultCreateForm.reset();
  await persistVaultToBackend("Encrypted vault created.");
  render();
}

async function unlockVault() {
  if (!state.encryptedVault) {
    showToast("No encrypted vault found.");
    return;
  }

  try {
    state.masterPassword = refs.unlockMasterPassword.value;
    state.vault = await decryptVault(state.encryptedVault, state.masterPassword);
    state.selectedId = state.vault.entries[0]?.id ?? null;
    refs.vaultUnlockForm.reset();
    render();
    showToast("Vault unlocked.");
  } catch {
    showToast("Master password is incorrect.");
  }
}

function lockVault(message) {
  state.vault = null;
  state.masterPassword = "";
  state.selectedId = null;
  render();
  if (message) {
    showToast(message);
  }
}

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
  if (!state.session || !state.vault || !state.masterPassword) {
    return;
  }

  await withLoading(async () => {
    state.encryptedVault = await encryptVault(state.vault, state.masterPassword);
    await api("/vault", {
      method: "PUT",
      body: JSON.stringify({ encryptedVault: state.encryptedVault }),
    });
    if (successMessage) {
      showToast(successMessage);
    }
  });
}

function render() {
  const loggedIn = Boolean(state.session);
  const unlocked = Boolean(state.vault);

  refs.accountSurface.hidden = loggedIn;
  refs.vaultSurface.hidden = !loggedIn || unlocked;
  refs.appShell.hidden = !loggedIn || !unlocked;
  refs.logoutButton.hidden = !loggedIn;
  refs.lockButton.hidden = !unlocked;

  if (!loggedIn) {
    refs.syncStatus.textContent = state.loading ? "Working" : "Idle";
    return;
  }

  const hasVault = Boolean(state.encryptedVault);
  refs.vaultAuthTitle.textContent = hasVault ? "Unlock your master-password vault" : "Create your master password";
  refs.vaultCreateForm.hidden = hasVault;
  refs.vaultUnlockForm.hidden = !hasVault;

  if (!unlocked) {
    refs.syncStatus.textContent = state.loading ? "Working" : "Locked";
    return;
  }

  refs.currentUser.textContent = state.session.username;
  refs.entryCount.textContent = String(state.vault.entries.length);
  refs.syncStatus.textContent = state.loading ? "Saving" : "Ready";
  refs.vaultHeadline.textContent = `${state.session.username}'s password vault`;
  renderEntryList();
  renderEditor();
}

function renderEntryList() {
  refs.entryList.innerHTML = "";
  const entries = visibleEntries();
  refs.visibleCount.textContent = `${entries.length} visible`;

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
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

    const meta = document.createElement("div");
    meta.className = "entry-meta";

    const title = document.createElement("h4");
    title.textContent = entry.website;

    const updated = document.createElement("span");
    updated.className = "mini-note";
    updated.textContent = formatDate(entry.updatedAt);

    const summary = document.createElement("p");
    summary.className = "entry-summary";
    summary.textContent = entry.username || entry.notes || "Saved password entry";

    meta.append(title, updated);
    button.append(meta, summary);
    refs.entryList.append(button);
  }
}

function renderEditor() {
  const entry = getSelectedEntry();
  refs.entryForm.hidden = !entry;
  refs.editorEmpty.hidden = Boolean(entry);

  if (!entry) {
    refs.editorTitle.textContent = "Select or create an entry";
    refs.editorUpdated.textContent = "No selection";
    return;
  }

  refs.editorTitle.textContent = entry.website;
  refs.editorUpdated.textContent = `Updated ${formatDate(entry.updatedAt)}`;
  refs.entryWebsite.value = entry.website;
  refs.entryUsername.value = entry.username;
  refs.entryPassword.value = entry.password;
  refs.entryNotes.value = entry.notes;
  refs.entryPassword.type = "password";
  refs.togglePasswordButton.textContent = "Show";
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

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function registerInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    refs.installButton.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    refs.installButton.hidden = true;
    showToast("Cloud Vault was installed.");
  });
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
