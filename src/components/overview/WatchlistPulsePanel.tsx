import { ArrowRight, Building } from "lucide-react";
import { Link } from "react-router-dom";

import { OverviewSectionHeader } from "@/components/overview/OverviewSectionHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function WatchlistPulsePanel({
  actionHref,
  actionLabel,
  isAuthenticated,
  trackedCount,
  openings,
  companies,
  isLoading,
  unavailable,
}: {
  actionHref: string;
  actionLabel: string;
  isAuthenticated: boolean;
  trackedCount: number;
  openings: number;
  companies?: Array<{ name: string; count: number }>;
  isLoading?: boolean;
  unavailable?: boolean;
}) {
  return (
    <Card className="overflow-hidden rounded-[30px] border-border/60 bg-card/80">
      <CardContent className="p-5 sm:p-6">
        <OverviewSectionHeader icon={Building} label="Watchlist" actionLabel={actionLabel} to={actionHref} />

        {unavailable ? (
          <div className="mt-5 rounded-[24px] border border-dashed border-border/60 bg-background/35 p-5 text-sm text-muted-foreground">
            Unavailable right now
          </div>
        ) : isLoading ? (
          <div className="mt-5 space-y-3">
            <Skeleton className="h-10 w-32 animate-shimmer" />
            <Skeleton className="h-20 w-full animate-shimmer" />
          </div>
        ) : trackedCount === 0 ? (
          <div className="mt-5 rounded-[24px] border border-dashed border-border/60 bg-background/35 p-5">
            <p className="text-sm text-foreground">{isAuthenticated ? "No companies tracked yet." : "Watch companies to see openings here."}</p>
            <Link to={actionHref} className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80">
              {isAuthenticated ? "Manage watchlist" : "Sign in"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-border/60 bg-background/35 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Total openings</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{openings}</p>
            </div>

            <div className="rounded-2xl border border-border/60 bg-background/35 p-3">
              <div className="space-y-2">
                {(companies ?? []).slice(0, 5).map((company) => (
                  <Link
                    key={company.name}
                    to={actionHref}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-background/70"
                  >
                    <span className="truncate text-foreground">{company.name}</span>
                    <span className="shrink-0 text-muted-foreground">{company.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
