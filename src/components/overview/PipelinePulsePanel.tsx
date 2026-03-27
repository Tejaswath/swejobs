import { Kanban } from "lucide-react";
import { Link } from "react-router-dom";

import { OverviewSectionHeader } from "@/components/overview/OverviewSectionHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { PipelineMetric } from "./types";

export function PipelinePulsePanel({
  metrics,
  isLoading,
  unavailable,
  actionHref,
  label = "Pipeline",
}: {
  metrics: PipelineMetric[];
  isLoading?: boolean;
  unavailable?: boolean;
  actionHref: string;
  label?: string;
}) {
  return (
    <Card className="overflow-hidden rounded-[30px] border-border/60 bg-card/80">
      <CardContent className="p-5 sm:p-6">
        <OverviewSectionHeader icon={Kanban} label={label} actionLabel="Open" to={actionHref} />

        {unavailable ? (
          <div className="mt-5 rounded-[24px] border border-dashed border-border/60 bg-background/35 p-5 text-sm text-muted-foreground">
            Unavailable right now
          </div>
        ) : isLoading ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-2xl border border-border/60 bg-background/45 p-4">
                <Skeleton className="mx-auto h-8 w-14" />
                <Skeleton className="mx-auto mt-3 h-3 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {metrics.map((metric) => (
              <Link
                key={metric.label}
                to={metric.href}
                className="rounded-2xl border border-border/60 bg-background/45 p-4 text-center transition-colors hover:border-primary/25 hover:bg-background/70"
              >
                <p className={cn("text-[2rem] font-semibold tracking-tight text-foreground", metric.accentClassName)}>
                  {metric.count}
                </p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  {metric.label}
                </p>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
