import { describe, expect, it } from "vitest";
import {
  applicationResponseCount,
  buildSweJobsApplication,
  computeApplicationMetrics,
  formatApplicationDate,
  formatApplicationDateInput,
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
});
