const DB_NAME = "cloud-notes-db";
const STORE_NAME = "vault";
const ENCRYPTED_VAULT_KEY = "encrypted-vault";
const AUTO_LOCK_KEY = "cloud-notes-auto-lock";
const LAST_SYNC_KEY = "cloud-notes-last-sync";
const GITHUB_TOKEN_SESSION_KEY = "cloud-notes-session-token";
const PBKDF2_ITERATIONS = 250000;
const GITHUB_VAULT = {
  owner: "chocolategoutham-cyber",
  repo: "cloud_notes_vault",
  branch: "main",
  path: "vault/notes.enc.json",
};

const state = {
  encryptedVault: null,
  vault: null,
  passphrase: "",
  selectedId: null,
  search: "",
  autoLockMinutes: readJsonStorage(AUTO_LOCK_KEY, 10),
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
  noteCount: document.querySelector("#note-count"),
  saveStatus: document.querySelector("#save-status"),
  searchInput: document.querySelector("#search-input"),
  autoLockSelect: document.querySelector("#auto-lock-select"),
  newNoteButton: document.querySelector("#new-note-button"),
  duplicateNoteButton: document.querySelector("#duplicate-note-button"),
  noteList: document.querySelector("#note-list"),
  visibleCount: document.querySelector("#visible-count"),
  editorTitle: document.querySelector("#editor-title"),
  editorUpdated: document.querySelector("#editor-updated"),
  noteForm: document.querySelector("#note-form"),
  editorEmpty: document.querySelector("#editor-empty"),
  noteTitle: document.querySelector("#note-title"),
  noteTags: document.querySelector("#note-tags"),
  noteContent: document.querySelector("#note-content"),
  deleteNoteButton: document.querySelector("#delete-note-button"),
  syncStatus: document.querySelector("#sync-status"),
  syncToken: document.querySelector("#sync-token"),
  pushButton: document.querySelector("#push-button"),
  pullButton: document.querySelector("#pull-button"),
  repoName: document.querySelector("#repo-name"),
  repoPath: document.querySelector("#repo-path"),
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

  refs.lockButton.addEventListener("click", () => lockVault("Notes locked."));

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
    renderNoteList();
  });

  refs.autoLockSelect.addEventListener("change", (event) => {
    state.autoLockMinutes = Number(event.target.value);
    writeJsonStorage(AUTO_LOCK_KEY, state.autoLockMinutes);
    scheduleAutoLock();
    showToast(state.autoLockMinutes === 0 ? "Auto-lock disabled for this device." : `Auto-lock set to ${state.autoLockMinutes} minutes.`);
  });

  refs.newNoteButton.addEventListener("click", () => void createNote());
  refs.duplicateNoteButton.addEventListener("click", () => void duplicateSelectedNote());

  refs.noteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSelectedNote();
  });

  refs.deleteNoteButton.addEventListener("click", () => void deleteSelectedNote());
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

