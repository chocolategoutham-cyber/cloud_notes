const API_BASE = "https://cloud-notes-api.cloud-notes-api.workers.dev";

const ENTRY_TYPES = {
  password: {
    label: "Password",
    titleLabel: "Website or app",
    titlePlaceholder: "example.com",
    notesPlaceholder: "Backup emails, recovery notes, or sign-in instructions.",
    description: "Keep login credentials, URLs, and recovery details together.",
    fields: [
      { key: "username", label: "Username / Email", autocomplete: "username", copyable: true },
      { key: "password", label: "Password", secret: true, generate: true, autocomplete: "off" },
      { key: "url", label: "Login URL", type: "url", placeholder: "https://example.com/login", copyable: true },
    ],
  },
  card: {
    label: "Card",
    titleLabel: "Card label",
    titlePlaceholder: "Primary Visa",
    notesPlaceholder: "Billing reminders, bank phone numbers, or usage notes.",
    description: "Store card details, CVV, expiry, and billing helpers in one place.",
    fields: [
      { key: "cardholder", label: "Cardholder name", copyable: true },
      { key: "cardNumber", label: "Card number", secret: true, copyable: true },
      { key: "expiry", label: "Expiry", placeholder: "MM/YY", copyable: true },
      { key: "cvv", label: "CVV", secret: true, copyable: true },
      { key: "billingZip", label: "Billing ZIP / PIN", copyable: true },
      { key: "pinHint", label: "PIN hint", placeholder: "Only a hint, not the actual PIN" },
    ],
  },
  banking: {
    label: "Banking",
    titleLabel: "Account label",
    titlePlaceholder: "Salary Account",
    notesPlaceholder: "Branch notes, support contacts, or payment reminders.",
    description: "Save account numbers, IFSC, UPI IDs, and account-specific notes.",
    fields: [
      { key: "bankName", label: "Bank name", copyable: true },
      { key: "accountName", label: "Account holder", copyable: true },
      { key: "accountNumber", label: "Account number", secret: true, copyable: true },
      { key: "ifsc", label: "IFSC / routing", copyable: true },
      { key: "upiId", label: "UPI ID", copyable: true },
      { key: "customerId", label: "Customer ID", copyable: true },
    ],
  },
  document: {
    label: "Document",
    titleLabel: "Document name",
    titlePlaceholder: "Passport",
    notesPlaceholder: "Issue office, renewal notes, or where the original is stored.",
    description: "Track important IDs, document numbers, issue dates, and expiries.",
    fields: [
      { key: "documentNumber", label: "Document number", copyable: true },
      { key: "issuedBy", label: "Issued by", copyable: true },
      { key: "issueDate", label: "Issue date", type: "date" },
      { key: "expiryDate", label: "Expiry date", type: "date" },
      { key: "linkedContact", label: "Linked phone / email", copyable: true },
    ],
  },
  api: {
    label: "API Key",
    titleLabel: "Service name",
    titlePlaceholder: "OpenAI API",
    notesPlaceholder: "Scopes, usage notes, or where this key is used.",
    description: "Keep tokens, environments, endpoints, and usage notes together.",
    fields: [
      { key: "keyName", label: "Key label", copyable: true },
      { key: "secretValue", label: "Secret / token", secret: true, copyable: true },
      { key: "environment", label: "Environment", placeholder: "prod, staging, dev", copyable: true },
      { key: "endpoint", label: "Endpoint / URL", type: "url", copyable: true },
    ],
  },
  wifi: {
    label: "Wi-Fi",
    titleLabel: "Network label",
    titlePlaceholder: "Home Wi-Fi",
    notesPlaceholder: "Router location, ISP plan, or reset instructions.",
    description: "Save Wi-Fi passwords, SSIDs, router logins, and setup notes.",
    fields: [
      { key: "networkName", label: "Network name (SSID)", copyable: true },
      { key: "wifiPassword", label: "Wi-Fi password", secret: true, generate: true, copyable: true },
      { key: "routerLogin", label: "Router login", copyable: true },
      { key: "routerIp", label: "Router IP", placeholder: "192.168.0.1", copyable: true },
    ],
  },
  note: {
    label: "Private Note",
    titleLabel: "Note title",
    titlePlaceholder: "Things I should not forget",
    notesPlaceholder: "Write the secure note here.",
    description: "Use the vault as a private notebook for sensitive text and reminders.",
    fields: [
      { key: "subtitle", label: "Subtitle / context", copyable: true },
      { key: "reference", label: "Reference / link", copyable: true },
    ],
  },
  emergency: {
    label: "Emergency",
    titleLabel: "Emergency item",
    titlePlaceholder: "Family emergency contact",
    notesPlaceholder: "Medical notes, instructions, or where key documents are kept.",
    description: "Save urgent contacts, addresses, and instructions you may need quickly.",
    fields: [
      { key: "contactName", label: "Contact name", copyable: true },
      { key: "phone", label: "Phone", type: "tel", copyable: true },
      { key: "location", label: "Address / location", copyable: true },
      { key: "instructions", label: "Short instruction", copyable: true },
    ],
  },
};

