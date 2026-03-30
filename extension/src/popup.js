import { MAX_CAPTURED_DESCRIPTION_CHARS } from "./constants";
import {
  getCurrentUser,
  getExtensionConfig,
  hasValidConfig,
  initializeClientFromStorage,
  signInWithGoogle,
  signInWithPassword,
  signOutClient,
} from "./supabaseClient";

const elements = {
  toggleConfig: document.getElementById("toggle-config"),
  configSection: document.getElementById("config-section"),
  configStatus: document.getElementById("config-status"),
  authSection: document.getElementById("auth-section"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  signInGoogle: document.getElementById("sign-in-google"),
  signIn: document.getElementById("sign-in"),
  captureSection: document.getElementById("capture-section"),
  signOut: document.getElementById("sign-out"),
  company: document.getElementById("company"),
  jobTitle: document.getElementById("job-title"),
  status: document.getElementById("status"),
  jobUrl: document.getElementById("job-url"),
  notes: document.getElementById("notes"),
  recruiterSection: document.getElementById("recruiter-section"),
  recruiterHeading: document.getElementById("recruiter-heading"),
  recruiterContext: document.getElementById("recruiter-context"),
  recruiterName: document.getElementById("recruiter-name"),
  recruiterEmail: document.getElementById("recruiter-email"),
  recruiterTitleDisplay: document.getElementById("recruiter-title-display"),
  recruiterLinkedin: document.getElementById("recruiter-linkedin"),
  saveRecruiterToggle: document.getElementById("save-recruiter-toggle"),
  recruiterStatus: document.getElementById("recruiter-status"),
  autofill: document.getElementById("autofill"),
  saveApplication: document.getElementById("save-application"),
  globalStatus: document.getElementById("global-status"),
};

let supabaseClient = null;
let currentUser = null;
let activeConfig = null;
let capturedDescription = "";
let capturedRecruiter = null;

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
  elements.signInGoogle.disabled = isSaving;
  elements.signIn.disabled = isSaving;
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

function toTitleCase(value) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function inferNameFromEmail(email) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail.includes("@")) return "";

  const localPart = normalizedEmail.split("@")[0]?.replace(/\+.*/, "") ?? "";
  if (!localPart) return "";

  const cleaned = localPart.replace(/[_-]+/g, ".");
  const pieces = cleaned
    .split(".")
    .map((piece) => piece.trim())
    .filter(Boolean);

  if (pieces.length === 0 || pieces.length > 4) return "";

  const blockedTokens = new Set([
    "admin",
    "careers",
    "contact",
    "hello",
    "hr",
    "info",
    "jobs",
    "noreply",
    "recruiter",
    "recruiting",
    "support",
    "talent",
    "team",
  ]);
  if (pieces.every((piece) => blockedTokens.has(piece))) return "";

  const candidate = toTitleCase(
    pieces
      .map((piece) => piece.replace(/[^a-zA-Z]/g, ""))
      .filter(Boolean)
      .join(" "),
  );
  if (!candidate || candidate.length < 3 || candidate.length > 80) return "";
  return candidate;
}

function inferCompanyFromEmailDomain(email) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail.includes("@")) return "";

  const domain = normalizedEmail.split("@")[1]?.trim() ?? "";
  if (!domain) return "";

  const providerDomains = new Set([
    "gmail.com",
    "googlemail.com",
    "hotmail.com",
    "icloud.com",
    "live.com",
    "msn.com",
    "outlook.com",
    "proton.me",
    "protonmail.com",
    "yahoo.com",
  ]);
  if (providerDomains.has(domain)) return "";

  const domainParts = domain.split(".").filter(Boolean);
  if (domainParts.length < 2) return "";

  let brandPart = domainParts[0];
  if (["mail", "m", "mx"].includes(brandPart) && domainParts.length > 2) {
    brandPart = domainParts[1];
  }

  const cleaned = brandPart.replace(/[^a-z0-9-]/g, " ").replace(/-/g, " ");
  const candidate = toTitleCase(cleaned);
  if (!candidate || candidate.length < 2 || candidate.length > 80) return "";
  return candidate;
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
  if (elements.configStatus) {
    elements.configStatus.textContent = config.supabaseUrl ? "Connected" : "Not configured";
  }
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
  activeConfig = config;

  if (error || !hasValidConfig(config)) {
    currentUser = null;
    elements.authSection.classList.add("hidden");
    elements.captureSection.classList.add("hidden");
    showStatus("Connection unavailable. Check extension defaults.", "error");
    return;
  }

  currentUser = await getCurrentUser(supabaseClient);
  toggleAuthAndCapture();
}

