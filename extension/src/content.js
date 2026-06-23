import { detectApplicationFields, fillApplicationForm } from "./autofill.js";
import {
  buildLinkedInJobViewUrl,
  extractLinkedInJob,
  filterAggregatorSiteName,
  inferBrandFromHostname,
  isLinkedInJobPage,
  isLinkedInNoiseTitle,
  parseLinkedInDocumentTitle,
  sanitizeRecruiterName,
  shouldShowCaptureFab,
} from "@/lib/extensionCapture";

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function textFromSelectorList(selectors) {
  let best = "";
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const candidate = cleanText(element.textContent ?? "");
    if (candidate.length > best.length) best = candidate;
  }
  return best;
}

function extractFromJsonLd() {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    try {
      const raw = String(script.textContent ?? "").trim();
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      for (let i = 0; i < queue.length; i += 1) {
        const candidate = queue[i];
        if (!candidate || typeof candidate !== "object") continue;
        if (Array.isArray(candidate["@graph"])) {
          queue.push(...candidate["@graph"]);
        }
        const type = String(candidate["@type"] ?? "").toLowerCase();
        if (type !== "jobposting") continue;
        return {
          title: String(candidate.title ?? "").trim(),
          company: String(candidate.hiringOrganization?.name ?? "").trim(),
          description: cleanText(String(candidate.description ?? "")),
        };
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return null;
}

function detectGreenhouseInfo() {
  const url = location.href;
  let match = url.match(/boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i);
  if (match) return { boardToken: match[1], jobId: match[2] };

  match = url.match(/([^/.]+)\.greenhouse\.io\/.*[?&]token=(\d+)/i);
  if (match) return { boardToken: match[1], jobId: match[2] };

  const frameSrc = document.querySelector('iframe[src*="greenhouse"]')?.getAttribute("src") ?? "";
  match = frameSrc.match(/boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i);
  if (match) return { boardToken: match[1], jobId: match[2] };
  return null;
}

async function fetchGreenhouseJD(boardToken, jobId) {
  try {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${jobId}`);
    if (!response.ok) return null;
    const data = await response.json();
    return {
      title: String(data.title ?? "").trim(),
      company: String(data.company?.name ?? boardToken).trim(),
      description: cleanText(data.content ?? ""),
    };
  } catch {
    return null;
  }
}

function detectLeverInfo() {
  const match = location.href.match(/jobs\.lever\.co\/([^/]+)\/([a-f0-9-]+)/i);
  if (!match) return null;
  return { company: match[1], postingId: match[2] };
}

async function fetchLeverJD(company, postingId) {
  try {
    const response = await fetch(`https://api.lever.co/v0/postings/${company}/${postingId}`);
    if (!response.ok) return null;
    const data = await response.json();
    const lists = Array.isArray(data.lists) ? data.lists : [];
    const description = lists
      .map((section) => `${section.text ?? ""}\n${cleanText(section.content ?? "")}`)
      .join("\n\n")
      .trim();
    return {
      title: String(data.text ?? "").trim(),
      company: String(data.categories?.team ?? company).trim(),
      description,
    };
  } catch {
    return null;
  }
}

function detectAshbyInfo() {
  const match = location.href.match(/jobs\.ashbyhq\.com\/([^/]+)\/([a-f0-9-]+)/i);
  if (!match) return null;
  return { orgSlug: match[1], jobId: match[2] };
}

function extractEightfoldData() {
  if (!location.href.includes("eightfold.ai")) return null;

  const titleEl =
    document.querySelector("[data-test='position-header'] h1") ??
    document.querySelector(".position-title") ??
    document.querySelector(".position-header h1") ??
    document.querySelector("h1.job-title");

  const applyTitleEl =
    document.querySelector(".position-apply-header h2") ??
    document.querySelector(".position-apply-header h1") ??
    document.querySelector("[class*='PositionApply'] h2") ??
    document.querySelector("[class*='position-name']");

  const companyEl =
    document.querySelector("[class*='company-name']") ??
    document.querySelector(".employer-name") ??
    document.querySelector("[data-test='employer-name']");

  const descriptionEl =
    document.querySelector("[data-test='job-description']") ??
    document.querySelector(".position-job-description") ??
    document.querySelector("[class*='JobDescription']") ??
    document.querySelector("[class*='job-description']");

  const title = cleanText(titleEl?.textContent ?? applyTitleEl?.textContent ?? "");
  const company = cleanText(companyEl?.textContent ?? inferCompanyFromMeta() ?? "");
  const description = cleanText(descriptionEl?.textContent ?? "");

  if (!title && !description) return null;
  return { title, company, description };
}

function extractWorkdayDescription() {
  if (!location.href.includes("myworkdayjobs.com")) return null;
  return cleanText(
    document.querySelector("[data-automation-id='jobPostingDescription']")?.textContent ??
      document.querySelector("[data-automation-id='jobDescriptionText']")?.textContent ??
      "",
  );
}

function extractTeamtailorDescription() {
  if (!location.href.includes("teamtailor.com")) return null;
  return cleanText(
    document.querySelector("[data-controller='job-ad']")?.textContent ??
      document.querySelector(".job-ad-body")?.textContent ??
      document.querySelector("article")?.textContent ??
      "",
  );
}

function extractLinkedInDescription() {
  if (!location.href.includes("linkedin.com/jobs")) return null;
  return cleanText(
    document.querySelector(".show-more-less-html__markup")?.textContent ??
      document.querySelector(".description__text")?.textContent ??
      "",
  );
}

function inferTitleFromDocumentTitle() {
  const docTitle = String(document.title ?? "").trim();
  if (!docTitle) return "";
  const separators = [" | ", " - ", " — ", " · "];
  for (const separator of separators) {
    if (!docTitle.includes(separator)) continue;
    const [first] = docTitle.split(separator);
    if (first?.trim()) return first.trim();
  }
  return docTitle;
}

function inferCompanyFromMeta() {
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName?.getAttribute("content")) {
    return filterAggregatorSiteName(String(ogSiteName.getAttribute("content")));
  }
  return "";
}

function inferCompanyFromHostname() {
  try {
    return inferBrandFromHostname(new URL(location.href).hostname);
  } catch {
    return "";
  }
}

function inferTitleForPage() {
  if (isLinkedInJobPage(location.href)) {
    const parsed = parseLinkedInDocumentTitle(document.title);
    if (parsed.title) return parsed.title;
    return inferTitleFromDocumentTitle();
  }

  return cleanText(
    document.querySelector("h1")?.textContent ??
      document.querySelector("h2")?.textContent ??
      inferTitleFromDocumentTitle(),
  );
}

async function captureJobPage() {
  const warnings = [];
  const structured = extractFromJsonLd();
  const eightfoldData = extractEightfoldData();
  const workdayDescription = extractWorkdayDescription();
  const teamtailorDescription = extractTeamtailorDescription();
  const linkedInDescription = extractLinkedInDescription();
  const linkedInJob = extractLinkedInJob(document, location.href, document.title);
  let atsResult = null;

  const greenhouseInfo = detectGreenhouseInfo();
  if (greenhouseInfo) {
    atsResult = await fetchGreenhouseJD(greenhouseInfo.boardToken, greenhouseInfo.jobId);
    if (atsResult) warnings.push("Extracted via Greenhouse API.");
  }

  if (!atsResult) {
    const leverInfo = detectLeverInfo();
    if (leverInfo) {
      atsResult = await fetchLeverJD(leverInfo.company, leverInfo.postingId);
      if (atsResult) warnings.push("Extracted via Lever API.");
    }
  }

  if (!atsResult) {
    const ashbyInfo = detectAshbyInfo();
    if (ashbyInfo) {
      const ashbyTitle = cleanText(
        document.querySelector("h1.ashby-job-posting-brief-title, h1")?.textContent ?? "",
      );
      const ashbyDescription = cleanText(
        document.querySelector("[class*='ashby-job-posting-description'], .posting-page")?.textContent ?? "",
      );
      if (ashbyTitle && ashbyDescription) {
        atsResult = {
          title: ashbyTitle,
          company: inferCompanyFromMeta() || ashbyInfo.orgSlug,
          description: ashbyDescription,
        };
        warnings.push("Extracted via Ashby selectors.");
      }
    }
  }

  let roleTitle =
    atsResult?.title ||
    eightfoldData?.title ||
    linkedInJob?.title ||
    structured?.title ||
    inferTitleForPage();

  if (isLinkedInNoiseTitle(roleTitle)) {
    roleTitle = linkedInJob?.title || structured?.title || "";
  }

  const companyHint =
    atsResult?.company ||
    eightfoldData?.company ||
    linkedInJob?.company ||
    structured?.company ||
    inferCompanyFromMeta() ||
    cleanText(
      document.querySelector("[data-company]")?.textContent ??
        document.querySelector(".company, .company-name, [data-automation-id='jobPostingCompanyName']")?.textContent ??
        "",
    ) ||
    inferCompanyFromHostname();

  const captureUrl = linkedInJob?.jobId
    ? buildLinkedInJobViewUrl(linkedInJob.jobId)
    : location.href;

  let jdText = "";
  if (atsResult?.description && atsResult.description.length > 180) {
    jdText = cleanText(atsResult.description);
  } else if (eightfoldData?.description && eightfoldData.description.length > 180) {
    jdText = eightfoldData.description;
    warnings.push("Extracted via Eightfold selectors.");
  } else if (structured?.description && structured.description.length > 180) {
    jdText = cleanText(structured.description);
  } else if (workdayDescription && workdayDescription.length > 180) {
    jdText = workdayDescription;
    warnings.push("Extracted via Workday selectors.");
  } else if (teamtailorDescription && teamtailorDescription.length > 180) {
    jdText = teamtailorDescription;
    warnings.push("Extracted via Teamtailor selectors.");
  } else if (linkedInDescription && linkedInDescription.length > 180) {
    jdText = linkedInDescription;
    warnings.push("Extracted via LinkedIn selectors.");
  }

  if (jdText.length < 200) {
    const descriptionFallback = textFromSelectorList([
      "[data-automation-id='jobPostingDescription']",
      "[data-automation='jobDescription']",
      ".job-description",
      ".posting-page",
      ".show-more-less-html__markup",
      ".description__text",
      "[data-controller='job-ad']",
      ".job-ad-body",
      "article",
      "main",
      "[role='main']",
    ]);
    if (descriptionFallback.length > jdText.length) {
      jdText = descriptionFallback;
    }
  }

  const endMarkers = [
    "apply for this job",
    "apply now",
    "submit application",
    "ansök nu",
    "skicka ansökan",
    "ansök här",
    "similar jobs",
  ];
  const lower = jdText.toLowerCase();
  for (const marker of endMarkers) {
    const index = lower.indexOf(marker);
    if (index > 300) {
      jdText = jdText.slice(0, index).trim();
      break;
    }
  }

  if (location.href.includes("/apply") || location.href.includes("/application")) {
    warnings.push("This looks like an apply page. Capture from the job listing page for better results.");
  }

  if (jdText.length < 120) {
    warnings.push("Short description extracted; verify before saving.");
  }

  return {
    jd_text: jdText.slice(0, 10_000),
    jd_url: captureUrl,
    page_title: document.title,
    role_title: roleTitle,
    company_hint: companyHint,
    warnings,
  };
}

function extractRecruiterFromLinkedIn() {
  if (!location.href.includes("linkedin.com")) return null;

  const hiringTeamSection =
    document.querySelector("[class*='hiring-team']") ??
    document.querySelector("[class*='hirer-card']") ??
    document.querySelector("[data-test-id='hirer-card']");

  if (hiringTeamSection) {
    const nameEl = hiringTeamSection.querySelector("h3, [class*='name'], a[class*='app-aware-link']");
    const titleEl = hiringTeamSection.querySelector("[class*='headline'], [class*='title'], p");
    const profileLink = hiringTeamSection.querySelector("a[href*='linkedin.com/in/']");
    const name = cleanText(nameEl?.textContent ?? "");
    const title = cleanText(titleEl?.textContent ?? "");
    if (name && name.length > 2 && name.length < 80) {
      return {
        name,
        title: title || "",
        company: "",
        email: "",
        linkedin_url: profileLink?.href ?? "",
      };
    }
  }

  if (location.href.includes("linkedin.com/in/")) {
    const profileName = cleanText(
      document.querySelector("h1.text-heading-xlarge")?.textContent ??
        document.querySelector("h1[class*='inline']")?.textContent ??
        "",
    );
    const profileTitle = cleanText(
      document.querySelector("[data-field='headline']")?.textContent ??
        document.querySelector(".text-body-medium")?.textContent ??
        "",
    );
    if (profileName && profileName.length > 2) {
      return {
        name: profileName,
        title: profileTitle || "",
        company: "",
        email: "",
        linkedin_url: location.href.split("?")[0],
      };
    }
  }

  return null;
}

function extractRecruiterFromJobPage() {
  const pageText = document.body?.innerText ?? "";
  const emailMatch = pageText.match(
    /(?:kontakta|contact|frågor|questions|recruiter|rekryterare)[\s\S]{0,220}?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
  );
  const contactMatch = pageText.match(
    /(?:kontakta|contact person|recruiter|rekryterare|hiring manager)[:\s]*([A-ZÅÄÖ][a-zåäö]+(?:\s[A-ZÅÄÖ][a-zåäö]+){1,3})/i,
  );
  if (!emailMatch && !contactMatch) return null;
  const rawName = contactMatch?.[1]?.trim() ?? "";
  const name = sanitizeRecruiterName(rawName);
  if (!name && !emailMatch) return null;
  return {
    name,
    title: "",
    company: "",
    email: emailMatch?.[1]?.trim() ?? "",
    linkedin_url: "",
  };
}

function extractRecruiterInfo() {
  const linkedInRecruiter = extractRecruiterFromLinkedIn();
  if (linkedInRecruiter) return linkedInRecruiter;
  const pageRecruiter = extractRecruiterFromJobPage();
  if (pageRecruiter && (pageRecruiter.name || pageRecruiter.email)) return pageRecruiter;
  return null;
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.action === "captureRecruiterInfo") {
    sendResponse(extractRecruiterInfo());
    return false;
  }

  if (request?.action === "detectApplicationFields") {
    sendResponse({
      count: detectApplicationFields(document),
      detected: detectApplicationFields(document) >= 2,
    });
    return false;
  }

  if (request?.action === "fillApplicationForm") {
    fillApplicationForm(request.payload ?? {})
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          message: String(error?.message ?? "Form fill failed."),
          filled: [],
          skipped: [],
          resumeAttached: false,
        }),
      );
    return true;
  }

  if (request?.action !== "captureJobPage") return undefined;

  (async () => {
    let result = await captureJobPage();

    const weakTitle = result.role_title.trim().length < 5;
    const weakDescription = result.jd_text.trim().length < 200;
    if (weakTitle && weakDescription) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const retry = await captureJobPage();
      if (
        retry.jd_text.length > result.jd_text.length ||
        retry.role_title.length > result.role_title.length
      ) {
        result = retry;
        result.warnings = [...(result.warnings ?? []), "Extracted on retry (SPA detected)."];
      }
    }

    result.recruiter_hint = extractRecruiterInfo();
    sendResponse(result);
  })().catch((error) =>
    sendResponse({
      jd_text: "",
      jd_url: location.href,
      page_title: document.title,
      role_title: "",
      company_hint: "",
      warnings: [String(error?.message ?? "Capture failed")],
      recruiter_hint: null,
    }),
  );

  return true;
});

