import { MAX_CAPTURED_DESCRIPTION_CHARS } from "./constants";
import {
  getCurrentUser,
  getExtensionConfig,
  hasValidConfig,
  initializeClientFromStorage,
  saveExtensionConfig,
  signInWithPassword,
  signOutClient,
} from "./supabaseClient";

const elements = {
  toggleConfig: document.getElementById("toggle-config"),
  configSection: document.getElementById("config-section"),
  configUrl: document.getElementById("config-url"),
  configAnon: document.getElementById("config-anon"),
  saveConfig: document.getElementById("save-config"),
  authSection: document.getElementById("auth-section"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  signIn: document.getElementById("sign-in"),
  captureSection: document.getElementById("capture-section"),
  signOut: document.getElementById("sign-out"),
  company: document.getElementById("company"),
  jobTitle: document.getElementById("job-title"),
  status: document.getElementById("status"),
  jobUrl: document.getElementById("job-url"),
  notes: document.getElementById("notes"),
  autofill: document.getElementById("autofill"),
  saveApplication: document.getElementById("save-application"),
  globalStatus: document.getElementById("global-status"),
};

let supabaseClient = null;
let currentUser = null;
let capturedDescription = "";

function showStatus(message, type = "success") {
  elements.globalStatus.textContent = message;
  elements.globalStatus.className = `status ${type}`;
  elements.globalStatus.classList.remove("hidden");
}

function clearStatus() {
  elements.globalStatus.classList.add("hidden");
  elements.globalStatus.textContent = "";
}

function setSavingState(isSaving) {
  elements.saveApplication.disabled = isSaving;
  elements.autofill.disabled = isSaving;
  elements.signIn.disabled = isSaving;
  elements.saveConfig.disabled = isSaving;
}

function handleKeyboardShortcuts(event) {
  const key = String(event.key ?? "").toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "enter") {
    event.preventDefault();
    elements.saveApplication.click();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "a") {
    event.preventDefault();
    elements.autofill.click();
  }
}

function toggleAuthAndCapture() {
  if (currentUser) {
    elements.authSection.classList.add("hidden");
    elements.captureSection.classList.remove("hidden");
  } else {
    elements.authSection.classList.remove("hidden");
    elements.captureSection.classList.add("hidden");
  }
}

async function hydrateConfigInputs() {
  const config = await getExtensionConfig();
  elements.configUrl.value = config.supabaseUrl;
  elements.configAnon.value = config.supabaseAnonKey;
}

async function hydrateActiveTabUrl() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.url) {
    elements.jobUrl.value = activeTab.url;
  }
}

async function initializePopup() {
  clearStatus();
  await hydrateConfigInputs();
  await hydrateActiveTabUrl();

  const { client, config, error } = await initializeClientFromStorage();
  supabaseClient = client;

  if (error || !hasValidConfig(config)) {
    currentUser = null;
    elements.authSection.classList.add("hidden");
    elements.captureSection.classList.add("hidden");
    showStatus("Set Supabase URL + anon key first.", "error");
    return;
  }

  currentUser = await getCurrentUser(supabaseClient);
  toggleAuthAndCapture();
}

elements.saveConfig.addEventListener("click", async () => {
  clearStatus();
  const supabaseUrl = elements.configUrl.value.trim();
  const supabaseAnonKey = elements.configAnon.value.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    showStatus("Both Supabase URL and anon key are required.", "error");
    return;
  }

  setSavingState(true);
  try {
    await saveExtensionConfig({ supabaseUrl, supabaseAnonKey });
    await initializePopup();
    showStatus("Config saved.");
  } catch (error) {
    showStatus(String(error?.message ?? "Could not save config."), "error");
  } finally {
    setSavingState(false);
  }
});

elements.signIn.addEventListener("click", async () => {
  clearStatus();
  if (!supabaseClient) {
    showStatus("Save Supabase config first.", "error");
    return;
  }

  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  if (!email || !password) {
    showStatus("Email and password are required.", "error");
    return;
  }

  setSavingState(true);
  try {
    currentUser = await signInWithPassword(supabaseClient, email, password);
    toggleAuthAndCapture();
    showStatus("Signed in.");
  } catch (error) {
    showStatus(String(error?.message ?? "Sign-in failed."), "error");
  } finally {
    setSavingState(false);
  }
});

elements.signOut.addEventListener("click", async () => {
  clearStatus();
  if (!supabaseClient) return;
  await signOutClient(supabaseClient);
  currentUser = null;
  toggleAuthAndCapture();
  showStatus("Signed out.");
});

elements.autofill.addEventListener("click", async () => {
  clearStatus();
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) {
      showStatus("No active tab found.", "error");
      return;
    }

    const response = await chrome.tabs.sendMessage(activeTab.id, { action: "captureJobPage" });
    if (!response) {
      showStatus("Could not extract job details from this page.", "error");
      return;
    }

    elements.company.value = String(response.company_hint ?? "").trim();
    elements.jobTitle.value = String(response.role_title ?? "").trim();
    elements.jobUrl.value = String(response.jd_url ?? activeTab.url ?? "").trim();
    capturedDescription = String(response.jd_text ?? "").slice(0, MAX_CAPTURED_DESCRIPTION_CHARS);

    if (Array.isArray(response.warnings) && response.warnings.length > 0) {
      showStatus(String(response.warnings[0]), "error");
    } else {
      showStatus("Page details extracted.");
    }
  } catch (error) {
    showStatus(String(error?.message ?? "Autofill failed."), "error");
  }
});

elements.saveApplication.addEventListener("click", async () => {
  clearStatus();
  if (!supabaseClient) {
    showStatus("Save Supabase config first.", "error");
    return;
  }

  const user = currentUser ?? (await getCurrentUser(supabaseClient));
  if (!user) {
    currentUser = null;
    toggleAuthAndCapture();
    showStatus("Please sign in again.", "error");
    return;
  }

  const company = elements.company.value.trim();
  const jobTitle = elements.jobTitle.value.trim();
  const status = elements.status.value;
  const jobUrl = elements.jobUrl.value.trim();
  const manualNotes = elements.notes.value.trim();

  if (!company || !jobTitle) {
    showStatus("Company and job title are required.", "error");
    return;
  }

  const payload = {
    user_id: user.id,
    company,
    job_title: jobTitle,
    status,
    job_url: jobUrl,
    source: "extension",
    applied_at: new Date().toISOString(),
    notes: manualNotes || null,
    ats_job_description: capturedDescription || null,
    request_id: crypto.randomUUID(),
  };

  setSavingState(true);
  try {
    const { error } = await supabaseClient.from("applications").insert(payload);
    if (error) throw error;

    elements.notes.value = "";
    elements.jobTitle.value = "";
    elements.company.value = "";
    capturedDescription = "";
    const jdLength = payload.ats_job_description?.length ?? 0;
    const message =
      jdLength > 200
        ? `Saved with ${Math.round(jdLength / 1000)}K description captured.`
        : jdLength > 0
          ? `Saved (short description: ${jdLength} chars).`
          : "Saved (no description captured).";
    showStatus(message);
  } catch (error) {
    showStatus(String(error?.message ?? "Save failed."), "error");
  } finally {
    setSavingState(false);
  }
});

document.addEventListener("keydown", handleKeyboardShortcuts);

elements.toggleConfig?.addEventListener("click", () => {
  if (!elements.configSection) return;
  const current = elements.configSection.style.display;
  elements.configSection.style.display = current === "none" ? "" : "none";
});

void initializePopup();
