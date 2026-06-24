import { describe, expect, it } from "vitest";

import {
  aggregatePersonalFeedbackDelta,
  profileHeadlineBoost,
  profileLocationBoost,
} from "@/lib/personalRanking";

describe("personalRanking", () => {
  it("boosts remote and Stockholm matches from profile location", () => {
    const profile = { location: "Stockholm / remote" };

    expect(
      profileLocationBoost(
        { remote_flag: true, municipality: "Uppsala", region: "Uppsala" },
        profile,
      ),
    ).toBe(5);
    expect(
      profileLocationBoost(
        { remote_flag: false, municipality: "Stockholm", region: "Stockholms län" },
        profile,
      ),
    ).toBe(4);
  });

  it("boosts headline overlap without dominating the score", () => {
    expect(
      profileHeadlineBoost(
        { headline: "Backend Engineer Intern" },
        { headline: "Software engineer intern seeking backend roles" },
      ),
    ).toBe(4);
  });

  it("caps combined personal feedback delta", () => {
    expect(
      aggregatePersonalFeedbackDelta({
        companyRoleDelta: 10,
        highSignalScoreDelta: 20,
      }),
    ).toBe(15);
  });
});
