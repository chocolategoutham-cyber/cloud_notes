const API_BASE = "https://cloud-notes-api.cloud-notes-api.workers.dev";

const state = {
  loading: false,
  toastTimeout: null,
  session: null,
  vault: null,
  pendingEmail: "",
  authStep: "email",
  selectedId: null,
  search: "",
  isCreatingEntry: false,
  sessionToken: "",
};

const refs = {
  authPage: document.querySelector("#auth-page"),
  vaultPage: document.querySelector("#vault-page"),
  emailStep: document.querySelector("#email-step"),
  otpStep: document.querySelector("#otp-step"),
  emailForm: document.querySelector("#email-form"),
  otpForm: document.querySelector("#otp-form"),
  emailInput: document.querySelector("#email-input"),
  otpInput: document.querySelector("#otp-input"),
  otpEmailLabel: document.querySelector("#otp-email-label"),
  devOtpHint: document.querySelector("#dev-otp-hint"),
  changeEmailButton: document.querySelector("#change-email-button"),
  currentEmail: document.querySelector("#current-email"),
  logoutButton: document.querySelector("#logout-button"),
  searchInput: document.querySelector("#search-input"),
  entryCount: document.querySelector("#entry-count"),
  entryList: document.querySelector("#entry-list"),
  newEntryButton: document.querySelector("#new-entry-button"),
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
  refs.emailForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void requestOtp();
  });

  refs.otpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void verifyOtp();
  });

  refs.changeEmailButton.addEventListener("click", () => {
    state.authStep = "email";
    refs.otpForm.reset();
    refs.devOtpHint.hidden = true;
    render();
  });

  refs.otpInput.addEventListener("input", () => {
    refs.otpInput.value = refs.otpInput.value.replace(/\D/g, "");
  });

  refs.logoutButton.addEventListener("click", () => void logout());
  refs.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderEntryList();
  });
  refs.newEntryButton.addEventListener("click", () => startNewEntry());
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
}

async function hydrateSession() {
  state.sessionToken = getStoredSessionToken();
  if (!state.sessionToken) {
    state.session = null;
    state.vault = null;
    state.selectedId = null;
    state.isCreatingEntry = false;
    render();
    return;
  }

  try {
    const response = await api("/session");
    state.session = response.user;
    state.vault = sanitizeVault(response.vault);
    state.selectedId = state.vault.entries[0]?.id ?? null;
    state.isCreatingEntry = !state.vault.entries.length;
  } catch {
    clearStoredSessionToken();
    state.sessionToken = "";
    state.session = null;
    state.vault = null;
    state.selectedId = null;
    state.isCreatingEntry = false;
  }

  render();
}

async function requestOtp() {
  const email = normalizeEmail(refs.emailInput.value);
  if (!email) {
    showToast("Enter a valid email address.");
    return;
  }

  await withLoading(async () => {
    const response = await api("/request-otp", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    state.pendingEmail = email;
    state.authStep = "otp";
    refs.otpEmailLabel.textContent = `Code sent to ${email}`;
    refs.devOtpHint.hidden = !response.devCode;
    refs.devOtpHint.textContent = response.devCode
      ? `Dev OTP: ${response.devCode}. Configure email delivery secrets to send real messages automatically.`
      : "OTP email sent. Check your inbox and spam folder.";
    render();
    refs.otpInput.focus();
    showToast(response.devCode ? "OTP created." : "OTP sent to email.");
  });
}

async function verifyOtp() {
  const email = state.pendingEmail || normalizeEmail(refs.emailInput.value);
  const code = refs.otpInput.value.trim();

  if (!email) {
    showToast("Enter your email first.");
    state.authStep = "email";
    render();
    return;
  }

  if (!/^\d{6}$/.test(code)) {
    showToast("Enter a 6-digit OTP.");
    return;
  }

  await withLoading(async () => {
    const response = await api("/verify-otp", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });

    state.sessionToken = response.sessionToken || "";
    storeSessionToken(state.sessionToken);
    state.session = response.user;
    state.vault = sanitizeVault(response.vault);
    state.selectedId = state.vault.entries[0]?.id ?? null;
    state.isCreatingEntry = !state.vault.entries.length;
    state.search = "";
    refs.searchInput.value = "";
    refs.emailForm.reset();
    refs.otpForm.reset();
    refs.devOtpHint.hidden = true;
    render();
    showToast("Logged in.");
  });
}

async function logout() {
  await withLoading(async () => {
    await api("/logout", { method: "POST" });
    clearStoredSessionToken();
    state.sessionToken = "";
    state.session = null;
    state.vault = null;
    state.pendingEmail = "";
    state.authStep = "email";
    state.selectedId = null;
    state.search = "";
    state.isCreatingEntry = false;
    refs.emailForm.reset();
    refs.otpForm.reset();
    refs.searchInput.value = "";
    render();
    showToast("Logged out.");
  });
}

function startNewEntry() {
  if (!state.vault) {
    return;
  }

  state.isCreatingEntry = true;
  state.selectedId = null;
  refs.entryForm.reset();
  refs.entryPassword.type = "password";
  refs.togglePasswordButton.textContent = "Show";
  renderEditor();
  refs.entryWebsite.focus();
}