const DEFAULT_TYPE = "password";

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
  installPrompt: null,
  editorType: DEFAULT_TYPE,
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
  installButtons: Array.from(document.querySelectorAll("[data-install-app]")),
  changeEmailButton: document.querySelector("#change-email-button"),
  currentEmail: document.querySelector("#current-email"),
  logoutButton: document.querySelector("#logout-button"),
  searchInput: document.querySelector("#search-input"),
  entryCount: document.querySelector("#entry-count"),
  entryList: document.querySelector("#entry-list"),
  newEntryButton: document.querySelector("#new-entry-button"),
  editorEmpty: document.querySelector("#editor-empty"),
  editorContent: document.querySelector("#editor-content"),
  editorTypeLabel: document.querySelector("#editor-type-label"),
  editorTitle: document.querySelector("#editor-title"),
  editorUpdated: document.querySelector("#editor-updated"),
  favoriteButton: document.querySelector("#favorite-button"),
  entryForm: document.querySelector("#entry-form"),
  entryType: document.querySelector("#entry-type"),
  entryTags: document.querySelector("#entry-tags"),
  entryTitleLabel: document.querySelector("#entry-title-label"),
  entryTitleInput: document.querySelector("#entry-title-input"),
  entryTypeHint: document.querySelector("#entry-type-hint"),
  dynamicFields: document.querySelector("#dynamic-fields"),
  entryNotes: document.querySelector("#entry-notes"),
  deleteEntryButton: document.querySelector("#delete-entry-button"),
  templateGrid: document.querySelector("#template-grid"),
  quickTemplateList: document.querySelector("#quick-template-list"),
  typeChipList: document.querySelector("#type-chip-list"),
  toast: document.querySelector("#toast"),
};

document.addEventListener("DOMContentLoaded", () => {
  void initializeApp();
});

async function initializeApp() {
  renderTypeOptions();
  renderTemplateButtons();
  bindEvents();
  registerServiceWorker();
  await hydrateSession();
}

function bindEvents() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    updateInstallButtons();
  });

  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    updateInstallButtons();
    showToast("Cloud Vault installed.");
  });

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

  refs.installButtons.forEach((button) => {
    button.addEventListener("click", () => void installApp());
  });

  refs.otpInput.addEventListener("input", () => {
    refs.otpInput.value = refs.otpInput.value.replace(/\D/g, "");
  });

  refs.logoutButton.addEventListener("click", () => void logout());
  refs.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderEntryList();
  });
  refs.newEntryButton.addEventListener("click", () => startNewEntry(DEFAULT_TYPE));
  refs.entryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveEntry();
  });
  refs.deleteEntryButton.addEventListener("click", () => void deleteEntry());

  refs.entryType.addEventListener("change", () => {
    const current = collectEditorValues();
    state.editorType = refs.entryType.value || DEFAULT_TYPE;
    hydrateEditorForm({ ...current, type: state.editorType });
  });

  refs.favoriteButton.addEventListener("click", () => {
    const active = refs.favoriteButton.dataset.active === "true";
    setFavoriteButtonState(!active);
  });

  refs.dynamicFields.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-secret-action]");
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.secretAction;
    const fieldKey = actionButton.dataset.fieldKey;
    const input = refs.dynamicFields.querySelector(`[data-field-key="${fieldKey}"]`);
    if (!input) {
      return;
    }

    if (action === "toggle") {
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      actionButton.textContent = isPassword ? "Hide" : "Show";
      return;
    }

    if (action === "copy") {
      if (!input.value) {
        showToast("Nothing to copy.");
        return;
      }
      await navigator.clipboard.writeText(input.value);
      showToast("Copied.");
      return;
    }

    if (action === "generate") {
      input.value = generatePassword();
      input.type = "text";
      const toggleButton = refs.dynamicFields.querySelector(
        `[data-secret-action="toggle"][data-field-key="${fieldKey}"]`
      );
      if (toggleButton) {
        toggleButton.textContent = "Hide";
      }
      showToast("Strong value generated.");
      return;
    }
  });

  updateInstallButtons();
}

