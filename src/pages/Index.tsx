import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { pickLatestDigest, type DigestRow } from "@/lib/digest";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FadeUp, AnimatedNumber, StaggerContainer } from "@/components/motion";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Compass,
  CalendarClock,
  Kanban,
  TrendingUp,
  BookOpen,
  Building,
  BriefcaseBusiness,
  BellRing,
  Sparkles,
  GraduationCap,
  Target,
  Activity,
  X,
  type LucideIcon,
} from "lucide-react";

function WelcomeBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <FadeUp>
      <div className="relative overflow-hidden rounded-2xl border border-primary/15 bg-card/80 px-5 py-4">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(circle at left top, rgba(88, 128, 255, 0.2), transparent 30%), radial-gradient(circle at 75% 0%, rgba(56, 189, 248, 0.12), transparent 26%)",
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 z-10 h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="border border-primary/20 bg-primary/10 text-primary">
              Quick start
            </Badge>
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Run your search from one screen.</h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Track the market, spot deadlines, and move promising roles forward without digging through flat lists.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border/60 bg-background/60 px-3 py-1">Ranked matches</span>
              <span className="rounded-full border border-border/60 bg-background/60 px-3 py-1">Deadline radar</span>
              <span className="rounded-full border border-border/60 bg-background/60 px-3 py-1">Skill momentum</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/jobs">
                Explore jobs <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link to="/skills">
                Open skill gap <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </FadeUp>
  );
}

function OverviewPanelHeader({
  icon: Icon,
  label,
  actionLabel,
  to,
}: {
  icon: LucideIcon;
  label: string;
  actionLabel?: string;
  to?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </h2>
      {actionLabel && to && (
        <Button asChild variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link to={to}>
            {actionLabel} <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      )}
    </div>
  );
}

function MetricLinkCard({
  to,
  icon: Icon,
  label,
  value,
  helper,
  accentClassName,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  value: string;
  helper: string;
  accentClassName?: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-border/60 bg-background/55 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-background/80"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
          <p className={cn("text-2xl font-semibold tracking-tight", accentClassName)}>{value}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/70 p-2 text-muted-foreground transition-colors group-hover:text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{helper}</p>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
    </Link>
  );
}

type UpcomingDeadlineJob = {
  id: number;
  headline: string;
  employer_name: string | null;
  application_deadline: string | null;
};

type DeadlineGroups = {
  today: UpcomingDeadlineJob[];
  thisWeek: UpcomingDeadlineJob[];
  later: UpcomingDeadlineJob[];
};

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

function formatDeadline(deadlineDate: string | null, bucket: keyof DeadlineGroups): string {
  const parsed = parseDeadlineDate(deadlineDate);
  if (!parsed) return "—";
  if (bucket === "today") return "Today";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
}

