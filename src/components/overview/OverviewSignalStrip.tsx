import { Link } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { OverviewSignalStripItem } from "./types";

export function OverviewSignalStrip({
  items,
  isLoading,
  unavailable,
}: {
  items: OverviewSignalStripItem[];
  isLoading?: boolean;
  unavailable?: boolean;
}) {
  if (unavailable) {
    return (
      <div className="rounded-[22px] border border-border/60 bg-background/45 px-4 py-3 text-sm text-muted-foreground">
        Unavailable right now
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid overflow-hidden rounded-[22px] border border-border/60 bg-background/45 md:grid-cols-3 lg:grid-cols-[0.95fr_0.95fr_1.1fr]">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="border-b border-border/40 px-4 py-3 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
            <Skeleton className="h-7 w-24 animate-shimmer bg-muted/70" />
            <Skeleton className="mt-2 h-3 w-16 animate-shimmer bg-muted/60" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid overflow-hidden rounded-[22px] border border-border/60 bg-background/45 md:grid-cols-3 lg:grid-cols-[0.95fr_0.95fr_1.1fr]">
      {items.map((item, index) => (
        <Link
          key={item.label}
          to={item.href}
          title={item.fullLabel}
          aria-label={item.fullLabel ? `${item.label}: ${item.fullLabel}` : item.label}
          className={cn(
            "px-4 py-3 transition-colors hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            index < items.length - 1 && "border-b border-border/40 md:border-b-0 md:border-r",
            index === 0 && "md:border-l-2 md:border-l-primary/40",
            item.tone === "due" && item.pulse && "bg-rose-500/[0.03]",
          )}
        >
          <div className="flex items-center gap-2">
            <div className={cn("min-w-0 text-[2rem] font-semibold tracking-tight text-foreground", item.accentClassName)}>
              {item.value}
            </div>
            {item.badge}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {item.tone === "due" && item.pulse ? (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
              </span>
            ) : null}
            {item.label}
          </p>
        </Link>
      ))}
    </div>
  );
}
