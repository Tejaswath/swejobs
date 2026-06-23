export const AUTOFILL_FIELD_KEYS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "linkedin_url",
  "portfolio_url",
  "cover_letter",
] as const;

export type AutofillFieldKey = (typeof AUTOFILL_FIELD_KEYS)[number];

export type AutofillProfile = {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  portfolio_url?: string | null;
};

export type AutofillValues = Record<AutofillFieldKey, string>;

const FIELD_PATTERNS: Record<AutofillFieldKey, RegExp[]> = {
  first_name: [/first[\s_-]?name/i, /given[\s_-]?name/i, /fname/i, /förnamn/i],
  last_name: [/last[\s_-]?name/i, /family[\s_-]?name/i, /surname/i, /lname/i, /efternamn/i],
  email: [/e[\s-]?mail/i, /email address/i],
  phone: [/phone/i, /mobile/i, /telefon/i, /tel\b/i],
  linkedin_url: [/linkedin/i],
  portfolio_url: [/portfolio/i, /website/i, /personal site/i, /hemsida/i],
  cover_letter: [/cover[\s_-]?letter/i, /motivation/i, /personligt brev/i, /letter/i],
};

function cleanText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function buildAutofillValues(
  profile: AutofillProfile | null | undefined,
  coverLetterText = "",
): AutofillValues {
  const firstName = cleanText(profile?.first_name);
  const lastName = cleanText(profile?.last_name);
  const fullName = cleanText(profile?.full_name);
  const derivedFirst = firstName || fullName.split(/\s+/).filter(Boolean)[0] || "";
  const derivedLast =
    lastName || fullName.split(/\s+/).filter(Boolean).slice(1).join(" ") || "";

  return {
    first_name: derivedFirst,
    last_name: derivedLast,
    email: cleanText(profile?.email),
    phone: cleanText(profile?.phone),
    linkedin_url: cleanText(profile?.linkedin_url),
    portfolio_url: cleanText(profile?.portfolio_url),
    cover_letter: cleanText(coverLetterText),
  };
}

export function buildFieldHaystack(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => cleanText(part).toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export function matchAutofillKey(haystack: string): AutofillFieldKey | null {
  const normalized = haystack.toLowerCase();
  if (!normalized) return null;

  for (const key of AUTOFILL_FIELD_KEYS) {
    if (FIELD_PATTERNS[key].some((pattern) => pattern.test(normalized))) {
      return key;
    }
  }

  return null;
}

export function countApplicationLikeFields(haystacks: string[]): number {
  const matched = new Set<AutofillFieldKey>();
  for (const haystack of haystacks) {
    const key = matchAutofillKey(haystack);
    if (key) matched.add(key);
  }
  return matched.size;
}
