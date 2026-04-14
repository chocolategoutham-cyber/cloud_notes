const DB_NAME = "cloud-notes-db";
const STORE_NAME = "vault";
const ENCRYPTED_VAULT_KEY = "encrypted-vault";
const SYNC_SETTINGS_KEY = "cloud-notes-sync-settings";
const AUTO_LOCK_KEY = "cloud-notes-auto-lock";
const LAST_SYNC_KEY = "cloud-notes-last-sync";
const GITHUB_TOKEN_SESSION_KEY = "cloud-notes-session-token";
const PBKDF2_ITERATIONS = 250000;
const EMPTY_SYNC_SETTINGS = {
  owner: "",
  repo: "",
  branch: "main",
  path: "vault/cloud-notes.enc.json",
};

const state = {
  encryptedVault: null,
  vault: null,
  passphrase: "",
  selectedId: null,
  filter: "all",
  search: "",
  autoLockMinutes: readJsonStorage(AUTO_LOCK_KEY, 10),
  syncSettings: { ...EMPTY_SYNC_SETTINGS, ...readJsonStorage(SYNC_SETTINGS_KEY, EMPTY_SYNC_SETTINGS) },
  lastSync: readJsonStorage(LAST_SYNC_KEY, null),
  installPrompt: null,
  toastTimeout: null,
  lockTimeout: null,
};

const refs = {
  authSurface: document.querySelector("#auth-surface"),
  authTitle: document.querySelector("#auth-title"),
  setupForm: document.querySelector("#setup-form"),
  setupPassphrase: document.querySelector("#setup-passphrase"),
  setupConfirm: document.querySelector("#setup-confirm"),
  unlockForm: document.querySelector("#unlock-form"),
  unlockPassphrase: document.querySelector("#unlock-passphrase"),
  appShell: document.querySelector("#app-shell"),
  lockButton: document.querySelector("#lock-button"),
  installButton: document.querySelector("#install-button"),
  itemCount: document.querySelector("#item-count"),
  passwordCount: document.querySelector("#password-count"),
  saveStatus: document.querySelector("#save-status"),
  searchInput: document.querySelector("#search-input"),
  filterGroup: document.querySelector("#filter-group"),
  autoLockSelect: document.querySelector("#auto-lock-select"),
  newNoteButton: document.querySelector("#new-note-button"),
  newPasswordButton: document.querySelector("#new-password-button"),
  newSnippetButton: document.querySelector("#new-snippet-button"),
  entryList: document.querySelector("#entry-list"),
  visibleCount: document.querySelector("#visible-count"),
  editorTitle: document.querySelector("#editor-title"),
  editorUpdated: document.querySelector("#editor-updated"),
  entryForm: document.querySelector("#entry-form"),
  editorEmpty: document.querySelector("#editor-empty"),
  entryType: document.querySelector("#entry-type"),
  entryTitle: document.querySelector("#entry-title"),
  entryTags: document.querySelector("#entry-tags"),
  usernameField: document.querySelector("#username-field"),
  urlField: document.querySelector("#url-field"),
  passwordField: document.querySelector("#password-field"),
  entryUsername: document.querySelector("#entry-username"),
  entryUrl: document.querySelector("#entry-url"),
  entryPassword: document.querySelector("#entry-password"),
  entryContent: document.querySelector("#entry-content"),
  contentLabel: document.querySelector("#content-label"),
  duplicateEntryButton: document.querySelector("#duplicate-entry-button"),
  deleteEntryButton: document.querySelector("#delete-entry-button"),
  togglePasswordVisibility: document.querySelector("#toggle-password-visibility"),
  copyPasswordButton: document.querySelector("#copy-password-button"),
  generatePasswordButton: document.querySelector("#generate-password-button"),
  syncStatus: document.querySelector("#sync-status"),
  syncSettingsForm: document.querySelector("#sync-settings-form"),
  syncOwner: document.querySelector("#sync-owner"),
  syncRepo: document.querySelector("#sync-repo"),
  syncBranch: document.querySelector("#sync-branch"),
  syncPath: document.querySelector("#sync-path"),
  syncToken: document.querySelector("#sync-token"),
  pushButton: document.querySelector("#push-button"),
  pullButton: document.querySelector("#pull-button"),
  lastSyncNote: document.querySelector("#last-sync-note"),
  vaultHeadline: document.querySelector("#vault-headline"),
  toast: document.querySelector("#toast"),
};

