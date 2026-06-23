import { MAX_CAPTURED_DESCRIPTION_CHARS } from "./constants";
import { canonicalizeJobUrl } from "@/lib/jobUrlMatching";
import { inferBrandFromHostname } from "@/lib/extensionCapture";
import { DEFAULT_COVER_LETTER_TEMPLATE, renderCoverLetter } from "@/lib/coverLetter";
import {
  getApplicationByUrl,
  getCurrentUser,
  getDefaultResumeDownload,
  getExtensionConfig,
  getUserProfile,
  hasValidConfig,
  initializeClientFromStorage,
  signInWithGoogle,
  signInWithPassword,
  signOutClient,
  updateApplication,
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
  fillApplication: document.getElementById("fill-application"),
  saveApplication: document.getElementById("save-application"),
  savedStateBanner: document.getElementById("saved-state-banner"),
  profileHint: document.getElementById("profile-hint"),
  globalStatus: document.getElementById("global-status"),
};

let supabaseClient = null;
let currentUser = null;
let activeConfig = null;
let capturedDescription = "";
let capturedRecruiter = null;
let existingApplication = null;

const SAVE_LABEL_NEW = "Save application";
const SAVE_LABEL_UPDATE = "Update application";

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
  if (elements.fillApplication) elements.fillApplication.disabled = isSaving;
  elements.signInGoogle.disabled = isSaving;
  elements.signIn.disabled = isSaving;
}

function applyExistingApplicationState(application) {
  existingApplication = application;
  elements.saveApplication.textContent = application ? SAVE_LABEL_UPDATE : SAVE_LABEL_NEW;
  if (!elements.savedStateBanner) return;

  if (application) {
    elements.savedStateBanner.textContent = `Already saved (${application.status}) — Re-scan updates description and notes.`;
    elements.savedStateBanner.classList.remove("hidden");
  } else {
    elements.savedStateBanner.textContent = "";
    elements.savedStateBanner.classList.add("hidden");
  }
}

function canonicalJobUrl(rawUrl) {
  return canonicalizeJobUrl(String(rawUrl ?? "").trim()) ?? String(rawUrl ?? "").trim();
}

async function lookupExistingApplication(jobUrl) {
  if (!supabaseClient || !currentUser) {
    applyExistingApplicationState(null);
    return null;
  }

  const match = await getApplicationByUrl(supabaseClient, currentUser.id, jobUrl);
  applyExistingApplicationState(match);
  return match;
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

function inferCompanyFromUrl(url) {
  try {
    return inferBrandFromHostname(new URL(String(url ?? "")).hostname);
  } catch {
    return "";
  }
}

function isAutofillSupportedUrl(url) {
  try {
    const parsed = new URL(String(url ?? ""));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function requestContentMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const errorMessage = String(error?.message ?? "");
    const missingReceiver = /receiving end does not exist/i.test(errorMessage);
    if (!missingReceiver) throw error;

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["dist/content.js"],
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function requestCaptureJobPage(tabId) {
  return requestContentMessage(tabId, { action: "captureJobPage" });
}

async function refreshFillApplicationVisibility() {
  if (!elements.fillApplication) return;
  elements.fillApplication.classList.add("hidden");

  if (!currentUser) return;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id || !isAutofillSupportedUrl(activeTab.url)) return;

  try {
    const response = await requestContentMessage(activeTab.id, { action: "detectApplicationFields" });
    if (response?.detected) {
      elements.fillApplication.classList.remove("hidden");
    }
  } catch {
    elements.fillApplication.classList.add("hidden");
  }
}

function toggleAuthAndCapture() {
  if (currentUser) {
    elements.authSection.classList.add("hidden");
    elements.captureSection.classList.remove("hidden");
    elements.profileHint?.classList.remove("hidden");
  } else {
    elements.authSection.classList.remove("hidden");
    elements.captureSection.classList.add("hidden");
    elements.profileHint?.classList.add("hidden");
    applyExistingApplicationState(null);
  }
}

function captureFieldsAreEmpty() {
  return !elements.company.value.trim() && !elements.jobTitle.value.trim();
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

  if (currentUser) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.url && isAutofillSupportedUrl(activeTab.url) && captureFieldsAreEmpty()) {
      await runPageCapture({ announce: true });
    }
    await refreshFillApplicationVisibility();
  }
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
    await refreshFillApplicationVisibility();
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
    await refreshFillApplicationVisibility();
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
  await runPageCapture({ announce: true });
});

