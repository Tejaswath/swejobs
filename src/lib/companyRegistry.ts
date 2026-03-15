import rawRegistry from "../../pipeline/config/company_registry.json";

export type CompanyCoverageStatus =
  | "connected"
  | "planned"
  | "blocked"
  | "html_fallback_candidate";

export type CompanyRegistryEntry = {
  company_canonical: string;
  display_name: string;
  priority_tier: string;
  category: string;
  status: CompanyCoverageStatus;
  provider: string | null;
  provider_identifier: string | null;
  provider_order: string[];
  markets: string[];
  notes: string;
  aliases?: string[];
  career_page_url?: string | null;
};

const COMPANY_SUFFIXES = new Set([
  "ab",
  "aktiebolag",
  "group",
  "holding",
  "holdings",
  "sweden",
  "sverige",
  "consulting",
  "services",
  "technology",
  "technologies",
  "solutions",
  "company",
  "corp",
  "corporation",
  "inc",
  "ltd",
  "plc",
  "asa",
  "oy",
  "ag",
  "gmbh",
]);

const PROVIDER_LABELS: Record<string, string> = {
  lever: "Lever",
  greenhouse: "Greenhouse",
  teamtailor: "Teamtailor",
  smartrecruiters: "SmartRecruiters",
  workday: "Workday",
  jobs2web: "Jobs2Web",
  html_fallback: "HTML fallback",
};

type CompanyRegistryDocument = {
  version: number;
  updated_at: string;
  companies: CompanyRegistryEntry[];
};

const registryDocument = rawRegistry as CompanyRegistryDocument;

export const companyRegistry = registryDocument.companies ?? [];

function tokensFor(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token && !COMPANY_SUFFIXES.has(token));
}

export function normalizeCompanyKey(value: string | null | undefined): string {
  if (!value) return "";
  return tokensFor(value).join(" ");
}

function aliasesFor(entry: CompanyRegistryEntry): Set<string> {
  const values = new Set<string>();
  values.add(normalizeCompanyKey(entry.company_canonical));
  values.add(normalizeCompanyKey(entry.display_name));
  for (const alias of entry.aliases ?? []) {
    values.add(normalizeCompanyKey(alias));
  }
  return new Set([...values].filter(Boolean));
}

export function findCompanyRegistryEntry(query: string | null | undefined): CompanyRegistryEntry | null {
  const normalized = normalizeCompanyKey(query);
  if (!normalized) return null;
  for (const entry of companyRegistry) {
    const aliases = aliasesFor(entry);
    if (aliases.has(normalized)) {
      return entry;
    }
  }
  return null;
}

export function getCompanyRegistryEntryByCanonical(
  companyCanonical: string | null | undefined,
): CompanyRegistryEntry | null {
  const normalized = normalizeCompanyKey(companyCanonical);
  if (!normalized) return null;
  return companyRegistry.find((entry) => normalizeCompanyKey(entry.company_canonical) === normalized) ?? null;
}

export function companyDisplayName(
  companyCanonical: string | null | undefined,
  fallback: string | null | undefined,
): string {
  const entry = getCompanyRegistryEntryByCanonical(companyCanonical);
  return entry?.display_name ?? fallback ?? "";
}

export function providerLabel(provider: string | null | undefined): string {
  if (!provider) return "Unknown";
  return PROVIDER_LABELS[provider] ?? provider;
}

export function connectedCompanySourceCount(): number {
  return companyRegistry.filter((entry) => entry.status === "connected").length;
}

export function connectedCompanyRegistryEntries(): CompanyRegistryEntry[] {
  return companyRegistry
    .filter((entry) => entry.status === "connected")
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export function plannedCompanyRegistryEntries(): CompanyRegistryEntry[] {
  return companyRegistry
    .filter((entry) => entry.status === "planned")
    .sort((a, b) => {
      if (a.priority_tier !== b.priority_tier) {
        return a.priority_tier.localeCompare(b.priority_tier);
      }
      return a.display_name.localeCompare(b.display_name);
    });
}

export function companyCoverageStatusCounts(): Record<CompanyCoverageStatus, number> {
  return companyRegistry.reduce(
    (acc, entry) => {
      acc[entry.status] += 1;
      return acc;
    },
    {
      connected: 0,
      planned: 0,
      blocked: 0,
      html_fallback_candidate: 0,
    } satisfies Record<CompanyCoverageStatus, number>,
  );
}