document.addEventListener("DOMContentLoaded", () => {
  void initializeApp();
});

async function initializeApp() {
  bindEvents();
  applyStoredSettings();
  registerInstallPrompt();
  registerServiceWorker();
  state.encryptedVault = await readEncryptedVault();
  render();
}

function bindEvents() {
  refs.setupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void createVault();
  });

  refs.unlockForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void unlockVault();
  });

  refs.lockButton.addEventListener("click", () => lockVault("Vault locked."));

  refs.installButton.addEventListener("click", async () => {
    if (!state.installPrompt) {
      return;
    }

    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    refs.installButton.hidden = true;
  });

  refs.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderEntryList();
  });

  refs.filterGroup.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) {
      return;
    }

    state.filter = button.dataset.filter;
    renderFilters();
    renderEntryList();
  });

  refs.autoLockSelect.addEventListener("change", (event) => {
    state.autoLockMinutes = Number(event.target.value);
    writeJsonStorage(AUTO_LOCK_KEY, state.autoLockMinutes);
    scheduleAutoLock();
    showToast(state.autoLockMinutes === 0 ? "Auto-lock disabled for this device." : `Auto-lock set to ${state.autoLockMinutes} minutes.`);
  });

  refs.newNoteButton.addEventListener("click", () => void createEntry("note"));
  refs.newPasswordButton.addEventListener("click", () => void createEntry("password"));
  refs.newSnippetButton.addEventListener("click", () => void createEntry("snippet"));

  refs.entryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSelectedEntry();
  });

  refs.entryType.addEventListener("change", () => renderEditorFields());
  refs.duplicateEntryButton.addEventListener("click", () => void duplicateSelectedEntry());
  refs.deleteEntryButton.addEventListener("click", () => void deleteSelectedEntry());

  refs.togglePasswordVisibility.addEventListener("click", () => {
    refs.entryPassword.type = refs.entryPassword.type === "password" ? "text" : "password";
    refs.togglePasswordVisibility.textContent = refs.entryPassword.type === "password" ? "Show" : "Hide";
  });

  refs.copyPasswordButton.addEventListener("click", async () => {
    if (!refs.entryPassword.value) {
      showToast("There is no password to copy yet.");
      return;
    }

    await navigator.clipboard.writeText(refs.entryPassword.value);
    showToast("Password copied to your clipboard.");
  });

  refs.generatePasswordButton.addEventListener("click", () => {
    refs.entryPassword.value = generatePassword();
    refs.entryPassword.type = "text";
    refs.togglePasswordVisibility.textContent = "Hide";
    showToast("Generated a strong password. Save the entry to keep it.");
  });

  refs.syncSettingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSyncSettings();
  });

  refs.pushButton.addEventListener("click", () => void pushVaultToGitHub());
  refs.pullButton.addEventListener("click", () => void pullVaultFromGitHub());

  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, () => {
      if (state.vault) {
        scheduleAutoLock();
      }
    });
  });
}

function registerInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    refs.installButton.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    refs.installButton.hidden = true;
    showToast("Cloud Notes was installed on this device.");
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  }
}

function applyStoredSettings() {
  refs.autoLockSelect.value = String(state.autoLockMinutes);
  refs.syncOwner.value = state.syncSettings.owner;
  refs.syncRepo.value = state.syncSettings.repo;
  refs.syncBranch.value = state.syncSettings.branch;
  refs.syncPath.value = state.syncSettings.path;
  refs.syncToken.value = sessionStorage.getItem(GITHUB_TOKEN_SESSION_KEY) ?? "";
}

