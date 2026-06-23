const AGGREGATOR_SITE_NAMES = new Set([
  "linkedin",
  "indeed",
  "glassdoor",
  "monster",
  "ziprecruiter",
  "the local jobs",
  "eures",
  "arbetsförmedlingen",
  "platsbanken",
  "jobbank",
]);

const AGGREGATOR_HOSTNAME_LABELS = new Set([
  "linkedin",
  "indeed",
  "glassdoor",
  "monster",
  "ziprecruiter",
  "jobbank",
  "arbetsformedlingen",
  "arbetsförmedlingen",
]);

const RECRUITER_NAME_STOPWORDS = new Set([
  "than",
  "those",
  "who",
  "don",
  "the",
  "you",
  "your",
  "our",
  "this",
  "that",
  "here",
  "apply",
  "contact",
  "more",
  "and",
  "for",
  "with",
]);

const LINKEDIN_DETAIL_ROOT_SELECTORS = [
  ".jobs-search__job-details--container",
  ".jobs-details",
  ".job-view-layout",
  ".scaffold-layout__detail",
  "[class*='jobs-details__main-content']",
  ".jobs-search__right-rail",
];

const LINKEDIN_COMPANY_SELECTORS = [
  ".job-details-jobs-unified-top-card__company-name a",
  ".job-details-jobs-unified-top-card__company-name",
  ".jobs-unified-top-card__company-name",
  ".topcard__org-name-link",
  "a[data-tracking-control-name='public_jobs_topcard-org-name']",
  ".job-details-jobs-unified-top-card__primary-description-container a",
];

const LINKEDIN_TITLE_SELECTORS = [
  ".job-details-jobs-unified-top-card__job-title",
  ".topcard__title",
  "h1.t-24",
  "h1.job-details-jobs-unified-top-card__job-title",
  ".jobs-unified-top-card__job-title",
];

const LINKEDIN_LIST_TITLE_SELECTORS = [
  ".job-card-list__title",
  ".job-card-container__link",
  "a[data-tracking-control-name='public_jobs_jserp-result_job-title']",
  "strong",
];

const LINKEDIN_LIST_COMPANY_SELECTORS = [
  ".job-card-container__company-name",
  ".job-card-container__primary-description",
  "a[data-tracking-control-name='public_jobs_jserp-result_job-search-card-subtitle']",
  ".artdeco-entity-lockup__subtitle",
];

function cleanText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function textFromSelectors(root: ParentNode, selectors: string[]): string {
  if (!("querySelector" in root)) return "";
  let best = "";
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (!element) continue;
    const candidate = cleanText(element.textContent);
    if (candidate.length > best.length) best = candidate;
  }
  return best;
}

function findLinkedInDetailRoot(root: ParentNode): ParentNode | null {
  if (!("querySelector" in root)) return null;
  for (const selector of LINKEDIN_DETAIL_ROOT_SELECTORS) {
    const element = root.querySelector(selector);
    if (element) return element;
  }
  return null;
}

function findLinkedInListItem(root: ParentNode, jobId: string | null): Element | null {
  if (!("querySelector" in root) || !jobId) return null;

  const byId =
    root.querySelector(`[data-occludable-job-id="${jobId}"]`) ??
    root.querySelector(`[data-job-id="${jobId}"]`);
  if (byId) return byId;

  return root.querySelector(".jobs-search-results__list-item--active");
}

export function isAggregatorSiteName(siteName: string | null | undefined): boolean {
  const normalized = cleanText(siteName).toLowerCase();
  if (!normalized) return false;
  return AGGREGATOR_SITE_NAMES.has(normalized);
}

export function filterAggregatorSiteName(siteName: string | null | undefined): string {
  return isAggregatorSiteName(siteName) ? "" : cleanText(siteName);
}

export function isAggregatorHostname(hostname: string | null | undefined): boolean {
  const labels = String(hostname ?? "")
    .toLowerCase()
    .split(".")
    .filter(Boolean);
  return labels.some((label) => AGGREGATOR_HOSTNAME_LABELS.has(label));
}

