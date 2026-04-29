const API_BASE = "https://cloud-notes-api.cloud-notes-api.workers.dev";

const state = {
  loading: false,
  toastTimeout: null,
  session: null,
  vault: null,
  pendingPhone: "",
  authStep: "phone",
  selectedId: null,
  search: "",
  isCreatingEntry: false,
};

const refs = {
  authPage: document.querySelector("#auth-page"),
  vaultPage: document.querySelector("#vault-page"),
  phoneStep: document.querySelector("#phone-step"),
  otpStep: document.querySelector("#otp-step"),
  phoneForm: document.querySelector("#phone-form"),
  otpForm: document.querySelector("#otp-form"),
  phoneInput: document.querySelector("#phone-input"),
  otpInput: document.querySelector("#otp-input"),
  otpPhoneLabel: document.querySelector("#otp-phone-label"),
  devOtpHint: document.querySelector("#dev-otp-hint"),
  changePhoneButton: document.querySelector("#change-phone-button"),
  currentPhone: document.querySelector("#current-phone"),
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
  saveVaultButton: document.querySelector("#save-vault-button"),
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
  refs.phoneForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void requestOtp();
  });

  refs.otpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void verifyOtp();
  });

  refs.changePhoneButton.addEventListener("click", () => {
    state.authStep = "phone";
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

  refs.saveVaultButton.addEventListener("click", () => void persistVault("Vault saved."));
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
  try {
    const response = await api("/session");
    state.session = response.user;
    state.vault = sanitizeVault(response.vault);
    state.selectedId = state.vault.entries[0]?.id ?? null;
    state.isCreatingEntry = !state.vault.entries.length;
  } catch {
    state.session = null;
    state.vault = null;
    state.selectedId = null;
    state.isCreatingEntry = false;
  }

  render();
}

async function requestOtp() {
  const phone = normalizePhone(refs.phoneInput.value);
  if (!phone) {
    showToast("Enter a valid phone number.");
    return;
  }

  await withLoading(async () => {
    const response = await api("/request-otp", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });

    state.pendingPhone = phone;
    state.authStep = "otp";
    refs.otpPhoneLabel.textContent = `Code sent to ${phone}`;
    refs.devOtpHint.hidden = !response.devCode;
    refs.devOtpHint.textContent = response.devCode
      ? `Dev OTP: ${response.devCode}. Cloudflare cannot send SMS by itself, so dev mode is active.`
      : "";
    refs.otpForm.reset();
    render();
    refs.otpInput.focus();
    showToast("OTP created.");
  });
}

async function verifyOtp() {
  const phone = state.pendingPhone || normalizePhone(refs.phoneInput.value);
  const code = refs.otpInput.value.trim();

  if (!phone) {
    showToast("Enter your phone number first.");
    state.authStep = "phone";
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
      body: JSON.stringify({ phone, code }),
    });

    state.session = response.user;
    state.vault = sanitizeVault(response.vault);
    state.selectedId = state.vault.entries[0]?.id ?? null;
    state.isCreatingEntry = !state.vault.entries.length;
    state.search = "";
    refs.searchInput.value = "";
    refs.phoneForm.reset();
    refs.otpForm.reset();
    refs.devOtpHint.hidden = true;
    render();
    showToast("Logged in.");
  });
}

async function logout() {
  await withLoading(async () => {
    await api("/logout", { method: "POST" });
    state.session = null;
    state.vault = null;
    state.pendingPhone = "";
    state.authStep = "phone";
    state.selectedId = null;
    state.search = "";
    state.isCreatingEntry = false;
    refs.phoneForm.reset();
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
  if (!state.session || !state.vault) {
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

  refs.phoneStep.classList.toggle("active-step", state.authStep === "phone");
  refs.otpStep.classList.toggle("active-step", state.authStep === "otp");

  if (!loggedIn) {
    return;
  }

  refs.currentPhone.textContent = state.session.phone;
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
    empty.innerHTML = "<h3>No passwords yet</h3><p>Add your first entry to this phone vault.</p>";
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

function normalizePhone(value) {
  const cleaned = String(value || "").trim().replace(/[^\d+]/g, "");
  if (!/^\+?\d{8,15}$/.test(cleaned)) {
    return "";
  }
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
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

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("is-visible");
  clearTimeout(state.toastTimeout);
  state.toastTimeout = window.setTimeout(() => {
    refs.toast.classList.remove("is-visible");
  }, 2600);
}
