import type { UserProfileRow } from "@/lib/profile";

export const DEFAULT_COVER_LETTER_TEMPLATE = `Dear {{company}} team,

I am applying for the {{jobTitle}} role. {{aboutMe}}

Thank you for your time and consideration.

Best regards,
{{firstName}} {{lastName}}
{{email}}
{{phone}}
{{linkedinUrl}}`;

export type CoverLetterJob = {
  company: string;
  job_title: string;
};

function cleanText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function firstNameFromProfile(profile: UserProfileRow | null | undefined): string {
  const explicit = cleanText(profile?.first_name);
  if (explicit) return explicit;
  const full = cleanText(profile?.full_name);
  if (!full) return "";
  return full.split(/\s+/)[0] ?? "";
}

function lastNameFromProfile(profile: UserProfileRow | null | undefined): string {
  const explicit = cleanText(profile?.last_name);
  if (explicit) return explicit;
  const full = cleanText(profile?.full_name);
  if (!full) return "";
  const parts = full.split(/\s+/).filter(Boolean);
  return parts.slice(1).join(" ");
}

export function renderCoverLetter(
  template: string,
  job: CoverLetterJob,
  profile: UserProfileRow | null | undefined,
): string {
  const aboutMe = cleanText(profile?.about_me);
  const aboutSentence = aboutMe || "I believe my background is a strong fit for this opportunity.";

  const replacements: Record<string, string> = {
    "{{company}}": cleanText(job.company) || "your",
    "{{jobTitle}}": cleanText(job.job_title) || "this role",
    "{{aboutMe}}": aboutSentence,
    "{{firstName}}": firstNameFromProfile(profile),
    "{{lastName}}": lastNameFromProfile(profile),
    "{{email}}": cleanText(profile?.email),
    "{{phone}}": cleanText(profile?.phone),
    "{{linkedinUrl}}": cleanText(profile?.linkedin_url),
    "{{portfolioUrl}}": cleanText(profile?.portfolio_url),
    "{{headline}}": cleanText(profile?.headline),
    "{{location}}": cleanText(profile?.location),
  };

  let rendered = template;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(token, value);
  }

  return rendered
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
