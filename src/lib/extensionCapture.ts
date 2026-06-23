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

const LINKEDIN_COMPANY_SELECTORS = [
  ".job-details-jobs-unified-top-card__company-name a",
  ".job-details-jobs-unified-top-card__company-name",
  ".jobs-unified-top-card__company-name",
  ".topcard__org-name-link",
  "a[data-tracking-control-name='public_jobs_topcard-org-name']",
];

const LINKEDIN_TITLE_SELECTORS = [
  ".job-details-jobs-unified-top-card__job-title",
  ".topcard__title",
  "h1.t-24",
  "h1.job-details-jobs-unified-top-card__job-title",
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

export function isAggregatorSiteName(siteName: string | null | undefined): boolean {
  const normalized = cleanText(siteName).toLowerCase();
  if (!normalized) return false;
  return AGGREGATOR_SITE_NAMES.has(normalized);
}

export function filterAggregatorSiteName(siteName: string | null | undefined): string {
  return isAggregatorSiteName(siteName) ? "" : cleanText(siteName);
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
): { title: string; company: string } | null {
  if (!href.includes("linkedin.com/jobs")) return null;

  const title = textFromSelectors(root, LINKEDIN_TITLE_SELECTORS);
  const company = textFromSelectors(root, LINKEDIN_COMPANY_SELECTORS);
  if (!title && !company) return null;

  return {
    title,
    company,
  };
}

export function sanitizeRecruiterName(name: string | null | undefined): string {
  return isPlausiblePersonName(name) ? cleanText(name) : "";
}
