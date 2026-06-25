import { cn } from "@/lib/utils";

type FitLabel = "Strong" | "Possible" | "Stretch";

const SEGMENTS: Record<FitLabel, number> = { Strong: 3, Possible: 2, Stretch: 1 };
const TONE: Record<FitLabel, { fill: string; empty: string; text: string }> = {
  Strong: { fill: "bg-emerald-400", empty: "bg-emerald-400/20", text: "text-emerald-300" },
  Possible: { fill: "bg-amber-400", empty: "bg-amber-400/20", text: "text-amber-300" },
  Stretch: { fill: "bg-zinc-500", empty: "bg-zinc-500/25", text: "text-zinc-400" },
};

export function FitIndicator({
  label,
  score,
  className,
}: {
  label: FitLabel;
  score?: number;
  className?: string;
}) {
  const filled = SEGMENTS[label];
  const tone = TONE[label];

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      title={
        score != null
          ? `${score}/100 — role relevance, career stage, résumé match, source quality, and your preferences.`
          : undefined
      }
      aria-label={`${label} fit${score != null ? `, ${score} of 100` : ""}`}
    >
      <span className="flex items-end gap-[2px]" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={cn(
              "h-3.5 w-1.5 rounded-[2px]",
              index < filled ? tone.fill : tone.empty,
            )}
          />
        ))}
      </span>
      <span className={cn("text-xs font-medium", tone.text)}>{label}</span>
    </span>
  );
}