export default function Index() {
  const { user } = useAuth();
  const REFRESH_MS = 60_000;
  const [showWelcome, setShowWelcome] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("swejobs-welcome-dismissed") !== "true";
    }
    return true;
  });

  useEffect(() => {
    document.title = "SweJobs — Swedish Tech Job Tracker";
  }, []);

  const dismissWelcome = () => {
    setShowWelcome(false);
    localStorage.setItem("swejobs-welcome-dismissed", "true");
  };

  const { data: jobCount } = useQuery({
    queryKey: ["job-count"],
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const { count } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("is_target_role", true);
      return count ?? 0;
    },
  });

  const { data: latestDigest } = useQuery({
    queryKey: ["latest-digest", "rolling_30d"],
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const { data } = await supabase
        .from("weekly_digests")
        .select("id, digest_json, period_start, period_end, generated_at")
        .order("generated_at", { ascending: false })
        .limit(100);
      return pickLatestDigest((data ?? []) as DigestRow[], "rolling_30d");
    },
  });

  const { data: trackedJobs } = useQuery({
    queryKey: ["tracked-summary", user?.id],
    enabled: !!user,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const { data } = await supabase
        .from("tracked_jobs")
        .select("status, job_id, jobs(headline, employer_name, application_deadline)")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const { data: upcomingDeadlines } = useQuery({
    queryKey: ["upcoming-deadlines"],
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id, headline, employer_name, application_deadline")
        .eq("is_active", true)
        .eq("is_target_role", true)
        .not("application_deadline", "is", null)
        .gte("application_deadline", new Date().toISOString().slice(0, 10))
        .order("application_deadline", { ascending: true })
        .limit(12);
      return (data ?? []) as UpcomingDeadlineJob[];
    },
  });

  const { data: watchedCompanyData } = useQuery({
    queryKey: ["watched-overview", user?.id],
    enabled: !!user,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const { data: watched } = await supabase
        .from("watched_companies")
        .select("employer_name")
        .eq("user_id", user!.id);
      if (!watched || watched.length === 0) return [];
      const names = watched.map((w) => w.employer_name);
      const results: Array<{ name: string; count: number }> = [];
      for (const name of names.slice(0, 5)) {
        const { count } = await supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("employer_name", name)
          .eq("is_active", true);
        results.push({ name, count: count ?? 0 });
      }
      return results;
    },
  });

  const digest = latestDigest?.digest_json as Record<string, unknown> | null;
  const topSkills = digest?.top_skills as Array<{ skill: string; count: number }> | undefined;
  const risingSkills = digest?.rising_skills as Array<{ skill: string; pct_change: number }> | undefined;

  // Only show rising skills if at least one has a real non-zero change
  const hasRealRising = risingSkills?.some((s) => isFinite(s.pct_change) && s.pct_change !== 0) ?? false;

  const trackedCounts = trackedJobs?.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) ?? {};

  const heroRising = hasRealRising ? risingSkills?.[0] : undefined;
  const heroJobCount = jobCount ?? 0;
  const demandHighlights = topSkills?.slice(0, 6) ?? [];
  const risingHighlights = (risingSkills ?? [])
    .filter((skill) => isFinite(skill.pct_change) && skill.pct_change !== 0)
    .slice(0, 4);
  const savedCount = trackedCounts.saved ?? 0;
  const appliedCount = trackedCounts.applied ?? 0;
  const interviewingCount = trackedCounts.interviewing ?? 0;
  const trackedTotal = Object.values(trackedCounts).reduce((sum, value) => sum + value, 0);
  const watchlistHighlights = watchedCompanyData?.slice(0, 4) ?? [];
  const watchlistOpenings = (watchedCompanyData ?? []).reduce((sum, company) => sum + company.count, 0);
  const groupedDeadlines = useMemo<DeadlineGroups>(() => {
    const groups: DeadlineGroups = {
      today: [],
      thisWeek: [],
      later: [],
    };

    for (const job of upcomingDeadlines ?? []) {
      groups[deadlineBucket(job.application_deadline)].push(job);
    }

    return groups;
  }, [upcomingDeadlines]);
  const priorityDeadlineCount = groupedDeadlines.today.length + groupedDeadlines.thisWeek.length;
  const primaryFocusSkill = heroRising?.skill ?? demandHighlights[0]?.skill ?? "software_engineering";
  const secondaryFocusSkill =
    demandHighlights.find((skill) => skill.skill !== primaryFocusSkill)?.skill ?? "backend";
  const focusQueue = Array.from(
    new Set([
      primaryFocusSkill,
      secondaryFocusSkill,
      ...risingHighlights.map((skill) => skill.skill),
      ...demandHighlights.map((skill) => skill.skill),
    ]),
  ).slice(0, 5);
  const risingBySkill = new Map(risingHighlights.map((skill) => [skill.skill, skill.pct_change]));
  const topSignalDelta = heroRising ? Math.round(heroRising.pct_change) : null;
  const studyFocusSkills = [
    ...demandHighlights.map((skill) => ({
      name: skill.skill,
      jobCount: skill.count,
      weeklyDelta: risingBySkill.get(skill.skill),
    })),
    ...risingHighlights
      .filter((skill) => !demandHighlights.some((item) => item.skill === skill.skill))
      .map((skill) => ({
        name: skill.skill,
        jobCount: 0,
        weeklyDelta: skill.pct_change,
      })),
  ].slice(0, 8);
  const deadlinePanels = [
    {
      key: "today" as const,
      label: "Today",
      hint: "Needs attention",
      emptyLabel: "No deadlines today.",
      items: groupedDeadlines.today.slice(0, 2),
      panelClass: "border-rose-500/20 bg-rose-500/5",
      labelClass: "text-rose-200",
      badgeClass: "border-rose-500/20 bg-rose-500/10 text-rose-200",
    },
    {
      key: "thisWeek" as const,
      label: "This week",
      hint: "Worth planning",
      emptyLabel: "No urgent closers.",
      items: groupedDeadlines.thisWeek.slice(0, 3),
      panelClass: "border-amber-500/20 bg-amber-500/5",
      labelClass: "text-amber-200",
      badgeClass: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    },
    {
      key: "later" as const,
      label: "Later",
      hint: "Good shortlist fuel",
      emptyLabel: "Nothing queued yet.",
      items: groupedDeadlines.later.slice(0, 2),
      panelClass: "border-sky-500/20 bg-sky-500/5",
      labelClass: "text-sky-200",
      badgeClass: "border-sky-500/20 bg-sky-500/10 text-sky-100",
    },
  ];
  const metricCards = [
    {
      to: "/jobs",
      icon: Compass,
      label: "Live market",
      value: heroJobCount.toLocaleString(),
      helper: heroRising
        ? `${heroRising.skill} is rising +${Math.round(heroRising.pct_change)}%`
        : "Fresh ranked roles ready to browse",
      accentClassName: "text-foreground",
    },
    {
      to: "/tracked",
      icon: BellRing,
      label: "Deadline pressure",
      value: priorityDeadlineCount.toString(),
      helper:
        groupedDeadlines.today.length > 0
          ? `${groupedDeadlines.today.length} due today`
          : groupedDeadlines.thisWeek.length > 0
            ? `${groupedDeadlines.thisWeek.length} closing this week`
            : "No urgent closing dates right now",
      accentClassName: groupedDeadlines.today.length > 0 ? "text-rose-200" : "text-foreground",
    },
    {
      to: "/tracked",
      icon: Kanban,
      label: "Pipeline",
      value: trackedTotal.toString(),
      helper: user
        ? `${savedCount} saved, ${appliedCount} applied`
        : "Sign in to keep roles and notes together",
      accentClassName: "text-foreground",
    },
  ];
  const nextMoveRows = [
    {
      to: "/tracked",
      icon: BellRing,
      label:
        groupedDeadlines.today.length > 0
          ? `Apply to ${groupedDeadlines.today.length} role${groupedDeadlines.today.length === 1 ? "" : "s"} due today`
          : groupedDeadlines.thisWeek.length > 0
            ? `Review ${groupedDeadlines.thisWeek.length} deadlines landing this week`
            : "No urgent closers",
    },
    {
      to: user ? "/tracked" : "/auth",
      icon: BriefcaseBusiness,
      label:
        trackedTotal > 0
          ? `${trackedTotal} role${trackedTotal === 1 ? "" : "s"} already in motion`
          : "Build your pipeline",
    },
    {
      to: "/skills",
      icon: GraduationCap,
      label: `Study ${primaryFocusSkill}`,
    },
  ];

  // Empty state: no data ingested yet
  if (jobCount === 0) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Activity className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h1 className="text-xl font-semibold tracking-tight">Waiting for data</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-md">
            Your job pipeline hasn't started yet. Once connected, this page will show upcoming deadlines, skill trends, and study focus recommendations.
          </p>
          <p className="mt-4 font-mono text-xs text-muted-foreground/60">
            Pipeline status: Not connected
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[440px] opacity-95"
          style={{
            background:
              "radial-gradient(circle at 12% 10%, rgba(88, 128, 255, 0.22), transparent 26%), radial-gradient(circle at 84% 12%, rgba(56, 189, 248, 0.12), transparent 22%), linear-gradient(180deg, rgba(17, 24, 39, 0.12), transparent 70%)",
          }}
        />

        <StaggerContainer className="relative space-y-8">
          {showWelcome && <WelcomeBanner onDismiss={dismissWelcome} />}

          <FadeUp>
            <section className="relative overflow-hidden rounded-[30px] border border-border/60 bg-card/80 px-6 py-6 shadow-[0_18px_60px_rgba(2,8,23,0.18)] sm:px-8 sm:py-8">
              <div className="pointer-events-none absolute -left-10 top-0 h-44 w-44 rounded-full bg-primary/20 blur-3xl" />
              <div className="pointer-events-none absolute right-0 top-0 h-48 w-48 rounded-full bg-sky-500/10 blur-3xl" />
              <div className="relative grid gap-8 xl:grid-cols-[1.35fr,0.95fr]">
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="gap-1.5 border border-primary/20 bg-primary/10 text-primary hover:bg-primary/10">
                      <Sparkles className="h-3.5 w-3.5" />
                      Weekly brief
                    </Badge>
                    {heroRising && (
                      <Badge variant="secondary" className="border border-primary/20 bg-background/70 text-foreground">
                        Momentum +{Math.round(heroRising.pct_change)}%
                      </Badge>
                    )}
                  </div>

                  <div className="max-w-3xl space-y-3">
                    <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[3.7rem]">
                      Make your next application from signal, not noise.
                    </h1>
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="font-medium text-foreground tabular-nums">
                          <AnimatedNumber value={heroJobCount} />
                        </span>
                        live roles
                      </span>
                      <span className="text-border">·</span>
                      <span className="inline-flex items-center gap-1 text-sm">
                        <span className="text-muted-foreground">top signal:</span>
                        <span className="font-medium text-primary">{primaryFocusSkill}</span>
                        {topSignalDelta != null && (
                          <span className="font-medium text-emerald-400">+{topSignalDelta}%</span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button asChild size="lg" className="h-11 rounded-xl px-5">
                      <Link to="/jobs">
                        <Compass className="h-4 w-4" /> Explore best matches
                      </Link>
                    </Button>
                    <Button
                      asChild
                      variant="secondary"
                      size="lg"
                      className="h-11 rounded-xl border border-border/60 bg-background/60 px-5 text-foreground hover:bg-background/80"
                    >
                      <Link to="/skills">
                        <Target className="h-4 w-4" /> Review skill gap
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" size="lg" className="h-11 rounded-xl px-4 text-muted-foreground hover:text-foreground">
                      <Link to={user ? "/tracked" : "/auth"}>
                        <Kanban className="h-4 w-4" /> Open tracker
                      </Link>
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {metricCards.map((metric) => (
                      <MetricLinkCard key={metric.label} {...metric} />
                    ))}
                  </div>
                </div>

                <Card className="relative overflow-hidden border-primary/20 bg-background/55 backdrop-blur-sm">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent" />
                  <CardContent className="relative p-5 sm:p-6">
                    <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Next move</p>
                    <div className="mt-4 rounded-3xl border border-primary/20 bg-primary/10 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary/70">Market pulse</p>
                          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{primaryFocusSkill}</h2>
                          <span className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground/70">
                            <TrendingUp className="h-3 w-3" />
                            {topSignalDelta != null ? "accelerating this week" : "market lead"}
                          </span>
                        </div>
                        {heroRising && (
                          <Badge className="bg-primary text-primary-foreground hover:bg-primary">+{Math.round(heroRising.pct_change)}%</Badge>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 space-y-3">
                      {nextMoveRows.map((row) => {
                        const Icon = row.icon;
                        return (
                          <Link
                            key={row.label}
                            to={row.to}
                            className="group flex items-center gap-3 rounded-2xl border border-border/60 bg-card/65 px-3 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-card"
                          >
                            <div className="rounded-xl border border-border/60 bg-background/70 p-2 text-muted-foreground transition-colors group-hover:text-primary">
                              <Icon className="h-4 w-4" />
                            </div>
                            <span className="text-sm font-medium transition-colors group-hover:text-foreground">
                              {row.label}
                            </span>
                            <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                          </Link>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>
          </FadeUp>

          <div className="grid gap-4 xl:grid-cols-[1.3fr,0.92fr]">
            <FadeUp>
              <Card className="h-full overflow-hidden border-border/60 bg-card/80">
                <CardContent className="p-5 sm:p-6">
                  <OverviewPanelHeader icon={CalendarClock} label="Deadline radar" actionLabel="Open tracker" to="/tracked" />
                  <div className="mt-5 grid gap-3 lg:grid-cols-3">
                    {deadlinePanels.map((panel) => (
                      <div key={panel.key} className={cn("rounded-3xl border p-4", panel.panelClass)}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className={cn("font-mono text-[11px] uppercase tracking-[0.22em]", panel.labelClass)}>
                              {panel.label}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">{panel.hint}</p>
                          </div>
                          <span className={cn("rounded-full border px-2.5 py-1 font-mono text-[11px]", panel.badgeClass)}>
                            {panel.items.length}
                          </span>
                        </div>

                        <div className="mt-4 space-y-2">
                          {panel.items.length > 0 ? (
                            panel.items.map((job) => (
                              <Link
                                key={job.id}
                                to={`/jobs/${job.id}`}
                                className="group block rounded-2xl border border-border/60 bg-background/60 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-background/80"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">{job.headline}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">{job.employer_name}</p>
                                  </div>
                                  <span className="shrink-0 rounded-full border border-border/60 bg-card/80 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                                    {formatDeadline(job.application_deadline, panel.key)}
                                  </span>
                                </div>
                              </Link>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-dashed border-border/60 bg-background/35 p-4 text-sm text-muted-foreground">
                              {panel.emptyLabel}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </FadeUp>

            <div className="grid gap-4">
              <FadeUp>
                <Card className="overflow-hidden border-border/60 bg-card/80">
                  <CardContent className="p-5 sm:p-6">
                    <OverviewPanelHeader icon={Kanban} label="Pipeline pulse" actionLabel="Open tracker" to="/tracked" />
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      {[
                        { label: "Saved", value: savedCount },
                        { label: "Applied", value: appliedCount },
                        { label: "Interviewing", value: interviewingCount },
                      ].map((item) => (
                        <div key={item.label} className="rounded-2xl border border-border/60 bg-background/55 p-4 text-center">
                          <p className="font-mono text-2xl font-semibold">{item.value}</p>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                        </div>
                      ))}
                    </div>
                    {trackedTotal === 0 ? (
                      <div className="mt-4 flex flex-col items-center gap-3 py-2 text-center">
                        <p className="text-sm text-muted-foreground">Save jobs to build your pipeline.</p>
                        <Button asChild variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-primary hover:text-primary">
                          <Link to="/jobs">
                            Browse jobs <ArrowRight className="h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-4 flex justify-end">
                        <Button asChild variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground">
                          <Link to="/tracked">
                            Open pipeline <ArrowRight className="h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </FadeUp>

              <FadeUp>
                <Card className="overflow-hidden border-border/60 bg-card/80">
                  <CardContent className="p-5 sm:p-6">
                    <OverviewPanelHeader
                      icon={Building}
                      label="Watchlist pulse"
                      actionLabel={user ? "Manage" : "Sign in"}
                      to={user ? "/watchlist" : "/auth"}
                    />
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-3xl font-semibold tracking-tight">{watchlistOpenings}</p>
                        <p className="text-sm text-muted-foreground">openings across watched companies</p>
                      </div>
                      {user && watchlistHighlights.length > 0 && (
                        <Badge variant="secondary" className="border border-border/60 bg-background/70 text-foreground">
                          {watchlistHighlights.length} tracked
                        </Badge>
                      )}
                    </div>

                    <div className="mt-5 space-y-2">
                      {user && watchlistHighlights.length > 0 ? (
                        watchlistHighlights.map((company) => (
                          <Link
                            key={company.name}
                            to="/watchlist"
                            className="group flex items-center justify-between rounded-2xl border border-border/60 bg-background/55 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-background/80"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 font-mono text-sm text-primary">
                                {company.name.slice(0, 1).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{company.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {company.count} opening{company.count === 1 ? "" : "s"}
                                </p>
                              </div>
                            </div>
                            <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                          </Link>
                        ))
                      ) : (
                        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border/60 bg-background/35 p-5 text-center">
                          <p className="text-sm text-muted-foreground">
                            {user ? "Add companies to watch." : "Sign in to watch companies."}
                          </p>
                          <Button asChild variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-primary hover:text-primary">
                            <Link to={user ? "/watchlist" : "/auth"}>
                              {user ? "Manage watchlist" : "Sign in"} <ArrowRight className="h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </FadeUp>
            </div>
          </div>

          <FadeUp>
            <Card className="relative overflow-hidden border-border/60 bg-card/80">
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-90"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(88, 128, 255, 0.14), transparent 42%), linear-gradient(225deg, rgba(16, 185, 129, 0.08), transparent 38%)",
                }}
              />
              <CardContent className="relative p-5 sm:p-6">
                <OverviewPanelHeader icon={BookOpen} label="Study focus" actionLabel="Full analysis" to="/skills" />
                <div className="mt-5 grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
                  <div className="space-y-5">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Skill signals</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {studyFocusSkills.length > 0 ? (
                          studyFocusSkills.map((skill) => {
                            const isRising = typeof skill.weeklyDelta === "number" && skill.weeklyDelta > 0;
                            return (
                            <div
                              key={skill.name}
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm transition-colors hover:border-primary/25 hover:bg-background",
                                isRising
                                  ? "border-emerald-500/25 bg-emerald-500/5 text-foreground"
                                  : "border-border/60 bg-background/65 text-foreground",
                              )}
                            >
                              {isRising && <TrendingUp className="h-3 w-3 shrink-0 text-emerald-400" />}
                              <span className="font-medium">{skill.name}</span>
                              <span className={cn("font-mono text-xs", isRising ? "text-emerald-400" : "text-muted-foreground")}>
                                {isRising ? `+${Math.round(skill.weeklyDelta ?? 0)}%` : skill.jobCount}
                              </span>
                            </div>
                          );
                          })
                        ) : (
                          <div className="rounded-2xl border border-dashed border-border/60 bg-background/35 p-4 text-sm text-muted-foreground">
                            Market digest data is still warming up.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-primary/20 bg-primary/10 p-5">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary/70">Learn next</p>
                    <div className="mt-3">
                      <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">{primaryFocusSkill}</h3>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
                          {primaryFocusSkill}
                        </span>
                        <span className="text-xs text-muted-foreground/50">pairs with</span>
                        <span className="rounded-full bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {secondaryFocusSkill}
                        </span>
                        <span className="text-xs text-emerald-400">closes gap</span>
                      </div>
                    </div>

                    <div className="mt-5 space-y-2">
                      {focusQueue.map((skill, index) => (
                        <div key={skill} className="flex items-center justify-between rounded-2xl border border-border/50 bg-background/60 px-3 py-2.5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 font-mono text-xs text-primary">
                              {index + 1}
                            </div>
                            <span className="text-sm font-medium">{skill}</span>
                          </div>
                          {risingBySkill.has(skill) ? (
                            <span className="font-mono text-xs text-primary">
                              +{Math.round(risingBySkill.get(skill) ?? 0)}%
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">steady</span>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <Button asChild size="sm" className="gap-1.5">
                        <Link to="/skills">
                          <GraduationCap className="h-3.5 w-3.5" /> Build the plan
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
                        <Link to="/digest">
                          <TrendingUp className="h-3.5 w-3.5" /> Open digest
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </FadeUp>
        </StaggerContainer>
      </div>
    </AppLayout>
  );
}