async function saveEntry() {
  if (!state.vault) {
    return;
  }

  const website = refs.entryWebsite.value.trim();
  if (!website) {
    showToast("Website is required.");
    return;
  }

  const now = new Date().toISOString();
  const entry = {
    id: state.selectedId || crypto.randomUUID(),
    website,
    username: refs.entryUsername.value.trim(),
    password: refs.entryPassword.value,
    notes: refs.entryNotes.value.trim(),
    updatedAt: now,
  };

  const existingIndex = state.vault.entries.findIndex((item) => item.id === entry.id);
  if (existingIndex === -1) {
    entry.createdAt = now;
    state.vault.entries.unshift(entry);
  } else {
    entry.createdAt = state.vault.entries[existingIndex].createdAt;
    state.vault.entries[existingIndex] = entry;
  }

  state.vault.entries.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  state.selectedId = entry.id;
  state.isCreatingEntry = false;
  await persistVault("Entry saved.");
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
  state.isCreatingEntry = !state.vault.entries.length;
  await persistVault("Entry deleted.");
  render();
}

async function persistVault(successMessage) {
  if (!state.session || !state.vault || !state.sessionToken) {
    return;
  }

  await withLoading(async () => {
    await api("/vault", {
      method: "PUT",
      body: JSON.stringify({ vault: state.vault }),
    });
    showToast(successMessage);
  });
}

function render() {
  const loggedIn = Boolean(state.session && state.vault);

  refs.authPage.classList.toggle("active-page", !loggedIn);
  refs.vaultPage.classList.toggle("active-page", loggedIn);
  refs.emailStep.classList.toggle("active-step", state.authStep === "email");
  refs.otpStep.classList.toggle("active-step", state.authStep === "otp");

  if (!loggedIn) {
    return;
  }

  refs.currentEmail.textContent = state.session.email;
  refs.entryCount.textContent = String(state.vault.entries.length);
  renderEntryList();
  renderEditor();
}

function renderEntryList() {
  refs.entryList.innerHTML = "";
  const entries = visibleEntries();

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "entry-card";
    empty.innerHTML = "<h3>No passwords yet</h3><p>Add your first entry to this email vault.</p>";
    refs.entryList.append(empty);
    return;
  }

  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entry-card";
    button.classList.toggle("is-selected", entry.id === state.selectedId && !state.isCreatingEntry);
    button.addEventListener("click", () => {
      state.selectedId = entry.id;
      state.isCreatingEntry = false;
      renderEntryList();
      renderEditor();
    });

    const title = document.createElement("h3");
    title.textContent = entry.website;

    const summary = document.createElement("p");
    summary.textContent = entry.username || entry.notes || "Saved password";

    button.append(title, summary);
    refs.entryList.append(button);
  }
}

function renderEditor() {
  const entry = getSelectedEntry();
  const showingComposer = state.isCreatingEntry;

  refs.editorEmpty.hidden = Boolean(entry || showingComposer);
  refs.editorContent.hidden = !entry && !showingComposer;

  if (showingComposer) {
    refs.editorTitle.textContent = "New Entry";
    refs.editorUpdated.textContent = "Unsaved";
    refs.entryForm.reset();
    refs.deleteEntryButton.hidden = true;
    refs.entryPassword.type = "password";
    refs.togglePasswordButton.textContent = "Show";
    return;
  }

  if (!entry) {
    return;
  }

  refs.editorTitle.textContent = entry.website;
  refs.editorUpdated.textContent = `Updated ${formatDate(entry.updatedAt)}`;
  refs.entryWebsite.value = entry.website;
  refs.entryUsername.value = entry.username || "";
  refs.entryPassword.value = entry.password || "";
  refs.entryNotes.value = entry.notes || "";
  refs.entryPassword.type = "password";
  refs.togglePasswordButton.textContent = "Show";
  refs.deleteEntryButton.hidden = false;
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
      createdAt: entry.createdAt || new Date().toISOString(),
      updatedAt: entry.updatedAt || new Date().toISOString(),
    })),
  };
}

async function withLoading(task) {
  state.loading = true;
  try {
    await task();
  } catch (error) {
    showToast(error.message || "Something went wrong.");
  } finally {
    state.loading = false;
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.sessionToken ? { Authorization: `Bearer ${state.sessionToken}` } : {}),
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
    if (response.status === 401 || response.status === 403) {
      clearStoredSessionToken();
      state.sessionToken = "";
    }
    throw new Error(message);
  }

  return response.json();
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "";
  }
  return email;
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

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  }
}

function getStoredSessionToken() {
  try {
    return localStorage.getItem("cloud_vault_session_token") || "";
  } catch {
    return "";
  }
}

function storeSessionToken(token) {
  try {
    if (token) {
      localStorage.setItem("cloud_vault_session_token", token);
    }
  } catch {
    // Ignore storage failures.
  }
}

function clearStoredSessionToken() {
  try {
    localStorage.removeItem("cloud_vault_session_token");
  } catch {
    // Ignore storage failures.
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
