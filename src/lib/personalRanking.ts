import { numberValue } from "@/lib/jobEligibility";

export type UserProfileRankingInput = {
  location?: string | null;
  headline?: string | null;
};

export type JobLocationRankingInput = {
  remote_flag?: boolean | null;
  municipality?: string | null;
  region?: string | null;
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

export function profileLocationBoost(
  job: JobLocationRankingInput,
  profile: UserProfileRankingInput | null | undefined,
): number {
  if (!profile) return 0;
  const location = String(profile.location || "").toLowerCase();
  if (!location) return 0;

  let boost = 0;
  if (job.remote_flag && (location.includes("remote") || location.includes("distans"))) {
    boost += 5;
  }

  const municipality = String(job.municipality || "").toLowerCase();
  const region = String(job.region || "").toLowerCase();
  if (location.includes("stockholm") && (municipality.includes("stockholm") || region.includes("stockholm"))) {
    boost += 4;
  }

  return boost;
}

export function profileHeadlineBoost(
  job: { headline?: string | null; role_family?: string | null },
  profile: UserProfileRankingInput | null | undefined,
): number {
  if (!profile?.headline) return 0;

  const profileTokens = tokenize(profile.headline);
  const headlineTokens = tokenize(String(job.headline || ""));
  if (profileTokens.length === 0 || headlineTokens.length === 0) return 0;

  const overlap = profileTokens.filter((token) =>
    headlineTokens.some((headlineToken) => headlineToken.includes(token) || token.includes(headlineToken)),
  );

  if (overlap.length >= 2) return 4;
  if (overlap.length === 1) return 2;
  return 0;
}

export function aggregatePersonalFeedbackDelta(options: {
  companyRoleDelta?: number;
  highSignalScoreDelta?: number | null;
}): number {
  const raw =
    numberValue(options.companyRoleDelta) + Math.round(numberValue(options.highSignalScoreDelta) * 0.5);

  return Math.max(-15, Math.min(15, raw));
}