function applyStoredSettings() {
  refs.autoLockSelect.value = String(state.autoLockMinutes);
  refs.syncToken.value = sessionStorage.getItem(GITHUB_TOKEN_SESSION_KEY) ?? "";
  refs.repoName.textContent = `${GITHUB_VAULT.owner}/${GITHUB_VAULT.repo}`;
  refs.repoPath.textContent = `${GITHUB_VAULT.branch} -> ${GITHUB_VAULT.path}`;
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

async function createVault() {
  const passphrase = refs.setupPassphrase.value.trim();
  const confirmation = refs.setupConfirm.value.trim();

  if (passphrase.length < 10) {
    showToast("Choose a password with at least 10 characters.");
    return;
  }

  if (passphrase !== confirmation) {
    showToast("The passwords do not match.");
    return;
  }

  const vault = createStarterVault();
  await unlockWithVault(vault, passphrase, true);
  refs.setupForm.reset();
  showToast("Encrypted notes vault created on this device.");
}

async function unlockVault() {
  if (!state.encryptedVault) {
    showToast("No encrypted notes vault exists on this device yet.");
    return;
  }

  try {
    const vault = await decryptVault(state.encryptedVault, refs.unlockPassphrase.value);
    await unlockWithVault(vault, refs.unlockPassphrase.value, false);
    refs.unlockForm.reset();
    showToast("Notes unlocked.");
  } catch (error) {
    showToast(error.message);
  }
}

async function unlockWithVault(vault, passphrase, shouldPersist) {
  state.passphrase = passphrase;
  state.vault = normalizeVault(vault);
  state.selectedId = chooseSelection();
  if (shouldPersist) {
    await persistVault("Encrypted notes saved locally.");
  }
  render();
  scheduleAutoLock();
}

function lockVault(message) {
  state.passphrase = "";
  state.vault = null;
  state.selectedId = null;
  clearTimeout(state.lockTimeout);
  refs.noteForm.reset();
  render();
  if (message) {
    showToast(message);
  }
}

async function createNote() {
  if (!state.vault) {
    return;
  }

  const note = buildNote();
  state.vault.notes.unshift(note);
  state.selectedId = note.id;
  touchVault();
  await persistVault("New note created.");
  render();
}

async function duplicateSelectedNote() {
  const selected = getSelectedNote();
  if (!selected) {
    return;
  }

  const copy = {
    ...selected,
    id: crypto.randomUUID(),
    title: `${selected.title} copy`,
    tags: [...selected.tags],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  state.vault.notes.unshift(copy);
  state.selectedId = copy.id;
  touchVault();
  await persistVault("Note duplicated.");
  render();
}

async function saveSelectedNote() {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  const now = new Date().toISOString();
  note.title = refs.noteTitle.value.trim() || "Untitled note";
  note.tags = parseTags(refs.noteTags.value);
  note.content = refs.noteContent.value;
  note.updatedAt = now;
  touchVault(now);
  await persistVault("Note saved.");
  render();
}

async function deleteSelectedNote() {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  const confirmed = window.confirm(`Delete "${note.title}" from this encrypted notes vault?`);
  if (!confirmed) {
    return;
  }

  state.vault.notes = state.vault.notes.filter((entry) => entry.id !== note.id);
  upsertTombstone(note.id, new Date().toISOString());
  state.selectedId = chooseSelection();
  touchVault();
  await persistVault("Note deleted.");
  render();
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
    showToast("Unlock your notes before syncing.");
    return;
  }

  const token = readSyncToken();
  if (!token) {
    showToast("Add a GitHub token for this tab session before syncing.");
    return;
  }

  await persistVault();

  try {
    const existing = await fetchGitHubFile(GITHUB_VAULT, token);
    const body = {
      message: `Update encrypted notes ${new Date().toISOString()}`,
      content: encodeUtf8ToBase64(JSON.stringify(state.encryptedVault, null, 2)),
      branch: GITHUB_VAULT.branch,
    };

    if (existing?.sha) {
      body.sha = existing.sha;
    }

    const response = await fetch(buildGitHubContentsUrl(GITHUB_VAULT), {
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
    showToast("Encrypted notes pushed to GitHub.");
  } catch (error) {
    showToast(error.message || "GitHub push failed.");
  }
}

async function pullVaultFromGitHub() {
  if (!state.vault) {
    showToast("Unlock your notes before syncing.");
    return;
  }

  const token = readSyncToken();
  if (!token) {
    showToast("Add a GitHub token for this tab session before syncing.");
    return;
  }

  try {
    const remoteFile = await fetchGitHubFile(GITHUB_VAULT, token);
    if (!remoteFile) {
      showToast("No encrypted notes file exists in the vault repo yet.");
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
    showToast("Encrypted notes pulled and merged.");
  } catch (error) {
    showToast(error.message || "GitHub pull failed.");
  }
}

function render() {
  renderAuthState();
  renderInstallState();
  renderSyncSummary();

  const unlocked = Boolean(state.vault);
  refs.appShell.hidden = !unlocked;
  refs.lockButton.hidden = !unlocked;

  if (!unlocked) {
    return;
  }

  renderStats();
  renderNoteList();
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
  refs.authTitle.textContent = hasLocalVault ? "Unlock your encrypted notes vault" : "Create your encrypted notes vault";
}

function renderInstallState() {
  refs.installButton.hidden = !state.installPrompt;
}

function renderStats() {
  refs.vaultHeadline.textContent = `Your secure notes vault, ${formattedTime(state.vault.updatedAt)}`;
  refs.noteCount.textContent = String(state.vault.notes.length);
  refs.saveStatus.textContent = formattedTime(state.vault.updatedAt);
}

function renderNoteList() {
  refs.noteList.innerHTML = "";
  const notes = visibleNotes();
  refs.visibleCount.textContent = `${notes.length} visible`;

  if (!notes.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = state.search ? "No notes match your search yet." : "No notes yet. Create your first secure note.";
    refs.noteList.append(empty);
    return;
  }

  for (const note of notes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entry-card";
    button.classList.toggle("is-selected", note.id === state.selectedId);
    button.addEventListener("click", () => {
      state.selectedId = note.id;
      renderEditor();
      renderNoteList();
    });

    const meta = document.createElement("div");
    meta.className = "entry-meta";

    const title = document.createElement("h4");
    title.textContent = note.title;
    meta.append(title);

    const time = document.createElement("span");
    time.className = "mini-note";
    time.textContent = formattedTime(note.updatedAt);
    meta.append(time);

    const tags = document.createElement("div");
    tags.className = "entry-pill-row";

    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = "Note";
    tags.append(pill);

    const tagText = document.createElement("span");
    tagText.className = "mini-note";
    tagText.textContent = note.tags.length ? note.tags.join(", ") : "No tags";
    tags.append(tagText);

    const summary = document.createElement("p");
    summary.className = "entry-summary";
    summary.textContent = note.content || "No content yet";

    button.append(meta, tags, summary);
    refs.noteList.append(button);
  }
}

function renderEditor() {
  const note = getSelectedNote();
  refs.noteForm.hidden = !note;
  refs.editorEmpty.hidden = Boolean(note);

  if (!note) {
    refs.editorTitle.textContent = "Select or create a note";
    refs.editorUpdated.textContent = "No selection";
    return;
  }

  refs.editorTitle.textContent = note.title;
  refs.editorUpdated.textContent = `Updated ${formattedTime(note.updatedAt)}`;
  refs.noteTitle.value = note.title;
  refs.noteTags.value = note.tags.join(", ");
  refs.noteContent.value = note.content;
}

function renderSyncSummary() {
  refs.syncStatus.textContent = `${GITHUB_VAULT.owner}/${GITHUB_VAULT.repo}`;
  const lastSyncText = state.lastSync ? `${state.lastSync.mode} at ${formattedTime(state.lastSync.at)}` : "not yet run";
  refs.lastSyncNote.textContent = `Last sync: ${lastSyncText}`;
}

function scheduleAutoLock() {
  clearTimeout(state.lockTimeout);
  if (!state.vault || state.autoLockMinutes === 0) {
    return;
  }

  state.lockTimeout = window.setTimeout(() => {
    lockVault("Notes auto-locked after inactivity.");
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

function createStarterVault() {
  const now = new Date().toISOString();
  return normalizeVault({
    version: 1,
    createdAt: now,
    updatedAt: now,
    deleted: [],
    notes: [
      {
        id: crypto.randomUUID(),
        title: "Welcome to Cloud Notes",
        tags: ["starter", "notes"],
        content:
          "This app is now focused on secure notes only.\n\nWhat changed:\n- One password unlocks all your notes\n- Search works after unlock\n- Sync is wired to a separate private GitHub vault repo\n- Notes are encrypted before local save and before GitHub sync",
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
    notes: Array.isArray(vault.notes) ? vault.notes.map(normalizeNote) : [],
  };

  normalized.notes.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  normalized.deleted.sort((left, right) => Date.parse(right.deletedAt) - Date.parse(left.deletedAt));
  return normalized;
}

function normalizeNote(note) {
  const now = new Date().toISOString();
  return {
    id: note.id || crypto.randomUUID(),
    title: note.title || "Untitled note",
    tags: Array.isArray(note.tags) ? note.tags.filter(Boolean) : [],
    content: note.content || "",
    createdAt: note.createdAt || now,
    updatedAt: note.updatedAt || now,
  };
}

function normalizeTombstone(entry) {
  return {
    id: entry.id,
    deletedAt: entry.deletedAt || new Date().toISOString(),
  };
}

function buildNote() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "New note",
    tags: [],
    content: "",
    createdAt: now,
    updatedAt: now,
  };
}

function parseTags(raw) {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function visibleNotes() {
  if (!state.vault) {
    return [];
  }

  if (!state.search) {
    return state.vault.notes;
  }

  return state.vault.notes.filter((note) => {
    const haystack = [note.title, note.content, note.tags.join(" ")].join(" ").toLowerCase();
    return haystack.includes(state.search);
  });
}

function getSelectedNote() {
  if (!state.vault || !state.selectedId) {
    return null;
  }
  return state.vault.notes.find((note) => note.id === state.selectedId) || null;
}

function chooseSelection() {
  const notes = state.vault?.notes ?? [];
  if (!notes.length) {
    return null;
  }
  if (state.selectedId && notes.some((note) => note.id === state.selectedId)) {
    return state.selectedId;
  }
  return notes[0].id;
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
  const noteMap = new Map();
  const tombstoneMap = new Map();

  for (const tombstone of [...local.deleted, ...remote.deleted]) {
    const previous = tombstoneMap.get(tombstone.id);
    if (!previous || Date.parse(tombstone.deletedAt) > Date.parse(previous.deletedAt)) {
      tombstoneMap.set(tombstone.id, tombstone);
    }
  }

  for (const note of [...local.notes, ...remote.notes]) {
    const previous = noteMap.get(note.id);
    if (!previous || Date.parse(note.updatedAt) > Date.parse(previous.updatedAt)) {
      noteMap.set(note.id, note);
    }
  }

  const mergedNotes = [];
  for (const note of noteMap.values()) {
    const tombstone = tombstoneMap.get(note.id);
    if (!tombstone || Date.parse(note.updatedAt) >= Date.parse(tombstone.deletedAt)) {
      mergedNotes.push(note);
    }
  }

  return normalizeVault({
    version: 1,
    createdAt: [local.createdAt, remote.createdAt].sort()[0],
    updatedAt: [local.updatedAt, remote.updatedAt].sort().at(-1),
    deleted: [...tombstoneMap.values()],
    notes: mergedNotes,
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
    throw new Error("Password mismatch or vault data is corrupted.");
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
