import {
  AUTOFILL_FIELD_KEYS,
  buildAutofillValues,
  detectApplicationFieldCount,
  findAutofillField,
  findResumeFileInput,
  inferAutofillProvider,
} from "@/lib/applicationAutofill";

const HIGHLIGHT_STYLE = "box-shadow: 0 0 0 2px rgb(59 130 246 / 55%)";

function setNativeValue(element, value) {
  const prototype =
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value);
  else element.value = value;

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function detectApplicationFields(root = document) {
  return detectApplicationFieldCount(root);
}

function showFillBanner(message) {
  const existing = document.getElementById("swejobs-fill-banner-host");
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = "swejobs-fill-banner-host";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .banner {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        max-width: 320px;
        padding: 12px 14px;
        border-radius: 10px;
        background: #0f172a;
        color: #e2e8f0;
        font: 12px/1.4 Inter, system-ui, sans-serif;
        box-shadow: 0 12px 30px rgb(15 23 42 / 45%);
      }
      strong { color: #fff; display: block; margin-bottom: 4px; }
    </style>
    <div class="banner">
      <strong>Filled by SweJobs</strong>
      <span>${message}</span>
    </div>
  `;

  setTimeout(() => host.remove(), 8000);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attachResumeFile(fileInput, resumeDownload, { maxAttempts = 3 } = {}) {
  if (!(fileInput instanceof HTMLInputElement) || fileInput.type !== "file" || !resumeDownload?.signedUrl) {
    return { attached: false, error: "No resume file input or signed download URL." };
  }

  let lastError = "Could not download resume.";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(resumeDownload.signedUrl);
      if (!response.ok) {
        throw new Error(`Resume download failed (${response.status}).`);
      }
      const blob = await response.blob();
      const file = new File([blob], resumeDownload.fileName || "resume.pdf", {
        type: resumeDownload.mimeType || "application/pdf",
      });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      fileInput.style.cssText += HIGHLIGHT_STYLE;
      return { attached: true, error: null };
    } catch (error) {
      lastError = String(error?.message ?? "Could not attach resume.");
      if (attempt < maxAttempts) {
        await sleep(400 * attempt);
      }
    }
  }

  fileInput.style.cssText += HIGHLIGHT_STYLE;
  fileInput.title = "Attach your SweJobs resume PDF here.";
  return { attached: false, error: lastError };
}

export async function fillApplicationForm(payload) {
  const provider = inferAutofillProvider(typeof location !== "undefined" ? location.hostname : "");
  const values = buildAutofillValues(payload?.profile ?? null, payload?.coverLetterText ?? "");
  const filled = [];
  const skipped = [];
  const fieldsDetected = detectApplicationFieldCount(document);

  for (const key of AUTOFILL_FIELD_KEYS) {
    const value = values[key];
    if (!value) {
      skipped.push(key);
      continue;
    }

    const field = findAutofillField(document, key, provider);
    if (!field) {
      skipped.push(key);
      continue;
    }

    if (field.value && String(field.value).trim()) {
      skipped.push(key);
      continue;
    }

    setNativeValue(field, value);
    field.style.cssText += HIGHLIGHT_STYLE;
    filled.push(key);
  }

  const resumeInput = findResumeFileInput(document, provider);
  let resumeAttached = false;
  let resumeError = null;

  if (resumeInput && payload?.resumeDownload) {
    const resumeResult = await attachResumeFile(resumeInput, payload.resumeDownload);
    resumeAttached = resumeResult.attached;
    resumeError = resumeResult.error;
  } else if (payload?.resumeDownload) {
    resumeError = "No resume upload field found on this page.";
  }

  const summaryParts = [];
  if (filled.length > 0) {
    summaryParts.push(`Filled ${filled.length}/${fieldsDetected || filled.length} field${filled.length === 1 ? "" : "s"}.`);
  } else {
    summaryParts.push("No empty fields matched.");
  }
  if (resumeAttached) {
    summaryParts.push("Resume attached.");
  } else if (payload?.resumeDownload) {
    summaryParts.push(resumeError || "Resume needs manual attach.");
  }
  summaryParts.push("Review before submitting.");
  const summary = summaryParts.join(" ");

  showFillBanner(summary);

  return {
    ok: true,
    filled,
    skipped,
    resumeAttached,
    resumeError,
    message: summary,
    fields_detected: fieldsDetected,
    fields_filled: filled.length,
    provider,
    page_host: typeof location !== "undefined" ? location.hostname : "",
    field_details: {
      filled,
      skipped,
      provider,
      page_host: typeof location !== "undefined" ? location.hostname : "",
    },
  };
}