async function createVault() {
  const passphrase = refs.setupPassphrase.value.trim();
  const confirmation = refs.setupConfirm.value.trim();

  if (passphrase.length < 10) {
    showToast("Choose a passphrase with at least 10 characters.");
    return;
  }

  if (passphrase !== confirmation) {
    showToast("The passphrases do not match.");
    return;
  }

  const vault = createStarterVault();
  await unlockWithVault(vault, passphrase, true);
  refs.setupForm.reset();
  showToast("Encrypted vault created on this device.");
}

async function unlockVault() {
  if (!state.encryptedVault) {
    showToast("No encrypted vault exists on this device yet.");
    return;
  }

  const passphrase = refs.unlockPassphrase.value;

  try {
    const vault = await decryptVault(state.encryptedVault, passphrase);
    await unlockWithVault(vault, passphrase, false);
    refs.unlockForm.reset();
    showToast("Vault unlocked.");
  } catch (error) {
    showToast(error.message);
  }
}

async function unlockWithVault(vault, passphrase, shouldPersist) {
  state.passphrase = passphrase;
  state.vault = normalizeVault(vault);
  state.selectedId = chooseSelection();
  if (shouldPersist) {
    await persistVault("Vault saved locally.");
  }
  render();
  scheduleAutoLock();
}

function lockVault(message) {
  state.passphrase = "";
  state.vault = null;
  state.selectedId = null;
  clearTimeout(state.lockTimeout);
  refs.entryForm.reset();
  refs.entryPassword.type = "password";
  refs.togglePasswordVisibility.textContent = "Show";
  render();
  if (message) {
    showToast(message);
  }
}

async function createEntry(type) {
  if (!state.vault) {
    return;
  }

  const item = buildEntry(type);
  state.vault.items.unshift(item);
  state.selectedId = item.id;
  touchVault();
  await persistVault(`${labelForType(type)} created locally.`);
  render();
}

async function saveSelectedEntry() {
  const selected = getSelectedEntry();
  if (!selected) {
    return;
  }

  const now = new Date().toISOString();
  const nextType = refs.entryType.value;
  selected.type = nextType;
  selected.title = refs.entryTitle.value.trim() || defaultTitleForType(nextType);
  selected.tags = parseTags(refs.entryTags.value);
  selected.username = refs.entryUsername.value.trim();
  selected.url = refs.entryUrl.value.trim();
  selected.password = refs.entryPassword.value;
  selected.content = refs.entryContent.value;
  selected.updatedAt = now;

  if (selected.type !== "password") {
    selected.username = "";
    selected.url = "";
    selected.password = "";
  }

  touchVault(now);
  await persistVault("Local vault updated.");
  render();
}

async function duplicateSelectedEntry() {
  const selected = getSelectedEntry();
  if (!selected) {
    return;
  }

  const duplicate = {
    ...selected,
    id: crypto.randomUUID(),
    title: `${selected.title} copy`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [...selected.tags],
  };

  state.vault.items.unshift(duplicate);
  state.selectedId = duplicate.id;
  touchVault();
  await persistVault("Entry duplicated.");
  render();
}

async function deleteSelectedEntry() {
  const selected = getSelectedEntry();
  if (!selected) {
    return;
  }

  const confirmed = window.confirm(`Delete "${selected.title}" from this encrypted vault?`);
  if (!confirmed) {
    return;
  }

  state.vault.items = state.vault.items.filter((item) => item.id !== selected.id);
  upsertTombstone(selected.id, new Date().toISOString());
  state.selectedId = chooseSelection();
  touchVault();
  await persistVault("Entry deleted.");
  render();
}

function saveSyncSettings() {
  state.syncSettings = {
    owner: refs.syncOwner.value.trim(),
    repo: refs.syncRepo.value.trim(),
    branch: refs.syncBranch.value.trim() || "main",
    path: refs.syncPath.value.trim() || "vault/cloud-notes.enc.json",
  };

  writeJsonStorage(SYNC_SETTINGS_KEY, state.syncSettings);

  const token = refs.syncToken.value.trim();
  if (token) {
    sessionStorage.setItem(GITHUB_TOKEN_SESSION_KEY, token);
  }

  renderSyncSummary();
}

