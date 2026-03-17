import { ArrowRight, Building } from "lucide-react";
import { Link } from "react-router-dom";

import { OverviewSectionHeader } from "@/components/overview/OverviewSectionHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function WatchlistPulsePanel({
  actionHref,
  actionLabel,
  trackedCount,
  openings,
  featured,
  isLoading,
  unavailable,
}: {
  actionHref: string;
  actionLabel: string;
  trackedCount: number;
  openings: number;
  featured?: { name: string; count: number };
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
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : trackedCount === 0 ? (
          <div className="mt-5 rounded-[24px] border border-dashed border-border/60 bg-background/35 p-5">
            <p className="text-sm font-medium text-foreground">No companies tracked yet</p>
            <Link to={actionHref} className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80">
              Start from tracker
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[2rem] font-semibold tracking-tight text-foreground">{openings}</p>
                <p className="text-sm text-muted-foreground">openings across watched companies</p>
              </div>
              <Badge variant="secondary" className="border border-border/60 bg-background/70 text-foreground">
                {trackedCount} tracked
              </Badge>
            </div>

            {featured ? (
              <Link
                to={actionHref}
                className="group flex items-center justify-between rounded-2xl border border-border/60 bg-background/45 p-3 transition-colors hover:border-primary/25 hover:bg-background/70"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 font-semibold text-primary">
                    {featured.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{featured.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {featured.count} opening{featured.count === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
              </Link>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
