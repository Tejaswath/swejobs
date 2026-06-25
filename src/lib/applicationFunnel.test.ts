import { describe, expect, it } from "vitest";

import {
  computeWeeklyFunnelSummary,
  daysInCurrentStatus,
  listFollowUpNudges,
  needsFollowUp,
  parseApplicationStatusHistory,
} from "@/lib/applicationFunnel";

describe("applicationFunnel", () => {
  const now = new Date("2026-06-24T12:00:00Z");

  it("parses status history and measures days in current status", () => {
    const history = parseApplicationStatusHistory([
      { status: "applied", at: "2026-06-01T12:00:00Z" },
      { status: "oa", at: "2026-06-10T12:00:00Z" },
    ]);

    expect(history).toHaveLength(2);
    expect(
      daysInCurrentStatus(
        {
          status: "oa",
          applied_at: "2026-06-01T12:00:00Z",
          status_history: history,
        },
        now,
      ),
    ).toBe(14);
  });

  it("flags follow-up when applied status is unchanged for 14+ days", () => {
    const application = {
      id: "app-1",
      company: "Spotify",
      job_title: "Backend Engineer",
      status: "applied",
      applied_at: "2026-06-01T12:00:00Z",
      status_history: [{ status: "applied", at: "2026-06-01T12:00:00Z" }],
    };

    expect(needsFollowUp(application, now)).toBe(true);
    expect(listFollowUpNudges([application], now)).toEqual([
      {
        id: "app-1",
        company: "Spotify",
        jobTitle: "Backend Engineer",
        daysInStatus: 23,
        href: "/applications?momentum=follow_up",
      },
    ]);
  });

  it("summarizes weekly funnel activity from status history", () => {
    const summary = computeWeeklyFunnelSummary(
      [
        {
          status: "applied",
          applied_at: "2026-06-20T12:00:00Z",
          status_history: [{ status: "applied", at: "2026-06-20T12:00:00Z" }],
        },
        {
          status: "interviewing",
          applied_at: "2026-06-01T12:00:00Z",
          status_history: [
            { status: "applied", at: "2026-06-01T12:00:00Z" },
            { status: "oa", at: "2026-06-18T12:00:00Z" },
            { status: "interviewing", at: "2026-06-22T12:00:00Z" },
          ],
        },
        {
          status: "applied",
          applied_at: "2026-06-01T12:00:00Z",
          status_history: [{ status: "applied", at: "2026-06-01T12:00:00Z" }],
        },
      ],
      now,
    );

    expect(summary).toEqual({
      submittedThisWeek: 1,
      statusChangesThisWeek: 3,
      responsesThisWeek: 2,
      followUpDue: 1,
    });
  });
});
