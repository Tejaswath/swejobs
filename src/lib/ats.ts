const STOP_WORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "for",
  "from",
  "have",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "our",
  "the",
  "their",
  "this",
  "to",
  "we",
  "will",
  "with",
  "you",
  "your",
  "som",
  "att",
  "och",
  "det",
  "den",
  "för",
  "med",
  "som",
  "till",
  "vara",
  "eller",
  "är",
  "av",
]);

export type AtsScanResult = {
  score: number;
  keywordCount: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  trackedMissingKeywords: string[];
  untrackedMissingKeywords: string[];
  recommendations: string[];
};

export function normalizeKeyword(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#./ -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeKeywords(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeKeyword(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function extractKeywordsFromJobText(text: string, limit = 20) {
  const tokens = normalizeKeyword(text)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function hasKeyword(text: string, keyword: string) {
  const normalizedText = ` ${normalizeKeyword(text)} `;
  const normalizedKeyword = ` ${normalizeKeyword(keyword)} `;
  return normalizedText.includes(normalizedKeyword);
}

export function runAtsScan(params: {
  resumeText: string;
  targetKeywords: string[];
  trackedSkills?: Iterable<string>;
}): AtsScanResult {
  const keywords = dedupeKeywords(params.targetKeywords);
  const trackedSkillSet = new Set(Array.from(params.trackedSkills ?? []).map((skill) => normalizeKeyword(skill)));
  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];

  for (const keyword of keywords) {
    if (hasKeyword(params.resumeText, keyword)) {
      matchedKeywords.push(keyword);
    } else {
      missingKeywords.push(keyword);
    }
  }

  const trackedMissingKeywords = missingKeywords.filter((keyword) => trackedSkillSet.has(normalizeKeyword(keyword)));
  const untrackedMissingKeywords = missingKeywords.filter((keyword) => !trackedSkillSet.has(normalizeKeyword(keyword)));
  const score = keywords.length > 0 ? Math.round((matchedKeywords.length / keywords.length) * 100) : 0;

  const recommendations: string[] = [];
  if (trackedMissingKeywords.length > 0) {
    recommendations.push(`Add proof for ${trackedMissingKeywords.slice(0, 5).join(", ")} if those skills are actually on this resume version.`);
  }
  if (untrackedMissingKeywords.length > 0) {
    recommendations.push(`Review whether ${untrackedMissingKeywords.slice(0, 5).join(", ")} belong in the resume or should stay as interview prep notes.`);
  }
  if (matchedKeywords.length === 0) {
    recommendations.push("This resume is not surfacing the target keywords yet. Start with the must-have terms before tailoring details.");
  }

  return {
    score,
    keywordCount: keywords.length,
    matchedKeywords,
    missingKeywords,
    trackedMissingKeywords,
    untrackedMissingKeywords,
    recommendations,
  };
}
