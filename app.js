const API_BASE = "https://cloud-notes-api.YOUR-SUBDOMAIN.workers.dev";

const state = {
  installPrompt: null,
  toastTimeout: null,
  session: null,
  notes: [],
  selectedId: null,
  search: "",
  loading: false,
};

const refs = {
  authSurface: document.querySelector("#auth-surface"),
  appShell: document.querySelector("#app-shell"),
  installButton: document.querySelector("#install-button"),
  logoutButton: document.querySelector("#logout-button"),
  loginForm: document.querySelector("#login-form"),
  signupForm: document.querySelector("#signup-form"),
  loginUsername: document.querySelector("#login-username"),
  loginPassword: document.querySelector("#login-password"),
  signupUsername: document.querySelector("#signup-username"),
  signupPassword: document.querySelector("#signup-password"),
  currentUser: document.querySelector("#current-user"),
  noteCount: document.querySelector("#note-count"),
  syncStatus: document.querySelector("#sync-status"),
  searchInput: document.querySelector("#search-input"),
  newNoteButton: document.querySelector("#new-note-button"),
  refreshButton: document.querySelector("#refresh-button"),
  noteList: document.querySelector("#note-list"),
  visibleCount: document.querySelector("#visible-count"),
  editorTitle: document.querySelector("#editor-title"),
  editorUpdated: document.querySelector("#editor-updated"),
  noteForm: document.querySelector("#note-form"),
  editorEmpty: document.querySelector("#editor-empty"),
  noteTitle: document.querySelector("#note-title"),
  noteContent: document.querySelector("#note-content"),
  deleteNoteButton: document.querySelector("#delete-note-button"),
  apiStatus: document.querySelector("#api-status"),
  apiBaseValue: document.querySelector("#api-base-value"),
  repoName: document.querySelector("#repo-name"),
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

  refs.logoutButton.addEventListener("click", () => void logout());
  refs.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderNoteList();
  });
  refs.newNoteButton.addEventListener("click", () => {
    state.selectedId = null;
    refs.noteForm.hidden = false;
    refs.editorEmpty.hidden = true;
    refs.editorTitle.textContent = "New note";
    refs.editorUpdated.textContent = "Unsaved";
    refs.noteForm.reset();
    refs.noteTitle.focus();
  });
  refs.refreshButton.addEventListener("click", () => void loadNotes(true));
  refs.noteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveNote();
  });
  refs.deleteNoteButton.addEventListener("click", () => void deleteNote());
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
    refs.apiStatus.textContent = "Connected";
    refs.repoName.textContent = session.repo;
    await loadNotes(false);
  } catch {
    state.session = null;
    refs.apiStatus.textContent = "Backend ready";
    refs.repoName.textContent = "Configured by worker environment";
    render();
  }
}

