import { cn } from "@/lib/utils";

type FitLabel = "Strong" | "Possible" | "Stretch";

const SEGMENTS: Record<FitLabel, number> = { Strong: 3, Possible: 2, Stretch: 1 };
const TONE: Record<FitLabel, { fill: string; text: string }> = {
  Strong: { fill: "bg-primary", text: "text-primary" },
  Possible: { fill: "bg-sky-400", text: "text-sky-300" },
  Stretch: { fill: "bg-muted-foreground/70", text: "text-muted-foreground" },
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
            className={cn("h-3 w-[5px] rounded-[1px]", index < filled ? tone.fill : "bg-muted-foreground/20")}
          />
        ))}
      </span>
      <span className={cn("text-[11px] font-medium", tone.text)}>{label}</span>
    </span>
  );
}
