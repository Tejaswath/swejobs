import { Kanban } from "lucide-react";
import { Link } from "react-router-dom";

import { OverviewSectionHeader } from "@/components/overview/OverviewSectionHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { PipelineMetric } from "./types";

type MetricGroup = {
  label: string;
  metrics: PipelineMetric[];
  actionHref: string;
  isLoading?: boolean;
  unavailable?: boolean;
};

function MetricGroupRow({ group }: { group: MetricGroup }) {
  const metricColumnsClass =
    group.metrics.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3";

  if (group.unavailable) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-background/35 px-4 py-4 text-sm text-muted-foreground">
        {group.label} unavailable right now
      </div>
    );
  }

  if (group.isLoading) {
    return (
      <div className={cn("grid gap-3", metricColumnsClass)}>
        {Array.from({ length: Math.max(3, group.metrics.length) }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-border/60 bg-background/45 p-4">
            <Skeleton className="mx-auto h-8 w-14" />
            <Skeleton className="mx-auto mt-3 h-3 w-16" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("grid gap-3", metricColumnsClass)}>
      {group.metrics.map((metric) => (
        <Link
          key={`${group.label}-${metric.label}`}
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
  );
}

export function PipelinePulsePanel({
  label = "Pipeline",
  primaryGroup,
  secondaryGroup,
  footnote,
  quickAction,
}: {
  label?: string;
  primaryGroup: MetricGroup;
  secondaryGroup?: MetricGroup;
  footnote?: string;
  quickAction?: { label: string; href: string } | null;
}) {
  return (
    <Card className="overflow-hidden rounded-[30px] border-border/60 bg-card/80">
      <CardContent className="p-5 sm:p-6">
        <OverviewSectionHeader icon={Kanban} label={label} />

        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              {primaryGroup.label}
            </p>
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
              <Link to={primaryGroup.actionHref}>Open</Link>
            </Button>
          </div>
          <MetricGroupRow group={primaryGroup} />

          {secondaryGroup ? (
            <div className="border-t border-border/50 pt-4">
              <div className="mb-4 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  {secondaryGroup.label}
                </p>
                <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                  <Link to={secondaryGroup.actionHref}>Open</Link>
                </Button>
              </div>
              <MetricGroupRow group={secondaryGroup} />
            </div>
          ) : null}

          {footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
          {quickAction ? (
            <Button asChild size="sm" className="h-8 text-xs">
              <Link to={quickAction.href}>{quickAction.label}</Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
