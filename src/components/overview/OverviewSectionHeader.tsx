import { ArrowRight, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

export function OverviewSectionHeader({
  icon: Icon,
  label,
  actionLabel,
  to,
  className,
}: {
  icon: LucideIcon;
  label: string;
  actionLabel?: string;
  to?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </h2>
      {actionLabel && to ? (
        <Link
          to={to}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {actionLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  );
}
