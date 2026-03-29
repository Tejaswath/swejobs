import type { ReactNode } from "react";

export type OverviewSignalStripItem = {
  label: string;
  value: ReactNode;
  href: string;
  accentClassName?: string;
  fullLabel?: string;
  badge?: ReactNode;
  tone?: "neutral" | "live" | "due";
  pulse?: boolean;
};

export type DeadlinePreviewJob = {
  id: number;
  headline: string;
  employerName: string | null;
  deadlineLabel: string;
  href: string;
};

export type DeadlineBucketViewModel = {
  id: "today" | "thisWeek" | "later";
  label: string;
  count: number;
  href: string;
  accentClassName: string;
  badgeClassName: string;
  jobs?: DeadlinePreviewJob[];
};

export type PipelineMetric = {
  label: string;
  count: number;
  href: string;
  accentClassName?: string;
};

export type StudySkillChip = {
  name: string;
  count?: number;
  delta?: number | null;
  isRising: boolean;
};
