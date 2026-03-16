import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  companyCoverageStatusCounts,
  connectedCompanyRegistryEntries,
  connectedCompanySourceCount,
  plannedCompanyRegistryEntries,
  providerLabel,
} from "@/lib/companyRegistry";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const REFRESH_MS = 60_000;

export default function Admin() {
  const { user, loading } = useAuth();

  useEffect(() => {
    document.title = "Pipeline Admin | SweJobs";
  }, []);

  const connectedSources = connectedCompanySourceCount();
  const connectedCompanies = connectedCompanyRegistryEntries();
  const plannedCompanies = plannedCompanyRegistryEntries();
  const coverageCounts = companyCoverageStatusCounts();

  const { data: freshnessState, isLoading, error, refetch } = useQuery({
    queryKey: ["pipeline-freshness"],
    enabled: !!user,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const [{ data: pollState, error: pollError }, { data: atsState, error: atsError }] = await Promise.all([
        supabase.from("ingestion_state").select("key, value").eq("key", "last_poll_at"),
        supabase.from("ingestion_state").select("key, value").like("key", "feed:%:last_success_at"),
      ]);
      if (pollError) throw pollError;
      if (atsError) throw atsError;

      const lastPollAt =
        pollState?.find((item) => item.key === "last_poll_at")?.value ?? null;
      const lastAtsSync =
        atsState
          ?.map((item) => item.value)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;

      return { lastPollAt, lastAtsSync };
    },
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
              {isLoading
                ? "Loading..."
                : freshnessState?.lastPollAt
                  ? new Date(freshnessState.lastPollAt).toLocaleString("sv-SE")
                  : "Unknown"}
            </p>
          </div>
          <div className="rounded-lg border border-border/40 bg-card/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Connected company sources</p>
            <p className="mt-1 text-sm font-medium">{connectedSources}</p>
          </div>
          <div className="rounded-lg border border-border/40 bg-card/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Last ATS sync</p>
            <p className="mt-1 text-sm font-medium">
              {isLoading
                ? "Loading..."
                : freshnessState?.lastAtsSync
                  ? new Date(freshnessState.lastAtsSync).toLocaleString("sv-SE")
                  : "Not synced yet"}
            </p>
          </div>
        </section>

        <section className="rounded-lg border border-border/40 bg-card/60 px-4 py-4">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Coverage status</p>
              <h2 className="mt-1 text-base font-medium">Connected company sources</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                SweJobs is currently connected to {coverageCounts.connected} company sources. Another{" "}
                {coverageCounts.planned} target companies are planned but not integrated yet.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className="font-normal">Connected {coverageCounts.connected}</Badge>
              <Badge variant="outline" className="font-normal">Planned {coverageCounts.planned}</Badge>
              <Badge variant="outline" className="font-normal">Blocked {coverageCounts.blocked}</Badge>
              <Badge variant="outline" className="font-normal">HTML fallback {coverageCounts.html_fallback_candidate}</Badge>
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
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Next planned targets</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {plannedCompanies.slice(0, 20).map((company) => (
                  <Badge key={company.company_canonical} variant="outline" className="font-normal">
                    {company.display_name}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
