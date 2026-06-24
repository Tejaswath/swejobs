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

export type AutofillProvider = "teamtailor" | "workday" | "generic";

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

const GENERIC_SELECTORS: Record<AutofillFieldKey, string[]> = {
  first_name: ["#first_name", "#firstName", "input[name*='first_name']", "input[name*='firstName']"],
  last_name: ["#last_name", "#lastName", "input[name*='last_name']", "input[name*='lastName']"],
  email: ["#email", "input[type='email']", "input[name*='email']"],
  phone: ["#phone", "input[type='tel']", "input[name*='phone']"],
  linkedin_url: ["input[name*='linkedin']", "input[id*='linkedin']"],
  portfolio_url: ["input[name*='portfolio']", "input[name*='website']", "input[id*='portfolio']"],
  cover_letter: ["textarea[name*='cover']", "textarea[id*='cover']", "textarea[name*='letter']"],
};

const PROVIDER_SELECTORS: Partial<Record<AutofillProvider, Partial<Record<AutofillFieldKey, string[]>>>> = {
  teamtailor: {
    first_name: [
      "input[name*='candidate[first_name]']",
      "input[name*='first_name']",
      "#candidate_first_name",
    ],
    last_name: [
      "input[name*='candidate[last_name]']",
      "input[name*='last_name']",
      "#candidate_last_name",
    ],
    email: ["input[name*='candidate[email]']", "input[name*='[email]']", "input[type='email']"],
    phone: ["input[name*='candidate[phone]']", "input[name*='phone']", "input[type='tel']"],
    linkedin_url: ["input[name*='linkedin']"],
    portfolio_url: ["input[name*='portfolio']", "input[name*='website']"],
    cover_letter: ["textarea[name*='cover']", "textarea[name*='letter']", "textarea[name*='message']"],
  },
  workday: {
    first_name: [
      "input[data-automation-id*='legalNameSection_firstName']",
      "input[data-automation-id*='firstName']",
    ],
    last_name: [
      "input[data-automation-id*='legalNameSection_lastName']",
      "input[data-automation-id*='lastName']",
    ],
    email: ["input[data-automation-id*='email']", "input[data-automation-id*='Email']"],
    phone: ["input[data-automation-id*='phone']", "input[data-automation-id*='Phone']"],
    linkedin_url: ["input[data-automation-id*='linkedin']", "input[data-automation-id*='LinkedIn']"],
    portfolio_url: ["input[data-automation-id*='website']", "input[data-automation-id*='portfolio']"],
    cover_letter: ["textarea[data-automation-id*='cover']", "textarea[data-automation-id*='letter']"],
  },
};

const RESUME_INPUT_SELECTORS = [
  "input[type='file'][name*='resume']",
  "input[type='file'][id*='resume']",
  "input[type='file'][name*='cv']",
  "input[type='file'][data-automation-id*='resume']",
  "input[type='file'][name*='candidate[resume]']",
];

function cleanText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function inferAutofillProvider(pageHost: string): AutofillProvider {
  const host = cleanText(pageHost).toLowerCase();
  if (host.includes("teamtailor.com")) return "teamtailor";
  if (host.includes("myworkdayjobs.com") || host.includes("workday.com")) return "workday";
  return "generic";
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

function isFillableField(field: Element): field is HTMLInputElement | HTMLTextAreaElement {
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
  if (field instanceof HTMLInputElement && ["hidden", "submit", "button", "checkbox", "radio"].includes(field.type)) {
    return false;
  }
  return true;
}

function selectorsForKey(key: AutofillFieldKey, provider: AutofillProvider): string[] {
  const providerSpecific = PROVIDER_SELECTORS[provider]?.[key] ?? [];
  const generic = GENERIC_SELECTORS[key] ?? [];
  return [...providerSpecific, ...generic];
}

export function findAutofillField(
  root: ParentNode,
  key: AutofillFieldKey,
  provider: AutofillProvider = "generic",
): HTMLInputElement | HTMLTextAreaElement | null {
  for (const selector of selectorsForKey(key, provider)) {
    const element = root.querySelector(selector);
    if (isFillableField(element)) return element;
  }

  const fields = root.querySelectorAll("input, textarea");
  for (const field of fields) {
    if (!isFillableField(field)) continue;

    const haystack = buildFieldHaystack([
      field.name,
      field.id,
      field.getAttribute("aria-label"),
      field.placeholder,
      field.autocomplete,
      field.labels?.[0]?.textContent,
      field.getAttribute("data-automation-id"),
    ]);

    if (matchAutofillKey(haystack) === key) return field;
  }

  return null;
}

export function findResumeFileInput(root: ParentNode, provider: AutofillProvider = "generic"): HTMLInputElement | null {
  const selectors =
    provider === "teamtailor"
      ? [...RESUME_INPUT_SELECTORS, "input[type='file'][name*='candidate[resume]']"]
      : provider === "workday"
        ? [...RESUME_INPUT_SELECTORS, "input[type='file'][data-automation-id*='resume']"]
        : RESUME_INPUT_SELECTORS;

  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element instanceof HTMLInputElement && element.type === "file") return element;
  }
  return null;
}

export function collectFieldHaystacks(root: ParentNode): string[] {
  const fields = root.querySelectorAll("input, textarea, select");
  const haystacks: string[] = [];

  for (const field of fields) {
    if (field instanceof HTMLInputElement && ["hidden", "submit", "button", "checkbox", "radio"].includes(field.type)) {
      continue;
    }

    haystacks.push(
      buildFieldHaystack([
        field.getAttribute("name"),
        field.id,
        field.getAttribute("aria-label"),
        field.getAttribute("placeholder"),
        field.getAttribute("autocomplete"),
        field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
          ? field.labels?.[0]?.textContent
          : null,
        field.getAttribute("data-automation-id"),
      ]),
    );
  }

  return haystacks;
}

export function detectApplicationFieldCount(root: ParentNode): number {
  return countApplicationLikeFields(collectFieldHaystacks(root));
}
