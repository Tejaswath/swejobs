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
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-12 w-full" />
                <Skeleton className="mt-2 h-12 w-full" />
              </div>
            ))}
          </div>
        ) : buckets.length === 0 ? (
          <div className="mt-5 rounded-[24px] border border-dashed border-border/60 bg-background/35 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-base font-medium text-foreground">No upcoming deadlines right now</p>
                <p className="mt-1 text-sm text-muted-foreground">Use Explore to keep building your shortlist before the next close dates appear.</p>
              </div>
              <Button asChild variant="outline" className="gap-1.5 self-start">
                <Link to="/jobs">
                  Explore active roles
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
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
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/90">{bucket.label}</p>
                  </div>
                  <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium", bucket.badgeClassName)}>
                    {bucket.count}
                  </span>
                </div>

                <div className="mt-4 space-y-2">
                  {bucket.jobs.map((job) => (
                    <Link
                      key={job.id}
                      to={job.href}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      className="group block rounded-2xl border border-border/60 bg-background/70 p-3 transition-colors hover:border-primary/25 hover:bg-background/90"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{job.headline}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{job.employerName}</p>
                        </div>
                        <span className="shrink-0 rounded-full border border-border/60 bg-card/85 px-2 py-1 text-[11px] text-muted-foreground">
                          {job.deadlineLabel}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
