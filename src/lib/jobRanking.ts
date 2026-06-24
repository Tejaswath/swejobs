import { effectiveCareerStage, numberValue, type EligibilityJob } from "@/lib/jobEligibility";

export type RankingJob = EligibilityJob & {
  id?: unknown;
  company_tier?: unknown;
  source_kind?: unknown;
  is_direct_company_source?: unknown;
  published_at?: unknown;
  application_deadline?: unknown;
  role_family?: unknown;
};

export type RankingContext = {
  atsMatch?: number | null;
  watched?: boolean;
  qualityBand?: string | null;
  feedbackDelta?: number;
  profileLocationBoost?: number;
  profileHeadlineBoost?: number;
  now?: Date;
};

export type SuitabilityResult = {
  score: number;
  label: "Strong" | "Possible" | "Stretch";
  reasons: string[];
};

const GENERIC_SUITABILITY_REASONS = new Set(["Relevant software role"]);

/** First user-facing reason that adds decision value beyond the generic role-family label. */
export function primarySuitabilityReason(result: SuitabilityResult): string | null {
  return result.reasons.find((reason) => !GENERIC_SUITABILITY_REASONS.has(reason)) ?? null;
}

function freshnessScore(value: unknown, now: Date): number {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (now.getTime() - timestamp) / 86_400_000);
  if (days <= 3) return 10;
  if (days <= 7) return 7;
  if (days <= 14) return 4;
  return 0;
}

function deadlineScore(value: unknown, now: Date): number {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return 0;
  const days = (timestamp - now.getTime()) / 86_400_000;
  if (days < 0) return -10;
  if (days <= 3) return 6;
  if (days <= 7) return 4;
  if (days <= 14) return 2;
  return 0;
}

export function suitabilityScore(job: RankingJob, context: RankingContext = {}): SuitabilityResult {
  const reasons: string[] = [];
  let score = 0;

  if (job.is_target_role === true) {
    score += 18;
    reasons.push("Relevant software role");
  }
  const roleConfidence = Math.max(0, Math.min(1, numberValue(job.role_family_confidence, 0)));
  score += Math.round(roleConfidence * 8);
  if (roleConfidence >= 0.9) reasons.push("Strong title signal");

  const stage = effectiveCareerStage(job.career_stage, job.career_stage_confidence);
  if (stage === "graduate" || stage === "trainee" || stage === "junior") {
    score += 28;
    reasons.push("Early-career fit");
  } else if (stage === "unknown") {
    score += 12;
  } else if (stage === "mid") {
    score -= 12;
    reasons.push("May require more experience");
  }

  if (context.atsMatch !== null && context.atsMatch !== undefined) {
    const match = Math.max(0, Math.min(100, numberValue(context.atsMatch)));
    score += Math.round(match * 0.45);
    if (match >= 60) reasons.push(`Strong resume match (${match}%)`);
    else if (match >= 35) reasons.push(`Useful resume match (${match}%)`);
  }

  const quality = String(context.qualityBand || "").toLowerCase();
  const direct = job.is_direct_company_source === true || String(job.source_kind || "") === "direct_company_ats";
  if (direct) {
    score += 10;
    reasons.push("Direct company application");
  }
  if (quality === "trusted") score += 6;
  else if (quality === "verified") score += 4;
  else if (String(job.source_kind || "") === "jobtech") score += 1;

  const fresh = freshnessScore(job.published_at, context.now ?? new Date());
  score += fresh;
  if (fresh >= 7) reasons.push("Recently posted");
  const deadline = deadlineScore(job.application_deadline, context.now ?? new Date());
  score += deadline;
  if (deadline >= 4) reasons.push("Deadline approaching");

  if (context.watched) {
    score += 8;
    reasons.push("Company you follow");
  }
  if (numberValue(context.profileLocationBoost) > 0) {
    score += numberValue(context.profileLocationBoost);
    reasons.push("Matches your location preference");
  }
  if (numberValue(context.profileHeadlineBoost) > 0) {
    score += numberValue(context.profileHeadlineBoost);
    reasons.push("Matches your profile focus");
  }
  const tier = String(job.company_tier || "").toUpperCase();
  if (tier === "A") score += 4;
  else if (tier === "B") score += 2;

  score += Math.max(-15, Math.min(15, numberValue(context.feedbackDelta)));
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 70 ? "Strong" : score >= 45 ? "Possible" : "Stretch";
  return { score, label, reasons: reasons.slice(0, 3) };
}
