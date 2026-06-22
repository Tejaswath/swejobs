import { describe, expect, it } from "vitest";
import fixtures from "../../tests/fixtures/ranking_cases.json";
import { primarySuitabilityReason, suitabilityScore } from "@/lib/jobRanking";

describe("primarySuitabilityReason", () => {
  it("skips the generic software-role fallback when a specific reason exists", () => {
    const result = suitabilityScore(
      {
        is_target_role: true,
        career_stage: "junior",
        career_stage_confidence: 0.9,
        role_family_confidence: 0.95,
      },
      { atsMatch: 72 },
    );
    expect(primarySuitabilityReason(result)).not.toBe("Relevant software role");
    expect(primarySuitabilityReason(result)).toMatch(/resume match|title signal|Early-career/i);
  });
});

describe("suitability ranking invariants", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const { ats_match: betterMatch, quality_band: betterBand, watched: betterWatched, ...better } = fixture.better;
      const { ats_match: worseMatch, quality_band: worseBand, watched: worseWatched, ...worse } = fixture.worse;
      const betterScore = suitabilityScore(better, {
        atsMatch: betterMatch,
        qualityBand: betterBand,
        watched: betterWatched,
        now: new Date("2026-06-14T00:00:00Z"),
      }).score;
      const worseScore = suitabilityScore(worse, {
        atsMatch: worseMatch,
        qualityBand: worseBand,
        watched: worseWatched,
        now: new Date("2026-06-14T00:00:00Z"),
      }).score;
      expect(betterScore).toBeGreaterThan(worseScore);
    });
  }
});
