import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export const APPLICATION_STATUSES = [
  "applied",
  "oa",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type ApplicationRow = Tables<"applications">;
export type ApplicationInsert = TablesInsert<"applications">;
export type ApplicationUpdate = TablesUpdate<"applications">;

export type ApplicationSort =
  | "applied_desc"
  | "applied_asc"
  | "company_asc"
  | "company_desc"
  | "status"
  | "ats_desc"
  | "ats_asc";

export type ApplicationMetrics = {
  total: number;
  applied: number;
  oa: number;
  interviewing: number;
  offer: number;
  rejected: number;
  withdrawn: number;
  responseRate: number;
};

export type ApplicationMomentum = {
  awaitingResponse: number;
  followUpDue: number;
  activeThisWeek: number;
  archived: number;
};

export type ApplicationMomentumFilter = "all" | "awaiting" | "follow_up" | "active_week";

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: "Applied",
  oa: "Online Assessment",
  interviewing: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const STATUS_COLORS: Record<ApplicationStatus, string> = {
  applied: "bg-stone-600 text-stone-100",
  oa: "bg-amber-800/80 text-amber-200",
  interviewing: "bg-blue-800/80 text-blue-200",
  offer: "bg-emerald-800/80 text-emerald-200",
  rejected: "bg-red-900/80 text-red-200",
  withdrawn: "bg-zinc-700 text-zinc-300",
};

const RESPONSE_STATUSES = new Set<ApplicationStatus>(["oa", "interviewing", "offer"]);
const ARCHIVED_STATUSES = new Set<ApplicationStatus>(["rejected", "withdrawn"]);
const DAY_MS = 86_400_000;

export function computeApplicationMetrics(applications: Array<{ status: string }>): ApplicationMetrics {
  const base: ApplicationMetrics = {
    total: applications.length,
    applied: 0,
    oa: 0,
    interviewing: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
    responseRate: 0,
  };

  for (const application of applications) {
    const status = application.status as ApplicationStatus;
    if (status in base) {
      base[status] += 1;
    }
  }

  const responseCount = applications.reduce((sum, application) => {
    const status = application.status as ApplicationStatus;
    return RESPONSE_STATUSES.has(status) ? sum + 1 : sum;
  }, 0);

  base.responseRate = base.total > 0 ? Math.round((responseCount / base.total) * 100) : 0;
  return base;
}

export function formatApplicationDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString("en-SE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatApplicationDateInput(value: string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  return value.slice(0, 10);
}

export function applicationResponseCount(applications: Array<{ status: string }>): number {
  return applications.reduce((sum, application) => {
    const status = application.status as ApplicationStatus;
    return RESPONSE_STATUSES.has(status) ? sum + 1 : sum;
  }, 0);
}

function ageInDays(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / DAY_MS));
}

export function isArchivedApplication(application: { status: string }): boolean {
  return ARCHIVED_STATUSES.has(application.status as ApplicationStatus);
}

export function matchesApplicationMomentum(
  application: {
    status: string;
    applied_at?: string | null;
    updated_at?: string | null;
  },
  filter: ApplicationMomentumFilter,
  now = new Date(),
): boolean {
  if (filter === "all") return true;
  if (filter === "awaiting") return application.status === "applied";
  if (filter === "follow_up") {
    const age = ageInDays(application.applied_at, now);
    return application.status === "applied" && age != null && age > 10;
  }
  if (isArchivedApplication(application)) return false;
  const activityAge = ageInDays(application.updated_at ?? application.applied_at, now);
  return activityAge != null && activityAge <= 7;
}

export function computeApplicationMomentum(
  applications: Array<{
    status: string;
    applied_at?: string | null;
    updated_at?: string | null;
  }>,
  now = new Date(),
): ApplicationMomentum {
  return applications.reduce<ApplicationMomentum>(
    (momentum, application) => {
      if (isArchivedApplication(application)) momentum.archived += 1;
      if (matchesApplicationMomentum(application, "awaiting", now)) momentum.awaitingResponse += 1;
      if (matchesApplicationMomentum(application, "follow_up", now)) momentum.followUpDue += 1;
      if (matchesApplicationMomentum(application, "active_week", now)) momentum.activeThisWeek += 1;
      return momentum;
    },
    { awaitingResponse: 0, followUpDue: 0, activeThisWeek: 0, archived: 0 },
  );
}

export function sweJobsApplicationRequestId(userId: string, jobId: number) {
  return `swejobs-${userId}-${jobId}`;
}

export function buildSweJobsApplication(values: {
  userId: string;
  jobId: number;
  company: string;
  jobTitle: string;
  jobUrl?: string | null;
}): ApplicationInsert {
  return {
    user_id: values.userId,
    job_id: values.jobId,
    company: values.company,
    job_title: values.jobTitle,
    status: "applied",
    job_url: values.jobUrl ?? "",
    source: "swejobs",
    request_id: sweJobsApplicationRequestId(values.userId, values.jobId),
  };
}