function readSyncToken() {
  const token = refs.syncToken.value.trim() || sessionStorage.getItem(GITHUB_TOKEN_SESSION_KEY) || "";
  if (token) {
    sessionStorage.setItem(GITHUB_TOKEN_SESSION_KEY, token);
  }
  return token;
}

async function pushVaultToGitHub() {
  if (!state.vault) {
    showToast("Unlock your vault before syncing.");
    return;
  }

  saveSyncSettings();
  const token = readSyncToken();
  const settings = state.syncSettings;

  if (!settings.owner || !settings.repo || !settings.branch || !settings.path) {
    showToast("Fill in the GitHub owner, repo, branch, and vault path first.");
    return;
  }

  if (!token) {
    showToast("Paste a GitHub token for this tab session before syncing.");
    return;
  }

  await persistVault();

  try {
    const existing = await fetchGitHubFile(settings, token);
    const content = encodeUtf8ToBase64(JSON.stringify(state.encryptedVault, null, 2));
    const url = buildGitHubContentsUrl(settings);
    const body = {
      message: `Update encrypted vault ${new Date().toISOString()}`,
      content,
      branch: settings.branch,
    };

    if (existing?.sha) {
      body.sha = existing.sha;
    }

    const response = await fetch(url, {
      method: "PUT",
      headers: githubHeaders(token),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(await extractGitHubError(response));
    }

    writeJsonStorage(LAST_SYNC_KEY, { at: new Date().toISOString(), mode: "push" });
    state.lastSync = readJsonStorage(LAST_SYNC_KEY, null);
    renderSyncSummary();
    showToast("Encrypted vault pushed to GitHub.");
  } catch (error) {
    showToast(error.message || "GitHub push failed.");
  }
}

async function pullVaultFromGitHub() {
  if (!state.vault) {
    showToast("Unlock your vault before syncing.");
    return;
  }

  saveSyncSettings();
  const token = readSyncToken();
  const settings = state.syncSettings;

  if (!settings.owner || !settings.repo || !settings.branch || !settings.path) {
    showToast("Fill in the GitHub owner, repo, branch, and vault path first.");
    return;
  }

  if (!token) {
    showToast("Paste a GitHub token for this tab session before syncing.");
    return;
  }

  try {
    const remoteFile = await fetchGitHubFile(settings, token);
    if (!remoteFile) {
      showToast("No remote encrypted vault exists yet.");
      return;
    }

    const remoteVault = await decryptVault(remoteFile.payload, state.passphrase);
    state.vault = mergeVaults(state.vault, remoteVault);
    state.selectedId = chooseSelection();
    touchVault();
    await persistVault();
    writeJsonStorage(LAST_SYNC_KEY, { at: new Date().toISOString(), mode: "pull" });
    state.lastSync = readJsonStorage(LAST_SYNC_KEY, null);
    render();
    showToast("Remote vault pulled and merged locally.");
  } catch (error) {
    showToast(error.message || "GitHub pull failed.");
  }
}

function render() {
  renderAuthState();
  renderFilters();
  renderInstallState();
  renderSyncSummary();

  const unlocked = Boolean(state.vault);
  refs.appShell.hidden = !unlocked;
  refs.lockButton.hidden = !unlocked;

  if (!unlocked) {
    return;
  }

  renderStats();
  renderEntryList();
  renderEditor();
}

function renderAuthState() {
  const hasLocalVault = Boolean(state.encryptedVault);
  const unlocked = Boolean(state.vault);
  refs.authSurface.hidden = unlocked;

  if (unlocked) {
    return;
  }

  refs.setupForm.hidden = hasLocalVault;
  refs.unlockForm.hidden = !hasLocalVault;
  refs.authTitle.textContent = hasLocalVault ? "Unlock your encrypted vault" : "Create your local vault";
}

function renderInstallState() {
  refs.installButton.hidden = !state.installPrompt;
}

function renderStats() {
  refs.vaultHeadline.textContent = `Your encrypted vault, ${formattedTime(state.vault.updatedAt)}`;
  refs.itemCount.textContent = String(state.vault.items.length);
  refs.passwordCount.textContent = String(state.vault.items.filter((item) => item.type === "password").length);
  refs.saveStatus.textContent = formattedTime(state.vault.updatedAt);
}

function renderFilters() {
  for (const button of refs.filterGroup.querySelectorAll("[data-filter]")) {
    button.classList.toggle("is-active", button.dataset.filter === state.filter);
  }
}

function renderEntryList() {
  refs.entryList.innerHTML = "";
  const items = visibleItems();
  refs.visibleCount.textContent = `${items.length} visible`;

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = state.search ? "No matches for this search yet." : "No entries yet. Create your first encrypted item.";
    refs.entryList.append(empty);
    return;
  }

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entry-card";
    button.classList.toggle("is-selected", item.id === state.selectedId);
    button.addEventListener("click", () => {
      state.selectedId = item.id;
      renderEditor();
      renderEntryList();
    });

    const headline = document.createElement("div");
    headline.className = "entry-meta";

    const title = document.createElement("h4");
    title.textContent = item.title;
    headline.append(title);

    const time = document.createElement("span");
    time.className = "mini-note";
    time.textContent = formattedTime(item.updatedAt);
    headline.append(time);

    const pillRow = document.createElement("div");
    pillRow.className = "entry-pill-row";

    const pill = document.createElement("span");
    pill.className = `pill ${item.type}`;
    pill.textContent = labelForType(item.type);
    pillRow.append(pill);

    const tags = document.createElement("span");
    tags.className = "mini-note";
    tags.textContent = item.tags.length ? item.tags.join(", ") : "No tags";
    pillRow.append(tags);

    const summary = document.createElement("p");
    summary.className = "entry-summary";
    summary.textContent = summaryForItem(item);

    button.append(headline, pillRow, summary);
    refs.entryList.append(button);
  }
}

