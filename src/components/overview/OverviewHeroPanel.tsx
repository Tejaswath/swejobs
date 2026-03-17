import { ArrowRight, Compass, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";

import { OverviewSignalStrip } from "@/components/overview/OverviewSignalStrip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import type { OverviewSignalStripItem } from "./types";

export function OverviewHeroPanel({
  signalItems,
  isSignalsLoading,
  signalsUnavailable,
  momentumLabel,
}: {
  signalItems: OverviewSignalStripItem[];
  isSignalsLoading?: boolean;
  signalsUnavailable?: boolean;
  momentumLabel?: string | null;
}) {
  return (
    <div className="relative overflow-hidden rounded-[30px] border border-border/60 bg-card/80 px-6 py-6 shadow-[0_18px_60px_rgba(2,8,23,0.18)] sm:px-7 sm:py-7">
      <div className="pointer-events-none absolute -left-10 top-0 h-44 w-44 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-0 h-48 w-48 rounded-full bg-sky-500/10 blur-3xl" />

      <div className="relative space-y-5">
        <div className="flex items-center gap-2">
          {momentumLabel ? (
            <Badge className="gap-1.5 border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-emerald-300 hover:bg-emerald-500/10">
              <TrendingUp className="h-3.5 w-3.5" />
              {momentumLabel}
            </Badge>
          ) : null}
        </div>

        <div className="space-y-2">
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-[3.15rem] lg:leading-[0.98]">
            Make your next application from signal, not noise.
          </h1>
        </div>

        <OverviewSignalStrip
          items={signalItems}
          isLoading={isSignalsLoading}
          unavailable={signalsUnavailable}
        />

        <div>
          <Button asChild size="lg" className="h-11 rounded-xl px-5 text-base">
            <Link to="/jobs">
              <Compass className="h-4 w-4" />
              Explore ranked roles
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
