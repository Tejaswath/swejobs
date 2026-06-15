import { describe, expect, it } from "vitest";
import fixtures from "../../tests/fixtures/ranking_cases.json";
import { suitabilityScore } from "@/lib/jobRanking";

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