function renderEditor() {
  const selected = getSelectedEntry();
  refs.entryForm.hidden = !selected;
  refs.editorEmpty.hidden = Boolean(selected);

  if (!selected) {
    refs.editorTitle.textContent = "Select or create an item";
    refs.editorUpdated.textContent = "No selection";
    return;
  }

  refs.editorTitle.textContent = selected.title;
  refs.editorUpdated.textContent = `Updated ${formattedTime(selected.updatedAt)}`;
  refs.entryType.value = selected.type;
  refs.entryTitle.value = selected.title;
  refs.entryTags.value = selected.tags.join(", ");
  refs.entryUsername.value = selected.username;
  refs.entryUrl.value = selected.url;
  refs.entryPassword.value = selected.password;
  refs.entryContent.value = selected.content;
  refs.entryPassword.type = "password";
  refs.togglePasswordVisibility.textContent = "Show";
  renderEditorFields();
}

function renderEditorFields() {
  const type = refs.entryType.value;
  const isPassword = type === "password";
  refs.usernameField.hidden = !isPassword;
  refs.urlField.hidden = !isPassword;
  refs.passwordField.hidden = !isPassword;
  refs.contentLabel.textContent = isPassword ? "Notes" : type === "snippet" ? "Private snippet" : "Body";
}

function renderSyncSummary() {
  const configured = state.syncSettings.owner && state.syncSettings.repo;
  refs.syncStatus.textContent = configured ? `${state.syncSettings.owner}/${state.syncSettings.repo}` : "Not configured";
  const lastSyncText = state.lastSync ? `${state.lastSync.mode} at ${formattedTime(state.lastSync.at)}` : "not yet run";
  refs.lastSyncNote.textContent = `Last sync: ${lastSyncText}`;
}

function scheduleAutoLock() {
  clearTimeout(state.lockTimeout);
  if (!state.vault || state.autoLockMinutes === 0) {
    return;
  }

  state.lockTimeout = window.setTimeout(() => {
    lockVault("Vault auto-locked after inactivity.");
  }, state.autoLockMinutes * 60 * 1000);
}

