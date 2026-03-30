import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bookmark, ChevronDown, ChevronUp, FileText } from "lucide-react";

import { AppLayout } from "@/components/AppLayout";
import { OverviewHeroPanel } from "@/components/overview/OverviewHeroPanel";
import { DeadlineRadarPanel } from "@/components/overview/DeadlineRadarPanel";
import { FadeUp, AnimatedNumber, StaggerContainer } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDelayedVisibility } from "@/hooks/useDelayedVisibility";
import { cn } from "@/lib/utils";

import type {
  DeadlineBucketViewModel,
  OverviewSignalStripItem,
} from "@/components/overview/types";

type UpcomingDeadlineJob = {
  id: number;
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
  kind: "shortlist" | "application";
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

const ONBOARDING_DISMISSED_KEY = "swejobs.overview.onboarding.dismissed.v1";
const OVERVIEW_LAST_VISIT_KEY = "swejobs.overview.last-visit.v1";

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

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  return new Date(timestamp).toLocaleString();
}

export default function Index() {
  const { user } = useAuth();
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [onboardingExpanded, setOnboardingExpanded] = useState(false);
  const [previousVisitIso, setPreviousVisitIso] = useState<string | null>(null);

  useEffect(() => {
    document.title = "SweJobs — Swedish Tech Job Tracker";
  }, []);

  useEffect(() => {
    if (!user) {
      setOnboardingDismissed(false);
      return;
    }
    setOnboardingDismissed(localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "true");
  }, [user]);

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
        .eq("is_target_role", true);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const newThisWeekQuery = useQuery({
    queryKey: ["new-this-week"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const weekAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { count, error } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("is_target_role", true)
        .gte("published_at", weekAgoIso);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const upcomingDeadlinesQuery = useQuery({
    queryKey: ["upcoming-deadlines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, application_deadline")
        .eq("is_active", true)
        .eq("is_target_role", true)
        .not("application_deadline", "is", null)
        .gte("application_deadline", new Date().toISOString().slice(0, 10))
        .order("application_deadline", { ascending: true });
      if (error) throw error;
      return (data ?? []) as UpcomingDeadlineJob[];
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
        .eq("is_active", true);
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
        .gt("published_at", previousVisitIso!);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const onboardingProgressQuery = useQuery({
    queryKey: ["onboarding-progress", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [resumeResult, skillResult, searchResult] = await Promise.all([
        supabase
          .from("resume_versions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .not("storage_path", "is", null),
        supabase
          .from("user_skills")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id),
        supabase
          .from("saved_searches")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id),
      ]);

      if (resumeResult.error) throw resumeResult.error;
      if (skillResult.error) throw skillResult.error;
      if (searchResult.error) throw searchResult.error;

      return {
        resumeCount: resumeResult.count ?? 0,
        skillCount: skillResult.count ?? 0,
        searchCount: searchResult.count ?? 0,
      };
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
          kind: "shortlist",
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
  const recentActivityItems = recentActivityQuery.data ?? [];
  const recentCapturedApplications = recentCapturedQuery.data ?? [];

  const deadlineBuckets: DeadlineBucketViewModel[] = [
    {
      id: "today",
      label: "Today",
      count: groupedDeadlines.today.length,
      href: "/jobs?deadline=today",
      accentClassName: "border-rose-500/30 bg-rose-500/[0.08] shadow-[inset_0_1px_0_rgba(244,63,94,0.12)]",
      badgeClassName: "border-rose-500/20 bg-rose-500/10 text-rose-100",
    },
    {
      id: "thisWeek",
      label: "This week",
      count: groupedDeadlines.thisWeek.length,
      href: "/jobs?deadline=week",
      accentClassName: "border-amber-500/20 bg-amber-500/5",
      badgeClassName: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    },
    {
      id: "later",
      label: "Later",
      count: groupedDeadlines.later.length,
      href: "/jobs?deadline=upcoming",
      accentClassName: "border-sky-500/15 bg-sky-500/[0.03]",
      badgeClassName: "border-sky-500/20 bg-sky-500/10 text-sky-100",
    },
  ].filter((bucket) => bucket.count > 0);

  const signalItems: OverviewSignalStripItem[] = [
    {
      label: "Live roles",
      value: <AnimatedNumber value={jobCountQuery.data ?? 0} />,
      href: "/jobs",
      accentClassName: "text-foreground",
      tone: "live",
    },
    {
      label: "Due today",
      value: <AnimatedNumber value={groupedDeadlines.today.length} />,
      href: "/jobs?deadline=today",
      accentClassName: groupedDeadlines.today.length > 0 ? "text-rose-200" : "text-foreground",
      tone: "due",
      pulse: groupedDeadlines.today.length > 0,
    },
    {
      label: "New this week",
      value: <AnimatedNumber value={newThisWeekQuery.data ?? 0} />,
      href: "/jobs",
      fullLabel: `${newThisWeekQuery.data ?? 0} roles posted in the last 7 days`,
    },
  ];

  const onboardingProgress = onboardingProgressQuery.data ?? {
    resumeCount: 0,
    skillCount: 0,
    searchCount: 0,
  };
  const onboardingTasks = [
    {
      id: "resume",
      done: onboardingProgress.resumeCount > 0,
      label: "Upload a resume",
      href: "/resumes",
    },
    {
      id: "watchlist",
      done: watchlistHighlights.length >= 3,
      label: "Watch 3 companies",
      href: "/jobs",
    },
    {
      id: "skills",
      done: onboardingProgress.skillCount > 0,
      label: "Add your skills",
      href: "/skills",
    },
    {
      id: "searches",
      done: onboardingProgress.searchCount > 0,
      label: "Save your first search",
      href: "/searches",
    },
  ];
  const onboardingRemaining = onboardingTasks.filter((task) => !task.done);
  const onboardingCompletionPct = Math.round(((onboardingTasks.length - onboardingRemaining.length) / onboardingTasks.length) * 100);
  const showOnboardingChecklist = !!user && !onboardingDismissed && onboardingRemaining.length > 0;

  useEffect(() => {
    if (!showOnboardingChecklist) {
      setOnboardingExpanded(false);
    }
  }, [showOnboardingChecklist]);

  const isReturningUser = !!user && (recentActivityItems.length > 0 || watchlistHighlights.length > 0);
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? "Good morning" : currentHour < 18 ? "Good afternoon" : "Good evening";
  const heroHeadline = !user
    ? "Find your next role in Sweden."
    : isReturningUser
      ? `${greeting}.`
      : "Welcome.";
  const heroSubtext = !user
    ? `${(jobCountQuery.data ?? 0).toLocaleString()} active roles from connected sources.`
    : isReturningUser
      ? (newRolesSinceLastVisitQuery.data ?? 0) > 0
        ? `${newRolesSinceLastVisitQuery.data} new roles since your last visit.`
        : undefined
      : undefined;

  const showHeroSignalsLoading = useDelayedVisibility(
    jobCountQuery.isLoading || newThisWeekQuery.isLoading || upcomingDeadlinesQuery.isLoading,
  );
  const showUpcomingDeadlineLoading = useDelayedVisibility(upcomingDeadlinesQuery.isLoading);
  const heroSignalsUnavailable = jobCountQuery.isError || upcomingDeadlinesQuery.isError || newThisWeekQuery.isError;

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

        <StaggerContainer className="relative space-y-6">
          <FadeUp>
            <OverviewHeroPanel
              signalItems={signalItems}
              headline={heroHeadline}
              subtext={heroSubtext}
              primaryActionLabel="Explore roles"
              primaryActionHref="/jobs"
              secondaryAction={!user ? { label: "Sign up free", href: "/auth" } : null}
              isSignalsLoading={showHeroSignalsLoading}
              signalsUnavailable={heroSignalsUnavailable}
            />
          </FadeUp>

          {showOnboardingChecklist ? (
            <FadeUp>
              <Card className="rounded-[24px] border-border/60 bg-card/80">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-3 rounded-2xl border border-border/60 bg-background/25 px-4 py-3 text-left transition-colors hover:border-primary/30"
                      onClick={() => setOnboardingExpanded((previous) => !previous)}
                    >
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background/60">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary via-primary to-emerald-500 transition-[width]"
                          style={{ width: `${onboardingCompletionPct}%` }}
                        />
                      </div>
                      <span className="animate-subtle-pulse shrink-0 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
                        {onboardingRemaining.length} steps left
                      </span>
                      {onboardingExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => {
                        localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true");
                        setOnboardingDismissed(true);
                      }}
                    >
                      Dismiss
                    </Button>
                  </div>
                  {onboardingExpanded ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {onboardingTasks.map((task) => (
                        <Link
                          key={task.id}
                          to={task.href}
                          className="flex items-center justify-between rounded-lg border border-border/50 bg-background/30 px-3 py-2 text-sm hover:border-primary/30"
                        >
                          <span>{task.label}</span>
                          <Badge variant={task.done ? "secondary" : "outline"} className="text-[10px]">
                            {task.done ? "Done" : "Start"}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </FadeUp>
          ) : null}

          {user ? (
            <FadeUp>
              <div className="rounded-2xl border border-border/50 bg-background/30 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Watched
                  </p>
                  {watchedCompanyDataQuery.isLoading ? (
                    <span className="text-xs text-muted-foreground">Loading…</span>
                  ) : watchlistHighlights.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No watched companies yet.</span>
                  ) : (
                    watchlistHighlights.slice(0, 5).map((company) => (
                      <Link
                        key={company.name}
                        to={`/jobs?search=${encodeURIComponent(company.name)}`}
                        className="rounded-full border border-border/50 bg-background/35 px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                      >
                        {company.name}
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </FadeUp>
          ) : null}

          <FadeUp>
            <DeadlineRadarPanel
              buckets={deadlineBuckets}
              isLoading={showUpcomingDeadlineLoading}
              unavailable={upcomingDeadlinesQuery.isError}
            />
          </FadeUp>

          <div className="border-t border-border/30 pt-6">
            <div className="grid gap-4 xl:grid-cols-2">
              {user ? (
                <FadeUp>
                  <Card className="rounded-[24px] border-border/60 bg-card/80">
                    <CardContent className="p-5">
                      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Recent activity</p>
                      {recentActivityItems.length === 0 ? (
                        <p className="mt-3 text-sm text-muted-foreground">No activity yet.</p>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {recentActivityItems.map((item) => {
                            const ItemIcon = item.kind === "application" ? FileText : Bookmark;
                            return (
                              <Link
                                key={item.id}
                                to={item.href ?? "/"}
                                className={cn(
                                  "flex items-center justify-between gap-3 rounded-lg border border-border/50 border-l-2 bg-background/30 px-3 py-2 transition-colors hover:bg-muted/30 hover:border-primary/30",
                                  item.kind === "shortlist" && "border-l-primary/60",
                                  item.kind === "application" && "border-l-emerald-500/60",
                                )}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <ItemIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  <p className="line-clamp-1 text-sm text-foreground">
                                    {item.company}
                                    {item.role ? ` · ${item.role}` : ""}
                                  </p>
                                </div>
                                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.at)}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </FadeUp>
              ) : null}

              {user ? (
                <FadeUp>
                  <Card className="rounded-[24px] border-border/60 bg-card/80">
                    <CardContent className="p-5">
                      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Recently captured</p>
                      {recentCapturedQuery.isLoading ? (
                        <p className="mt-3 text-sm text-muted-foreground">Loading captured jobs…</p>
                      ) : recentCapturedApplications.length === 0 ? (
                        <p className="mt-3 text-sm text-muted-foreground">
                          No captured jobs yet. Use the SweJobs extension to save jobs from external sites.
                        </p>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {recentCapturedApplications.map((item) => (
                            <Link
                              key={item.id}
                              to="/applications"
                              className="flex items-center justify-between gap-3 rounded-lg border border-border/50 border-l-2 border-l-sky-500/60 bg-background/30 px-3 py-2 transition-colors hover:bg-muted/30 hover:border-primary/30"
                            >
                              <div className="min-w-0">
                                <p className="line-clamp-1 text-sm text-foreground">
                                  {item.company || "Company"} · {item.job_title || "Role"}
                                </p>
                                <p className="text-xs text-muted-foreground">{formatDateTime(item.created_at)}</p>
                              </div>
                              <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.created_at)}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                      <div className="mt-3">
                        <Link to="/applications" className="text-xs text-primary hover:underline">
                          Open Applications
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                </FadeUp>
              ) : null}
            </div>
          </div>
        </StaggerContainer>
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-background to-transparent" />
      </div>
    </AppLayout>
  );
}