function renderTypeOptions() {
  refs.entryType.innerHTML = "";
  for (const [type, config] of Object.entries(ENTRY_TYPES)) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = config.label;
    refs.entryType.append(option);
  }
}

function renderTemplateButtons() {
  const fragmentOne = document.createDocumentFragment();
  const fragmentTwo = document.createDocumentFragment();

  for (const [type, config] of Object.entries(ENTRY_TYPES)) {
    const templateButton = createTemplateButton(type, config.label);
    const quickButton = createTemplateButton(type, config.label);
    quickButton.classList.add("quick-template-button");
    fragmentOne.append(templateButton);
    fragmentTwo.append(quickButton);
  }

  refs.templateGrid.replaceChildren(fragmentOne);
  refs.quickTemplateList.replaceChildren(fragmentTwo);
}

function createTemplateButton(type, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "template-button";
  button.textContent = label;
  button.addEventListener("click", () => startNewEntry(type));
  return button;
}

async function hydrateSession() {
  state.sessionToken = getStoredSessionToken();
  if (!state.sessionToken) {
    resetSessionState();
    render();
    return;
  }

  try {
    const response = await api("/session");
    state.session = response.user;
    state.vault = sanitizeVault(response.vault);
    state.selectedId = state.vault.entries[0]?.id ?? null;
    state.isCreatingEntry = !state.vault.entries.length;
    state.editorType = state.vault.entries[0]?.type || DEFAULT_TYPE;
  } catch {
    clearStoredSessionToken();
    state.sessionToken = "";
    resetSessionState();
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
    state.editorType = state.vault.entries[0]?.type || DEFAULT_TYPE;
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
    state.pendingEmail = "";
    state.authStep = "email";
    refs.emailForm.reset();
    refs.otpForm.reset();
    refs.searchInput.value = "";
    resetSessionState();
    render();
    showToast("Logged out.");
  });
}

async function installApp() {
  if (isStandaloneMode()) {
    showToast("Cloud Vault is already installed.");
    return;
  }

  if (state.installPrompt) {
    const promptEvent = state.installPrompt;
    state.installPrompt = null;
    await promptEvent.prompt();
    await promptEvent.userChoice.catch(() => undefined);
    updateInstallButtons();
    return;
  }

  showToast("In Brave, open the menu and tap Add to Home screen or Install app.");
}

function startNewEntry(type = DEFAULT_TYPE) {
  if (!state.vault) {
    return;
  }

  state.isCreatingEntry = true;
  state.selectedId = null;
  state.editorType = type;
  renderEditor();
  refs.entryTitleInput.focus();
}

async function saveEntry() {
  if (!state.vault) {
    return;
  }

  const values = collectEditorValues();
  if (!values.title) {
    showToast("Title is required.");
    refs.entryTitleInput.focus();
    return;
  }

  const now = new Date().toISOString();
  const entry = {
    id: state.selectedId || crypto.randomUUID(),
    type: values.type,
    title: values.title,
    notes: values.notes,
    tags: values.tags,
    isFavorite: values.isFavorite,
    fields: values.fields,
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

  sortEntries(state.vault.entries);
  state.selectedId = entry.id;
  state.isCreatingEntry = false;
  state.editorType = entry.type;
  await persistVault("Record saved.");
  render();
}

async function deleteEntry() {
  const entry = getSelectedEntry();
  if (!entry) {
    return;
  }

  const confirmed = window.confirm(`Delete "${entry.title}" from your vault?`);
  if (!confirmed) {
    return;
  }

  state.vault.entries = state.vault.entries.filter((item) => item.id !== entry.id);
  sortEntries(state.vault.entries);
  state.selectedId = state.vault.entries[0]?.id ?? null;
  state.isCreatingEntry = !state.vault.entries.length;
  state.editorType = state.vault.entries[0]?.type || DEFAULT_TYPE;
  await persistVault("Record deleted.");
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
  updateInstallButtons();

  if (!loggedIn) {
    return;
  }

  refs.currentEmail.textContent = state.session.email;
  refs.entryCount.textContent = String(state.vault.entries.length);
  renderTypeCounts();
  renderEntryList();
  renderEditor();
}

function renderTypeCounts() {
  const counts = new Map();
  for (const entry of state.vault.entries) {
    counts.set(entry.type, (counts.get(entry.type) || 0) + 1);
  }

  refs.typeChipList.innerHTML = "";
  if (!counts.size) {
    return;
  }

  for (const [type, count] of counts.entries()) {
    const chip = document.createElement("span");
    chip.className = "type-chip";
    chip.textContent = `${getEntryTypeConfig(type).label}: ${count}`;
    refs.typeChipList.append(chip);
  }
}

function renderEntryList() {
  refs.entryList.innerHTML = "";
  const entries = visibleEntries();

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "entry-card";
    empty.innerHTML = "<h3>No records yet</h3><p>Add your first secure record to this vault.</p>";
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
      state.editorType = entry.type;
      renderEntryList();
      renderEditor();
    });

    const meta = document.createElement("div");
    meta.className = "entry-card-meta";

    const typeBadge = document.createElement("span");
    typeBadge.className = "entry-type-badge";
    typeBadge.textContent = getEntryTypeConfig(entry.type).label;

    meta.append(typeBadge);

    if (entry.isFavorite) {
      const favoriteBadge = document.createElement("span");
      favoriteBadge.className = "entry-favorite-badge";
      favoriteBadge.textContent = "Favorite";
      meta.append(favoriteBadge);
    }

    const title = document.createElement("h3");
    title.textContent = entry.title;

    const summary = document.createElement("p");
    summary.textContent = buildEntrySummary(entry);

    button.append(meta, title, summary);

    if (entry.tags.length) {
      const tags = document.createElement("div");
      tags.className = "entry-tag-row";
      for (const tag of entry.tags.slice(0, 3)) {
        const tagChip = document.createElement("span");
        tagChip.className = "entry-tag";
        tagChip.textContent = tag;
        tags.append(tagChip);
      }
      button.append(tags);
    }

    refs.entryList.append(button);
  }
}

