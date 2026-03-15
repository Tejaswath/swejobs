type UnknownRecord = Record<string, unknown>;

export type DigestWindowType = "calendar_week" | `rolling_${number}d` | string;

export interface DigestJson extends UnknownRecord {
  window_type?: DigestWindowType;
  window_days?: number;
}

export interface DigestRow {
  id: number;
  generated_at: string | null;
  period_start: string;
  period_end: string;
  digest_json: unknown;
}

function toDigestJson(value: unknown): DigestJson | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as DigestJson;
}

function tsValue(value: string | null): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export function isWindowType(digest: unknown, expected: DigestWindowType): boolean {
  const parsed = toDigestJson(digest);
  return parsed?.window_type === expected;
}

export function pickLatestDigest<T extends DigestRow>(
  rows: T[] | null | undefined,
  expectedWindowType: DigestWindowType,
): T | null {
  const all = [...(rows ?? [])];
  if (all.length === 0) return null;

  const sortedFiltered = all
    .filter((row) => isWindowType(row.digest_json, expectedWindowType))
    .sort((a, b) => tsValue(b.generated_at) - tsValue(a.generated_at));
  if (sortedFiltered.length > 0) return sortedFiltered[0];

  const fallback = all.sort((a, b) => tsValue(b.generated_at) - tsValue(a.generated_at))[0];
  console.warn(
    `No digest found for window_type=${expectedWindowType}; falling back to latest available digest.`,
  );
  return fallback ?? null;
}

export function sortDigestsByGeneratedAtDesc<T extends DigestRow>(rows: T[] | null | undefined): T[] {
  return [...(rows ?? [])].sort((a, b) => tsValue(b.generated_at) - tsValue(a.generated_at));
}

function formatDate(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleDateString("sv-SE");
}

function formatTime(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

export function formatDigestLabel(row: DigestRow): string {
  const digest = toDigestJson(row.digest_json);
  const windowType = digest?.window_type;
  const generatedTime = formatTime(row.generated_at);
  if (typeof windowType === "string") {
    const rolling = /^rolling_(\d+)d$/.exec(windowType);
    if (rolling) {
      return generatedTime
        ? `Rolling ${rolling[1]}d ending ${formatDate(row.period_end)} (${generatedTime})`
        : `Rolling ${rolling[1]}d ending ${formatDate(row.period_end)}`;
    }
    if (windowType === "calendar_week") {
      return generatedTime
        ? `Calendar week of ${formatDate(row.period_start)} (${generatedTime})`
        : `Calendar week of ${formatDate(row.period_start)}`;
    }
  }
  return generatedTime
    ? `Window ending ${formatDate(row.period_end)} (${generatedTime})`
    : `Window ending ${formatDate(row.period_end)}`;
}
