import { describe, expect, it } from "vitest";

import { deadlineShowsInList, listCareerLabel, listLocationHint } from "@/lib/jobListDisplay";

describe("jobListDisplay", () => {
  it("hides unspecified career labels in the default list", () => {
    expect(listCareerLabel("broad", "unknown_possible", "unknown")).toBeNull();
    expect(listCareerLabel("broad", "junior", "unknown")).toBe("junior");
    expect(listCareerLabel("graduate_trainee", "confirmed_graduate", "unknown")).toBe("confirmed graduate");
  });

  it("shows urgent deadlines only within seven days", () => {
    const today = new Date();
    const inThreeDays = new Date(today);
    inThreeDays.setDate(today.getDate() + 3);
    const iso = inThreeDays.toISOString().slice(0, 10);
    expect(deadlineShowsInList(iso)).toBe(true);
    expect(deadlineShowsInList(null)).toBe(false);
  });

  it("prefers remote over municipality in the list hint", () => {
    expect(listLocationHint({ municipality: "Stockholm", remote_flag: true })).toBe("Remote");
    expect(listLocationHint({ municipality: "Stockholm", remote_flag: false })).toBe("Stockholm");
  });
});
