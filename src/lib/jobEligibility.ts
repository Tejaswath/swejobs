export type EligibilityLens = "high_signal" | "broad" | "graduate_trainee";

export type EligibilityJob = {
  is_active?: unknown;
  is_target_role?: unknown;
  is_noise?: unknown;
  relevance_score?: unknown;
  headline?: string | null;
  career_stage?: unknown;
  career_stage_confidence?: unknown;
  role_family_confidence?: unknown;
  years_required_min?: unknown;
  is_grad_program?: unknown;
  swedish_required?: unknown;
  citizenship_required?: unknown;
  security_clearance_required?: unknown;
  reason_codes?: unknown;
  source_kind?: unknown;
  source_feed_key?: unknown;
};

export type FeedEligibility = {
  enabled?: unknown;
  high_signal_eligible?: unknown;
  quality_band?: unknown;
};

const SENIOR_TITLE_PATTERN =
  /\b(senior|lead|principal|staff|architect|manager|head of|director|vp|vice president|experienced|expert|seasoned|erfaren|erfarenhet|flerårig|flerarig|gedigen erfarenhet)\b/i;
const SENIOR_STAGES = new Set(["senior", "lead", "staff", "principal"]);
const GRAD_STAGES = new Set(["graduate", "trainee", "junior"]);

function normalizedCareerStage(stage: unknown): string {
  return String(stage || "unknown").toLowerCase();
}

export function boolValue(value: unknown): boolean {
  return value === true;
}

export function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function effectiveCareerStage(stage: unknown, confidence: unknown): string {
  const normalized = normalizedCareerStage(stage);
  const score = Number(confidence);
  if (!Number.isFinite(score) || score < 0.6) return "unknown";
  return normalized;
}

export function hasSeniorRoleSignal(job: EligibilityJob): boolean {
  if (SENIOR_TITLE_PATTERN.test(String(job.headline ?? ""))) return true;
  if (SENIOR_STAGES.has(normalizedCareerStage(job.career_stage))) return true;
  if (numberValue(job.years_required_min, -1) >= 3) return true;
  if (!Array.isArray(job.reason_codes)) return false;
  const reasons = new Set(job.reason_codes.map((value) => String(value).toLowerCase()));
  return reasons.has("career_stage_senior") || reasons.has("years_required_3plus");
}

export function hasDefaultRestriction(job: EligibilityJob): boolean {
  return (
    boolValue(job.swedish_required) ||
    boolValue(job.citizenship_required) ||
    boolValue(job.security_clearance_required)
  );
}

export function isGraduateTraineeCandidate(job: EligibilityJob): boolean {
  if (hasSeniorRoleSignal(job) || hasDefaultRestriction(job)) return false;
  const stage = normalizedCareerStage(job.career_stage);
  const years =
    job.years_required_min === null || job.years_required_min === undefined
      ? Number.POSITIVE_INFINITY
      : numberValue(job.years_required_min, Number.POSITIVE_INFINITY);
  return boolValue(job.is_grad_program) || GRAD_STAGES.has(stage) || years <= 2;
}

export type EarlyCareerBucket = "confirmed_graduate" | "junior" | "unknown_possible" | "stretch";

export function earlyCareerBucket(job: EligibilityJob): EarlyCareerBucket {
  const stage = effectiveCareerStage(job.career_stage, job.career_stage_confidence);
  const years =
    job.years_required_min === null || job.years_required_min === undefined
      ? Number.POSITIVE_INFINITY
      : numberValue(job.years_required_min, Number.POSITIVE_INFINITY);
  if (boolValue(job.is_grad_program) || stage === "graduate" || stage === "trainee") return "confirmed_graduate";
  if (stage === "junior" || years <= 2) return "junior";
  if (stage === "unknown" && !hasSeniorRoleSignal(job)) return "unknown_possible";
  return "stretch";
}

export function jobPassesLens(
  job: EligibilityJob,
  lens: EligibilityLens,
  feed: FeedEligibility | null | undefined,
  includeJobtechInHighSignal: boolean,
): boolean {
  if (!boolValue(job.is_active) || boolValue(job.is_noise)) return false;
  if (lens === "broad") return !hasDefaultRestriction(job);
  if (hasDefaultRestriction(job) || hasSeniorRoleSignal(job)) return false;

  const relevance = numberValue(job.relevance_score);
  if (lens === "graduate_trainee") return relevance >= 15 && isGraduateTraineeCandidate(job);
  if (!boolValue(job.is_target_role) || relevance < 30) return false;

  if (String(job.source_kind || "").toLowerCase() === "jobtech") return includeJobtechInHighSignal;
  const quality = String(feed?.quality_band || "unrated").toLowerCase();
  return (
    boolValue(feed?.enabled) &&
    boolValue(feed?.high_signal_eligible) &&
    (quality === "trusted" || quality === "verified")
  );
}
