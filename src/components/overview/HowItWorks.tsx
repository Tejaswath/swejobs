import { Compass, FileText, Target } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

const STEPS = [
  {
    icon: Compass,
    title: "Find",
    description: "Relevant Swedish software roles from connected sources.",
  },
  {
    icon: FileText,
    title: "See your fit",
    description: "Match your résumé to each role before you apply.",
  },
  {
    icon: Target,
    title: "Apply & track",
    description: "Apply and follow your progress in one place.",
  },
] as const;

export function HowItWorks() {
  return (
    <Card className="rounded-[24px] border-border/60 bg-card/80">
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">How it works</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.title} className="space-y-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/40">
                <step.icon className="h-4 w-4 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">{step.title}</p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