async function persistVault(message) {
  if (!state.vault || !state.passphrase) {
    return;
  }

  state.vault = normalizeVault(state.vault);
  state.encryptedVault = await encryptVault(state.vault, state.passphrase);
  await writeEncryptedVault(state.encryptedVault);
  if (message) {
    showToast(message);
  }
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function createStarterVault() {
  const now = new Date().toISOString();
  return normalizeVault({
    version: 1,
    createdAt: now,
    updatedAt: now,
    deleted: [],
    items: [
      {
        id: crypto.randomUUID(),
        type: "note",
        title: "Welcome to Cloud Notes",
        tags: ["starter", "security"],
        username: "",
        url: "",
        password: "",
        content:
          "This vault stays encrypted before it syncs to GitHub.\n\nSuggestions:\n- Use a dedicated private repo for encrypted sync\n- Reuse the same passphrase across your devices\n- Keep your GitHub token scoped only to the repo you choose",
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
}

function normalizeVault(vault) {
  const normalized = {
    version: 1,
    createdAt: vault.createdAt || new Date().toISOString(),
    updatedAt: vault.updatedAt || new Date().toISOString(),
    deleted: Array.isArray(vault.deleted) ? vault.deleted.map(normalizeTombstone) : [],
    items: Array.isArray(vault.items) ? vault.items.map(normalizeItem) : [],
  };

  normalized.items.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  normalized.deleted.sort((left, right) => Date.parse(right.deletedAt) - Date.parse(left.deletedAt));
  return normalized;
}

function normalizeItem(item) {
  const now = new Date().toISOString();
  return {
    id: item.id || crypto.randomUUID(),
    type: ["note", "password", "snippet"].includes(item.type) ? item.type : "note",
    title: item.title || "Untitled note",
    tags: Array.isArray(item.tags) ? item.tags.filter(Boolean) : [],
    username: item.username || "",
    url: item.url || "",
    password: item.password || "",
    content: item.content || "",
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now,
  };
}

function normalizeTombstone(tombstone) {
  return {
    id: tombstone.id,
    deletedAt: tombstone.deletedAt || new Date().toISOString(),
  };
}

function buildEntry(type) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type,
    title: defaultTitleForType(type),
    tags: [],
    username: "",
    url: "",
    password: "",
    content: "",
    createdAt: now,
    updatedAt: now,
  };
}

function defaultTitleForType(type) {
  if (type === "password") {
    return "New password";
  }
  if (type === "snippet") {
    return "New private snippet";
  }
  return "New note";
}

function labelForType(type) {
  if (type === "password") {
    return "Password";
  }
  if (type === "snippet") {
    return "Snippet";
  }
  return "Note";
}

function summaryForItem(item) {
  if (item.type === "password") {
    const parts = [item.username, item.url, item.content].filter(Boolean);
    return parts.join(" | ") || "Stored password entry";
  }
  return item.content || "No content yet";
}

function parseTags(raw) {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function visibleItems() {
  if (!state.vault) {
    return [];
  }

  return state.vault.items.filter((item) => {
    const filterMatches = state.filter === "all" || item.type === state.filter;
    if (!filterMatches) {
      return false;
    }

    if (!state.search) {
      return true;
    }

    const haystack = [item.title, item.content, item.username, item.url, item.tags.join(" ")]
      .join(" ")
      .toLowerCase();
    return haystack.includes(state.search);
  });
}

function getSelectedEntry() {
  if (!state.vault || !state.selectedId) {
    return null;
  }
  return state.vault.items.find((item) => item.id === state.selectedId) || null;
}

function chooseSelection() {
  const items = state.vault?.items ?? [];
  if (!items.length) {
    return null;
  }
  if (state.selectedId && items.some((item) => item.id === state.selectedId)) {
    return state.selectedId;
  }
  return items[0].id;
}

function touchVault(timestamp = new Date().toISOString()) {
  state.vault.updatedAt = timestamp;
}

function upsertTombstone(id, deletedAt) {
  const existing = state.vault.deleted.find((entry) => entry.id === id);
  if (existing) {
    existing.deletedAt = deletedAt;
    return;
  }
  state.vault.deleted.push({ id, deletedAt });
}

function mergeVaults(localVault, remoteVault) {
  const local = normalizeVault(localVault);
  const remote = normalizeVault(remoteVault);
  const itemMap = new Map();
  const tombstoneMap = new Map();

  for (const tombstone of [...local.deleted, ...remote.deleted]) {
    const previous = tombstoneMap.get(tombstone.id);
    if (!previous || Date.parse(tombstone.deletedAt) > Date.parse(previous.deletedAt)) {
      tombstoneMap.set(tombstone.id, tombstone);
    }
  }

  for (const item of [...local.items, ...remote.items]) {
    const previous = itemMap.get(item.id);
    if (!previous || Date.parse(item.updatedAt) > Date.parse(previous.updatedAt)) {
      itemMap.set(item.id, item);
    }
  }

  const mergedItems = [];
  for (const item of itemMap.values()) {
    const tombstone = tombstoneMap.get(item.id);
    if (!tombstone || Date.parse(item.updatedAt) >= Date.parse(tombstone.deletedAt)) {
      mergedItems.push(item);
    }
  }

  const mergedUpdatedAt = [local.updatedAt, remote.updatedAt].sort().at(-1);
  return normalizeVault({
    version: 1,
    createdAt: [local.createdAt, remote.createdAt].sort()[0],
    updatedAt: mergedUpdatedAt,
    deleted: [...tombstoneMap.values()],
    items: mergedItems,
  });
}

function formattedTime(value) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function generatePassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";
  const random = new Uint32Array(length);
  crypto.getRandomValues(random);
  let password = "";
  for (let index = 0; index < length; index += 1) {
    password += alphabet[random[index] % alphabet.length];
  }
  return password;
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("is-visible");
  clearTimeout(state.toastTimeout);
  state.toastTimeout = window.setTimeout(() => {
    refs.toast.classList.remove("is-visible");
  }, 2600);
}

async function encryptVault(vault, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const encoded = new TextEncoder().encode(JSON.stringify(vault));
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    version: 1,
    algorithm: "AES-GCM",
    kdf: "PBKDF2",
    iterations: PBKDF2_ITERATIONS,
    updatedAt: vault.updatedAt,
    salt: encodeBytes(new Uint8Array(salt)),
    iv: encodeBytes(new Uint8Array(iv)),
    cipherText: encodeBytes(new Uint8Array(cipherBuffer)),
  };
}

async function decryptVault(payload, passphrase) {
  try {
    const salt = decodeBytes(payload.salt);
    const iv = decodeBytes(payload.iv);
    const cipherText = decodeBytes(payload.cipherText);
    const key = await deriveKey(passphrase, salt, payload.iterations || PBKDF2_ITERATIONS);
    const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherText);
    const text = new TextDecoder().decode(plainBuffer);
    return JSON.parse(text);
  } catch {
    throw new Error("Passphrase mismatch or vault data is corrupted.");
  }
}

async function deriveKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const passphraseBytes = new TextEncoder().encode(passphrase);
  const keyMaterial = await crypto.subtle.importKey("raw", passphraseBytes, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

function encodeBytes(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function decodeBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeUtf8ToBase64(value) {
  return encodeBytes(new TextEncoder().encode(value));
}

function decodeBase64ToUtf8(value) {
  return new TextDecoder().decode(decodeBytes(value));
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function buildGitHubContentsUrl(settings) {
  const path = settings.path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}/contents/${path}`;
}

async function fetchGitHubFile(settings, token) {
  const url = new URL(buildGitHubContentsUrl(settings));
  url.searchParams.set("ref", settings.branch);

  const response = await fetch(url, {
    headers: githubHeaders(token),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await extractGitHubError(response));
  }

  const data = await response.json();
  return {
    sha: data.sha,
    payload: JSON.parse(decodeBase64ToUtf8((data.content || "").replaceAll("\n", ""))),
  };
}

async function extractGitHubError(response) {
  try {
    const data = await response.json();
    if (data?.message) {
      return `GitHub API: ${data.message}`;
    }
  } catch {
    return `GitHub API request failed with status ${response.status}.`;
  }
  return `GitHub API request failed with status ${response.status}.`;
}

async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readEncryptedVault() {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(ENCRYPTED_VAULT_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function writeEncryptedVault(payload) {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.objectStore(STORE_NAME).put(payload, ENCRYPTED_VAULT_KEY);
  });
}
