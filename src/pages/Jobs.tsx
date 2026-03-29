import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { AppLayout } from "@/components/AppLayout";
import { AdvancedFiltersPopover } from "@/components/jobs/AdvancedFiltersPopover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  MapPin,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  Building,
  Bookmark,
  X,
  Star,
  TrendingUp,
  Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import {
  companyDisplayName,
  findCompanyRegistryEntry,
  getCompanyRegistryEntryByCanonical,
  normalizeCompanyKey,
  providerLabel,
} from "@/lib/companyRegistry";
import { buildSweJobsApplication } from "@/lib/applications";
import { extractKeywordsFromJobText, runAtsScan, type AtsScanResult } from "@/lib/ats";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const LIST_FETCH_LIMIT = 300;
const REFRESH_MS = 600_000;
const WATCHED_COMPANY_BOOST = 35;
const CAREER_STAGE_CONFIDENCE_THRESHOLD = 0.6;

type Lens = "best_matches" | "all_roles" | "graduate_trainee" | "main_companies" | "hidden_gems" | "consultancies";
type JobSort = "relevance" | "deadline" | "newest" | "ats_desc";
type SearchFallbackMode = "none" | "show_swedish" | "show_experience" | "show_both" | "show_both_best_matches";
type DeadlineFocus = "none" | "today" | "week" | "upcoming";

const LENSES: Array<{ id: Lens; label: string; description: string }> = [
  { id: "best_matches", label: "Best Matches", description: "Top ranked roles for your profile" },
  { id: "all_roles", label: "All Roles", description: "Every active role, no target-role filter" },
  { id: "graduate_trainee", label: "Graduate / Trainee", description: "Early-career and program roles" },
  { id: "main_companies", label: "Main Companies", description: "Tier A/B employers" },
  { id: "hidden_gems", label: "Hidden Gems", description: "High-score unknown-tier roles" },
  { id: "consultancies", label: "Consultancies", description: "Consultancy and recruiter postings" },
];

const JOB_SORT_OPTIONS: Array<{ id: JobSort; label: string }> = [
  { id: "relevance", label: "Best match (ranked)" },
  { id: "ats_desc", label: "Keyword match (highest)" },
  { id: "deadline", label: "Deadline (soonest)" },
  { id: "newest", label: "Newest posted" },
];

const TIER_RANK: Record<string, number> = { A: 0, B: 1, C: 2, unknown: 3 };

function normalizeCompanyName(value: string | null | undefined): string {
  return normalizeCompanyKey(value);
}

function langRank(lang: string | null | undefined): number {
  if (lang === "en") return 2;
  if (lang === "mixed") return 1;
  return 0;
}

function timeValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boolValue(value: unknown): boolean {
  return value === true;
}

