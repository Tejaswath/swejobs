import { BookOpen, GraduationCap, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";

import { OverviewSectionHeader } from "@/components/overview/OverviewSectionHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { StudySkillChip } from "./types";

export function StudyFocusPanel({
  chips,
  rankedSkills,
  primarySkill,
  secondarySkill,
  isLoading,
  unavailable,
}: {
  chips: StudySkillChip[];
  rankedSkills: StudySkillChip[];
  primarySkill: string;
  secondarySkill: string;
  isLoading?: boolean;
  unavailable?: boolean;
}) {
  return (
    <Card className="relative overflow-hidden rounded-[30px] border-border/60 bg-card/80">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-90"
        style={{
          background:
            "linear-gradient(135deg, rgba(88, 128, 255, 0.14), transparent 42%), linear-gradient(225deg, rgba(16, 185, 129, 0.08), transparent 38%)",
        }}
      />
      <CardContent className="relative p-5 sm:p-6">
        <OverviewSectionHeader icon={BookOpen} label="Study focus" actionLabel="Full analysis" to="/digest" />

        {unavailable ? (
          <div className="mt-5 rounded-[24px] border border-dashed border-border/60 bg-background/35 p-5 text-sm text-muted-foreground">
            Unavailable right now
          </div>
        ) : isLoading ? (
          <div className="mt-5 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-4">
              <Skeleton className="h-4 w-24" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-28 rounded-full" />
                ))}
              </div>
            </div>
            <div className="rounded-[28px] border border-primary/20 bg-primary/10 p-5">
              <Skeleton className="h-4 w-24 bg-primary/15" />
              <Skeleton className="mt-4 h-10 w-52 bg-primary/20" />
              <Skeleton className="mt-4 h-7 w-72 bg-primary/15" />
              <div className="mt-5 space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full rounded-2xl bg-background/60" />
                ))}
              </div>
            </div>
          </div>
        ) : chips.length === 0 || rankedSkills.length === 0 ? (
          <div className="mt-5 rounded-[24px] border border-dashed border-border/60 bg-background/35 p-5">
            <p className="text-sm font-medium text-foreground">No study focus yet</p>
            <Link to="/digest" className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80">
              Open digest
              <TrendingUp className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="mt-5 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-5">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Skill signals</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {chips.map((chip) => (
                    <div
                      key={chip.name}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm transition-colors",
                        chip.isRising
                          ? "border-emerald-500/25 bg-emerald-500/5 text-foreground"
                          : "border-border/60 bg-background/65 text-foreground",
                      )}
                    >
                      {chip.isRising ? <TrendingUp className="h-3 w-3 shrink-0 text-emerald-400" /> : null}
                      <span className="font-medium">{chip.name}</span>
                      <span className={cn("font-mono text-xs", chip.isRising ? "text-emerald-400" : "text-muted-foreground")}>
                        {chip.isRising && typeof chip.delta === "number"
                          ? `+${Math.round(chip.delta)}%`
                          : chip.count ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-primary/20 bg-primary/10 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary/70">Learn next</p>
              <div className="mt-3">
                <h3 className="text-[2.35rem] font-semibold leading-none tracking-tight text-foreground">{primarySkill}</h3>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                  <span className="rounded-full bg-primary/15 px-2.5 py-1 font-medium text-primary">{primarySkill}</span>
                  <span className="text-muted-foreground">pairs with</span>
                  <span className="rounded-full bg-background/70 px-2.5 py-1 font-medium text-foreground">{secondarySkill}</span>
                  <span className="text-emerald-400">closes gap</span>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                {rankedSkills.map((skill, index) => (
                  <div key={skill.name} className="flex items-center justify-between rounded-2xl border border-border/50 bg-background/60 px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 font-mono text-xs text-primary">
                        {index + 1}
                      </div>
                      <span className="text-sm font-medium text-foreground">{skill.name}</span>
                    </div>
                    {skill.isRising && typeof skill.delta === "number" ? (
                      <span className="font-mono text-xs text-primary">+{Math.round(skill.delta)}%</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">steady</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild size="sm" className="gap-1.5">
                  <Link to="/digest">
                    <GraduationCap className="h-3.5 w-3.5" />
                    Build the plan
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
                  <Link to="/digest">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Open digest
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