function countApplicationLikeFields() {
  const fields = document.querySelectorAll("input, textarea, select");
  let score = 0;
  for (const field of fields) {
    const haystack = [
      field.name,
      field.id,
      field.getAttribute("aria-label"),
      field.placeholder,
      field.autocomplete,
    ]
      .join(" ")
      .toLowerCase();
    if (/email|phone|resume|cv|cover|linkedin|portfolio|first.?name|last.?name/.test(haystack)) {
      score += 1;
    }
  }
  return score;
}

function shouldMountCaptureFab() {
  if (shouldShowCaptureFab(location.href)) return true;
  return countApplicationLikeFields() >= 2;
}

function installCaptureFab() {
  if (window.__swejobsCaptureFab) return;

  const host = document.createElement("div");
  host.id = "swejobs-capture-fab-host";
  host.style.all = "initial";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .fab-wrap {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483646;
        font-family: Inter, system-ui, -apple-system, sans-serif;
      }
      .fab {
        width: 46px;
        height: 46px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, #3b82f6, #6366f1);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        cursor: pointer;
        box-shadow: 0 8px 24px rgb(59 130 246 / 35%);
      }
      .fab:hover { transform: translateY(-1px); }
      .toast {
        display: none;
        margin-bottom: 8px;
        max-width: 240px;
        padding: 10px 12px;
        border-radius: 10px;
        background: #0f172a;
        color: #e2e8f0;
        font-size: 12px;
        line-height: 1.4;
        box-shadow: 0 10px 30px rgb(15 23 42 / 45%);
      }
      .toast.visible { display: block; }
      .toast strong { color: #fff; display: block; margin-bottom: 2px; }
    </style>
    <div class="fab-wrap">
      <div class="toast" id="toast"></div>
      <button class="fab" type="button" aria-label="Capture role with SweJobs">SJ</button>
    </div>
  `;

  const toast = shadow.querySelector("#toast");
  const button = shadow.querySelector(".fab");
  let toastTimer = null;

  function setFabVisible(visible) {
    host.style.display = visible ? "block" : "none";
  }

  async function showCaptureToast(result) {
    const company = String(result?.company_hint ?? "").trim() || "Role";
    const title = String(result?.role_title ?? "").trim() || "Captured";
    toast.innerHTML = `<strong>${company}</strong>${title}<br>Open SweJobs to save.`;
    toast.classList.add("visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 5000);
  }

  button?.addEventListener("click", async () => {
    try {
      const result = await captureJobPage();
      await chrome.storage.local.set({ swejobs_last_fab_capture: result });
      await showCaptureToast(result);
    } catch (error) {
      toast.textContent = String(error?.message ?? "Capture failed.");
      toast.classList.add("visible");
    }
  });

  function refreshFab() {
    setFabVisible(shouldMountCaptureFab());
  }

  refreshFab();
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      refreshFab();
    }
  }, 1000);

  window.__swejobsCaptureFab = { refreshFab, setFabVisible };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installCaptureFab, { once: true });
} else {
  installCaptureFab();
}
