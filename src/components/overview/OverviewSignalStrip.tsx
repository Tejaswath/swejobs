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
      <div className="rounded-[22px] border border-border/60 bg-background/45 px-4 py-3">
        <Skeleton className="h-5 w-56 max-w-full animate-shimmer bg-muted/70" />
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>;
  }

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      {items.map((item, index) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {index > 0 ? <span className="text-muted-foreground/40">·</span> : null}
          <Link
            to={item.href}
            title={item.fullLabel}
            aria-label={item.fullLabel ? `${item.label}: ${item.fullLabel}` : item.label}
            className={cn(
              "inline-flex items-center gap-1.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              item.tone === "due" && item.pulse && "text-rose-200/90",
            )}
          >
            <span className={cn("font-mono font-medium text-foreground", item.accentClassName)}>{item.value}</span>
            <span className="lowercase">{item.label}</span>
            {item.badge}
          </Link>
        </span>
      ))}
    </p>
  );
}
