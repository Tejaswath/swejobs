import {
  AUTOFILL_FIELD_KEYS,
  buildAutofillValues,
  buildFieldHaystack,
  countApplicationLikeFields,
  matchAutofillKey,
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

function collectFieldHaystacks(root = document) {
  const fields = root.querySelectorAll("input, textarea, select");
  const haystacks = [];

  for (const field of fields) {
    if (field instanceof HTMLInputElement && ["hidden", "submit", "button", "checkbox", "radio"].includes(field.type)) {
      continue;
    }

    haystacks.push(
      buildFieldHaystack([
        field.name,
        field.id,
        field.getAttribute("aria-label"),
        field.placeholder,
        field.autocomplete,
        field.labels?.[0]?.textContent,
      ]),
    );
  }

  return haystacks;
}

export function detectApplicationFields(root = document) {
  return countApplicationLikeFields(collectFieldHaystacks(root));
}

function findFieldForKey(root, key) {
  const selectors = {
    first_name: ["#first_name", "#firstName", "input[name*='first_name']", "input[name*='firstName']"],
    last_name: ["#last_name", "#lastName", "input[name*='last_name']", "input[name*='lastName']"],
    email: ["#email", "input[type='email']", "input[name*='email']"],
    phone: ["#phone", "input[type='tel']", "input[name*='phone']"],
    linkedin_url: ["input[name*='linkedin']", "input[id*='linkedin']"],
    portfolio_url: ["input[name*='portfolio']", "input[name*='website']", "input[id*='portfolio']"],
    cover_letter: ["textarea[name*='cover']", "textarea[id*='cover']", "textarea[name*='letter']"],
  };

  for (const selector of selectors[key] ?? []) {
    const element = root.querySelector(selector);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element;
    }
  }

  const fields = root.querySelectorAll("input, textarea");
  for (const field of fields) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) continue;
    if (field instanceof HTMLInputElement && ["hidden", "submit", "button"].includes(field.type)) continue;

    const haystack = buildFieldHaystack([
      field.name,
      field.id,
      field.getAttribute("aria-label"),
      field.placeholder,
      field.autocomplete,
      field.labels?.[0]?.textContent,
    ]);

    if (matchAutofillKey(haystack) === key) return field;
  }

  return null;
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

async function attachResumeFile(fileInput, resumeDownload) {
  if (!(fileInput instanceof HTMLInputElement) || fileInput.type !== "file" || !resumeDownload?.signedUrl) {
    return false;
  }

  try {
    const response = await fetch(resumeDownload.signedUrl);
    if (!response.ok) throw new Error("Could not download resume.");
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
    return true;
  } catch {
    fileInput.style.cssText += HIGHLIGHT_STYLE;
    fileInput.title = "Attach your SweJobs resume PDF here.";
    return false;
  }
}

export async function fillApplicationForm(payload) {
  const values = buildAutofillValues(payload?.profile ?? null, payload?.coverLetterText ?? "");
  const filled = [];
  const skipped = [];

  for (const key of AUTOFILL_FIELD_KEYS) {
    const value = values[key];
    if (!value) {
      skipped.push(key);
      continue;
    }

    const field = findFieldForKey(document, key);
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

  const resumeInput =
    document.querySelector("input[type='file'][name*='resume']") ??
    document.querySelector("input[type='file'][id*='resume']") ??
    document.querySelector("input[type='file'][name*='cv']");

  let resumeAttached = false;
  if (resumeInput instanceof HTMLInputElement && payload?.resumeDownload) {
    resumeAttached = await attachResumeFile(resumeInput, payload.resumeDownload);
  }

  const summary = [
    filled.length > 0 ? `Filled ${filled.length} field${filled.length === 1 ? "" : "s"}.` : "No empty fields matched.",
    resumeAttached ? "Resume attached." : payload?.resumeDownload ? "Resume needs manual attach." : "",
    "Review before submitting.",
  ]
    .filter(Boolean)
    .join(" ");

  showFillBanner(summary);

  return {
    ok: true,
    filled,
    skipped,
    resumeAttached,
    message: summary,
  };
}
