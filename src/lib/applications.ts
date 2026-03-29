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
  return parsed.toLocaleDateString("sv-SE", {
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