elements.fillApplication?.addEventListener("click", async () => {
  clearStatus();
  if (!supabaseClient || !currentUser) {
    showStatus("Please sign in again.", "error");
    return;
  }

  setSavingState(true);
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id || !isAutofillSupportedUrl(activeTab.url)) {
      showStatus("Open an employer application page first.", "error");
      return;
    }

    const profile = await getUserProfile(supabaseClient, currentUser.id);
    if (!profile?.first_name && !profile?.email && !profile?.about_me) {
      showStatus("Add your details in SweJobs Profile first.", "error");
      return;
    }

    const coverLetterText = renderCoverLetter(
      DEFAULT_COVER_LETTER_TEMPLATE,
      {
        company: elements.company.value.trim() || "your company",
        job_title: elements.jobTitle.value.trim() || "this role",
      },
      profile,
    );

    const resumeDownload = await getDefaultResumeDownload(supabaseClient, currentUser.id);
    const response = await requestContentMessage(activeTab.id, {
      action: "fillApplicationForm",
      payload: {
        profile,
        coverLetterText,
        resumeDownload,
      },
    });

    if (!response?.ok) {
      showStatus(String(response?.message ?? "Could not fill this form."), "error");
      return;
    }

    showStatus(String(response.message ?? "Application form filled. Review before submitting."));
  } catch (error) {
    showStatus(String(error?.message ?? "Form fill failed."), "error");
  } finally {
    setSavingState(false);
  }
});

async function runPageCapture({ announce = true } = {}) {
  if (announce) clearStatus();
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) {
      if (announce) showStatus("No active tab found.", "error");
      return false;
    }
    if (!isAutofillSupportedUrl(activeTab.url)) {
      if (announce) showStatus("Re-scan works only on regular http/https pages.", "error");
      return false;
    }

    const response = await requestCaptureJobPage(activeTab.id);
    if (!response) {
      if (announce) showStatus("Could not extract job details from this page.", "error");
      return false;
    }

    const resolvedUrl = String(response.jd_url ?? activeTab.url ?? "").trim();
    const canonicalUrl = canonicalJobUrl(resolvedUrl);
    const detectedCompany = String(response.company_hint ?? "").trim();
    const inferredCompany = detectedCompany || inferCompanyFromUrl(resolvedUrl);
    elements.company.value = inferredCompany;
    elements.jobTitle.value = String(response.role_title ?? "").trim();
    elements.jobUrl.value = canonicalUrl || resolvedUrl;
    capturedDescription = String(response.jd_text ?? "").slice(0, MAX_CAPTURED_DESCRIPTION_CHARS);
    capturedRecruiter = response.recruiter_hint ?? null;

    try {
      const duplicate = await lookupExistingApplication(canonicalUrl || resolvedUrl);
      if (duplicate && announce) {
        showStatus(`Already in your tracker (status: ${duplicate.status}).`, "success");
      }
    } catch (lookupError) {
      console.warn("Duplicate lookup failed:", lookupError);
      applyExistingApplicationState(null);
    }

    const companyField = elements.company;
    const titleField = elements.jobTitle;
    companyField.style.borderColor = "";
    titleField.style.borderColor = "";
    companyField.title = "";
    titleField.title = "";

    const hasCompany = Boolean(inferredCompany);
    const hasTitle = Boolean(response.role_title?.trim());

    if (!hasCompany && !hasTitle) {
      companyField.style.borderColor = "var(--error-border)";
      titleField.style.borderColor = "var(--error-border)";
      companyField.title = "Not detected — enter manually";
      titleField.title = "Not detected — enter manually";
    } else if (!hasCompany) {
      companyField.style.borderColor = "var(--error-border)";
      companyField.title = "Not detected — enter manually";
    } else if (!detectedCompany && inferredCompany) {
      companyField.title = "Inferred from website domain";
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

    if (announce) {
      if (Array.isArray(response.warnings) && response.warnings.length > 0) {
        showStatus(String(response.warnings[0]), "error");
      } else if (!existingApplication) {
        showStatus("Page details extracted.");
      }
    }

    return true;
  } catch (error) {
    const message = String(error?.message ?? "Re-scan failed.");
    const cannotInject =
      /cannot access contents of url/i.test(message) ||
      /extensions gallery cannot be scripted/i.test(message) ||
      /missing host permission/i.test(message);
    if (announce) {
      if (cannotInject) {
        showStatus("Re-scan is blocked on this page. Open the original job page and retry.", "error");
      } else {
        showStatus(message, "error");
      }
    }
    return false;
  }
}

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
  const jobUrl = canonicalJobUrl(elements.jobUrl.value.trim());
  const manualNotes = elements.notes.value.trim();

  if (!company || !jobTitle) {
    showStatus("Company and job title are required.", "error");
    return;
  }

  const payload = {
    company,
    job_title: jobTitle,
    status,
    job_url: jobUrl,
    notes: manualNotes || null,
    ats_job_description: capturedDescription || null,
  };

  setSavingState(true);
  try {
    if (existingApplication?.id) {
      await updateApplication(supabaseClient, existingApplication.id, payload);
    } else {
      const insertPayload = {
        ...payload,
        user_id: user.id,
        source: "extension",
        applied_at: new Date().toISOString(),
        request_id: crypto.randomUUID(),
      };
      const { error } = await supabaseClient.from("applications").insert(insertPayload);
      if (error) throw error;
    }

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
    applyExistingApplicationState(null);
    const jdLength = payload.ats_job_description?.length ?? 0;
    const actionLabel = existingApplication ? "Updated" : "Saved";
    const message =
      jdLength > 200
        ? `${actionLabel} with ${Math.round(jdLength / 1000)}K description captured.`
        : jdLength > 0
          ? `${actionLabel} (short description: ${jdLength} chars).`
          : `${actionLabel} (no description captured).`;
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
