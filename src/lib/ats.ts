const STOP_WORDS = new Set([
  "a",
  "about",
  "across",
  "after",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "being",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "each",
  "for",
  "from",
  "good",
  "has",
  "have",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "more",
  "most",
  "must",
  "no",
  "not",
  "of",
  "on",
  "one",
  "or",
  "our",
  "out",
  "should",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "us",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "will",
  "with",
  "within",
  "work",
  "you",
  "your",
  "som",
  "att",
  "och",
  "det",
  "den",
  "för",
  "med",
  "till",
  "vara",
  "eller",
  "är",
  "av",
  "har",
  "ska",
]);

const SECTION_WEIGHTS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\b(requirements?|qualifications?|must have|what you bring|you have|required skills?)\b/i, weight: 2.6 },
  { pattern: /\b(krav|kvalifikationer|meriterande|vi söker dig som)\b/i, weight: 2.4 },
  { pattern: /\b(responsibilities|what you'?ll do|your mission|role overview)\b/i, weight: 1.9 },
  { pattern: /\b(nice to have|bonus skills?|preferred)\b/i, weight: 1.4 },
];

const PHRASE_PATTERNS = [
  "machine learning",
  "deep learning",
  "natural language processing",
  "large language model",
  "large language models",
  "spring boot",
  "distributed systems",
  "system design",
  "event driven",
  "micro services",
  "microservices",
  "rest api",
  "amazon web services",
  "google cloud platform",
  "software engineer",
  "software developer",
  "graphql",
  "ci cd",
  "test automation",
  "cloud architecture",
  "data engineering",
  "data science",
  "computer vision",
  "prompt engineering",
  "generative ai",
  "software engineering",
  "backend development",
];

const SYNONYM_GROUPS: Record<string, string[]> = {
  javascript: ["js", "javascript", "node.js", "nodejs", "ecmascript"],
  typescript: ["ts", "typescript"],
  python: ["python", "python3", "python2"],
  aws: ["aws", "amazon web services", "aws cloud"],
  gcp: ["gcp", "google cloud", "google cloud platform"],
  react: ["react", "reactjs", "react.js"],
  vue: ["vue", "vuejs", "vue.js"],
  docker: ["docker", "containerization", "containers"],
  sql: ["sql", "mysql", "postgresql", "postgres"],
  "machine learning": ["ml", "machine learning"],
  "artificial intelligence": ["ai", "artificial intelligence"],
  "generative ai": ["genai", "generative ai"],
  "large language models": ["llm", "llms", "large language model", "large language models"],
  developer: ["developer", "utvecklare"],
  "software engineer": ["software engineer", "systemutvecklare", "mjukvaruutvecklare"],
  csharp: ["c#", "csharp", ".net", "dotnet"],
  kubernetes: ["k8s", "kubernetes"],
  "spring boot": ["spring boot", "springboot"],
  "rest api": ["rest api", "restful api", "restful apis"],
};

const VARIANT_TO_CANONICAL = new Map<string, string>();
const CANONICAL_TO_VARIANTS = new Map<string, string[]>();

for (const [canonical, aliases] of Object.entries(SYNONYM_GROUPS)) {
  const canonicalNormalized = canonicalizeKeyword(canonical);
  const variants = Array.from(
    new Set([canonical, ...aliases].map((value) => normalizeKeyword(value)).filter(Boolean)),
  );
  CANONICAL_TO_VARIANTS.set(canonicalNormalized, variants);
  for (const variant of variants) {
    VARIANT_TO_CANONICAL.set(variant, canonicalNormalized);
  }
}

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

function canonicalizeKeyword(value: string) {
  const normalized = normalizeKeyword(value);
  return VARIANT_TO_CANONICAL.get(normalized) ?? normalized;
}

function dedupeKeywords(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = canonicalizeKeyword(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function sectionWeight(sectionText: string): number {
  const normalized = normalizeKeyword(sectionText);
  for (const rule of SECTION_WEIGHTS) {
    if (rule.pattern.test(normalized)) return rule.weight;
  }
  return 1;
}

function variantsForKeyword(keyword: string): string[] {
  const canonical = canonicalizeKeyword(keyword);
  return CANONICAL_TO_VARIANTS.get(canonical) ?? [canonical];
}

function addWeightedKeyword(counts: Map<string, number>, keyword: string, weight: number) {
  const canonical = canonicalizeKeyword(keyword);
  if (!canonical || STOP_WORDS.has(canonical) || canonical.length < 2) return;
  counts.set(canonical, (counts.get(canonical) ?? 0) + weight);
}

export function extractKeywordsFromJobText(text: string, limit = 35) {
  const sections = text
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);

  const counts = new Map<string, number>();
  const bigramOccurrences = new Map<string, number>();

  for (const section of sections.length > 0 ? sections : [text]) {
    const weight = sectionWeight(section);
    const normalizedSection = normalizeKeyword(section);
    const tokens = normalizedSection
      .split(" ")
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

    for (const token of tokens) {
      addWeightedKeyword(counts, token, weight);
    }

    for (const phrase of PHRASE_PATTERNS) {
      const normalizedPhrase = normalizeKeyword(phrase);
      if (normalizedSection.includes(normalizedPhrase)) {
        addWeightedKeyword(counts, normalizedPhrase, weight * 2);
      }
    }

    for (let index = 0; index < tokens.length - 1; index += 1) {
      const left = tokens[index];
      const right = tokens[index + 1];
      if (STOP_WORDS.has(left) || STOP_WORDS.has(right)) continue;
      const bigram = `${left} ${right}`;
      bigramOccurrences.set(bigram, (bigramOccurrences.get(bigram) ?? 0) + 1);
    }
  }

  const normalizedPhraseSet = new Set(PHRASE_PATTERNS.map((phrase) => normalizeKeyword(phrase)));
  for (const [bigram, occurrences] of bigramOccurrences.entries()) {
    const normalizedBigram = normalizeKeyword(bigram);
    if (occurrences <= 1 && !normalizedPhraseSet.has(normalizedBigram)) continue;
    addWeightedKeyword(counts, bigram, 1.1 + Math.min(occurrences, 3) * 0.4);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([keyword]) => keyword);
}

function hasKeyword(normalizedText: string, keyword: string) {
  const paddedText = ` ${normalizedText} `;
  return variantsForKeyword(keyword).some((variant) => {
    const paddedVariant = ` ${normalizeKeyword(variant)} `;
    return paddedText.includes(paddedVariant);
  });
}

export function runAtsScan(params: {
  resumeText: string;
  targetKeywords: string[];
  trackedSkills?: Iterable<string>;
}): AtsScanResult {
  const keywords = dedupeKeywords(params.targetKeywords);
  const trackedSkillSet = new Set(Array.from(params.trackedSkills ?? []).map((skill) => canonicalizeKeyword(skill)));
  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];
  const normalizedResumeText = normalizeKeyword(params.resumeText);

  for (const keyword of keywords) {
    if (hasKeyword(normalizedResumeText, keyword)) {
      matchedKeywords.push(keyword);
    } else {
      missingKeywords.push(keyword);
    }
  }

  const trackedMissingKeywords = missingKeywords.filter((keyword) => trackedSkillSet.has(canonicalizeKeyword(keyword)));
  const untrackedMissingKeywords = missingKeywords.filter((keyword) => !trackedSkillSet.has(canonicalizeKeyword(keyword)));
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
