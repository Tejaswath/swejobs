export type JobDescriptionSection = {
  title: string | null;
  body: string;
};

const SECTION_HEADER =
  /(?:^|[\n.]\s*|\s{2,})((?:Key Responsibilities|What we (?:offer|expect|are looking for)|Requirements|Who you are|About (?:the role|us|you)|Your profile|Qualifications|Ansvarsområden|Vi erbjuder|Krav|Om rollen|Om oss|Dina arbetsuppgifter)[:\s–-]*)/gi;

function decodeHtmlEntities(value: string): string {
  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

export function normalizeJobDescription(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";

  let text = decodeHtmlEntities(raw.trim());
  text = text
    .replace(/<\/p>\s*/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>\s*/gi, "\n")
    .replace(/<\/h[1-6]>\s*/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);
  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  text = text.replace(/([.!?])\s+(?=[A-ZÅÄÖ])/g, "$1\n\n");
  return text.replace(/[ \t]{2,}/g, " ").trim();
}

export function parseJobDescriptionSections(raw: string | null | undefined): JobDescriptionSection[] {
  const normalized = normalizeJobDescription(raw);
  if (!normalized) return [];

  const matches = [...normalized.matchAll(SECTION_HEADER)];
  if (matches.length === 0) {
    return [{ title: null, body: normalized }];
  }

  const sections: JobDescriptionSection[] = [];
  let cursor = 0;

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const headerStart = match.index ?? 0;
    const headerText = (match[1] ?? "").replace(/[:\s–-]+$/, "").trim();

    if (headerStart > cursor) {
      const intro = normalized.slice(cursor, headerStart).trim();
      if (intro) {
        sections.push({ title: null, body: intro });
      }
    }

    const bodyStart = headerStart + match[0].length;
    const bodyEnd = index + 1 < matches.length ? (matches[index + 1].index ?? normalized.length) : normalized.length;
    const body = normalized.slice(bodyStart, bodyEnd).trim();
    sections.push({ title: headerText, body });
    cursor = bodyEnd;
  }

  return sections.filter((section) => section.body.length > 0 || section.title);
}

export function formatDescriptionParagraphs(body: string): string[] {
  return body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}
