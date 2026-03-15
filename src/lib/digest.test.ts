import { describe, expect, it, vi } from "vitest";
import { formatDigestLabel, pickLatestDigest, type DigestRow } from "@/lib/digest";

function row(
  id: number,
  generatedAt: string,
  periodStart: string,
  periodEnd: string,
  windowType: string,
): DigestRow {
  return {
    id,
    generated_at: generatedAt,
    period_start: periodStart,
    period_end: periodEnd,
    digest_json: { window_type: windowType },
  };
}

describe("digest helper", () => {
  it("picks latest rolling_30d digest by generated_at", () => {
    const rows: DigestRow[] = [
      row(1, "2026-03-09T08:00:00Z", "2026-02-07T00:00:00Z", "2026-03-09T00:00:00Z", "rolling_30d"),
      row(2, "2026-03-09T09:00:00Z", "2026-03-03T00:00:00Z", "2026-03-10T00:00:00Z", "calendar_week"),
      row(3, "2026-03-09T10:00:00Z", "2026-02-07T00:00:00Z", "2026-03-09T00:00:00Z", "rolling_30d"),
    ];

    const picked = pickLatestDigest(rows, "rolling_30d");
    expect(picked?.id).toBe(3);
  });

  it("falls back to latest digest if expected window type is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows: DigestRow[] = [
      row(11, "2026-03-09T09:00:00Z", "2026-03-03T00:00:00Z", "2026-03-10T00:00:00Z", "calendar_week"),
      row(12, "2026-03-09T10:00:00Z", "2026-03-04T00:00:00Z", "2026-03-11T00:00:00Z", "calendar_week"),
    ];

    const picked = pickLatestDigest(rows, "rolling_30d");
    expect(picked?.id).toBe(12);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("formats rolling label without weekly wording", () => {
    const label = formatDigestLabel(
      row(21, "2026-03-09T10:00:00Z", "2026-02-07T00:00:00Z", "2026-03-09T00:00:00Z", "rolling_30d"),
    );
    expect(label).toContain("Rolling 30d ending");
  });
});
