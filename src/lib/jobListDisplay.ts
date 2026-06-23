const EARLY_CAREER_LABELS = {
  confirmed_graduate: "confirmed graduate",
  junior: "junior",
  unknown_possible: "experience unspecified",
  stretch: "stretch",
} as const;

type CareerBucket = keyof typeof EARLY_CAREER_LABELS;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function listCareerLabel(lens: string, careerBucket: CareerBucket, stage: string): string | null {
  if (lens === "graduate_trainee") {
    if (careerBucket === "confirmed_graduate" || careerBucket === "junior") {
      return EARLY_CAREER_LABELS[careerBucket];
    }
    return null;
  }
  if (careerBucket !== "stretch" && careerBucket !== "unknown_possible") {
    return EARLY_CAREER_LABELS[careerBucket];
  }
  if (stage !== "unknown") return stage;
  return null;
}

export function listLocationHint(job: { municipality?: string | null; remote_flag?: boolean | null }): string | null {
  if (job.remote_flag) return "Remote";
  return job.municipality?.trim() || null;
}

export function deadlineShowsInList(deadline: string | null | undefined): boolean {
  if (!deadline) return false;
  const parsed = new Date(`${deadline}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const today = startOfLocalDay(new Date());
  const targetDay = startOfLocalDay(parsed);
  const diffDays = Math.floor((targetDay.getTime() - today.getTime()) / 86_400_000);
  return diffDays <= 7;
}

export function deadlineUrgencyClass(deadline: string | null | undefined): string | null {
  if (!deadlineShowsInList(deadline)) return null;
  const parsed = new Date(`${deadline}T00:00:00`);
  const today = startOfLocalDay(new Date());
  const targetDay = startOfLocalDay(parsed);
  const diffDays = Math.floor((targetDay.getTime() - today.getTime()) / 86_400_000);
  if (diffDays <= 0) return "border-rose-500/40 bg-rose-500/10 text-rose-100";
  return "border-orange-500/35 bg-orange-500/10 text-orange-100";
}
