import { describe, expect, it } from "vitest";
import {
  applicationResponseCount,
  buildSweJobsApplication,
  computeApplicationMomentum,
  computeApplicationMetrics,
  formatApplicationDate,
  formatApplicationDateInput,
  isArchivedApplication,
  matchesApplicationMomentum,
  sweJobsApplicationRequestId,
} from "@/lib/applications";

describe("applications helpers", () => {
  it("computes metrics and response rate", () => {
    const metrics = computeApplicationMetrics([
      { status: "applied" },
      { status: "oa" },
      { status: "interviewing" },
      { status: "rejected" },
    ]);
    expect(metrics.total).toBe(4);
    expect(metrics.oa).toBe(1);
    expect(metrics.interviewing).toBe(1);
    expect(metrics.responseRate).toBe(50);
  });

  it("counts response statuses", () => {
    const count = applicationResponseCount([
      { status: "applied" },
      { status: "offer" },
      { status: "withdrawn" },
      { status: "oa" },
    ]);
    expect(count).toBe(2);
  });

  it("builds deterministic SweJobs request ids and payload", () => {
    const requestId = sweJobsApplicationRequestId("user-1", 42);
    expect(requestId).toBe("swejobs-user-1-42");

    const payload = buildSweJobsApplication({
      userId: "user-1",
      jobId: 42,
      company: "UBS",
      jobTitle: "Software Engineer",
      jobUrl: "https://jobs.ubs.com/role/42",
    });
    expect(payload.request_id).toBe(requestId);
    expect(payload.status).toBe("applied");
    expect(payload.source).toBe("swejobs");
  });

  it("formats dates safely", () => {
    expect(formatApplicationDate("2026-03-29T09:00:00Z")).toMatch(/2026/);
    expect(formatApplicationDate("bad-date")).toBe("Unknown");
    expect(formatApplicationDateInput("2026-03-29T09:00:00Z")).toBe("2026-03-29");
    expect(formatApplicationDateInput(null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("computes actionable momentum and keeps terminal statuses archived", () => {
    const now = new Date("2026-06-21T12:00:00Z");
    const applications = [
      { status: "applied", applied_at: "2026-06-05T12:00:00Z", updated_at: "2026-06-05T12:00:00Z", status_history: [{ status: "applied", at: "2026-06-05T12:00:00Z" }] },
      { status: "applied", applied_at: "2026-06-19T12:00:00Z", updated_at: "2026-06-19T12:00:00Z", status_history: [{ status: "applied", at: "2026-06-19T12:00:00Z" }] },
      { status: "interviewing", applied_at: "2026-06-01T12:00:00Z", updated_at: "2026-06-20T12:00:00Z", status_history: [{ status: "applied", at: "2026-06-01T12:00:00Z" }, { status: "interviewing", at: "2026-06-20T12:00:00Z" }] },
      { status: "rejected", applied_at: "2026-06-18T12:00:00Z", updated_at: "2026-06-20T12:00:00Z", status_history: [{ status: "applied", at: "2026-06-18T12:00:00Z" }, { status: "rejected", at: "2026-06-20T12:00:00Z" }] },
    ];

    expect(computeApplicationMomentum(applications, now)).toEqual({
      awaitingResponse: 2,
      followUpDue: 1,
      activeThisWeek: 2,
      archived: 1,
    });
    expect(matchesApplicationMomentum(applications[0], "follow_up", now)).toBe(true);
    expect(matchesApplicationMomentum(applications[2], "active_week", now)).toBe(true);
    expect(isArchivedApplication(applications[3])).toBe(true);
  });
});
