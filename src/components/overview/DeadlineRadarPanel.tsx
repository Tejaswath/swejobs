import { ArrowRight, CalendarClock } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";

import { OverviewSectionHeader } from "@/components/overview/OverviewSectionHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { DeadlineBucketViewModel } from "./types";

export function DeadlineRadarPanel({
  buckets,
  isLoading,
  unavailable,
}: {
  buckets: DeadlineBucketViewModel[];
  isLoading?: boolean;
  unavailable?: boolean;
}) {
  const navigate = useNavigate();

  return (
    <Card className="overflow-hidden rounded-[30px] border-border/60 bg-card/80">
      <CardContent className="p-5 sm:p-6">
        <OverviewSectionHeader
          icon={CalendarClock}
          label="Deadline radar"
          actionLabel="View all deadlines"
          to="/jobs?deadline=upcoming"
        />

        {unavailable ? (
          <div className="mt-5 rounded-[24px] border border-dashed border-border/60 bg-background/35 p-5 text-sm text-muted-foreground">
            Unavailable right now
          </div>
        ) : isLoading ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="rounded-[24px] border border-border/60 bg-background/35 p-4">
                <Skeleton className="h-4 w-24 animate-shimmer" />
                <Skeleton className="mt-3 h-12 w-full animate-shimmer" />
                <Skeleton className="mt-2 h-12 w-full animate-shimmer" />
              </div>
            ))}
          </div>
        ) : buckets.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-3 rounded-[24px] border border-dashed border-border/60 bg-background/35 p-8 text-center">
            <CalendarClock className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No upcoming deadlines</p>
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Link to="/jobs">
                Explore roles
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              "mt-5 grid gap-3",
              buckets.length === 1 ? "grid-cols-1" : buckets.length === 2 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1 lg:grid-cols-3",
            )}
          >
            {buckets.map((bucket) => (
              <div
                key={bucket.id}
                role="link"
                tabIndex={0}
                onClick={() => navigate(bucket.href)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(bucket.href);
                  }
                }}
                className={cn(
                  "cursor-pointer rounded-[24px] border p-4 transition-colors hover:border-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  bucket.accentClassName,
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/90">{bucket.label}</p>
                  <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium", bucket.badgeClassName)}>
                    {bucket.count}
                  </span>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 h-8 w-full justify-between text-xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(bucket.href);
                  }}
                >
                  Open roles
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