function renderEditor() {
  const entry = getSelectedEntry();
  const showingComposer = state.isCreatingEntry;

  refs.editorEmpty.hidden = Boolean(entry || showingComposer);
  refs.editorContent.hidden = !entry && !showingComposer;

  if (!entry && !showingComposer) {
    return;
  }

  const source = showingComposer ? createDraftEntry(state.editorType) : entry;
  state.editorType = source.type;
  hydrateEditorForm(source);
  refs.editorTypeLabel.textContent = getEntryTypeConfig(source.type).label;
  refs.editorTitle.textContent = showingComposer ? `New ${getEntryTypeConfig(source.type).label}` : source.title;
  refs.editorUpdated.textContent = showingComposer ? "Unsaved" : `Updated ${formatDate(source.updatedAt)}`;
  refs.deleteEntryButton.hidden = showingComposer;
}

function hydrateEditorForm(entry) {
  const config = getEntryTypeConfig(entry.type);
  refs.entryType.value = entry.type;
  refs.entryTitleLabel.textContent = config.titleLabel;
  refs.entryTitleInput.placeholder = config.titlePlaceholder;
  refs.entryTitleInput.value = entry.title || "";
  refs.entryTypeHint.textContent = config.description;
  refs.entryTags.value = entry.tags.join(", ");
  refs.entryNotes.placeholder = config.notesPlaceholder;
  refs.entryNotes.value = entry.notes || "";
  setFavoriteButtonState(Boolean(entry.isFavorite));
  renderDynamicFields(entry.type, entry.fields || {});
}

function renderDynamicFields(type, values) {
  const config = getEntryTypeConfig(type);
  refs.dynamicFields.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (const field of config.fields) {
    const group = document.createElement("div");
    group.className = "form-group";

    const label = document.createElement("label");
    label.setAttribute("for", `field-${field.key}`);
    label.textContent = field.label;

    const inputWrap = document.createElement("div");
    inputWrap.className = field.secret || field.copyable || field.generate ? "field-action-group" : "";

    const input = document.createElement(field.multiline ? "textarea" : "input");
    input.id = `field-${field.key}`;
    input.dataset.fieldKey = field.key;
    input.value = String(values[field.key] || "");
    input.placeholder = field.placeholder || "";
    input.autocomplete = field.autocomplete || "off";

    if (!field.multiline) {
      input.type = field.secret ? "password" : field.type || "text";
    } else {
      input.rows = 4;
    }

    inputWrap.append(input);

    if (field.secret || field.copyable || field.generate) {
      const actions = document.createElement("div");
      actions.className = "inline-field-actions";

      if (field.secret) {
        actions.append(createFieldActionButton("Show", "toggle", field.key));
      }
      if (field.copyable || field.secret) {
        actions.append(createFieldActionButton("Copy", "copy", field.key));
      }
      if (field.generate) {
        actions.append(createFieldActionButton("Generate", "generate", field.key));
      }

      inputWrap.append(actions);
    }

    group.append(label, inputWrap);
    fragment.append(group);
  }

  refs.dynamicFields.append(fragment);
}

