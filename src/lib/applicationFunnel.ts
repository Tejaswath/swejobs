import type { Json } from "@/integrations/supabase/types";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/applications";

export type StatusTimelineEntry = { status: ApplicationStatus; at: string };

export type ApplicationFunnelRow = {
  id?: string;
  company?: string | null;
  job_title?: string | null;
  status: string;
  applied_at?: string | null;
  updated_at?: string | null;
  status_history?: Json | null;
};

export type WeeklyFunnelSummary = {
  submittedThisWeek: number;
  statusChangesThisWeek: number;
  responsesThisWeek: number;
  followUpDue: number;
};

export type FollowUpNudge = {
  id: string;
  company: string;
  jobTitle: string;
  daysInStatus: number;
  href: string;
};

const RESPONSE_STATUSES = new Set<ApplicationStatus>(["oa", "interviewing", "offer"]);
const DAY_MS = 86_400_000;
const FOLLOW_UP_DAYS = 14;
const WEEK_MS = 7 * DAY_MS;

export function parseApplicationStatusHistory(value: Json | null | undefined): StatusTimelineEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const status = record.status;
      const at = record.at;
      if (typeof status !== "string" || typeof at !== "string") return null;
      if (!APPLICATION_STATUSES.includes(status as ApplicationStatus)) return null;
      return { status: status as ApplicationStatus, at };
    })
    .filter((entry): entry is StatusTimelineEntry => Boolean(entry));
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function currentStatusSince(
  application: Pick<ApplicationFunnelRow, "status" | "applied_at" | "status_history">,
): string | null {
  const timeline = parseApplicationStatusHistory(application.status_history);
  const last = timeline[timeline.length - 1];
  if (last) return last.at;
  return application.applied_at ?? null;
}

export function daysInCurrentStatus(
  application: Pick<ApplicationFunnelRow, "status" | "applied_at" | "status_history">,
  now = new Date(),
): number | null {
  const since = currentStatusSince(application);
  const timestamp = parseTimestamp(since);
  if (timestamp == null) return null;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / DAY_MS));
}

export function needsFollowUp(
  application: Pick<ApplicationFunnelRow, "status" | "applied_at" | "status_history">,
  now = new Date(),
  thresholdDays = FOLLOW_UP_DAYS,
): boolean {
  if (application.status !== "applied") return false;
  const days = daysInCurrentStatus(application, now);
  return days != null && days >= thresholdDays;
}

function transitionsInWindow(
  application: ApplicationFunnelRow,
  windowStartMs: number,
  now: Date,
): StatusTimelineEntry[] {
  const timeline = parseApplicationStatusHistory(application.status_history);
  const nowMs = now.getTime();
  return timeline.filter((entry) => {
    const at = parseTimestamp(entry.at);
    return at != null && at >= windowStartMs && at <= nowMs;
  });
}

export function computeWeeklyFunnelSummary(
  applications: ApplicationFunnelRow[],
  now = new Date(),
): WeeklyFunnelSummary {
  const windowStartMs = now.getTime() - WEEK_MS;
  let submittedThisWeek = 0;
  let statusChangesThisWeek = 0;
  let responsesThisWeek = 0;
  let followUpDue = 0;

  for (const application of applications) {
    const transitions = transitionsInWindow(application, windowStartMs, now);
    statusChangesThisWeek += transitions.length;

    const appliedAt = parseTimestamp(application.applied_at);
    if (appliedAt != null && appliedAt >= windowStartMs) {
      submittedThisWeek += 1;
    }

    for (const entry of transitions) {
      if (RESPONSE_STATUSES.has(entry.status)) {
        responsesThisWeek += 1;
      }
    }

    if (needsFollowUp(application, now)) {
      followUpDue += 1;
    }
  }

  return {
    submittedThisWeek,
    statusChangesThisWeek,
    responsesThisWeek,
    followUpDue,
  };
}

export function listFollowUpNudges(
  applications: ApplicationFunnelRow[],
  now = new Date(),
  limit = 3,
): FollowUpNudge[] {
  return applications
    .filter((application) => needsFollowUp(application, now))
    .map((application) => ({
      id: application.id ?? `${application.company}-${application.job_title}`,
      company: application.company?.trim() || "Company",
      jobTitle: application.job_title?.trim() || "Role",
      daysInStatus: daysInCurrentStatus(application, now) ?? FOLLOW_UP_DAYS,
      href: "/applications?momentum=follow_up",
    }))
    .sort((left, right) => right.daysInStatus - left.daysInStatus)
    .slice(0, limit);
}
