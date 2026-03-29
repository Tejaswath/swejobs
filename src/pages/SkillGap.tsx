import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { pickLatestDigest, type DigestRow } from "@/lib/digest";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StaggerContainer, FadeUp } from "@/components/motion";
import { Plus, X, Zap, Target, BookOpen, TrendingUp, Check, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PROFICIENCY_OPTIONS = ["strong", "learning", "interested"] as const;
const PROFICIENCY_COLORS: Record<string, string> = {
  strong: "bg-accent/10 text-accent border-accent/20",
  learning: "bg-primary/10 text-primary border-primary/20",
  interested: "bg-muted text-muted-foreground border-border",
};

export default function SkillGap() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newSkill, setNewSkill] = useState("");
  const [newProf, setNewProf] = useState<string>("learning");

  useEffect(() => {
    document.title = "Skill Gap | SweJobs";
  }, []);

  // Fetch user skills
  const { data: userSkills, error: userSkillsError, isLoading: userSkillsLoading } = useQuery({
    queryKey: ["user-skills", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_skills")
        .select("id, user_id, skill, proficiency, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch market skills from latest digest
  const { data: marketSkills, error: marketSkillsError, isLoading: marketSkillsLoading } = useQuery({
    queryKey: ["market-skills"],
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weekly_digests")
        .select("id, period_start, period_end, generated_at, digest_json")
        .order("generated_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      const latest = pickLatestDigest((data ?? []) as DigestRow[], "rolling_30d");
      if (!latest) return { top: [], rising: [] };
      const d = latest.digest_json as any;
      return {
        top: (d?.top_skills ?? []) as Array<{ skill: string; count: number }>,
        rising: (d?.rising_skills ?? []) as Array<{ skill: string; pct_change: number }>,
      };
    },
  });

  const addSkill = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in required");
      const { error } = await supabase.from("user_skills").insert({
        user_id: user.id,
        skill: newSkill.trim(),
        proficiency: newProf,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-skills"] });
      setNewSkill("");
      toast({ title: "Skill added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeSkill = useMutation({
    mutationFn: async (id: number) => {
      if (!user) throw new Error("Sign in required");
      const { error } = await supabase.from("user_skills").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-skills"] }),
  });

  const updateProficiency = useMutation({
    mutationFn: async ({ id, proficiency }: { id: number; proficiency: string }) => {
      if (!user) throw new Error("Sign in required");
      const { error } = await supabase.from("user_skills").update({ proficiency }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-skills"] }),
  });

  if (loading) {
    return (
      <AppLayout>
        <div className="space-y-2">
          <h1 className="font-mono text-xl font-bold tracking-tight">Skill Gap Tracker</h1>
          <p className="text-xs text-muted-foreground">Loading your skills...</p>
        </div>
      </AppLayout>
    );
  }

  const queryLoading = marketSkillsLoading || (Boolean(user) && userSkillsLoading);

  if (queryLoading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <div>
            <h1 className="font-mono text-xl font-bold tracking-tight">Skill Gap Tracker</h1>
            <p className="text-xs text-muted-foreground">Loading market comparison...</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={index} className="border-border/40">
                <CardContent className="space-y-3 p-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-3/4" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (userSkillsError || marketSkillsError) {
    const message =
      (userSkillsError as Error | null)?.message ||
      (marketSkillsError as Error | null)?.message ||
      "Unknown query error";
    return (
      <AppLayout>
        <div className="space-y-3 py-10">
          <h1 className="font-mono text-xl font-bold tracking-tight">Skill Gap Tracker</h1>
          <Card className="border-destructive/40">
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-medium text-destructive">Could not load skill-gap data.</p>
              <p className="text-xs text-muted-foreground">{message}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void qc.invalidateQueries({ queryKey: ["user-skills"] });
                  void qc.invalidateQueries({ queryKey: ["market-skills"] });
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

  const mySkillNames = new Set(
    (userSkills ?? [])
      .map((s) => String(s.skill ?? "").trim().toLowerCase())
      .filter((name) => name.length > 0),
  );
  const topMarket = (marketSkills?.top ?? []).filter((s) => typeof s.skill === "string" && s.skill.trim().length > 0);
  const risingMarket = (marketSkills?.rising ?? []).filter(
    (s) => typeof s.skill === "string" && s.skill.trim().length > 0,
  );

  // Categorize market skills
  const strongSkills = topMarket.filter((s) =>
    userSkills?.some(
      (u) =>
        String(u.skill ?? "").toLowerCase() === s.skill.toLowerCase() &&
        u.proficiency === "strong",
    )
  );
  const missingSkills = topMarket.filter((s) => !mySkillNames.has(s.skill.toLowerCase())).slice(0, 10);
  const risingIMiss = risingMarket.filter((s) => !mySkillNames.has(s.skill.toLowerCase())).slice(0, 8);
  const learnNext = [...missingSkills.slice(0, 3), ...risingIMiss.slice(0, 2)].slice(0, 5);

  return (
    <AppLayout>
      <StaggerContainer className="space-y-6">
        <FadeUp>
          <div>
            <h1 className="font-mono text-xl font-bold tracking-tight">Skill Gap Tracker</h1>
            <p className="text-xs text-muted-foreground">Compare your skills against market demand</p>
          </div>
        </FadeUp>

        {/* Add skill */}
        {user ? (
          <FadeUp>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Add a skill (e.g. React, Python, Kubernetes)..."
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newSkill.trim()) addSkill.mutate(); }}
                className="h-8 max-w-xs text-xs"
              />
              <Select value={newProf} onValueChange={setNewProf}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROFICIENCY_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 text-xs gap-1" onClick={() => addSkill.mutate()} disabled={!newSkill.trim() || addSkill.isPending}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
          </FadeUp>
        ) : (
          <FadeUp>
            <Card className="border-border/50">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium">Sign in to track your personal skill gap</p>
                  <p className="text-xs text-muted-foreground">
                    You can still view market-demand skills below.
                  </p>
                </div>
                <Button size="sm" asChild>
                  <a href="/auth">Sign in</a>
                </Button>
              </CardContent>
            </Card>
          </FadeUp>
        )}

        {/* My skills */}
        {userSkills && userSkills.length > 0 && (
          <FadeUp>
            <Card className="border-border/50">
              <CardContent className="p-4">
                <h2 className="mb-3 flex items-center gap-2 font-mono text-xs font-semibold">
                  <Target className="h-3.5 w-3.5 text-primary" /> My Skills
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {userSkills.map((s) => (
                    <Badge
                      key={s.id}
                      variant="outline"
                      className={`gap-1 text-xs cursor-pointer ${PROFICIENCY_COLORS[s.proficiency]}`}
                      onClick={() => {
                        const next = PROFICIENCY_OPTIONS[(PROFICIENCY_OPTIONS.indexOf(s.proficiency as any) + 1) % 3];
                        updateProficiency.mutate({ id: s.id, proficiency: next });
                      }}
                    >
                      {s.skill}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeSkill.mutate(s.id); }}
                        className="ml-0.5 hover:text-destructive"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Click a skill to cycle proficiency: strong → learning → interested</p>
              </CardContent>
            </Card>
          </FadeUp>
        )}

        {/* Gap analysis grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <FadeUp>
            <Card className="border-accent/20">
              <CardContent className="p-4">
                <h3 className="mb-2 flex items-center gap-1.5 font-mono text-xs font-semibold text-accent">
                  <Check className="h-3.5 w-3.5" /> Strong Match
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">Skills you're strong in that the market wants</p>
                <div className="space-y-1">
                  {strongSkills.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Add skills above to see matches</p>
                  ) : strongSkills.map((s) => (
                    <div key={s.skill} className="flex items-center justify-between">
                      <span className="text-xs">{s.skill}</span>
                      <span className="font-mono text-xs text-muted-foreground">{s.count} jobs</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </FadeUp>

          <FadeUp>
            <Card className="border-destructive/20">
              <CardContent className="p-4">
                <h3 className="mb-2 flex items-center gap-1.5 font-mono text-xs font-semibold text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" /> Missing
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">In-demand skills you haven't added</p>
                <div className="space-y-1">
                  {missingSkills.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Great coverage!</p>
                  ) : missingSkills.map((s) => (
                    <div key={s.skill} className="flex items-center justify-between">
                      <span className="text-xs">{s.skill}</span>
                      <span className="font-mono text-xs text-muted-foreground">{s.count} jobs</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </FadeUp>

          <FadeUp>
            <Card className="border-primary/20">
              <CardContent className="p-4">
                <h3 className="mb-2 flex items-center gap-1.5 font-mono text-xs font-semibold text-primary">
                  <TrendingUp className="h-3.5 w-3.5" /> Rising
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">Trending skills you don't have yet</p>
                <div className="space-y-1">
                  {risingIMiss.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">You're ahead of trends!</p>
                  ) : risingIMiss.map((s) => (
                    <div key={s.skill} className="flex items-center justify-between">
                      <span className="text-xs">{s.skill}</span>
                      <span className="font-mono text-xs text-accent">+{isFinite(s.pct_change) ? Math.round(s.pct_change) : 0}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </FadeUp>

          <FadeUp>
            <Card className="border-border/40">
              <CardContent className="p-4">
                <h3 className="mb-2 flex items-center gap-1.5 font-mono text-xs font-semibold">
                  <BookOpen className="h-3.5 w-3.5" /> Learn Next
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">Top recommendations based on gaps + trends</p>
                <div className="space-y-1.5">
                  {learnNext.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Add your skills to get recommendations</p>
                  ) : learnNext.map((s, i) => (
                    <div key={s.skill} className="flex items-center gap-2">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 font-mono text-[9px] text-primary">{i + 1}</span>
                      <span className="text-xs font-medium">{s.skill}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </FadeUp>
        </div>
      </StaggerContainer>
    </AppLayout>
  );
}