async function signup() {
  const username = refs.signupUsername.value.trim();
  const password = refs.signupPassword.value;

  if (username.length < 3) {
    showToast("Use a username with at least 3 characters.");
    return;
  }

  if (password.length < 10) {
    showToast("Use a password with at least 10 characters.");
    return;
  }

  await withLoading(async () => {
    const response = await api("/signup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    state.session = response.user;
    refs.signupForm.reset();
    refs.loginForm.reset();
    showToast("Account created. You are now logged in.");
    await loadNotes(false);
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
    refs.loginForm.reset();
    showToast("Logged in.");
    await loadNotes(false);
  });
}

async function logout() {
  await withLoading(async () => {
    await api("/logout", { method: "POST" });
    state.session = null;
    state.notes = [];
    state.selectedId = null;
    refs.searchInput.value = "";
    state.search = "";
    render();
    showToast("Logged out.");
  });
}

async function loadNotes(showToastOnSuccess) {
  await withLoading(async () => {
    const response = await api("/notes");
    state.notes = Array.isArray(response.notes) ? response.notes : [];
    state.selectedId = state.notes[0]?.id ?? null;
    render();
    if (showToastOnSuccess) {
      showToast("Notes refreshed from the private repo.");
    }
  });
}

async function saveNote() {
  const title = refs.noteTitle.value.trim() || "Untitled note";
  const content = refs.noteContent.value;
  const noteId = state.selectedId;

  await withLoading(async () => {
    const endpoint = noteId ? `/notes/${encodeURIComponent(noteId)}` : "/notes";
    const method = noteId ? "PUT" : "POST";
    const response = await api(endpoint, {
      method,
      body: JSON.stringify({ title, content }),
    });

    upsertNote(response.note);
    state.selectedId = response.note.id;
    render();
    showToast(noteId ? "Note updated in the private repo." : "New note added to the private repo.");
  });
}

async function deleteNote() {
  const selected = getSelectedNote();
  if (!selected) {
    return;
  }

  const confirmed = window.confirm(`Delete "${selected.title}"?`);
  if (!confirmed) {
    return;
  }

  await withLoading(async () => {
    await api(`/notes/${encodeURIComponent(selected.id)}`, {
      method: "DELETE",
    });

    state.notes = state.notes.filter((note) => note.id !== selected.id);
    state.selectedId = state.notes[0]?.id ?? null;
    render();
    showToast("Note deleted from the private repo.");
  });
}

function upsertNote(note) {
  const index = state.notes.findIndex((entry) => entry.id === note.id);
  if (index === -1) {
    state.notes.unshift(note);
  } else {
    state.notes[index] = note;
  }

  state.notes.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function render() {
  const loggedIn = Boolean(state.session);
  refs.authSurface.hidden = loggedIn;
  refs.appShell.hidden = !loggedIn;
  refs.logoutButton.hidden = !loggedIn;

  if (!loggedIn) {
    refs.syncStatus.textContent = state.loading ? "Working" : "Idle";
    return;
  }

  refs.currentUser.textContent = state.session.username;
  refs.noteCount.textContent = String(state.notes.length);
  refs.syncStatus.textContent = state.loading ? "Syncing" : "Ready";
  refs.vaultHeadline.textContent = `${state.session.username}'s notes`;

  renderNoteList();
  renderEditor();
}

function renderNoteList() {
  refs.noteList.innerHTML = "";
  const notes = visibleNotes();
  refs.visibleCount.textContent = `${notes.length} visible`;

  if (!notes.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = state.search ? "No notes match your search." : "No notes yet. Create your first note.";
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
      renderNoteList();
      renderEditor();
    });

    const meta = document.createElement("div");
    meta.className = "entry-meta";

    const title = document.createElement("h4");
    title.textContent = note.title;

    const updated = document.createElement("span");
    updated.className = "mini-note";
    updated.textContent = formatDate(note.updatedAt);

    const summary = document.createElement("p");
    summary.className = "entry-summary";
    summary.textContent = note.content || "No content yet";

    meta.append(title, updated);
    button.append(meta, summary);
    refs.noteList.append(button);
  }
}

function renderEditor() {
  const selected = getSelectedNote();
  refs.noteForm.hidden = !selected;
  refs.editorEmpty.hidden = Boolean(selected);

  if (!selected) {
    refs.editorTitle.textContent = "Select or create a note";
    refs.editorUpdated.textContent = "No selection";
    return;
  }

  refs.editorTitle.textContent = selected.title;
  refs.editorUpdated.textContent = `Updated ${formatDate(selected.updatedAt)}`;
  refs.noteTitle.value = selected.title;
  refs.noteContent.value = selected.content;
}

function visibleNotes() {
  if (!state.search) {
    return state.notes;
  }

  return state.notes.filter((note) => {
    const haystack = `${note.title} ${note.content}`.toLowerCase();
    return haystack.includes(state.search);
  });
}

function getSelectedNote() {
  if (!state.selectedId) {
    return null;
  }
  return state.notes.find((note) => note.id === state.selectedId) || null;
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
    showToast("Cloud Notes was installed.");
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
