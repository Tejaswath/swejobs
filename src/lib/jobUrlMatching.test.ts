import { describe, expect, it } from "vitest";
import {
  buildUrlLookupCandidates,
  canonicalizeJobUrl,
  hostLookupIlikePatterns,
  pathSimilarityScore,
  selectBestSimilarUrlMatch,
} from "@/lib/jobUrlMatching";

describe("jobUrlMatching helpers", () => {
  it("canonicalizes URL by stripping tracking params and hash", () => {
    const canonical = canonicalizeJobUrl(
      "https://www.example.com/jobs/123/?utm_source=mail&ref_code=x#section",
    );
    expect(canonical).toBe("https://example.com/jobs/123");
  });

  it("builds multiple lookup candidates", () => {
    const candidates = buildUrlLookupCandidates("https://example.com/jobs/ABC/?utm_medium=email");
    expect(candidates).toEqual(expect.arrayContaining(["https://example.com/jobs/ABC"]));
    expect(candidates.length).toBeGreaterThan(1);
  });

  it("scores path similarity and picks best host match", () => {
    const source = "https://jobs.ubs.com/openings/software-engineer-graduate";
    const rows = [
      { id: 1, source_url: "https://jobs.ubs.com/openings/software-engineer-graduate?utm_source=x" },
      { id: 2, source_url: "https://jobs.ubs.com/openings/qa-engineer" },
      { id: 3, source_url: "https://other.example.com/openings/software-engineer-graduate" },
    ];
    const score = pathSimilarityScore(source, rows[0].source_url!);
    expect(score).toBeGreaterThan(0.8);
    const best = selectBestSimilarUrlMatch(source, rows);
    expect(best?.id).toBe(1);
  });

  it("escapes ilike host patterns safely", () => {
    const patterns = hostLookupIlikePatterns("https://jobs.ubs.com/role/1");
    expect(patterns).toEqual([
      "%://jobs.ubs.com/%",
      "%://www.jobs.ubs.com/%",
    ]);
    expect(hostLookupIlikePatterns("not-a-url")).toEqual([]);
  });
});
