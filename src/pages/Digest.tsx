import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, TrendingDown, Building, MapPin } from "lucide-react";
import { useState } from "react";

const CHART_COLORS = [
  "hsl(217, 91%, 55%)",
  "hsl(160, 60%, 42%)",
  "hsl(38, 90%, 52%)",
  "hsl(0, 72%, 55%)",
  "hsl(262, 83%, 58%)",
  "hsl(190, 90%, 50%)",
];

function safeNum(val: unknown, fallback = 0): number {
  const n = Number(val);
  return isFinite(n) ? n : fallback;
}

function safePct(val: unknown): string {
  const n = Number(val);
  if (!isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${Math.round(n)}%`;
}

export default function Digest() {
  const { data: digests } = useQuery({
    queryKey: ["digests"],
    queryFn: async () => {
      const { data } = await supabase
        .from("weekly_digests")
        .select("*")
        .order("period_end", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const [selectedIdx, setSelectedIdx] = useState("0");
  const digest = digests?.[Number(selectedIdx)];
  const d = digest?.digest_json as any;

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Market Digest</h1>
            <p className="text-xs text-muted-foreground">Weekly insights & skill trends</p>
          </div>
          {digests && digests.length > 0 && (
            <Select value={selectedIdx} onValueChange={setSelectedIdx}>
              <SelectTrigger className="w-48 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {digests.map((d, i) => (
                  <SelectItem key={d.id} value={String(i)}>
                    Week of {new Date(d.period_start).toLocaleDateString("sv-SE")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {!digest ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <TrendingUp className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h2 className="text-lg font-medium">No digests yet</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm">
              Market digests are generated weekly. Check back soon for skill trends, employer rankings, and regional breakdowns.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Summary */}
            <div className="grid gap-6 sm:grid-cols-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">New jobs</p>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-semibold">{safeNum(d?.total_new_jobs)}</span>
                  {d?.new_jobs_delta_pct != null && isFinite(Number(d.new_jobs_delta_pct)) && (
                    <Badge variant={Number(d.new_jobs_delta_pct) >= 0 ? "default" : "destructive"} className="text-[10px] font-normal">
                      {Number(d.new_jobs_delta_pct) >= 0 ? <TrendingUp className="mr-0.5 h-2.5 w-2.5" /> : <TrendingDown className="mr-0.5 h-2.5 w-2.5" />}
                      {safePct(d.new_jobs_delta_pct)}
                    </Badge>
                  )}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Removed</p>
                <span className="font-mono text-2xl font-semibold">{safeNum(d?.total_removed_jobs)}</span>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Remote share</p>
                <span className="font-mono text-2xl font-semibold">{safeNum(d?.remote_share_pct)}%</span>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">English listings</p>
                <span className="font-mono text-2xl font-semibold">{safeNum(d?.english_pct)}%</span>
              </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
              {/* Top skills */}
              {d?.top_skills && (
                <section>
                  <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Top 20 Skills</h2>
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={d.top_skills.slice(0, 20)} layout="vertical" margin={{ left: 80 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="skill" width={75} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="hsl(217, 91%, 55%)" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </section>
              )}

              {/* Rising skills */}
              {d?.rising_skills && (
                <section>
                  <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5" /> Rising Skills
                  </h2>
                  <div className="space-y-2">
                    {d.rising_skills.map((s: any, i: number) => (
                      <div key={s.skill} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-muted-foreground w-4">{i + 1}</span>
                          <span>{s.skill}</span>
                        </div>
                        <span className="font-mono text-xs text-primary">
                          +{safeNum(s.delta)} ({safePct(s.delta_pct)})
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Role family distribution */}
              {d?.top_role_families && (
                <section>
                  <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Top Role Families</h2>
                  <div className="space-y-1.5">
                    {d.top_role_families.map((r: any) => (
                      <div key={r.role_family} className="flex items-center justify-between text-sm">
                        <span>{r.role_family}</span>
                        <span className="font-mono text-xs text-muted-foreground">{safeNum(r.count)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Weekly study focus */}
              {d?.study_focus && (
                <section>
                  <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Study Focus</h2>
                  <div className="space-y-2 rounded-lg border border-border/50 p-3">
                    <p className="text-sm">
                      <span className="font-medium">Primary:</span> {d.study_focus.primary_skill}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Secondary:</span> {d.study_focus.secondary_skill}
                    </p>
                    <p className="text-xs text-muted-foreground">{d.study_focus.why}</p>
                  </div>
                </section>
              )}

              {/* Employers */}
              {d?.top_employers && (
                <section>
                  <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <Building className="h-3.5 w-3.5" /> Top Employers
                  </h2>
                  <div className="space-y-1.5">
                    {d.top_employers.map((e: any, i: number) => (
                      <div key={e.name} className="flex items-center justify-between text-sm">
                        <span>{e.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{safeNum(e.count)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Region breakdown */}
              {d?.region_breakdown && (
                <section>
                  <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" /> Region Breakdown
                  </h2>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={d.region_breakdown}
                        dataKey="count"
                        nameKey="region"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ region, percent }) => `${region} ${isFinite(percent) ? (percent * 100).toFixed(0) : 0}%`}
                      >
                        {d.region_breakdown.map((_: any, i: number) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
