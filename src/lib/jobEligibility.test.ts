import { describe, expect, it } from "vitest";
import fixtures from "../../tests/fixtures/eligibility_cases.json";
import { earlyCareerBucket, jobPassesLens } from "@/lib/jobEligibility";

const feed = { enabled: true, high_signal_eligible: true, quality_band: "trusted" };

describe("shared eligibility fixtures", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      expect(jobPassesLens(fixture.job, "high_signal", feed, false)).toBe(fixture.high_signal);
      expect(jobPassesLens(fixture.job, "graduate_trainee", feed, false)).toBe(fixture.graduate_trainee);
    });
  }
});

describe("early-career buckets", () => {
  it("separates confirmed programs from unknown possible roles", () => {
    expect(earlyCareerBucket({ is_grad_program: true, career_stage: "unknown" })).toBe("confirmed_graduate");
    expect(earlyCareerBucket({ headline: "Software Engineer", career_stage: "unknown" })).toBe("unknown_possible");
    expect(earlyCareerBucket({ headline: "Senior Engineer", career_stage: "senior", career_stage_confidence: 0.9 })).toBe(
      "stretch",
    );
  });
});

describe("For You lens eligibility", () => {
  it("excludes explicit senior Swedish title variants", () => {
    const job = {
      is_active: true,
      is_noise: false,
      is_target_role: true,
      relevance_score: 80,
      headline: "Saab söker erfarna systemingenjörer!",
      career_stage: "unknown",
      source_kind: "jobtech",
    };

    expect(jobPassesLens(job, "broad", feed, false)).toBe(false);
  });
});
