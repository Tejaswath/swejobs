import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bookmark, Bell, FileText, Zap, ArrowRight, ExternalLink } from "lucide-react";

import { AppLayout } from "@/components/AppLayout";
import { OverviewHeroPanel } from "@/components/overview/OverviewHeroPanel";
import { FadeUp, AnimatedNumber, StaggerContainer } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useInAppAlerts } from "@/hooks/useInAppAlerts";
import { useDelayedVisibility } from "@/hooks/useDelayedVisibility";
import { cn } from "@/lib/utils";
import { jobPassesLens } from "@/lib/jobEligibility";
import { computeWeeklyFunnelSummary, listFollowUpNudges } from "@/lib/applicationFunnel";

import type { OverviewSignalStripItem } from "@/components/overview/types";

type UpcomingDeadlineJob = {
  id: number;
  headline: string | null;
  employer_name: string | null;
  company_canonical: string | null;
  application_deadline: string | null;
};

type DeadlineGroups = {
  today: UpcomingDeadlineJob[];
  thisWeek: UpcomingDeadlineJob[];
  later: UpcomingDeadlineJob[];
};

type RecentActivityItem = {
  id: string;
  at: string;
  kind: "saved" | "application" | "captured";
  company: string;
  role?: string;
  href?: string;
};

type RecentCapturedApplication = {
  id: string;
  company: string;
  job_title: string;
  created_at: string;
};

type PipelineStatus = "applied" | "oa" | "interviewing" | "offer" | "rejected";

