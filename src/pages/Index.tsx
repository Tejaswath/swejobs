import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FadeUp, AnimatedNumber } from "@/components/motion";
import {
  ArrowRight,
  Compass,
  CalendarClock,
  Kanban,
  TrendingUp,
  BookOpen,
  Building,
  Activity,
  X,
} from "lucide-react";

function WelcomeBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <FadeUp>
      <div className="relative rounded-lg border border-primary/20 bg-primary/5 px-5 py-4 mb-8">
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <h2 className="text-sm font-semibold">Welcome to SweJobs</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-lg">
          SweJobs monitors the Swedish tech job market for you. Browse jobs in <strong>Explore</strong>, save ones you like, and track your applications in <strong>Tracker</strong>. Data updates automatically from official sources.
        </p>
      </div>
    </FadeUp>
  );
}

export default function Index() {
  const { user } = useAuth();
  const [showWelcome, setShowWelcome] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("swejobs-welcome-dismissed") !== "true";
    }
    return true;
  });

  const dismissWelcome = () => {
    setShowWelcome(false);
    localStorage.setItem("swejobs-welcome-dismissed", "true");
  };

  const { data: jobCount } = useQuery({
    queryKey: ["job-count"],
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
    queryKey: ["latest-digest"],
    queryFn: async () => {
      const { data } = await supabase
        .from("weekly_digests")
        .select("digest_json, period_end")
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: trackedJobs } = useQuery({
    queryKey: ["tracked-summary", user?.id],
    enabled: !!user,
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
    queryFn: async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id, headline, employer_name, application_deadline")
        .eq("is_active", true)
        .eq("is_target_role", true)
        .not("application_deadline", "is", null)
        .gte("application_deadline", new Date().toISOString().slice(0, 10))
        .order("application_deadline", { ascending: true })
        .limit(5);
      return data ?? [];
    },
  });

  const { data: watchedCompanyData } = useQuery({
    queryKey: ["watched-overview", user?.id],
    enabled: !!user,
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
      <div className="space-y-10">
        {/* Welcome banner */}
        {showWelcome && <WelcomeBanner onDismiss={dismissWelcome} />}

        {/* Hero insight */}
        <FadeUp>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
              What to focus on this week
            </h1>
            <p className="text-sm text-muted-foreground">
              <AnimatedNumber value={heroJobCount} className="font-medium text-foreground" /> active jobs
              {heroRising && (
                <> · <span className="text-primary font-medium">{heroRising.skill}</span> is rising{" "}
                  <span className="font-mono text-xs text-primary">
                    +{Math.round(heroRising.pct_change)}%
                  </span>
                </>
              )}
            </p>
          </div>
        </FadeUp>

        <div className="space-y-8">
          {/* Upcoming Deadlines */}
          {upcomingDeadlines && upcomingDeadlines.length > 0 && (
            <FadeUp>
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" /> Upcoming deadlines
                  </h2>
                </div>
                <div className="space-y-0.5">
                  {upcomingDeadlines.map((job) => (
                    <Link
                      key={job.id}
                      to={`/jobs/${job.id}`}
                      className="flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{job.headline}</p>
                        <p className="text-xs text-muted-foreground">{job.employer_name}</p>
                      </div>
                      <span className="ml-3 shrink-0 font-mono text-xs text-muted-foreground">
                        {job.application_deadline?.slice(0, 10)}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            </FadeUp>
          )}

          {/* Tracking pipeline */}
          {user && trackedJobs && trackedJobs.length > 0 && (
            <FadeUp>
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <Kanban className="h-3.5 w-3.5" /> Your pipeline
                  </h2>
                  <Link to="/tracked">
                    <Button variant="ghost" size="sm" className="gap-1 text-xs h-7 px-2 text-muted-foreground hover:text-foreground">
                      View all <ArrowRight className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
                <div className="flex gap-3">
                  {["saved", "applied", "interviewing"].map((s) => (
                    <div key={s} className="flex-1 rounded-lg bg-muted/40 p-3 text-center">
                      <p className="font-mono text-lg font-semibold">{trackedCounts[s] ?? 0}</p>
                      <p className="text-[10px] capitalize text-muted-foreground">{s}</p>
                    </div>
                  ))}
                </div>
              </section>
            </FadeUp>
          )}

          {/* Watched companies */}
          {user && watchedCompanyData && watchedCompanyData.length > 0 && (
            <FadeUp>
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <Building className="h-3.5 w-3.5" /> Watched companies
                  </h2>
                  <Link to="/watchlist">
                    <Button variant="ghost" size="sm" className="gap-1 text-xs h-7 px-2 text-muted-foreground hover:text-foreground">
                      Manage <ArrowRight className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
                <div className="space-y-0.5">
                  {watchedCompanyData.map((c) => (
                    <div key={c.name} className="flex items-center justify-between rounded-md px-3 py-2 text-sm">
                      <span className="font-medium">{c.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{c.count} opening{c.count !== 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
              </section>
            </FadeUp>
          )}

          {/* Study focus */}
          {topSkills && topSkills.length > 0 && (
            <FadeUp>
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <BookOpen className="h-3.5 w-3.5" /> Study focus
                  </h2>
                  <Link to="/skills">
                    <Button variant="ghost" size="sm" className="gap-1 text-xs h-7 px-2 text-muted-foreground hover:text-foreground">
                      Full analysis <ArrowRight className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
                <div className={`grid gap-4 ${hasRealRising ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">High demand</p>
                    {topSkills.slice(0, 3).map((s) => (
                      <div key={s.skill} className="flex items-center justify-between text-sm">
                        <span>{s.skill}</span>
                        <span className="font-mono text-xs text-muted-foreground">{s.count} jobs</span>
                      </div>
                    ))}
                  </div>
                  {hasRealRising && risingSkills && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Rising fast</p>
                      {risingSkills.filter((s) => isFinite(s.pct_change) && s.pct_change !== 0).slice(0, 3).map((s) => (
                        <div key={s.skill} className="flex items-center justify-between text-sm">
                          <span>{s.skill}</span>
                          <span className="font-mono text-xs text-primary">
                            +{Math.round(s.pct_change)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Always needed</p>
                    {topSkills.slice(3, 6).map((s) => (
                      <div key={s.skill} className="flex items-center justify-between text-sm">
                        <span>{s.skill}</span>
                        <span className="font-mono text-xs text-muted-foreground">{s.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </FadeUp>
          )}

          {/* CTA */}
          <FadeUp>
            <Link to="/jobs">
              <Button className="gap-2 h-10" size="lg">
                <Compass className="h-4 w-4" /> Explore jobs <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </FadeUp>
        </div>
      </div>
    </AppLayout>
  );
}
