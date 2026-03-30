import { ArrowRight, Compass } from "lucide-react";
import { Link } from "react-router-dom";

import { OverviewSignalStrip } from "@/components/overview/OverviewSignalStrip";
import { Button } from "@/components/ui/button";

import type { OverviewSignalStripItem } from "./types";

export function OverviewHeroPanel({
  signalItems,
  headline,
  subtext,
  primaryActionLabel = "Explore roles",
  primaryActionHref = "/jobs",
  secondaryAction,
  isSignalsLoading,
  signalsUnavailable,
}: {
  signalItems: OverviewSignalStripItem[];
  headline: string;
  subtext?: string;
  primaryActionLabel?: string;
  primaryActionHref?: string;
  secondaryAction?: { label: string; href: string } | null;
  isSignalsLoading?: boolean;
  signalsUnavailable?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-[30px] border border-border/60 bg-card/80 px-6 py-5 shadow-[0_18px_60px_rgba(2,8,23,0.18)] glow-sm sm:px-7 sm:py-5">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/60 via-sky-400/40 to-primary/20" />
      <div className="pointer-events-none absolute -left-10 top-0 h-44 w-44 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-0 h-48 w-48 rounded-full bg-sky-500/10 blur-3xl" />

      <div className="relative space-y-5">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{headline}</h1>
          {subtext ? <p className="text-sm text-muted-foreground sm:text-base">{subtext}</p> : null}
        </div>

        <OverviewSignalStrip
          items={signalItems}
          isLoading={isSignalsLoading}
          unavailable={signalsUnavailable}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="default" className="h-9 rounded-xl bg-gradient-to-r from-primary to-primary/80 px-4 text-sm shadow-lg shadow-primary/20 hover:shadow-primary/30">
            <Link to={primaryActionHref}>
              <Compass className="h-4 w-4" />
              {primaryActionLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          {secondaryAction ? (
            <Button asChild variant="outline" size="default" className="h-9 rounded-xl px-4 text-sm">
              <Link to={secondaryAction.href}>{secondaryAction.label}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
