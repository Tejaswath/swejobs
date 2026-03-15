import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { pickLatestDigest, type DigestRow } from "@/lib/digest";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StaggerContainer, FadeUp, HoverCard } from "@/components/motion";
import { Star, Plus, Trash2, Building, Briefcase, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function CompanyWatchlist() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newCompany, setNewCompany] = useState("");

  // Watched companies
  const { data: watched, error: watchedError } = useQuery({
    queryKey: ["watched-companies", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("watched_companies")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // For each watched company, fetch their active jobs and top skills
  const { data: companyData, error: companyDataError } = useQuery({
    queryKey: ["watched-company-data", watched?.map((w) => w.employer_name)],
    enabled: !!watched && watched.length > 0,
    queryFn: async () => {
      const result: Record<string, { jobs: any[]; skills: Record<string, number> }> = {};
      for (const w of watched!) {
        const { data: jobs, error: jobsError } = await supabase
          .from("jobs")
          .select("id, headline, published_at, municipality, remote_flag")
          .eq("employer_name", w.employer_name)
          .eq("is_active", true)
          .order("published_at", { ascending: false })
          .limit(5);
        if (jobsError) throw jobsError;

        // Get tags for those jobs
        const jobIds = (jobs ?? []).map((j) => j.id);
        const skills: Record<string, number> = {};
        if (jobIds.length > 0) {
          const { data: tags, error: tagsError } = await supabase
            .from("job_tags")
            .select("tag")
            .in("job_id", jobIds);
          if (tagsError) throw tagsError;
          (tags ?? []).forEach((t) => {
            skills[t.tag] = (skills[t.tag] || 0) + 1;
          });
        }

        result[w.employer_name] = { jobs: jobs ?? [], skills };
      }
      return result;
    },
  });

  const addCompany = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("watched_companies").insert({
        user_id: user!.id,
        employer_name: newCompany.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watched-companies"] });
      qc.invalidateQueries({ queryKey: ["watched-company-data"] });
      setNewCompany("");
      toast({ title: "Company added to watchlist" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeCompany = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("watched_companies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watched-companies"] });
      qc.invalidateQueries({ queryKey: ["watched-company-data"] });
      toast({ title: "Removed" });
    },
  });

  // Suggestions from digest
  const { data: topEmployers, error: topEmployersError } = useQuery({
    queryKey: ["top-employers-suggest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weekly_digests")
        .select("id, period_start, period_end, generated_at, digest_json")
        .order("generated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const latest = pickLatestDigest((data ?? []) as DigestRow[], "rolling_30d");
      if (!latest) return [];
      const d = latest.digest_json as any;
      return (d?.top_employers ?? []) as Array<{ name: string; count: number }>;
    },
  });

  if (!loading && !user) return <Navigate to="/auth" replace />;

  if (watchedError || companyDataError || topEmployersError) {
    const message =
      (watchedError as Error | null)?.message ||
      (companyDataError as Error | null)?.message ||
      (topEmployersError as Error | null)?.message ||
      "Unknown query error";
    return (
      <AppLayout>
        <div className="space-y-3 py-10">
          <h1 className="font-mono text-xl font-bold tracking-tight">Company Watchlist</h1>
          <Card className="border-destructive/40">
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-medium text-destructive">Could not load watchlist data.</p>
              <p className="text-xs text-muted-foreground">{message}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void qc.invalidateQueries({ queryKey: ["watched-companies"] });
                  void qc.invalidateQueries({ queryKey: ["watched-company-data"] });
                  void qc.invalidateQueries({ queryKey: ["top-employers-suggest"] });
                }}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const watchedNames = new Set((watched ?? []).map((w) => w.employer_name));
  const suggestions = (topEmployers ?? []).filter((e) => !watchedNames.has(e.name)).slice(0, 6);

  return (
    <AppLayout>
      <StaggerContainer className="space-y-6">
        <FadeUp>
          <div>
            <h1 className="font-mono text-xl font-bold tracking-tight">Company Watchlist</h1>
            <p className="text-[11px] text-muted-foreground">Track companies and their openings</p>
          </div>
        </FadeUp>

        {/* Add company */}
        <FadeUp>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Add a company (e.g. Spotify, Klarna)..."
              value={newCompany}
              onChange={(e) => setNewCompany(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newCompany.trim()) addCompany.mutate(); }}
              className="h-8 max-w-xs text-xs"
            />
            <Button size="sm" className="h-8 text-xs gap-1" onClick={() => addCompany.mutate()} disabled={!newCompany.trim() || addCompany.isPending}>
              <Plus className="h-3 w-3" /> Watch
            </Button>
          </div>
        </FadeUp>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <FadeUp>
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Suggested from market data</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <Badge
                    key={s.name}
                    variant="outline"
                    className="cursor-pointer text-[10px] hover:bg-primary/5 transition-colors"
                    onClick={() => { setNewCompany(s.name); }}
                  >
                    <Star className="mr-1 h-2.5 w-2.5" /> {s.name} ({s.count})
                  </Badge>
                ))}
              </div>
            </div>
          </FadeUp>
        )}

        {/* Watched companies */}
        {watched && watched.length === 0 && (
          <FadeUp>
            <Card className="border-border/50">
              <CardContent className="py-10 text-center">
                <Building className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  No companies on your watchlist yet. Add one above or click a suggestion.
                </p>
              </CardContent>
            </Card>
          </FadeUp>
        )}

        <div className="space-y-4">
          {(watched ?? []).map((w) => {
            const cd = companyData?.[w.employer_name];
            const jobs = cd?.jobs ?? [];
            const skills = cd?.skills ?? {};
            const sortedSkills = Object.entries(skills).sort((a, b) => b[1] - a[1]).slice(0, 8);

            return (
              <FadeUp key={w.id}>
                <HoverCard>
                  <Card className="border-border/40 transition-colors hover:border-border">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                            <Building className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-mono text-sm font-semibold">{w.employer_name}</h3>
                            <p className="text-[10px] text-muted-foreground">
                              {jobs.length} active opening{jobs.length !== 1 ? "s" : ""}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeCompany.mutate(w.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      {/* Skills */}
                      {sortedSkills.length > 0 && (
                        <div className="mt-3">
                          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Repeated Skills</p>
                          <div className="flex flex-wrap gap-1">
                            {sortedSkills.map(([skill, count]) => (
                              <Badge key={skill} variant="secondary" className="text-[9px] gap-1 font-mono">
                                {skill} <span className="text-muted-foreground">×{count}</span>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Recent openings */}
                      {jobs.length > 0 && (
                        <div className="mt-3 space-y-1">
                          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Recent Openings</p>
                          {jobs.map((job) => (
                            <Link
                              key={job.id}
                              to={`/jobs/${job.id}`}
                              className="flex items-center justify-between rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted/50"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Briefcase className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                                <span className="truncate">{job.headline}</span>
                                {job.remote_flag && <Badge variant="secondary" className="text-[8px] h-3 px-1 shrink-0">Remote</Badge>}
                              </div>
                              {job.published_at && (
                                <span className="ml-2 shrink-0 font-mono text-[10px] text-muted-foreground">
                                  {new Date(job.published_at).toLocaleDateString("sv-SE")}
                                </span>
                              )}
                            </Link>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </HoverCard>
              </FadeUp>
            );
          })}
        </div>
      </StaggerContainer>
    </AppLayout>
  );
}