function createFieldActionButton(label, action, fieldKey) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-secondary btn-sm";
  button.dataset.secretAction = action;
  button.dataset.fieldKey = fieldKey;
  button.textContent = label;
  return button;
}

function collectEditorValues() {
  const fields = {};
  refs.dynamicFields.querySelectorAll("[data-field-key]").forEach((input) => {
    fields[input.dataset.fieldKey] = String(input.value || "").trim();
  });

  return {
    type: refs.entryType.value || DEFAULT_TYPE,
    title: refs.entryTitleInput.value.trim(),
    notes: refs.entryNotes.value.trim(),
    tags: parseTags(refs.entryTags.value),
    isFavorite: refs.favoriteButton.dataset.active === "true",
    fields,
  };
}

function visibleEntries() {
  const entries = state.vault?.entries || [];
  if (!state.search) {
    return entries;
  }

  return entries.filter((entry) => {
    const haystack = [
      entry.title,
      entry.notes,
      entry.type,
      ...entry.tags,
      ...Object.values(entry.fields || {}),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(state.search);
  });
}

function getSelectedEntry() {
  if (!state.vault || !state.selectedId) {
    return null;
  }

  return state.vault.entries.find((entry) => entry.id === state.selectedId) || null;
}

function createDraftEntry(type = DEFAULT_TYPE) {
  return {
    id: "",
    type,
    title: "",
    notes: "",
    tags: [],
    isFavorite: false,
    fields: {},
    createdAt: "",
    updatedAt: "",
  };
}

function sanitizeVault(vault) {
  if (!vault || typeof vault !== "object" || !Array.isArray(vault.entries)) {
    return { version: 2, entries: [] };
  }

  const entries = vault.entries.map((entry) => sanitizeEntry(entry)).filter(Boolean);
  sortEntries(entries);
  return {
    version: 2,
    entries,
  };
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const now = new Date().toISOString();
  const looksLegacy = "website" in entry || "username" in entry || "password" in entry;

  if (looksLegacy) {
    return {
      id: String(entry.id || crypto.randomUUID()),
      type: "password",
      title: String(entry.website || "Untitled Password"),
      notes: String(entry.notes || ""),
      tags: [],
      isFavorite: false,
      fields: {
        username: String(entry.username || ""),
        password: String(entry.password || ""),
        url: String(entry.url || ""),
      },
      createdAt: String(entry.createdAt || now),
      updatedAt: String(entry.updatedAt || now),
    };
  }

  const type = ENTRY_TYPES[entry.type] ? entry.type : DEFAULT_TYPE;
  const fields = {};
  for (const field of getEntryTypeConfig(type).fields) {
    fields[field.key] = String(entry.fields?.[field.key] || "");
  }

  return {
    id: String(entry.id || crypto.randomUUID()),
    type,
    title: String(entry.title || "Untitled Record"),
    notes: String(entry.notes || ""),
    tags: Array.isArray(entry.tags)
      ? entry.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8)
      : [],
    isFavorite: Boolean(entry.isFavorite),
    fields,
    createdAt: String(entry.createdAt || now),
    updatedAt: String(entry.updatedAt || now),
  };
}

function buildEntrySummary(entry) {
  const config = getEntryTypeConfig(entry.type);
  const values = config.fields
    .map((field) => entry.fields?.[field.key])
    .filter(Boolean)
    .slice(0, 2);

  if (values.length) {
    return values.join(" - ");
  }

  if (entry.notes) {
    return entry.notes;
  }

  return `${config.label} record`;
}

function parseTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
}

function sortEntries(entries) {
  entries.sort((left, right) => {
    if (left.isFavorite !== right.isFavorite) {
      return Number(right.isFavorite) - Number(left.isFavorite);
    }
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function setFavoriteButtonState(isFavorite) {
  refs.favoriteButton.dataset.active = isFavorite ? "true" : "false";
  refs.favoriteButton.textContent = isFavorite ? "Favorite" : "Mark Favorite";
  refs.favoriteButton.classList.toggle("is-active", isFavorite);
}

function getEntryTypeConfig(type) {
  return ENTRY_TYPES[type] || ENTRY_TYPES[DEFAULT_TYPE];
}

function resetSessionState() {
  state.session = null;
  state.vault = null;
  state.selectedId = null;
  state.search = "";
  state.isCreatingEntry = false;
  state.editorType = DEFAULT_TYPE;
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

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function updateInstallButtons() {
  const installed = isStandaloneMode();
  refs.installButtons.forEach((button) => {
    button.hidden = installed;
  });
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