const OVERVIEW_LAST_VISIT_KEY = "swejobs.overview.last-visit.v1";
const VALUE_PROP_LINE = "Find the few roles worth your time, see your fit, apply, track.";

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDeadlineDate(deadlineDate: string | null): Date | null {
  if (!deadlineDate) return null;
  const parsed = new Date(`${deadlineDate}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function endOfCurrentWeek(date: Date): Date {
  const dayIndexMondayZero = (date.getDay() + 6) % 7;
  const end = startOfLocalDay(date);
  end.setDate(end.getDate() + (6 - dayIndexMondayZero));
  return end;
}

function deadlineBucket(deadlineDate: string | null): keyof DeadlineGroups {
  const parsed = parseDeadlineDate(deadlineDate);
  if (!parsed) return "later";

  const today = startOfLocalDay(new Date());
  if (isSameLocalDay(parsed, today)) return "today";

  const weekEnd = endOfCurrentWeek(today);
  if (parsed <= weekEnd) return "thisWeek";
  return "later";
}

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const deltaMs = Date.now() - timestamp;
  const minutes = Math.max(1, Math.floor(deltaMs / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function Index() {
  const { user } = useAuth();
  const { alerts: inAppAlerts, unreadCount: unreadAlertCount, markAlertRead } = useInAppAlerts(user?.id);
  const [previousVisitIso, setPreviousVisitIso] = useState<string | null>(null);

  useEffect(() => {
    document.title = "SweJobs — Swedish Tech Job Tracker";
  }, []);

  useEffect(() => {
    const previous = localStorage.getItem(OVERVIEW_LAST_VISIT_KEY);
    setPreviousVisitIso(previous);
    localStorage.setItem(OVERVIEW_LAST_VISIT_KEY, new Date().toISOString());
  }, []);

  const jobCountQuery = useQuery({
    queryKey: ["job-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("is_target_role", true)
        .eq("is_noise", false)
        .eq("swedish_required", false)
        .eq("citizenship_required", false)
        .eq("security_clearance_required", false);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const highSignalSnapshotQuery = useQuery({
    queryKey: ["overview-high-signal-snapshot"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "is_active,is_target_role,is_noise,relevance_score,headline,career_stage,career_stage_confidence," +
            "years_required_min,swedish_required,citizenship_required,security_clearance_required,reason_codes," +
            "source_kind,source_feed_key,published_at,source_feed_registry(enabled,high_signal_eligible,quality_band)",
        )
        .eq("is_active", true)
        .limit(300);
      if (error) throw error;
      const weekAgo = Date.now() - 7 * 86_400_000;
      const rows = (data ?? []).filter((job) =>
        jobPassesLens(
          job,
          "high_signal",
          (
            job as {
              source_feed_registry?: { enabled?: unknown; high_signal_eligible?: unknown; quality_band?: unknown } | null;
            }
          ).source_feed_registry,
          false,
        ),
      );
      return {
        total: rows.length,
        newThisWeek: rows.filter((job) => Date.parse(String(job.published_at || "")) >= weekAgo).length,
      };
    },
  });

  const upcomingDeadlinesQuery = useQuery({
    queryKey: ["upcoming-deadlines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, headline, employer_name, company_canonical, application_deadline")
        .eq("is_active", true)
        .eq("is_target_role", true)
        .eq("is_noise", false)
        .eq("swedish_required", false)
        .eq("citizenship_required", false)
        .eq("security_clearance_required", false)
        .not("application_deadline", "is", null)
        .gte("application_deadline", new Date().toISOString().slice(0, 10))
        .order("application_deadline", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: number;
        headline: string | null;
        employer_name: string | null;
        company_canonical: string | null;
        application_deadline: string | null;
      }>;
    },
  });

  const watchedCompanyDataQuery = useQuery({
    queryKey: ["watched-overview", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: watched, error: watchedError } = await supabase
        .from("watched_companies")
        .select("employer_name")
        .eq("user_id", user!.id);
      if (watchedError) throw watchedError;
      if (!watched || watched.length === 0) return [];

      const employerNames = Array.from(new Set(watched.map((item) => item.employer_name)));
      const { data: activeJobs, error: jobsError } = await supabase
        .from("jobs")
        .select("employer_name")
        .in("employer_name", employerNames)
        .eq("is_active", true)
        .eq("is_noise", false)
        .eq("swedish_required", false)
        .eq("citizenship_required", false)
        .eq("security_clearance_required", false);
      if (jobsError) throw jobsError;

      const counts = new Map<string, number>();
      for (const row of activeJobs ?? []) {
        const employerName = row.employer_name;
        if (!employerName) continue;
        counts.set(employerName, (counts.get(employerName) ?? 0) + 1);
      }

      return employerNames.map((name) => ({ name, count: counts.get(name) ?? 0 }));
    },
  });

  const newRolesSinceLastVisitQuery = useQuery({
    queryKey: ["overview-new-roles-since-last-visit", previousVisitIso],
    enabled: !!previousVisitIso,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("is_target_role", true)
        .eq("is_noise", false)
        .eq("swedish_required", false)
        .eq("citizenship_required", false)
        .eq("security_clearance_required", false)
        .gt("published_at", previousVisitIso!);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const recentActivityQuery = useQuery({
    queryKey: ["overview-recent-activity", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [trackedResult, applicationsResult] = await Promise.all([
        supabase
          .from("tracked_jobs")
          .select("id, job_id, status, updated_at, jobs(headline, employer_name)")
          .eq("user_id", user!.id)
          .order("updated_at", { ascending: false })
          .limit(5),
        supabase
          .from("applications")
          .select("id, status, updated_at, company, job_title")
          .eq("user_id", user!.id)
          .order("updated_at", { ascending: false })
          .limit(5),
      ]);

      if (trackedResult.error) throw trackedResult.error;
      if (applicationsResult.error) throw applicationsResult.error;

      const trackedItems: RecentActivityItem[] = (trackedResult.data ?? []).map((item) => {
        const job = item.jobs as { headline?: string | null; employer_name?: string | null } | null;
        return {
          id: `tracked-${item.id}`,
          at: item.updated_at ?? "",
          kind: "saved",
          company: job?.employer_name ?? "Company",
          role: job?.headline ?? `Job #${item.id}`,
          href: item.job_id ? `/jobs/${item.job_id}` : "/jobs",
        };
      });

      const applicationItems: RecentActivityItem[] = (applicationsResult.data ?? []).map((item) => ({
        id: `application-${item.id}`,
        at: item.updated_at ?? "",
        kind: "application",
        company: item.company || "Company",
        role: item.job_title || "Role",
        href: "/applications",
      }));

      return [...trackedItems, ...applicationItems]
        .sort((left, right) => right.at.localeCompare(left.at))
        .slice(0, 5);
    },
  });

  const recentCapturedQuery = useQuery({
    queryKey: ["overview-recent-captured", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id, company, job_title, created_at")
        .eq("user_id", user!.id)
        .eq("source", "extension")
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) throw error;
      return (data ?? []) as RecentCapturedApplication[];
    },
  });

  const pipelineQuery = useQuery({
    queryKey: ["overview-pipeline", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("status")
        .eq("user_id", user!.id);
      if (error) throw error;

      const counts: Record<PipelineStatus, number> = {
        applied: 0,
        oa: 0,
        interviewing: 0,
        offer: 0,
        rejected: 0,
      };

      for (const row of data ?? []) {
        const status = row.status as PipelineStatus;
        if (status in counts) {
          counts[status] += 1;
        }
      }

      return counts;
    },
  });

  const groupedDeadlines = useMemo<DeadlineGroups>(() => {
    const groups: DeadlineGroups = {
      today: [],
      thisWeek: [],
      later: [],
    };

    for (const job of upcomingDeadlinesQuery.data ?? []) {
      groups[deadlineBucket(job.application_deadline)].push(job);
    }

    return groups;
  }, [upcomingDeadlinesQuery.data]);

  const watchlistHighlights = useMemo(
    () => [...(watchedCompanyDataQuery.data ?? [])].sort((left, right) => right.count - left.count),
    [watchedCompanyDataQuery.data],
  );
  const mergedRecentItems = useMemo(() => {
    const activityItems = recentActivityQuery.data ?? [];
    const capturedApplications = recentCapturedQuery.data ?? [];
    const capturedItems: RecentActivityItem[] = capturedApplications.map((item) => ({
      id: `captured-${item.id}`,
      at: item.created_at,
      kind: "captured",
      company: item.company || "Company",
      role: item.job_title || "Role",
      href: "/applications",
    }));
    const seen = new Set<string>();
    return [...activityItems, ...capturedItems]
      .sort((left, right) => right.at.localeCompare(left.at))
      .filter((item) => {
        const key = `${item.company}::${item.role ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3);
  }, [recentActivityQuery.data, recentCapturedQuery.data]);
  const funnelApplicationsQuery = useQuery({
    queryKey: ["overview-funnel-applications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id, company, job_title, status, applied_at, updated_at, status_history")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const weeklyFunnelSummary = useMemo(
    () => computeWeeklyFunnelSummary(funnelApplicationsQuery.data ?? []),
    [funnelApplicationsQuery.data],
  );
  const followUpNudges = useMemo(
    () => listFollowUpNudges(funnelApplicationsQuery.data ?? []),
    [funnelApplicationsQuery.data],
  );
  const topFollowUpNudge = followUpNudges[0] ?? null;

  const pipelineAppliedCount = pipelineQuery.data?.applied ?? 0;
  const pipelineInterviewCount = pipelineQuery.data?.interviewing ?? 0;
  const pipelineOfferCount = pipelineQuery.data?.offer ?? 0;

  const todaysMove = useMemo(() => {
    const urgent =
      groupedDeadlines.today[0] ??
      groupedDeadlines.thisWeek[0] ??
      null;
    if (!urgent) return null;
    const employer = urgent.company_canonical || urgent.employer_name || "Company";
    return {
      id: urgent.id,
      headline: urgent.headline || "Open role",
      employer,
      deadline: urgent.application_deadline,
      href: `/jobs/${urgent.id}`,
    };
  }, [groupedDeadlines]);

  const topUnreadAlerts = useMemo(
    () => inAppAlerts.filter((alert) => !alert.read_at).slice(0, 3),
    [inAppAlerts],
  );

  const signalItems: OverviewSignalStripItem[] = [
    {
      label: "Due today",
      rawValue: groupedDeadlines.today.length,
      value: <AnimatedNumber value={groupedDeadlines.today.length} />,
      href: "/jobs?deadline=today",
      accentClassName: groupedDeadlines.today.length > 0 ? "text-rose-200" : "text-foreground",
      tone: "due",
      pulse: groupedDeadlines.today.length > 0,
    },
    {
      label: "High signal",
      rawValue: highSignalSnapshotQuery.data?.total ?? 0,
      value: <AnimatedNumber value={highSignalSnapshotQuery.data?.total ?? 0} />,
      href: "/jobs?lens=high_signal",
      accentClassName: "text-foreground",
      tone: "live",
    },
    {
      label: "Alerts",
      rawValue: unreadAlertCount,
      value: <AnimatedNumber value={unreadAlertCount} />,
      href: "/searches",
      accentClassName: unreadAlertCount > 0 ? "text-amber-200" : "text-foreground",
      tone: unreadAlertCount > 0 ? "due" : "neutral",
      pulse: unreadAlertCount > 0,
    },
    {
      label: "Follow-ups due",
      rawValue: weeklyFunnelSummary.followUpDue,
      value: <AnimatedNumber value={weeklyFunnelSummary.followUpDue} />,
      href: "/applications?momentum=follow_up",
      accentClassName: weeklyFunnelSummary.followUpDue > 0 ? "text-amber-200" : "text-foreground",
      tone: weeklyFunnelSummary.followUpDue > 0 ? "due" : "neutral",
      pulse: weeklyFunnelSummary.followUpDue > 0,
    },
    {
      label: "Awaiting response",
      rawValue: pipelineAppliedCount,
      value: <AnimatedNumber value={pipelineAppliedCount} />,
      href: "/applications?momentum=awaiting",
      accentClassName: pipelineAppliedCount > 0 ? "text-sky-200" : "text-foreground",
    },
  ];
  const visibleSignalItems = signalItems.filter((item) => item.rawValue > 0);

  const isReturningUser = !!user && ((recentActivityQuery.data?.length ?? 0) > 0 || watchlistHighlights.length > 0);
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? "Good morning" : currentHour < 18 ? "Good afternoon" : "Good evening";
  const heroHeadline = !user
    ? "Find your next role in Sweden."
    : isReturningUser
      ? `${greeting}.`
      : "Welcome.";
  const heroSubtext = !user
    ? jobCountQuery.isLoading
      ? undefined
      : jobCountQuery.isError
        ? "Live role counts are temporarily unavailable."
        : `${(jobCountQuery.data ?? 0).toLocaleString()} active ${
            (jobCountQuery.data ?? 0) === 1 ? "role" : "roles"
          } from connected sources.`
    : (() => {
        const newRoles = newRolesSinceLastVisitQuery.data ?? 0;
        if (newRoles > 0) {
          return `${newRoles} new ${newRoles === 1 ? "role" : "roles"} since your last visit · ${VALUE_PROP_LINE}`;
        }
        return VALUE_PROP_LINE;
      })();

  const hasFocalAction = !!(user && (todaysMove || topFollowUpNudge));
  const primaryActionClassName =
    "h-9 shrink-0 rounded-xl bg-gradient-to-r from-primary to-primary/80 px-4 text-sm shadow-lg shadow-primary/20 hover:shadow-primary/30";

  const showHeroSignalsLoading = useDelayedVisibility(
    highSignalSnapshotQuery.isLoading || upcomingDeadlinesQuery.isLoading,
  );
  const heroSignalsUnavailable = highSignalSnapshotQuery.isError || upcomingDeadlinesQuery.isError;

  if (!jobCountQuery.isLoading && !jobCountQuery.isError && (jobCountQuery.data ?? 0) === 0) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Card className="w-full max-w-2xl rounded-[30px] border-border/60 bg-card/80">
            <CardContent className="p-8 text-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Overview</p>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">Waiting for market data</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Once the pipeline is connected, this page will show live roles, urgent deadlines, and your recent activity.
              </p>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-95"
          style={{
            background:
              "radial-gradient(circle at 12% 10%, rgba(88, 128, 255, 0.22), transparent 26%), radial-gradient(circle at 84% 12%, rgba(56, 189, 248, 0.12), transparent 22%), linear-gradient(180deg, rgba(17, 24, 39, 0.12), transparent 70%)",
          }}
        />

        <StaggerContainer className="relative space-y-4">
          <FadeUp>
            <OverviewHeroPanel
              signalItems={visibleSignalItems}
              headline={heroHeadline}
              subtext={heroSubtext}
              primaryActionLabel="Explore roles"
              primaryActionHref="/jobs"
              primaryActionVariant={hasFocalAction ? "outline" : "default"}
              secondaryAction={!user ? { label: "Sign up free", href: "/auth" } : null}
              isSignalsLoading={showHeroSignalsLoading}
              signalsUnavailable={heroSignalsUnavailable}
              isSubtextLoading={!user && jobCountQuery.isLoading}
            />
          </FadeUp>

          {user && topFollowUpNudge && !todaysMove ? (
            <FadeUp>
              <Card className="rounded-[24px] border-amber-500/20 bg-gradient-to-br from-amber-500/[0.08] via-card/80 to-card/80">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="min-w-0 space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-200/90">Follow-up nudge</p>
                    <p className="line-clamp-1 text-sm font-medium text-foreground">
                      {topFollowUpNudge.company} · {topFollowUpNudge.jobTitle}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Applied {topFollowUpNudge.daysInStatus} days ago with no status change
                    </p>
                  </div>
                  <Button asChild size="sm" className={primaryActionClassName}>
                    <Link to={topFollowUpNudge.href}>
                      Review application
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </FadeUp>
          ) : null}

          {user && todaysMove ? (
            <FadeUp>
              <Card className="rounded-[24px] border-rose-500/20 bg-gradient-to-br from-rose-500/[0.08] via-card/80 to-card/80">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="min-w-0 space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-rose-200/90">Your move today</p>
                    <p className="line-clamp-1 text-sm font-medium text-foreground">
                      {todaysMove.employer} · {todaysMove.headline}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Application deadline {todaysMove.deadline ? new Date(`${todaysMove.deadline}T00:00:00`).toLocaleDateString("en-SE", { month: "short", day: "numeric" }) : "soon"}
                    </p>
                  </div>
                  <Button asChild size="sm" className={primaryActionClassName}>
                    <Link to={todaysMove.href}>
                      Review role
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </FadeUp>
          ) : null}

          {user && (pipelineAppliedCount > 0 || pipelineInterviewCount > 0 || pipelineOfferCount > 0) ? (
            <FadeUp>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "applied", label: "Applied", count: pipelineAppliedCount, href: "/applications?status=applied", color: "border-primary/30 bg-primary/10" },
                  { key: "interviewing", label: "Interviewing", count: pipelineInterviewCount, href: "/applications?status=interviewing", color: "border-sky-500/30 bg-sky-500/10" },
                  { key: "offer", label: "Offers", count: pipelineOfferCount, href: "/applications?status=offer", color: "border-emerald-500/30 bg-emerald-500/10" },
                ]
                  .filter((stage) => stage.count > 0)
                  .map((stage) => (
                    <Link
                      key={stage.key}
                      to={stage.href}
                      className={cn(
                        "flex min-w-[7.5rem] flex-1 items-center justify-between rounded-2xl border px-4 py-3 transition-colors hover:border-primary/40",
                        stage.color,
                      )}
                    >
                      <span className="text-xs text-muted-foreground">{stage.label}</span>
                      <span className="text-lg font-semibold text-foreground">{stage.count}</span>
                    </Link>
                  ))}
              </div>
            </FadeUp>
          ) : null}

          {user && topUnreadAlerts.length > 0 ? (
            <FadeUp>
              <Card className="rounded-[24px] border-amber-500/20 bg-card/80">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      <Bell className="h-3 w-3" />
                      Saved-search alerts
                    </p>
                    <Link to="/searches" className="text-xs text-muted-foreground hover:text-foreground">
                      View all
                    </Link>
                  </div>
                  <div className="mt-3 space-y-2">
                    {topUnreadAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/30 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="line-clamp-1 text-sm font-medium text-foreground">{alert.title}</p>
                          <p className="line-clamp-1 text-xs text-muted-foreground">{alert.body}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {alert.jobs?.source_url ? (
                            <a href={alert.jobs.source_url} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]">
                                <ExternalLink className="h-3 w-3" /> Open
                              </Button>
                            </a>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => markAlertRead.mutate(alert.id)}
                          >
                            Mark read
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </FadeUp>
          ) : null}

          {user ? (
            <FadeUp>
              <Card className="rounded-[24px] border-border/60 bg-card/80">
                <CardContent className="p-5">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    <Zap className="h-3 w-3" />
                    Recent
                  </p>
                  {mergedRecentItems.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">Save roles, apply, or capture jobs to see activity here.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {mergedRecentItems.map((item) => {
                        const ItemIcon = item.kind === "application" || item.kind === "captured" ? FileText : Bookmark;
                        return (
                          <Link
                            key={item.id}
                            to={item.href ?? "/"}
                            className={cn(
                              "flex items-center justify-between gap-3 rounded-lg border border-border/50 border-l-2 bg-background/30 px-3 py-2 transition-colors hover:border-primary/30 hover:bg-muted/30",
                              item.kind === "saved" && "border-l-primary/60",
                              item.kind === "application" && "border-l-emerald-500/60",
                              item.kind === "captured" && "border-l-sky-500/60",
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <ItemIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <p className="line-clamp-1 text-sm text-foreground">
                                {item.company}
                                {item.role ? ` · ${item.role}` : ""}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-xs text-muted-foreground">{relativeTime(item.at)}</span>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </FadeUp>
          ) : null}
        </StaggerContainer>
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-background to-transparent" />
      </div>
    </AppLayout>
  );
}
