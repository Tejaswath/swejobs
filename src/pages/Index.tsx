import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppLayout } from "@/components/AppLayout";
import { OverviewHeroPanel } from "@/components/overview/OverviewHeroPanel";
import { DeadlineRadarPanel } from "@/components/overview/DeadlineRadarPanel";
import { PipelinePulsePanel } from "@/components/overview/PipelinePulsePanel";
import { WatchlistPulsePanel } from "@/components/overview/WatchlistPulsePanel";
import { StudyFocusPanel } from "@/components/overview/StudyFocusPanel";
import { FadeUp, AnimatedNumber, StaggerContainer } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDelayedVisibility } from "@/hooks/useDelayedVisibility";
import { pickLatestDigest, type DigestRow } from "@/lib/digest";

import type {
  DeadlineBucketViewModel,
  OverviewSignalStripItem,
  PipelineMetric,
  StudySkillChip,
} from "@/components/overview/types";

const REFRESH_MS = 60_000;

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

type ParsedTopSkill = {
  skill: string;
  count: number;
};

type ParsedRisingSkill = {
  skill: string;
  pctChange: number;
};

function safeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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

function parseTopSkills(raw: unknown): ParsedTopSkill[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const row = item as Record<string, unknown>;
      const skill = String(row.skill ?? "").trim();
      if (!skill) return null;
      return {
        skill,
        count: safeNumber(row.count),
      };
    })
    .filter((value): value is ParsedTopSkill => value !== null);
}

function parseRisingSkills(raw: unknown): ParsedRisingSkill[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const row = item as Record<string, unknown>;
      const skill = String(row.skill ?? "").trim();
      if (!skill) return null;
      return {
        skill,
        pctChange: safeNumber(row.pct_change ?? row.delta_pct),
      };
    })
    .filter((value): value is ParsedRisingSkill => value !== null)
    .filter((value) => value.pctChange !== 0);
}