export function inferBrandFromHostname(hostname: string | null | undefined): string {
  if (isAggregatorHostname(hostname)) return "";

  const labels = String(hostname ?? "")
    .toLowerCase()
    .split(".")
    .filter(Boolean);
  if (labels.length === 0) return "";

  const stopWords = new Set([
    "www",
    "jobs",
    "job",
    "careers",
    "career",
    "boards",
    "apply",
    "workdayjobs",
  ]);

  let brand = labels[0] ?? "";
  for (const label of labels) {
    if (!stopWords.has(label) && label.length > 2) {
      brand = label;
      break;
    }
  }

  const cleaned = brand.replace(/[^a-z0-9-]/g, " ").replace(/-/g, " ").trim();
  if (!cleaned || isAggregatorSiteName(cleaned)) return "";

  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function isLinkedInNoiseTitle(title: string | null | undefined): boolean {
  const normalized = cleanText(title).toLowerCase();
  if (!normalized) return true;
  if (normalized === "linkedin" || normalized === "home") return true;
  if (/^\d+\s+notifications?$/.test(normalized)) return true;
  if (normalized.includes("notification")) return true;
  if (normalized.length < 3) return true;
  return false;
}

export function parseLinkedInDocumentTitle(
  docTitle: string | null | undefined,
): { title: string; company: string } {
  const cleaned = cleanText(docTitle).replace(/^\(\d+\)\s*/, "");
  if (!cleaned) return { title: "", company: "" };

  const parts = cleaned
    .split(/\s*[|·]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return { title: "", company: "" };

  const last = parts[parts.length - 1]?.toLowerCase() ?? "";
  if (!last.includes("linkedin")) return { title: "", company: "" };

  if (parts.length >= 3) {
    return {
      title: isLinkedInNoiseTitle(parts[0]) ? "" : parts[0],
      company: filterAggregatorSiteName(parts[1]),
    };
  }

  return {
    title: isLinkedInNoiseTitle(parts[0]) ? "" : parts[0],
    company: "",
  };
}

export function getLinkedInJobIdFromUrl(href: string | null | undefined): string | null {
  const raw = String(href ?? "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const fromParam = url.searchParams.get("currentJobId");
    if (fromParam) return fromParam;
  } catch {
    // Fall through to regex parsing.
  }

  const viewMatch = raw.match(/linkedin\.com\/jobs\/view\/(\d+)/i);
  return viewMatch?.[1] ?? null;
}

export function buildLinkedInJobViewUrl(jobId: string | null | undefined): string {
  const normalized = String(jobId ?? "").trim();
  if (!normalized) return "";
  return `https://www.linkedin.com/jobs/view/${normalized}/`;
}

export function isLinkedInJobPage(href: string | null | undefined): boolean {
  return String(href ?? "").includes("linkedin.com/jobs");
}

export function shouldShowCaptureFab(href: string | null | undefined): boolean {
  const url = String(href ?? "").toLowerCase();
  if (!url.startsWith("http")) return false;
  if (isLinkedInJobPage(url)) return true;
  if (
    url.includes("greenhouse.io") ||
    url.includes("lever.co") ||
    url.includes("ashbyhq.com") ||
    url.includes("teamtailor.com") ||
    url.includes("myworkdayjobs.com") ||
    url.includes("eightfold.ai")
  ) {
    return true;
  }
  return false;
}

export function isPlausiblePersonName(name: string | null | undefined): boolean {
  const normalized = cleanText(name);
  if (!normalized || normalized.length < 4 || normalized.length > 60) return false;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) return false;

  const namePattern = /^[A-ZÅÄÖ][a-zåäöéè'-]+$/;
  for (const token of tokens) {
    if (!namePattern.test(token)) return false;
    if (RECRUITER_NAME_STOPWORDS.has(token.toLowerCase())) return false;
  }

  return true;
}

export function extractLinkedInJob(
  root: ParentNode,
  href: string,
  docTitle?: string | null,
): { title: string; company: string; jobId?: string } | null {
  if (!isLinkedInJobPage(href)) return null;

  const jobId = getLinkedInJobIdFromUrl(href);
  const detailRoot = findLinkedInDetailRoot(root) ?? root;

  let title = textFromSelectors(detailRoot, LINKEDIN_TITLE_SELECTORS);
  let company = textFromSelectors(detailRoot, LINKEDIN_COMPANY_SELECTORS);

  const listItem = findLinkedInListItem(root, jobId);
  if (listItem) {
    if (!title) title = textFromSelectors(listItem, LINKEDIN_LIST_TITLE_SELECTORS);
    if (!company) company = textFromSelectors(listItem, LINKEDIN_LIST_COMPANY_SELECTORS);
  }

  const fromDocumentTitle = parseLinkedInDocumentTitle(docTitle);
  if (!title) title = fromDocumentTitle.title;
  if (!company) company = fromDocumentTitle.company;

  if (isLinkedInNoiseTitle(title)) title = "";
  company = filterAggregatorSiteName(company);

  if (!title && !company) return null;

  return {
    title,
    company,
    ...(jobId ? { jobId } : {}),
  };
}

export function sanitizeRecruiterName(name: string | null | undefined): string {
  return isPlausiblePersonName(name) ? cleanText(name) : "";
}
