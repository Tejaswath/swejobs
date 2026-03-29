import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  companyRegistry,
  companyCoverageStatusCounts,
  connectedCompanyRegistryEntries,
  connectedViaJobTechRegistryEntries,
  connectedCompanySourceCount,
  normalizeCompanyKey,
  plannedCompanyRegistryEntries,
  providerLabel,
} from "@/lib/companyRegistry";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const REFRESH_MS = 300_000;

function formatMaybeDate(value: string | null): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString("sv-SE");
}

export default function Admin() {
  const { user, loading } = useAuth();

  useEffect(() => {
    document.title = "Pipeline Admin | SweJobs";
  }, []);

  const connectedSources = connectedCompanySourceCount();
  const connectedCompanies = connectedCompanyRegistryEntries();
  const connectedViaJobTech = connectedViaJobTechRegistryEntries();
  const plannedCompanies = plannedCompanyRegistryEntries();
  const coverageCounts = companyCoverageStatusCounts();
  const missingCount =
    coverageCounts.planned + coverageCounts.blocked + coverageCounts.html_fallback_candidate;

  const { data: freshnessState, isLoading, error, refetch } = useQuery({
    queryKey: ["pipeline-freshness"],
    enabled: !!user,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const [
        { data: pollState, error: pollError },
        { data: atsState, error: atsError },
        { data: activeJobs, error: activeJobsError },
        { data: companyState, error: companyStateError },
      ] = await Promise.all([
        supabase.from("ingestion_state").select("key, value").eq("key", "last_poll_at"),
        supabase.from("ingestion_state").select("key, value").like("key", "feed:%:last_success_at"),
        supabase.from("jobs").select("company_canonical").eq("is_active", true).not("company_canonical", "is", null).limit(10000),
        supabase.from("ingestion_state").select("key, value").like("key", "company:%:last_seen_at"),
      ]);
      if (pollError) throw pollError;
      if (atsError) throw atsError;
      if (activeJobsError) throw activeJobsError;
      if (companyStateError) throw companyStateError;

      const lastPollAt =
        pollState?.find((item) => item.key === "last_poll_at")?.value ?? null;
      const lastAtsSync =
        atsState
          ?.map((item) => item.value)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;

      const activeJobsByCompany: Record<string, number> = {};
      for (const row of activeJobs ?? []) {
        const key = normalizeCompanyKey(row.company_canonical);
        if (!key) continue;
        activeJobsByCompany[key] = (activeJobsByCompany[key] ?? 0) + 1;
      }

      const companyLastSeenAt: Record<string, string> = {};
      for (const row of companyState ?? []) {
        const match = /^company:([^:]+):last_seen_at$/i.exec(String(row.key ?? ""));
        if (!match) continue;
        const normalizedCanonical = normalizeCompanyKey(match[1].replace(/_/g, " "));
        if (!normalizedCanonical || !row.value) continue;
        companyLastSeenAt[normalizedCanonical] = row.value;
      }

      return { lastPollAt, lastAtsSync, activeJobsByCompany, companyLastSeenAt };
    },
  });

  const companyCoverageRows = companyRegistry
    .map((company) => {
      const key = normalizeCompanyKey(company.company_canonical);
      return {
        company,
        activeJobs: freshnessState?.activeJobsByCompany?.[key] ?? 0,
        lastSeenAt: freshnessState?.companyLastSeenAt?.[key] ?? null,
      };
    })
    .sort((left, right) => {
      const activeDiff = right.activeJobs - left.activeJobs;
      if (activeDiff !== 0) return activeDiff;
      return left.company.display_name.localeCompare(right.company.display_name, "sv-SE");
    });

  const coverageGapRows = companyCoverageRows
    .filter((row) => row.activeJobs === 0)
    .sort((left, right) => {
      if (left.company.priority_tier !== right.company.priority_tier) {
        return left.company.priority_tier.localeCompare(right.company.priority_tier);
      }
      return left.company.display_name.localeCompare(right.company.display_name, "sv-SE");
    });

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </AppLayout>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pipeline Admin</h1>
          <p className="text-sm text-muted-foreground">Operational sync and source coverage status</p>
        </div>

        {error && (
          <Card className="border-destructive/40">
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-medium text-destructive">Could not load pipeline freshness data.</p>
              <p className="text-xs text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border/40 bg-card/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Last sync</p>
            <p className="mt-1 text-sm font-medium">
              {isLoading ? "Loading..." : formatMaybeDate(freshnessState?.lastPollAt ?? null)}
            </p>
          </div>
          <div className="rounded-lg border border-border/40 bg-card/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Connected company sources</p>
            <p className="mt-1 text-sm font-medium">{connectedSources}</p>
          </div>
          <div className="rounded-lg border border-border/40 bg-card/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Last ATS sync</p>
            <p className="mt-1 text-sm font-medium">
              {isLoading ? "Loading..." : formatMaybeDate(freshnessState?.lastAtsSync ?? null)}
            </p>
          </div>
        </section>

        <section className="rounded-lg border border-border/40 bg-card/60 px-4 py-4">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Coverage status</p>
              <h2 className="mt-1 text-base font-medium">Connected company sources</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                SweJobs has {coverageCounts.connected} direct ATS connections and {coverageCounts.connected_jobtech} companies
                covered via JobTech attribution. {missingCount} remain planned/blocked/fallback.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className="font-normal">Direct ATS {coverageCounts.connected}</Badge>
              <Badge variant="outline" className="font-normal">Via JobTech {coverageCounts.connected_jobtech}</Badge>
              <Badge variant="outline" className="font-normal">Missing {missingCount}</Badge>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Live now</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {connectedCompanies.map((company) => (
                  <Badge key={company.company_canonical} variant="secondary" className="gap-1 font-normal">
                    {company.display_name}
                    <span className="text-xs text-muted-foreground">{providerLabel(company.provider)}</span>
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Connected via JobTech</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {connectedViaJobTech.slice(0, 20).map((company) => (
                  <Badge key={company.company_canonical} variant="outline" className="font-normal">
                    {company.display_name}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Next planned targets</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {plannedCompanies.slice(0, 20).map((company) => (
                <Badge key={company.company_canonical} variant="outline" className="font-normal">
                  {company.display_name}
                </Badge>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border/40 bg-card/60 px-4 py-4">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Company activity</p>
              <h2 className="mt-1 text-base font-medium">Per-company active job counts</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Counts are derived from active jobs in the current dataset and combined with ingestion freshness markers.
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Company</th>
                  <th className="pb-2 pr-3 font-medium">Tier</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 pr-3 font-medium">Active jobs</th>
                  <th className="pb-2 pr-3 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {companyCoverageRows.slice(0, 40).map((row) => (
                  <tr key={row.company.company_canonical} className="border-t border-border/40">
                    <td className="py-2 pr-3">{row.company.display_name}</td>
                    <td className="py-2 pr-3">{row.company.priority_tier}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className="font-normal">
                        {row.company.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 font-medium">{row.activeJobs}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{formatMaybeDate(row.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-border/40 bg-card/60 px-4 py-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Coverage gaps</p>
          <h2 className="mt-1 text-base font-medium">Tracked companies with zero active jobs</h2>
          {coverageGapRows.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No coverage gaps in the current active dataset.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {coverageGapRows.slice(0, 40).map((row) => (
                <Badge key={row.company.company_canonical} variant="outline" className="font-normal">
                  {row.company.display_name} · Tier {row.company.priority_tier}
                </Badge>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
