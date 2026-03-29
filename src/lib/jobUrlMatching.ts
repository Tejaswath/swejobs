type JobUrlCandidate = {
  id: number;
  source_url: string | null;
};

const TRACKING_PARAM_PREFIXES = ["utm_", "ref_", "trk_"];
const TRACKING_PARAM_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "source",
  "s",
]);

export function canonicalizeJobUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return null;

    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.hostname.startsWith("www.")) {
      parsed.hostname = parsed.hostname.slice(4);
    }

    const keptParams = new URLSearchParams();
    for (const [key, value] of parsed.searchParams.entries()) {
      const normalizedKey = key.toLowerCase();
      const isTrackingPrefix = TRACKING_PARAM_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix));
      if (TRACKING_PARAM_KEYS.has(normalizedKey) || isTrackingPrefix) continue;
      keptParams.append(key, value);
    }
    parsed.search = keptParams.toString();

    let normalizedPath = parsed.pathname.replace(/\/+/g, "/");
    if (normalizedPath.length > 1 && normalizedPath.endsWith("/")) {
      normalizedPath = normalizedPath.slice(0, -1);
    }
    parsed.pathname = normalizedPath;

    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

export function buildUrlLookupCandidates(rawUrl: string): string[] {
  const canonical = canonicalizeJobUrl(rawUrl);
  if (!canonical) return [];

  const parsed = new URL(canonical);
  const candidates = new Set<string>([canonical, rawUrl.trim()]);
  candidates.add(`${parsed.origin}${parsed.pathname}`);
  candidates.add(`${parsed.origin}${parsed.pathname}`.toLowerCase());

  if (parsed.hostname && !rawUrl.includes("www.")) {
    candidates.add(canonical.replace(`://${parsed.hostname}`, `://www.${parsed.hostname}`));
  }

  return Array.from(candidates).filter(Boolean);
}

function normalizedPathTokens(value: string): string[] {
  try {
    const parsed = new URL(value);
    return parsed.pathname
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1);
  } catch (_error) {
    return [];
  }
}

function jaccardSimilarity(leftTokens: string[], rightTokens: string[]): number {
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union > 0 ? intersection / union : 0;
}

function hostnameFromUrl(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_error) {
    return "";
  }
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function sanitizeHostname(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/^\.+|\.+$/g, "");
}

export function pathSimilarityScore(leftUrl: string, rightUrl: string): number {
  const leftTokens = normalizedPathTokens(leftUrl);
  const rightTokens = normalizedPathTokens(rightUrl);
  const jaccard = jaccardSimilarity(leftTokens, rightTokens);

  try {
    const leftPath = new URL(leftUrl).pathname.toLowerCase();
    const rightPath = new URL(rightUrl).pathname.toLowerCase();
    const containsBoost = leftPath.includes(rightPath) || rightPath.includes(leftPath) ? 0.2 : 0;
    return Math.min(1, jaccard + containsBoost);
  } catch (_error) {
    return jaccard;
  }
}

export function selectBestSimilarUrlMatch(
  rawUrl: string,
  candidates: JobUrlCandidate[],
  minScore = 0.42,
): JobUrlCandidate | null {
  const canonical = canonicalizeJobUrl(rawUrl);
  if (!canonical) return null;

  const targetHost = hostnameFromUrl(canonical);
  let best: { row: JobUrlCandidate; score: number } | null = null;

  for (const row of candidates) {
    if (!row.source_url) continue;
    const candidateCanonical = canonicalizeJobUrl(row.source_url);
    if (!candidateCanonical) continue;

    if (hostnameFromUrl(candidateCanonical) !== targetHost) continue;
    const score = pathSimilarityScore(canonical, candidateCanonical);
    if (!best || score > best.score) {
      best = { row, score };
    }
  }

  if (!best || best.score < minScore) return null;
  return best.row;
}

export function hostLookupIlikePatterns(rawUrl: string): string[] {
  const canonical = canonicalizeJobUrl(rawUrl);
  if (!canonical) return [];
  const host = sanitizeHostname(hostnameFromUrl(canonical));
  if (!host) return [];
  if (!/[a-z0-9]/.test(host)) return [];
  const escapedHost = escapeIlikePattern(host);
  return [`%://${escapedHost}/%`, `%://www.${escapedHost}/%`];
}