function effectiveConsultancyFlag(job: { consultancy_flag?: unknown; is_direct_company_source?: unknown }): boolean {
  return boolValue(job.consultancy_flag) && !boolValue(job.is_direct_company_source);
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function yearsValue(value: unknown): number {
  if (value === null || value === undefined) return 999;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 999;
  return parsed;
}

function effectiveCareerStage(stage: unknown, confidence: unknown): string {
  const normalized = String(stage || "unknown").toLowerCase();
  const score = Number(confidence);
  if (!Number.isFinite(score) || score < CAREER_STAGE_CONFIDENCE_THRESHOLD) return "unknown";
  return normalized;
}

function careerStageAdjustment(stage: string): number {
  if (["graduate", "trainee", "junior"].includes(stage)) return 18;
  if (["senior", "lead", "staff", "principal"].includes(stage)) return -60;
  return 0;
}

function fallbackDescription(mode: SearchFallbackMode): string {
  if (mode === "show_swedish") return "Showing matches that require Swedish for this search.";
  if (mode === "show_experience") return "Showing matches that may require 3+ years for this search.";
  if (mode === "show_both") return "Showing matches that require Swedish and/or 3+ years for this search.";
  if (mode === "show_both_best_matches") return "Showing best-match results with suppression toggles relaxed for this search.";
  return "";
}

function atsBadgeClass(score: number) {
  if (score >= 60) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (score >= 35) return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (score >= 15) return "border-orange-500/30 bg-orange-500/10 text-orange-300";
  return "border-red-500/20 text-red-400/80";
}

function requiresThreePlusYears(job: { years_required_min?: unknown; reason_codes?: unknown }): boolean {
  const years = numberValue(job.years_required_min, -1);
  if (years >= 3) return true;
  if (!Array.isArray(job.reason_codes)) return false;
  return job.reason_codes.some((value) => String(value).toLowerCase() === "years_required_3plus");
}

type AtsScoreContext = {
  headline?: string | null;
  career_stage?: unknown;
  career_stage_confidence?: unknown;
  years_required_min?: unknown;
  is_grad_program?: unknown;
  reason_codes?: unknown;
};

function seniorityPenalty(context: AtsScoreContext): number {
  const title = String(context.headline ?? "").toLowerCase().trim();
  const stage = effectiveCareerStage(context.career_stage, context.career_stage_confidence);
  const years = numberValue(context.years_required_min, -1);
  const reasonCodes = Array.isArray(context.reason_codes)
    ? context.reason_codes.map((value) => String(value).toLowerCase())
    : [];
  const hasSeniorTitleSignal = /\b(senior|lead|principal|staff|experienced|expert)\b/.test(title);
  const hasJuniorSignal = /\b(junior|graduate|trainee|entry)\b/.test(title) || boolValue(context.is_grad_program);

  let penalty = 0;
  if (stage === "senior" || stage === "lead" || stage === "staff" || stage === "principal") {
    penalty = Math.max(penalty, 40);
  }
  if (hasSeniorTitleSignal) {
    penalty = Math.max(penalty, 40);
  }
  if (years >= 8) {
    penalty = Math.max(penalty, 60);
  } else if (years >= 5) {
    penalty = Math.max(penalty, 45);
  } else if (years >= 3) {
    penalty = Math.max(penalty, 30);
  }
  if (reasonCodes.includes("years_required_3plus")) {
    penalty = Math.max(penalty, 30);
  }
  if (reasonCodes.includes("career_stage_senior")) {
    penalty = Math.max(penalty, 40);
  }
  if (years < 0 && stage === "unknown" && !hasJuniorSignal && !reasonCodes.includes("grad_program_detected")) {
    penalty = Math.max(penalty, 10);
  }
  if (hasJuniorSignal) {
    penalty = Math.max(0, penalty - 20);
  }
  return penalty;
}

function applySeniorityAdjustment(rawScore: number, context: AtsScoreContext): number {
  return Math.max(0, rawScore - seniorityPenalty(context));
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDeadlineDisplay(deadline: string | null | undefined): string {
  if (!deadline) return "No deadline";
  const parsed = new Date(`${deadline}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "No deadline";

  const today = startOfLocalDay(new Date());
  const targetDay = startOfLocalDay(parsed);
  const diffDays = Math.floor((targetDay.getTime() - today.getTime()) / 86_400_000);

  if (diffDays <= 0) return "Today";
  if (diffDays <= 7) return `Closing in ${diffDays}d`;
  return targetDay.toLocaleDateString("sv-SE", { month: "short", day: "numeric" });
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfCurrentWeek(date: Date): Date {
  const dayIndexMondayZero = (date.getDay() + 6) % 7;
  const end = startOfLocalDay(date);
  end.setDate(end.getDate() + (6 - dayIndexMondayZero));
  return end;
}

export default function Jobs() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    document.title = "Explore Jobs | SweJobs";
  }, []);

  const [lens, setLens] = useState<Lens>("best_matches");
  const [search, setSearch] = useState("");
  const [lang, setLang] = useState("all");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [hideSwedishRequired, setHideSwedishRequired] = useState(true);
  const [hideCitizenshipRestricted, setHideCitizenshipRestricted] = useState(true);
  const [hideThreePlusYears, setHideThreePlusYears] = useState(true);
  const [sortBy, setSortBy] = useState<JobSort>("relevance");
  const [selectedAtsResumeId, setSelectedAtsResumeId] = useState<string>("auto");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const debouncedSearch = useDebouncedValue(search, 275);
  const isSearchPending = search.trim() !== debouncedSearch.trim();
  const deadlineFocus: DeadlineFocus =
    searchParams.get("deadline") === "today"
      ? "today"
      : searchParams.get("deadline") === "week"
        ? "week"
        : searchParams.get("deadline") === "upcoming"
          ? "upcoming"
          : "none";

  const listRef = useRef<HTMLDivElement>(null);

  const { data: watchedCompanies } = useQuery({
    queryKey: ["watched-companies", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("watched_companies")
        .select("employer_name")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const watchedSet = useMemo(() => {
    const names = watchedCompanies?.map((item) => normalizeCompanyName(item.employer_name)) ?? [];
    return new Set(names.filter(Boolean));
  }, [watchedCompanies]);

  const { data: rawJobsData, isLoading, isFetching, error: jobsError } = useQuery({
    queryKey: ["jobs-v3", lens, debouncedSearch, lang, remoteOnly, deadlineFocus],
    staleTime: 300_000,
    placeholderData: (previous) => previous,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const normalizedSearchTerm = debouncedSearch.trim();
      const today = new Date();
      const todayIso = formatLocalDate(today);
      const weekEndIso = formatLocalDate(endOfCurrentWeek(today));
      let query = supabase
        .from("jobs")
        .select(
          "id, headline, employer_name, company_canonical, company_tier, municipality, region, lang, remote_flag, " +
          "published_at, application_deadline, employment_type, working_hours, occupation_label, " +
            "relevance_score, role_family, career_stage, career_stage_confidence, is_grad_program, years_required_min, " +
            "swedish_required, consultancy_flag, citizenship_required, security_clearance_required, reason_codes, " +
            "source_provider, source_kind, is_direct_company_source, is_target_role, is_noise",
        )
        .eq("is_active", true)
        .limit(LIST_FETCH_LIMIT);

      if (lens !== "all_roles") {
        query = query.eq("is_target_role", true);
      } else {
        query = query.eq("is_noise", false);
      }

      if (lang !== "all") {
        query = query.eq("lang", lang);
      }
      if (remoteOnly) {
        query = query.eq("remote_flag", true);
      }
      if (normalizedSearchTerm) {
        const term = normalizedSearchTerm.replace(/[(),]/g, " ");
        query = query.or(`headline.ilike.%${term}%,employer_name.ilike.%${term}%,company_canonical.ilike.%${term}%`);
      }

      if (deadlineFocus !== "none") {
        query = query
          .not("application_deadline", "is", null)
          .gte("application_deadline", todayIso)
          .order("application_deadline", { ascending: true })
          .order("relevance_score", { ascending: false })
          .order("published_at", { ascending: false });

        if (deadlineFocus === "today") {
          query = query.eq("application_deadline", todayIso);
        } else if (deadlineFocus === "week") {
          query = query.lte("application_deadline", weekEndIso);
        }
      } else {
        query = query
          .order("relevance_score", { ascending: false })
          .order("published_at", { ascending: false });
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const activeSearchCount = rawJobsData?.length ?? 0;

  const { data: searchCoverage } = useQuery({
    queryKey: ["jobs-search-coverage", debouncedSearch],
    enabled: debouncedSearch.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const term = debouncedSearch.trim().replace(/[(),]/g, " ");

      const visibleQuery = supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("is_noise", false)
        .or(`headline.ilike.%${term}%,employer_name.ilike.%${term}%,company_canonical.ilike.%${term}%`);

      const { count: visibleCount, error: visibleError } = await visibleQuery;
      if (visibleError) throw visibleError;

      return {
        visibleCount: visibleCount ?? 0,
      };
    },
  });

  const { data: atsResumes } = useQuery({
    queryKey: ["ats-resumes", user?.id],
    enabled: !!user,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resume_versions")
        .select("id, label, parsed_text, is_default, created_at")
        .eq("user_id", user!.id)
        .not("parsed_text", "is", null)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []).filter((resume) => typeof resume.parsed_text === "string" && resume.parsed_text.length > 0);
    },
  });

  const activeAtsResume = useMemo(() => {
    if (!atsResumes || atsResumes.length === 0) return null;
    const defaultResume = atsResumes.find((resume) => resume.is_default) ?? atsResumes[0];
    if (selectedAtsResumeId === "auto") return defaultResume;
    return atsResumes.find((resume) => resume.id === selectedAtsResumeId) ?? defaultResume;
  }, [atsResumes, selectedAtsResumeId]);

  useEffect(() => {
    if (!atsResumes || atsResumes.length === 0) {
      if (selectedAtsResumeId !== "auto") setSelectedAtsResumeId("auto");
      return;
    }
    if (selectedAtsResumeId === "auto") return;
    if (!atsResumes.some((resume) => resume.id === selectedAtsResumeId)) {
      setSelectedAtsResumeId("auto");
    }
  }, [atsResumes, selectedAtsResumeId]);

  const { data: userSkills } = useQuery({
    queryKey: ["user-skills", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_skills").select("skill").eq("user_id", user!.id);
      if (error) throw error;
      return new Set((data ?? []).map((item) => item.skill.toLowerCase()));
    },
  });

  const companyCoverageEntry = useMemo(() => findCompanyRegistryEntry(debouncedSearch), [debouncedSearch]);

  const rankedJobsView = useMemo(() => {
    const sourceJobs = [...(rawJobsData ?? [])];
    const normalizedSearchTerm = debouncedSearch.trim();

    const applyFilters = (
      jobs: typeof sourceJobs,
      options: { currentLens: Lens; hideSwedish: boolean; hideCitizenship: boolean; hideYears: boolean },
    ) => {
      const hasSearch = normalizedSearchTerm.length > 0;
      let rows = jobs.filter((job) => {
        if (options.currentLens === "all_roles") return true;
        const isTarget = boolValue((job as { is_target_role?: unknown }).is_target_role);
        const isNoise = boolValue((job as { is_noise?: unknown }).is_noise);
        if (!hasSearch) return isTarget;
        return isTarget || !isNoise;
      });

      if (options.hideSwedish) {
        rows = rows.filter((job) => !boolValue(job.swedish_required));
      }
      if (options.hideCitizenship) {
        rows = rows.filter(
          (job) => !boolValue(job.citizenship_required) && !boolValue(job.security_clearance_required),
        );
      }
      if (options.hideYears) {
        rows = rows.filter((job) => !requiresThreePlusYears(job));
      }

      if (options.currentLens === "graduate_trainee") {
        rows = rows.filter((job) => {
          const stage = effectiveCareerStage(job.career_stage, job.career_stage_confidence);
          return boolValue(job.is_grad_program) || ["graduate", "trainee", "junior"].includes(stage);
        });
      } else if (options.currentLens === "main_companies") {
        rows = rows.filter((job) => ["A", "B"].includes(String(job.company_tier || "unknown")));
      } else if (options.currentLens === "hidden_gems") {
        rows = rows.filter((job) => {
          const isUnknownTier = String(job.company_tier || "unknown") === "unknown";
          const relevance = numberValue(job.relevance_score);
          const consultancy = effectiveConsultancyFlag(job);
          if (!isUnknownTier) return false;
          if (consultancy && relevance < 40) return false;
          return relevance >= 25;
        });
      } else if (options.currentLens === "consultancies") {
        rows = rows.filter((job) => effectiveConsultancyFlag(job));
      }

      return rows;
    };

    let rows = applyFilters(sourceJobs, {
      currentLens: lens,
      hideSwedish: hideSwedishRequired,
      hideCitizenship: hideCitizenshipRestricted,
      hideYears: hideThreePlusYears,
    });
    let fallbackMode: SearchFallbackMode = "none";

    if (normalizedSearchTerm && rows.length === 0) {
      const fallbacks: Array<{
        mode: SearchFallbackMode;
        options: { currentLens: Lens; hideSwedish: boolean; hideCitizenship: boolean; hideYears: boolean };
      }> = [
        {
          mode: "show_swedish",
          options: {
            currentLens: lens,
            hideSwedish: false,
            hideCitizenship: hideCitizenshipRestricted,
            hideYears: hideThreePlusYears,
          },
        },
      ];

      if (!hideThreePlusYears) {
        fallbacks.push(
          {
            mode: "show_experience",
            options: {
              currentLens: lens,
              hideSwedish: hideSwedishRequired,
              hideCitizenship: hideCitizenshipRestricted,
              hideYears: false,
            },
          },
          {
            mode: "show_both",
            options: {
              currentLens: lens,
              hideSwedish: false,
              hideCitizenship: hideCitizenshipRestricted,
              hideYears: false,
            },
          },
        );
      }

      if (lens !== "best_matches") {
        fallbacks.push({
          mode: "show_both_best_matches",
          options: {
            currentLens: "best_matches",
            hideSwedish: false,
            hideCitizenship: hideCitizenshipRestricted,
            hideYears: hideThreePlusYears,
          },
        });
      }

      for (const fallback of fallbacks) {
        const recovered = applyFilters(sourceJobs, fallback.options);
        if (recovered.length > 0) {
          rows = recovered;
          fallbackMode = fallback.mode;
          break;
        }
      }
    }

    const isWatched = (job: any) => {
      const canonical = normalizeCompanyName(job.company_canonical || job.employer_name);
      return watchedSet.has(canonical);
    };
    const normalizedSearch = normalizeCompanyName(normalizedSearchTerm);
    const companySearchBoost = (job: any) => {
      if (!normalizedSearch) return 0;
      const canonical = normalizeCompanyName(job.company_canonical || job.employer_name);
      if (!canonical) return 0;
      if (canonical === normalizedSearch) return 80;
      if (canonical.startsWith(normalizedSearch) || normalizedSearch.startsWith(canonical)) return 55;
      if (canonical.includes(normalizedSearch)) return 35;
      return 0;
    };

    rows.sort((a, b) => {
      const targetDiff =
        lens === "all_roles"
          ? 0
          : Number(boolValue((b as { is_target_role?: unknown }).is_target_role)) -
            Number(boolValue((a as { is_target_role?: unknown }).is_target_role));
      if (targetDiff !== 0) return targetDiff;

      const watchedDiff = Number(isWatched(b)) - Number(isWatched(a));
      const stageA = effectiveCareerStage(a.career_stage, a.career_stage_confidence);
      const stageB = effectiveCareerStage(b.career_stage, b.career_stage_confidence);
      const stageAdjustmentA = lens === "best_matches" ? careerStageAdjustment(stageA) : 0;
      const stageAdjustmentB = lens === "best_matches" ? careerStageAdjustment(stageB) : 0;
      const boostedA =
        numberValue(a.relevance_score) +
        (isWatched(a) ? WATCHED_COMPANY_BOOST : 0) +
        stageAdjustmentA +
        companySearchBoost(a);
      const boostedB =
        numberValue(b.relevance_score) +
        (isWatched(b) ? WATCHED_COMPANY_BOOST : 0) +
        stageAdjustmentB +
        companySearchBoost(b);
      const relevanceDiff = boostedB - boostedA;
      if (relevanceDiff !== 0) return relevanceDiff;

      if (watchedDiff !== 0) return watchedDiff;

      const tierA = TIER_RANK[String(a.company_tier || "unknown")] ?? 3;
      const tierB = TIER_RANK[String(b.company_tier || "unknown")] ?? 3;
      if (tierA !== tierB) return tierA - tierB;

      const yearsDiff = yearsValue(a.years_required_min) - yearsValue(b.years_required_min);
      if (yearsDiff !== 0) return yearsDiff;

      const langDiff = langRank(String(b.lang || "")) - langRank(String(a.lang || ""));
      if (langDiff !== 0) return langDiff;

      const freshnessDiff = timeValue(String(b.published_at || "")) - timeValue(String(a.published_at || ""));
      if (freshnessDiff !== 0) return freshnessDiff;

      if (effectiveConsultancyFlag(a) !== effectiveConsultancyFlag(b)) {
        return Number(effectiveConsultancyFlag(a)) - Number(effectiveConsultancyFlag(b));
      }

      return numberValue(b.id) - numberValue(a.id);
    });

    return { rows, fallbackMode };
  }, [rawJobsData, hideSwedishRequired, hideCitizenshipRestricted, hideThreePlusYears, lens, watchedSet, debouncedSearch]);

  const rankAndFilterJobs = rankedJobsView.rows;
  const searchFallbackMode = rankedJobsView.fallbackMode;
  const rankedJobIds = useMemo(() => rankAndFilterJobs.map((job) => job.id), [rankAndFilterJobs]);

  const { data: allJobTags } = useQuery({
    queryKey: ["job-tags-ranked", rankedJobIds.join(",")],
    enabled: rankedJobIds.length > 0,
    staleTime: 300_000,
    placeholderData: (previous) => previous,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_tags")
        .select("job_id, tag")
        .in("job_id", rankedJobIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const tagsByJobId = useMemo(() => {
    return (allJobTags ?? []).reduce((acc, item) => {
      if (!acc[item.job_id]) acc[item.job_id] = [];
      acc[item.job_id].push(item.tag);
      return acc;
    }, {} as Record<number, string[]>);
  }, [allJobTags]);

  const { data: trackedStatuses } = useQuery({
    queryKey: ["tracked-statuses", user?.id, rankedJobIds.join(",")],
    enabled: !!user && rankedJobIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracked_jobs")
        .select("job_id, status")
        .eq("user_id", user!.id)
        .in("job_id", rankedJobIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const trackedStatusByJobId = useMemo(() => {
    return (trackedStatuses ?? []).reduce((acc, item) => {
      acc[item.job_id] = String(item.status ?? "");
      return acc;
    }, {} as Record<number, string>);
  }, [trackedStatuses]);

  const atsByJobId = useMemo(() => {
    const parsedText = activeAtsResume?.parsed_text;
    if (
      !parsedText ||
      rankAndFilterJobs.length === 0 ||
      (rankedJobIds.length > 0 && Object.keys(tagsByJobId).length === 0)
    ) {
      return {} as Record<number, { result: AtsScanResult; displayScore: number; penalty: number }>;
    }

    return rankAndFilterJobs.reduce<Record<number, { result: AtsScanResult; displayScore: number; penalty: number }>>(
      (acc, job) => {
        const tags = tagsByJobId[job.id] ?? [];
        const titleKeywords = extractKeywordsFromJobText([job.headline ?? "", job.occupation_label ?? ""].join(" "), 10);
        const keywords = Array.from(new Set([...tags, ...titleKeywords])).slice(0, 20);
        if (keywords.length === 0) return acc;

        const context = {
          headline: job.headline,
          career_stage: job.career_stage,
          career_stage_confidence: job.career_stage_confidence,
          years_required_min: job.years_required_min,
          is_grad_program: job.is_grad_program,
          reason_codes: job.reason_codes,
        };

        const result = runAtsScan({
          resumeText: parsedText,
          targetKeywords: keywords,
          trackedSkills: userSkills ?? [],
        });

        acc[job.id] = {
          result,
          displayScore: applySeniorityAdjustment(result.score, context),
          penalty: seniorityPenalty(context),
        };

        return acc;
      },
      {},
    );
  }, [activeAtsResume?.parsed_text, rankAndFilterJobs, rankedJobIds.length, tagsByJobId, userSkills]);

  const sortedJobs = useMemo(() => {
    const rows = [...rankAndFilterJobs];
    if (rows.length <= 1 || sortBy === "relevance") return rows;

    const baseOrderById = new Map(rows.map((job, index) => [job.id, index]));
    const baseOrderDiff = (aId: number, bId: number) => (baseOrderById.get(aId) ?? 0) - (baseOrderById.get(bId) ?? 0);

    if (sortBy === "newest") {
      return rows.sort((a, b) => {
        const diff = timeValue(String(b.published_at || "")) - timeValue(String(a.published_at || ""));
        if (diff !== 0) return diff;
        return baseOrderDiff(a.id, b.id);
      });
    }

    if (sortBy === "deadline") {
      return rows.sort((a, b) => {
        const aValue = a.application_deadline ? Date.parse(`${a.application_deadline}T00:00:00`) : Number.POSITIVE_INFINITY;
        const bValue = b.application_deadline ? Date.parse(`${b.application_deadline}T00:00:00`) : Number.POSITIVE_INFINITY;
        const diff = aValue - bValue;
        if (diff !== 0) return diff;
        return baseOrderDiff(a.id, b.id);
      });
    }

    if (!activeAtsResume?.parsed_text) return rows;

    return rows.sort((a, b) => {
      const bScore = atsByJobId[b.id]?.displayScore ?? -1;
      const aScore = atsByJobId[a.id]?.displayScore ?? -1;
      const diff = bScore - aScore;
      if (diff !== 0) return diff;
      return baseOrderDiff(a.id, b.id);
    });
  }, [activeAtsResume?.parsed_text, atsByJobId, rankAndFilterJobs, sortBy]);

  const total = sortedJobs.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const jobs = useMemo(() => {
    const start = page * PAGE_SIZE;
    return sortedJobs.slice(start, start + PAGE_SIZE);
  }, [page, sortedJobs]);

  useEffect(() => {
    setPage(0);
  }, [lens, hideSwedishRequired, hideCitizenshipRestricted, hideThreePlusYears, search, lang, remoteOnly, deadlineFocus, sortBy]);

  useEffect(() => {
    if (page >= totalPages) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [page, totalPages]);

  useEffect(() => {
    if (jobs.length === 0) {
      setSelectedId(null);
      setSelectedIdx(-1);
      return;
    }
    if (selectedId == null) return;
    if (!jobs.some((job) => job.id === selectedId)) {
      setSelectedId(null);
      setSelectedIdx(-1);
    }
  }, [jobs, selectedId]);

  const hasActiveFilters =
    deadlineFocus !== "none" ||
    lens !== "best_matches" ||
    sortBy !== "relevance" ||
    lang !== "all" ||
    remoteOnly ||
    !hideSwedishRequired ||
    !hideCitizenshipRestricted ||
    !hideThreePlusYears ||
    search.trim().length > 0;

  const clearFilters = () => {
    setLens("best_matches");
    setSearch("");
    setLang("all");
    setRemoteOnly(false);
    setHideSwedishRequired(true);
    setHideCitizenshipRestricted(true);
    setHideThreePlusYears(true);
    setSortBy("relevance");
    setPage(0);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("deadline");
      return next;
    });
  };

  const coverageBanner = useMemo(() => {
    if (!debouncedSearch.trim() || !companyCoverageEntry) return null;

    const provider = providerLabel(companyCoverageEntry.provider);
    const displayName = companyCoverageEntry.display_name;

    if (companyCoverageEntry.status === "connected" && total > 0) {
      return {
        tone: "info" as const,
        title: `Connected source: ${provider}`,
        body: `${displayName} is covered by SweJobs and active roles are shown below.`,
      };
    }

    if (companyCoverageEntry.status === "connected") {
      return {
        tone: "info" as const,
        title: `Connected source: ${provider}`,
        body: `SweJobs is connected to ${displayName} via ${provider}, but no active roles matched your current filters.`,
      };
    }

    if (companyCoverageEntry.status === "connected_jobtech" && total > 0) {
      return {
        tone: "info" as const,
        title: "Connected via JobTech",
        body: `${displayName} roles are available through JobTech aggregation and shown below.`,
      };
    }

    if (companyCoverageEntry.status === "connected_jobtech") {
      return {
        tone: "info" as const,
        title: "Connected via JobTech",
        body: `${displayName} is tracked through JobTech aggregation, but no active roles matched your current filters.`,
      };
    }

    if (companyCoverageEntry.status === "planned") {
      return {
        tone: "warning" as const,
        title: `${displayName} is not connected yet`,
        body: `${displayName} is on the SweJobs target list, but it is not connected yet. Current results reflect JobTech plus currently connected company sources.`,
      };
    }

    if (companyCoverageEntry.status === "blocked") {
      return {
        tone: "warning" as const,
        title: `${displayName} is currently blocked`,
        body: `${displayName} is tracked by SweJobs, but we have not found a stable public source for it yet.`,
      };
    }

    return {
      tone: "warning" as const,
      title: `${displayName} is a fallback candidate`,
      body: `${displayName} is high priority, but only an HTML fallback path is currently plausible. Structured source support has not been verified yet.`,
    };
  }, [companyCoverageEntry, debouncedSearch, total]);

  const { data: detail } = useQuery({
    queryKey: ["job", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id, headline, description, employer_name, company_canonical, company_tier, municipality, region, lang, " +
          "remote_flag, published_at, application_deadline, employment_type, working_hours, occupation_label, source_url, " +
          "relevance_score, role_family, career_stage, career_stage_confidence, is_grad_program, years_required_min, " +
          "swedish_required, consultancy_flag, citizenship_required, security_clearance_required, reason_codes, source_provider, source_kind, " +
          "is_direct_company_source, is_target_role",
        )
        .eq("id", selectedId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: detailTags } = useQuery({
    queryKey: ["job-tags", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase.from("job_tags").select("tag").eq("job_id", selectedId!);
      if (error) throw error;
      return data?.map((item) => item.tag) ?? [];
    },
  });

  const { data: tracking } = useQuery({
    queryKey: ["tracked", selectedId],
    enabled: !!user && !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracked_jobs")
        .select("*")
        .eq("job_id", selectedId!)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [notes, setNotes] = useState("");
  const [appliedFeedbackJobId, setAppliedFeedbackJobId] = useState<number | null>(null);
  const [showAtsDetails, setShowAtsDetails] = useState(false);

  useEffect(() => {
    if (tracking) {
      setNotes(tracking.notes ?? "");
    } else {
      setNotes("");
    }
  }, [tracking]);

  useEffect(() => {
    setAppliedFeedbackJobId(null);
    setShowAtsDetails(false);
  }, [selectedId]);

  const upsertTracking = useMutation({
    mutationFn: async (values: { status: string; notes: string }) => {
      const { error } = await supabase.from("tracked_jobs").upsert(
        {
          user_id: user!.id,
          job_id: selectedId!,
          status: values.status,
          notes: values.notes,
        },
        { onConflict: "user_id,job_id" },
      );
      if (error) throw error;

      if (values.status === "applied" && detail && selectedId) {
        const { error: applicationError } = await supabase.from("applications").upsert(
          buildSweJobsApplication({
            userId: user!.id,
            jobId: selectedId,
            company: detail.employer_name ?? "Unknown",
            jobTitle: detail.headline,
            jobUrl: detail.source_url,
          }),
          { onConflict: "user_id,request_id" },
        );
        if (applicationError) throw applicationError;
      }
    },
    onSuccess: (_data, values) => {
      qc.invalidateQueries({ queryKey: ["tracked", selectedId] });
      qc.invalidateQueries({ queryKey: ["applications", user?.id] });
      if (values.status === "applied") {
        setAppliedFeedbackJobId(selectedId ?? null);
        toast({ title: "Added to Applications" });
      } else {
        toast({ title: "Shortlisted" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const watchCompany = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("watched_companies").insert({
        user_id: user!.id,
        employer_name: name,
      });
      if (error) throw error;
    },
    onSuccess: (_data, name) => {
      qc.invalidateQueries({ queryKey: ["watched-companies"] });
      toast({
        title: `Watching ${name}`,
        description: "This company now gets extra ranking priority for your account.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!jobs.length) return;
    const handler = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIdx((previous) => {
          const next = Math.min(previous + 1, jobs.length - 1);
          setSelectedId(jobs[next].id);
          return next;
        });
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIdx((previous) => {
          const next = Math.max(previous - 1, 0);
          setSelectedId(jobs[next].id);
          return next;
        });
      } else if (event.key === "Escape") {
        setSelectedId(null);
        setSelectedIdx(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (selectedIdx >= 0 && selectedIdx < jobs.length) {
          setSelectedId(jobs[selectedIdx].id);
          return;
        }
        if (jobs.length > 0) {
          setSelectedIdx(0);
          setSelectedId(jobs[0].id);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [jobs, selectedIdx]);

  useEffect(() => {
    if (selectedIdx >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("[data-job-item]");
      items[selectedIdx]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIdx]);

  const matchingTags = detailTags?.filter((tag) => userSkills?.has(tag.toLowerCase())) ?? [];
  const missingTags = detailTags?.filter((tag) => !userSkills?.has(tag.toLowerCase())) ?? [];
  const listAtsByJobId = useMemo(() => {
    if (jobs.length === 0 || Object.keys(atsByJobId).length === 0) {
      return {} as Record<number, { result: AtsScanResult; displayScore: number; penalty: number }>;
    }
    return jobs.reduce<Record<number, { result: AtsScanResult; displayScore: number; penalty: number }>>((acc, job) => {
      const snapshot = atsByJobId[job.id];
      if (snapshot) acc[job.id] = snapshot;
      return acc;
    }, {});
  }, [atsByJobId, jobs]);

  const detailAtsResult = useMemo(() => {
    const parsedText = activeAtsResume?.parsed_text;
    if (!detail || !parsedText) return null;

    const detailTagKeywords = detailTags ?? [];
    const descriptionKeywords = extractKeywordsFromJobText([detail.headline, detail.description ?? ""].join(" "), 35);
    const keywords = Array.from(new Set([...detailTagKeywords, ...descriptionKeywords])).slice(0, 35);
    if (keywords.length === 0) return null;

    const context = {
      headline: detail.headline,
      career_stage: detail.career_stage,
      career_stage_confidence: detail.career_stage_confidence,
      years_required_min: detail.years_required_min,
      is_grad_program: detail.is_grad_program,
      reason_codes: detail.reason_codes,
    };

    const result = runAtsScan({
      resumeText: parsedText,
      targetKeywords: keywords,
      trackedSkills: userSkills ?? [],
    });

    return {
      result,
      displayScore: applySeniorityAdjustment(result.score, context),
      penalty: seniorityPenalty(context),
    };
  }, [activeAtsResume?.parsed_text, detail, detailTags, userSkills]);

  const detailDisplayEmployer = detail
    ? companyDisplayName(detail.company_canonical, detail.employer_name)
    : "";
  const detailProviderLabel = detail
    ? providerLabel(detail.source_provider || getCompanyRegistryEntryByCanonical(detail.company_canonical)?.provider)
    : "Unknown";

  return (
    <AppLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Explore</h1>
          <p className="text-xs text-muted-foreground">
            {deadlineFocus === "today"
              ? `${total.toLocaleString()} roles due today`
              : deadlineFocus === "week"
                ? `${total.toLocaleString()} roles closing this week`
                : deadlineFocus === "upcoming"
                  ? `${total.toLocaleString()} upcoming deadline roles`
                : `${total.toLocaleString()} jobs in current lens`}
          </p>
        </div>

        {deadlineFocus !== "none" && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            <p className="font-medium text-foreground">
              {deadlineFocus === "today"
                ? "Deadline focus: due today"
                : deadlineFocus === "week"
                  ? "Deadline focus: closing this week"
                  : "Deadline focus: all upcoming deadlines"}
            </p>
            <p className="mt-1 text-muted-foreground">
              This view is opened from the homepage deadline widgets and is sorted by closing date first.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {LENSES.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={lens === item.id ? "default" : "outline"}
              className={cn(
                "h-8 text-xs",
                lens === item.id
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                  : "border-border/60 bg-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
              onClick={() => setLens(item.id)}
              title={item.description}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search jobs, companies..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 pl-10 text-base"
          />
        </div>
        {isSearchPending && (
          <p className="text-[11px] text-muted-foreground">Updating search results…</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Select value={lang} onValueChange={setLang}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All langs</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="mixed">Mixed</SelectItem>
              <SelectItem value="sv">Swedish</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5">
            <Switch checked={remoteOnly} onCheckedChange={setRemoteOnly} className="scale-75" />
            <span className="text-xs text-muted-foreground">Remote</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Switch checked={hideThreePlusYears} onCheckedChange={setHideThreePlusYears} className="scale-75" />
            <span className="text-xs text-muted-foreground">Hide 3+ years (strict)</span>
          </div>

          <AdvancedFiltersPopover
            values={{
              hideSwedishRequired,
              hideCitizenshipRestricted,
              hideThreePlusYears,
            }}
            onChange={(nextValues) => {
              setHideSwedishRequired(nextValues.hideSwedishRequired);
              setHideCitizenshipRestricted(nextValues.hideCitizenshipRestricted);
              setHideThreePlusYears(nextValues.hideThreePlusYears);
            }}
          />

          <Select value={sortBy} onValueChange={(value) => setSortBy(value as JobSort)}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JOB_SORT_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {user ? (
            <Select value={selectedAtsResumeId} onValueChange={setSelectedAtsResumeId}>
              <SelectTrigger className="h-8 w-56 text-xs">
                <SelectValue placeholder="ATS resume" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  {activeAtsResume ? `ATS resume: Auto (${activeAtsResume.label})` : "ATS resume: Auto"}
                </SelectItem>
                {(atsResumes ?? []).map((resume) => (
                  <SelectItem key={resume.id} value={resume.id}>
                    {resume.label}
                    {resume.is_default ? " (Default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 px-2 text-xs">
              Reset controls
            </Button>
          )}
        </div>

        {sortBy === "ats_desc" && !activeAtsResume?.parsed_text ? (
          <p className="text-[11px] text-muted-foreground">
            Keyword sorting needs a resume with extracted text. Upload/select one in Resume Library.
          </p>
        ) : null}
        {sortBy === "ats_desc" && activeAtsResume?.parsed_text ? (
          <p className="text-[11px] text-muted-foreground">
            Keyword match is not a full hiring-fit score. Experience and seniority requirements still apply.
          </p>
        ) : null}

        <div className="flex gap-4" style={{ height: "calc(100vh - 320px)" }}>
          <div className={`flex flex-col ${selectedId ? "w-[380px] shrink-0" : "w-full max-w-2xl"} transition-all duration-200`}>
            {coverageBanner && (
              <div
                className={`mb-2 rounded-md border px-3 py-2 text-xs ${
                  coverageBanner.tone === "warning"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
                    : "border-primary/30 bg-primary/5 text-muted-foreground"
                }`}
              >
                <p className="font-medium text-foreground">{coverageBanner.title}</p>
                <p className="mt-1">{coverageBanner.body}</p>
              </div>
            )}
            {searchFallbackMode !== "none" && (
              <div className="mb-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                {fallbackDescription(searchFallbackMode)}
              </div>
            )}
            {!isLoading && isFetching && (
              <div className="mb-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                Refreshing results…
              </div>
            )}
            {isLoading ? (
              <div className="space-y-2 p-1">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="h-14 animate-pulse rounded-md bg-muted/50" />
                ))}
              </div>
            ) : jobsError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                Failed to load jobs: {jobsError instanceof Error ? jobsError.message : "Unknown error"}
              </div>
            ) : jobs.length === 0 ? (
              <div className="space-y-2 py-12 text-center">
                <p className="text-sm text-muted-foreground">No jobs found for this lens and filters.</p>
                <p className="text-xs text-muted-foreground/80">
                  {coverageBanner
                    ? coverageBanner.body
                    : debouncedSearch.trim()
                    ? activeSearchCount === 0
                      ? "No active jobs were found for this search in the current source data."
                      : searchCoverage?.visibleCount === 0
                        ? "Jobs were found for this search, but all current matches were filtered as non-target/noise."
                        : "No matches found even after relaxing suppression toggles. Try broadening the search or resetting controls."
                    : "Try turning off one suppression toggle to recover borderline matches."}
                </p>
              </div>
            ) : (
              <>
                <ScrollArea className="flex-1" ref={listRef}>
                  <div className="space-y-px pr-2">
                    {jobs.map((job, idx) => {
                      const isSelected = job.id === selectedId;
                      const tags = tagsByJobId[job.id] ?? [];
                      const trackedStatus = trackedStatusByJobId[job.id];
                      const canonical = normalizeCompanyName(job.company_canonical || job.employer_name);
                      const watched = watchedSet.has(canonical);
                      const stage = effectiveCareerStage(job.career_stage, job.career_stage_confidence);
                      const displayEmployer = companyDisplayName(job.company_canonical, job.employer_name);
                      const sourceEntry = getCompanyRegistryEntryByCanonical(job.company_canonical);
                      const sourceLabel = providerLabel(job.source_provider || sourceEntry?.provider);
                      const atsSnapshot = listAtsByJobId[job.id];

                      return (
                        <div
                          key={job.id}
                          data-job-item
                          onClick={() => {
                            setSelectedId(job.id);
                            setSelectedIdx(idx);
                          }}
                          className={cn(
                            "cursor-pointer rounded-md border-l-2 px-3 py-2.5 transition-all duration-200",
                            isSelected && "border-l-primary bg-primary/5 shadow-sm",
                            !isSelected && "border-l-transparent hover:bg-muted/40",
                            !isSelected && job.company_tier === "A" && "border-l-emerald-500/40",
                            !isSelected && job.company_tier === "B" && "border-l-sky-500/30",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm font-medium leading-snug line-clamp-1">{job.headline}</h3>
                            <div className="flex shrink-0 items-center gap-1">
                              {watched && (
                                <Badge variant="secondary" className="h-4 px-1 text-[9px] font-normal">
                                  Watched
                                </Badge>
                              )}
                              {trackedStatus === "saved" ? (
                                <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal border-primary/25 text-primary">
                                  Shortlisted
                                </Badge>
                              ) : null}
                              {trackedStatus === "applied" ? (
                                <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal border-emerald-500/25 text-emerald-300">
                                  Applied
                                </Badge>
                              ) : null}
                              {job.remote_flag && (
                                <Badge variant="secondary" className="h-4 px-1 text-[9px] font-normal">
                                  Remote
                                </Badge>
                              )}
                              {job.company_tier && job.company_tier !== "unknown" && (
                                <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal">
                                  Tier {job.company_tier}
                                </Badge>
                              )}
                              {atsSnapshot ? (
                                <Badge variant="outline" className={cn("h-4 shrink-0 px-1 text-[9px] font-normal", atsBadgeClass(atsSnapshot.displayScore))}>
                                  KW {atsSnapshot.displayScore}%
                                </Badge>
                              ) : null}
                              {boolValue(job.is_direct_company_source) && (
                                <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal">
                                  {sourceLabel}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span
                              className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary/20 text-[8px] font-semibold text-primary"
                              aria-hidden
                            >
                              {(displayEmployer || "?").charAt(0).toUpperCase()}
                            </span>
                            {displayEmployer}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            {job.municipality && <span>{job.municipality}</span>}
                            {job.lang && <span>{job.lang.toUpperCase()}</span>}
                            {stage !== "unknown" && (
                              <span>{stage}</span>
                            )}
                            <span>{formatDeadlineDisplay(job.application_deadline)}</span>
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {job.swedish_required && (
                              <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal">
                                Swedish req
                              </Badge>
                            )}
                            {(job.citizenship_required || job.security_clearance_required) && (
                              <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal">
                                Restricted
                              </Badge>
                            )}
                            {numberValue(job.years_required_min, 0) >= 3 && (
                              <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal">
                                {job.years_required_min}+ yrs
                              </Badge>
                            )}
                            {effectiveConsultancyFlag(job) && (
                              <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal">
                                Consultancy
                              </Badge>
                            )}
                            {tags.slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="outline" className="h-4 px-1.5 text-[9px] font-normal">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>

                {totalPages > 1 && (
                  <div className="mt-2 flex items-center justify-center gap-2 pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((prev) => Math.max(0, prev - 1))}
                      className="h-7 w-7 p-0"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="font-mono text-xs text-muted-foreground">
                      {page + 1}/{totalPages}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
                      className="h-7 w-7 p-0"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  ↑↓ Navigate · Enter Open · Esc Close
                </p>
              </>
            )}
          </div>

          <AnimatePresence>
            {selectedId && detail && (
              <motion.div
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
                className="flex-1 overflow-hidden rounded-lg border border-border/40 bg-card"
              >
                <ScrollArea className="h-full">
                  <div className="space-y-5 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold leading-tight">{detail.headline}</h2>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {detailDisplayEmployer && (
                            <span className="flex items-center gap-1">
                              <Building className="h-3 w-3" /> {detailDisplayEmployer}
                            </span>
                          )}
                          {detail.municipality && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {detail.municipality}
                            </span>
                          )}
                          {detail.lang && <span>{detail.lang.toUpperCase()}</span>}
                          {effectiveCareerStage(detail.career_stage, detail.career_stage_confidence) !== "unknown" && (
                            <span>{effectiveCareerStage(detail.career_stage, detail.career_stage_confidence)}</span>
                          )}
                          {detail.published_at && (
                            <span>{new Date(detail.published_at).toLocaleDateString("sv-SE")}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => {
                          setSelectedId(null);
                          setSelectedIdx(-1);
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {detail.source_url && (
                        <a href={detail.source_url} target="_blank" rel="noopener noreferrer">
                          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                            <ExternalLink className="h-3 w-3" /> Apply
                          </Button>
                        </a>
                      )}
                      {user && detailDisplayEmployer && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-xs text-muted-foreground"
                          onClick={() => watchCompany.mutate(detail.company_canonical || detailDisplayEmployer)}
                        >
                          <Star className="h-3 w-3" /> Watch {detailDisplayEmployer}
                        </Button>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {detail.remote_flag && <Badge>Remote</Badge>}
                      {detail.is_direct_company_source && (
                        <Badge variant="outline" className="text-xs font-normal">
                          {detailProviderLabel}
                        </Badge>
                      )}
                      {detail.company_tier && detail.company_tier !== "unknown" && (
                        <Badge variant="outline" className="text-xs font-normal">
                          Tier {detail.company_tier}
                        </Badge>
                      )}
                      {effectiveConsultancyFlag(detail) && (
                        <Badge variant="outline" className="text-xs font-normal">
                          Consultancy
                        </Badge>
                      )}
                      {detail.swedish_required && (
                        <Badge variant="outline" className="text-xs font-normal">
                          Swedish required
                        </Badge>
                      )}
                      {detail.citizenship_required && (
                        <Badge variant="outline" className="text-xs font-normal">
                          Citizenship required
                        </Badge>
                      )}
                      {detail.security_clearance_required && (
                        <Badge variant="outline" className="text-xs font-normal">
                          Security clearance
                        </Badge>
                      )}
                      {detail.years_required_min != null && (
                        <Badge variant="outline" className="text-xs font-normal">
                          {detail.years_required_min}+ years requested
                        </Badge>
                      )}
                      {detail.employment_type && (
                        <Badge variant="outline" className="text-xs font-normal">
                          {detail.employment_type}
                        </Badge>
                      )}
                      {detail.working_hours && (
                        <Badge variant="outline" className="text-xs font-normal">
                          {detail.working_hours}
                        </Badge>
                      )}
                      {detail.application_deadline && (
                        <Badge variant="outline" className="font-mono text-xs font-normal">
                          Due {detail.application_deadline.slice(0, 10)}
                        </Badge>
                      )}
                    </div>

                    {user && detailTags && detailTags.length > 0 && userSkills && userSkills.size > 0 && (
                      <div className="space-y-2">
                        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          <TrendingUp className="h-3 w-3" /> Skill match
                        </h3>
                        <div className="flex flex-wrap gap-1">
                          {matchingTags.map((tag) => (
                            <Badge
                              key={tag}
                              className="border-primary/20 bg-primary/10 text-xs font-normal text-primary"
                            >
                              {tag}
                            </Badge>
                          ))}
                          {missingTags.slice(0, 6).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs font-normal text-muted-foreground">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        {matchingTags.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {matchingTags.length} of {detailTags.length} skills match your profile
                          </p>
                        )}
                      </div>
                    )}

                    {detailTags && detailTags.length > 0 && (!user || !userSkills || userSkills.size === 0) && (
                      <div>
                        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Skills
                        </h3>
                        <div className="flex flex-wrap gap-1">
                          {detailTags.map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs font-normal">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {detailAtsResult ? (
                      <div className="space-y-2 border-t border-border/40 pt-4">
                        <div className="flex items-center gap-3 py-1">
                          <div className="h-px flex-1 bg-border/40" />
                          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">Match analysis</span>
                          <div className="h-px flex-1 bg-border/40" />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Keyword match (ATS)</h3>
                          <Badge variant="outline" className={cn("text-xs font-normal", atsBadgeClass(detailAtsResult.displayScore))}>
                            {detailAtsResult.displayScore}% match
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          This is a keyword overlap score, not a full suitability score. Years-of-experience requirements may still disqualify the role.
                        </p>
                        {detailAtsResult.penalty > 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            Seniority adjustment applied ({detailAtsResult.penalty} pts) based on title/stage/experience signals.
                          </p>
                        ) : null}
                        <Collapsible open={showAtsDetails} onOpenChange={setShowAtsDetails}>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs">
                              {showAtsDetails ? "Hide keywords" : "Show keywords"}
                              <ChevronsUpDown className="h-3.5 w-3.5" />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="space-y-3 pt-2">
                            <div>
                              <p className="mb-1 text-xs text-muted-foreground">Matched keywords</p>
                              <div className="flex flex-wrap gap-1">
                                {detailAtsResult.result.matchedKeywords.slice(0, 10).map((keyword) => (
                                  <Badge key={keyword} variant="secondary" className="text-[10px] font-normal">
                                    {keyword}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="mb-1 text-xs text-muted-foreground">Missing keywords</p>
                              <div className="flex flex-wrap gap-1">
                                {detailAtsResult.result.missingKeywords.slice(0, 10).map((keyword) => (
                                  <Badge key={keyword} variant="outline" className="text-[10px] font-normal">
                                    {keyword}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    ) : null}

                    {user && (
                      <div className="space-y-3 border-t border-border/40 pt-4">
                        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          <Bookmark className="h-3 w-3" /> Track
                        </h3>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant={tracking?.status === "saved" ? "default" : "outline"}
                            className="h-8 text-xs"
                            onClick={() => upsertTracking.mutate({ status: "saved", notes })}
                            disabled={upsertTracking.isPending}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant={tracking?.status === "applied" ? "default" : "outline"}
                            className="h-8 text-xs"
                            onClick={() => upsertTracking.mutate({ status: "applied", notes })}
                            disabled={upsertTracking.isPending}
                          >
                            I Applied
                          </Button>
                        </div>
                        {selectedId && appliedFeedbackJobId === selectedId ? (
                          <p className="text-xs text-emerald-300">
                            Added to Applications.{" "}
                            <Link to="/applications" className="underline">
                              View →
                            </Link>
                          </p>
                        ) : null}
                        {selectedId ? (
                          <Link
                            to={`/applications?prefill_job_id=${selectedId}`}
                            className="inline-flex text-xs text-muted-foreground underline hover:text-foreground"
                          >
                            Applied outside SweJobs? Log it
                          </Link>
                        ) : null}
                        <Textarea
                          value={notes}
                          onChange={(event) => setNotes(event.target.value)}
                          placeholder="Notes..."
                          rows={2}
                          className="text-xs"
                        />
                      </div>
                    )}

                    <div>
                      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Description
                      </h3>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {detail.description || "No description available."}
                      </p>
                    </div>
                  </div>
                </ScrollArea>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </AppLayout>
  );
}