function uniqueByName(skills: StudySkillChip[]): StudySkillChip[] {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    const key = skill.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function Index() {
  const { user } = useAuth();

  useEffect(() => {
    document.title = "SweJobs — Swedish Tech Job Tracker";
  }, []);

  const jobCountQuery = useQuery({
    queryKey: ["job-count"],
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
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

  const latestDigestQuery = useQuery({
    queryKey: ["latest-digest", "rolling_30d"],
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weekly_digests")
        .select("id, digest_json, period_start, period_end, generated_at")
        .order("generated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return pickLatestDigest((data ?? []) as DigestRow[], "rolling_30d");
    },
  });

  const trackedJobsQuery = useQuery({
    queryKey: ["tracked-summary", user?.id],
    enabled: !!user,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracked_jobs")
        .select("status, job_id, jobs(headline, employer_name, application_deadline)")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const upcomingDeadlinesQuery = useQuery({
    queryKey: ["upcoming-deadlines"],
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, headline, employer_name, application_deadline")
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
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const { data: watched, error: watchedError } = await supabase
        .from("watched_companies")
        .select("employer_name")
        .eq("user_id", user!.id);
      if (watchedError) throw watchedError;
      if (!watched || watched.length === 0) return [];

      const results: Array<{ name: string; count: number }> = [];
      for (const item of watched) {
        const { count, error } = await supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("employer_name", item.employer_name)
          .eq("is_active", true);
        if (error) throw error;
        results.push({ name: item.employer_name, count: count ?? 0 });
      }

      return results;
    },
  });

  const digest = latestDigestQuery.data?.digest_json as Record<string, unknown> | null;
  const topSkills = parseTopSkills(digest?.top_skills);
  const risingSkills = parseRisingSkills(digest?.rising_skills);
  const studyFocus = (digest?.study_focus as Record<string, unknown> | undefined) ?? undefined;

  const trackedCounts = trackedJobsQuery.data?.reduce((acc, tracked) => {
    acc[tracked.status] = (acc[tracked.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) ?? {};

  const trackedTotal = Object.values(trackedCounts).reduce((sum, value) => sum + value, 0);
  const savedCount = trackedCounts.saved ?? 0;
  const appliedCount = trackedCounts.applied ?? 0;
  const interviewingCount = trackedCounts.interviewing ?? 0;

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

  const heroRising = risingSkills[0];
  const studyPrimarySkill = String(studyFocus?.primary_skill ?? "").trim();
  const studySecondarySkill = String(studyFocus?.secondary_skill ?? "").trim();
  const topSkillName =
    heroRising?.skill ??
    (studyPrimarySkill || topSkills[0]?.skill || "software_engineering");
  const secondarySkillName =
    studySecondarySkill ||
    topSkills.find((skill) => skill.skill !== topSkillName)?.skill ||
    "python";

  const risingBySkill = new Map(risingSkills.map((skill) => [skill.skill, skill.pctChange]));
  const studyFocusSkills = uniqueByName(
    [
      ...topSkills.map((skill) => ({
        name: skill.skill,
        count: skill.count,
        delta: risingBySkill.get(skill.skill) ?? null,
        isRising: risingBySkill.has(skill.skill),
      })),
      ...risingSkills.map((skill) => ({
        name: skill.skill,
        count: topSkills.find((topSkill) => topSkill.skill === skill.skill)?.count ?? 0,
        delta: skill.pctChange,
        isRising: true,
      })),
    ].slice(0, 8),
  );
  const studyFocusChips = studyFocusSkills.slice(0, 6);

  const rankedStudySkills = Array.from(
    new Set([
      topSkillName,
      secondarySkillName,
      ...studyFocusSkills.map((skill) => skill.name),
    ]),
  )
    .map((name) => studyFocusSkills.find((skill) => skill.name === name) ?? {
      name,
      count: 0,
      delta: risingBySkill.get(name) ?? null,
      isRising: risingBySkill.has(name),
    })
    .slice(0, 5);

  const watchlistHighlights = watchedCompanyDataQuery.data ?? [];
  const watchlistOpenings = watchlistHighlights.reduce((sum, company) => sum + company.count, 0);

  const deadlineBuckets: DeadlineBucketViewModel[] = [
    {
      id: "today",
      label: "Today",
      hint: "Needs attention",
      count: groupedDeadlines.today.length,
      href: "/jobs?deadline=today",
      accentClassName: "border-rose-500/20 bg-rose-500/5",
      badgeClassName: "border-rose-500/20 bg-rose-500/10 text-rose-100",
      jobs: groupedDeadlines.today.slice(0, 2).map((job) => ({
        id: job.id,
        headline: job.headline,
        employerName: job.employer_name,
        deadlineLabel: formatDeadline(job.application_deadline, "today"),
        href: `/jobs/${job.id}`,
      })),
    },
    {
      id: "thisWeek",
      label: "This week",
      hint: "Worth planning",
      count: groupedDeadlines.thisWeek.length,
      href: "/jobs?deadline=week",
      accentClassName: "border-amber-500/20 bg-amber-500/5",
      badgeClassName: "border-amber-500/20 bg-amber-500/10 text-amber-100",
      jobs: groupedDeadlines.thisWeek.slice(0, 2).map((job) => ({
        id: job.id,
        headline: job.headline,
        employerName: job.employer_name,
        deadlineLabel: formatDeadline(job.application_deadline, "thisWeek"),
        href: `/jobs/${job.id}`,
      })),
    },
    {
      id: "later",
      label: "Later",
      hint: "Good shortlist fuel",
      count: groupedDeadlines.later.length,
      href: "/jobs?deadline=upcoming",
      accentClassName: "border-sky-500/20 bg-sky-500/5",
      badgeClassName: "border-sky-500/20 bg-sky-500/10 text-sky-100",
      jobs: groupedDeadlines.later.slice(0, 2).map((job) => ({
        id: job.id,
        headline: job.headline,
        employerName: job.employer_name,
        deadlineLabel: formatDeadline(job.application_deadline, "later"),
        href: `/jobs/${job.id}`,
      })),
    },
  ].filter((bucket) => bucket.count > 0);

  const signalItems: OverviewSignalStripItem[] = [
    {
      label: "Live roles",
      value: <AnimatedNumber value={jobCountQuery.data ?? 0} />,
      href: "/jobs",
      accentClassName: "text-foreground",
    },
    {
      label: "Due today",
      value: <AnimatedNumber value={groupedDeadlines.today.length} />,
      href: "/jobs?deadline=today",
      accentClassName: groupedDeadlines.today.length > 0 ? "text-rose-200" : "text-foreground",
    },
    {
      label: "Top signal",
      value: (
        <div className="flex min-w-0 items-center gap-2">
          <span title={topSkillName} className="max-w-[18ch] truncate sm:max-w-[22ch] lg:max-w-[26ch]">
            {topSkillName}
          </span>
        </div>
      ),
      href: "/digest",
      fullLabel: topSkillName,
      accentClassName: "text-[1.65rem]",
      badge:
        typeof heroRising?.pctChange === "number" ? (
          <Badge className="border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10">
            +{Math.round(heroRising.pctChange)}%
          </Badge>
        ) : null,
    },
  ];

  const pipelineHref = user ? "/tracked" : "/auth";

  const pipelineMetrics: PipelineMetric[] = [
    { label: "Saved", count: savedCount, href: pipelineHref },
    { label: "Applied", count: appliedCount, href: pipelineHref, accentClassName: appliedCount > 0 ? "text-primary" : undefined },
    { label: "Interviewing", count: interviewingCount, href: pipelineHref, accentClassName: interviewingCount > 0 ? "text-amber-300" : undefined },
  ];

  const showHeroSignalsLoading = useDelayedVisibility(
    jobCountQuery.isLoading || latestDigestQuery.isLoading || upcomingDeadlinesQuery.isLoading,
  );
  const showUpcomingDeadlineLoading = useDelayedVisibility(upcomingDeadlinesQuery.isLoading);
  const showTrackedLoading = useDelayedVisibility(!!user && trackedJobsQuery.isLoading);
  const showWatchlistLoading = useDelayedVisibility(!!user && watchedCompanyDataQuery.isLoading);
  const showStudyLoading = useDelayedVisibility(latestDigestQuery.isLoading);
  const heroSignalsUnavailable = jobCountQuery.isError || upcomingDeadlinesQuery.isError;

  if (!jobCountQuery.isLoading && !jobCountQuery.isError && (jobCountQuery.data ?? 0) === 0) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Card className="w-full max-w-2xl rounded-[30px] border-border/60 bg-card/80">
            <CardContent className="p-8 text-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Overview</p>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">Waiting for market data</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Once the pipeline is connected, this page will show live roles, urgent deadlines, and study signals.
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
              isSignalsLoading={showHeroSignalsLoading}
              signalsUnavailable={heroSignalsUnavailable}
              momentumLabel={heroRising ? `Momentum +${Math.round(heroRising.pctChange)}%` : null}
            />
          </FadeUp>

          <div className="grid gap-4 xl:grid-cols-[1.3fr,0.92fr]">
            <FadeUp>
              <DeadlineRadarPanel
                buckets={deadlineBuckets}
                isLoading={showUpcomingDeadlineLoading}
                unavailable={upcomingDeadlinesQuery.isError}
              />
            </FadeUp>

            <div className="grid gap-4">
              <FadeUp>
                <PipelinePulsePanel
                  metrics={pipelineMetrics}
                  isLoading={showTrackedLoading}
                  unavailable={!!user && trackedJobsQuery.isError}
                  actionHref={pipelineHref}
                />
              </FadeUp>

              <FadeUp>
                <WatchlistPulsePanel
                  actionHref={user ? "/watchlist" : "/auth"}
                  actionLabel={user ? "Manage" : "Sign in"}
                  trackedCount={watchlistHighlights.length}
                  openings={watchlistOpenings}
                  featured={watchlistHighlights[0]}
                  isLoading={showWatchlistLoading}
                  unavailable={!!user && watchedCompanyDataQuery.isError}
                />
              </FadeUp>
            </div>
          </div>

          <FadeUp>
            <StudyFocusPanel
              chips={studyFocusChips}
              rankedSkills={rankedStudySkills}
              primarySkill={topSkillName}
              secondarySkill={secondarySkillName}
              isLoading={showStudyLoading}
              unavailable={latestDigestQuery.isError}
            />
          </FadeUp>
        </StaggerContainer>
      </div>
    </AppLayout>
  );
}