elements.signIn.addEventListener("click", async () => {
  clearStatus();
  if (!supabaseClient) {
    showStatus("Connection unavailable.", "error");
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

elements.signInGoogle.addEventListener("click", async () => {
  clearStatus();
  if (!supabaseClient || !activeConfig) {
    showStatus("Connection unavailable.", "error");
    return;
  }

  setSavingState(true);
  try {
    currentUser = await signInWithGoogle(supabaseClient, activeConfig);
    toggleAuthAndCapture();
    showStatus("Signed in with Google.");
  } catch (error) {
    showStatus(String(error?.message ?? "Google sign-in failed."), "error");
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
    capturedRecruiter = response.recruiter_hint ?? null;

    const companyField = elements.company;
    const titleField = elements.jobTitle;
    companyField.style.borderColor = "";
    titleField.style.borderColor = "";
    companyField.title = "";
    titleField.title = "";

    const hasCompany = Boolean(response.company_hint?.trim());
    const hasTitle = Boolean(response.role_title?.trim());

    if (!hasCompany && !hasTitle) {
      companyField.style.borderColor = "var(--error-border)";
      titleField.style.borderColor = "var(--error-border)";
      companyField.title = "Not detected — enter manually";
      titleField.title = "Not detected — enter manually";
    } else if (!hasCompany) {
      companyField.style.borderColor = "var(--error-border)";
      companyField.title = "Not detected — enter manually";
    } else if (!hasTitle) {
      titleField.style.borderColor = "var(--error-border)";
      titleField.title = "Not detected — enter manually";
    }

    if (capturedRecruiter && (capturedRecruiter.name || capturedRecruiter.email)) {
      const inferredName = capturedRecruiter.name || inferNameFromEmail(capturedRecruiter.email);
      const isEmailOnly = !capturedRecruiter.name && Boolean(capturedRecruiter.email);
      const isNameInferred = !capturedRecruiter.name && Boolean(inferredName);
      const companyFromDomain = inferCompanyFromEmailDomain(capturedRecruiter.email);

      elements.recruiterSection.classList.remove("hidden");
      elements.recruiterName.textContent = inferredName || "Not detected";
      elements.recruiterName.style.opacity = isNameInferred ? "0.7" : "1";
      elements.recruiterEmail.textContent = capturedRecruiter.email || "Not detected";
      elements.recruiterTitleDisplay.textContent = capturedRecruiter.title || "Not detected";
      elements.recruiterTitleDisplay.style.opacity = capturedRecruiter.title ? "1" : "0.5";
      elements.recruiterLinkedin.textContent = capturedRecruiter.linkedin_url || "Not detected";
      elements.recruiterLinkedin.style.opacity = capturedRecruiter.linkedin_url ? "1" : "0.5";

      const contextParts = [];
      if (isEmailOnly) {
        elements.recruiterHeading.textContent = "Contact detected";
        if (isNameInferred) contextParts.push("Name inferred from email");
        else contextParts.push("No name found on page");
      } else {
        elements.recruiterHeading.textContent = "Recruiter detected";
      }
      if (companyFromDomain) {
        contextParts.push(`Company inferred from domain: ${companyFromDomain}`);
      }
      if (!capturedRecruiter.title) contextParts.push("Title not found");

      if (contextParts.length > 0) {
        elements.recruiterContext.textContent = `${contextParts.join(" · ")} — verify before saving.`;
        elements.recruiterContext.classList.remove("hidden");
      } else {
        elements.recruiterContext.textContent = "";
        elements.recruiterContext.classList.add("hidden");
      }

      elements.recruiterStatus.classList.add("hidden");
      elements.recruiterStatus.textContent = "";
    } else {
      capturedRecruiter = null;
      elements.recruiterSection.classList.add("hidden");
      elements.recruiterContext.classList.add("hidden");
      elements.recruiterContext.textContent = "";
    }

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
    showStatus("Connection unavailable.", "error");
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

    const saveRecruiterEnabled = Boolean(elements.saveRecruiterToggle?.checked);
    if (saveRecruiterEnabled && capturedRecruiter && (capturedRecruiter.name || capturedRecruiter.email)) {
      const recruiterPayload = {
        user_id: user.id,
        name: capturedRecruiter.name || inferNameFromEmail(capturedRecruiter.email) || "Potential Contact",
        email: capturedRecruiter.email || null,
        company:
          company ||
          capturedRecruiter.company ||
          inferCompanyFromEmailDomain(capturedRecruiter.email) ||
          "",
        title: capturedRecruiter.title || "",
        linkedin_url: capturedRecruiter.linkedin_url || "",
        notes: `Captured from ${jobUrl || "extension"} on ${new Date().toLocaleDateString("sv-SE")}`,
      };
      const { error: recruiterError } = await supabaseClient.from("recruiters").insert(recruiterPayload);
      if (recruiterError) {
        const isDuplicate = recruiterError.code === "23505" || /duplicate|already exists/i.test(recruiterError.message ?? "");
        if (!isDuplicate) {
          // Keep application save successful even if recruiter save fails.
          console.warn("Recruiter save failed:", recruiterError.message);
        }
      }
    }

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
  elements.configSection.classList.toggle("hidden");
});

void initializePopup();
