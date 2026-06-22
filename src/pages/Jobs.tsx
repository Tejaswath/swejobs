import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { AppLayout } from "@/components/AppLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ResumeUploadDialog } from "@/components/resumes/ResumeUploadDialog";
import {
  MapPin,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Building,
  X,
  Star,
  Search,
  SlidersHorizontal,
  EyeOff,
  ChevronsUpDown,
  Bookmark,
  CheckCircle2,
  FileUp,
  RotateCcw,
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
import { jobRecordToAtsKeywordInput, matchResumeToJob, type AtsScanResult } from "@/lib/ats";
import { cn } from "@/lib/utils";
import {
  boolValue,
  earlyCareerBucket,
  effectiveCareerStage,
  hasSeniorRoleSignal,
  isGraduateTraineeCandidate as contractIsGraduateTraineeCandidate,
  jobPassesLens,
  numberValue,
} from "@/lib/jobEligibility";
import { primarySuitabilityReason, suitabilityScore } from "@/lib/jobRanking";

const PAGE_SIZE = 25;
const LIST_FETCH_LIMIT = 300;
const REFRESH_MS = 600_000;

type Lens = "high_signal" | "broad" | "graduate_trainee";
type JobSort = "relevance" | "deadline" | "newest" | "ats_desc";
type SearchFallbackMode = "none" | "show_swedish" | "show_experience" | "show_both" | "show_both_best_matches";
type DeadlineFocus = "none" | "today" | "week" | "upcoming";

export function normalizeLensParam(value: string | null): Lens {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "graduate" || normalized === "graduate-trainee") return "graduate_trainee";
  if (normalized === "high-signal") return "high_signal";
  if (normalized === "for-you") return "broad";
  if (normalized === "broad" || normalized === "graduate_trainee" || normalized === "high_signal") {
    return normalized;
  }
  return "broad";
}

function normalizeLanguageParam(value: string | null): "all" | "en" | "sv" | "mixed" {
  return value === "en" || value === "sv" || value === "mixed" ? value : "all";
}

const LENSES: Array<{ id: Lens; label: string; description: string }> = [
  { id: "high_signal", label: "High Signal", description: "ATS-first, high-confidence relevant roles" },
  { id: "broad", label: "For You", description: "ATS plus useful JobTech discovery, ranked for fit" },
  { id: "graduate_trainee", label: "Graduate / Trainee", description: "Early-career and program roles" },
];

const JOB_SORT_OPTIONS: Array<{ id: JobSort; label: string }> = [
  { id: "relevance", label: "Recommended for you" },
  { id: "ats_desc", label: "Resume match (highest)" },
  { id: "deadline", label: "Deadline soonest" },
  { id: "newest", label: "Newest jobs" },
];

const TIER_RANK: Record<string, number> = { A: 0, B: 1, C: 2, unknown: 3 };
const EARLY_CAREER_LABELS = {
  confirmed_graduate: "confirmed graduate",
  junior: "junior",
  unknown_possible: "experience unspecified",
  stretch: "stretch",
} as const;

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

function normalizeDedupeValue(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9åäö]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function semanticJobDedupeKey(job: {
  headline?: unknown;
  headline_en?: unknown;
  employer_name?: unknown;
  company_canonical?: unknown;
  source_url?: unknown;
}): string {
  const company = normalizeCompanyName(String(job.company_canonical || job.employer_name || ""));
  const title = normalizeDedupeValue(job.headline || job.headline_en);
  if (company && title) return `${company}::${title}`;
  return normalizeDedupeValue(job.source_url);
}

function duplicateCandidateScore(job: {
  is_direct_company_source?: unknown;
  source_kind?: unknown;
  company_tier?: unknown;
  relevance_score?: unknown;
  published_at?: unknown;
  application_deadline?: unknown;
  source_url?: unknown;
}): number {
  let score = 0;
  if (boolValue(job.is_direct_company_source)) score += 10_000_000;
  if (String(job.source_kind || "").toLowerCase() === "direct_company_ats") score += 10_000_000;
  const tierRank = TIER_RANK[String(job.company_tier || "unknown")] ?? 3;
  score += (4 - tierRank) * 100_000;
  score += numberValue(job.relevance_score) * 1_000;
  score += Math.min(999, Math.floor(timeValue(String(job.published_at || "")) / 86_400_000));
  if (job.application_deadline) score += 100;
  if (job.source_url) score += 10;
  return score;
}

function effectiveConsultancyFlag(job: { consultancy_flag?: unknown; is_direct_company_source?: unknown }): boolean {
  return boolValue(job.consultancy_flag) && !boolValue(job.is_direct_company_source);
}

function yearsValue(value: unknown): number {
  if (value === null || value === undefined) return 999;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 999;
  return parsed;
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

type SeniorSignalContext = {
  headline?: string | null;
  career_stage?: unknown;
  career_stage_confidence?: unknown;
  years_required_min?: unknown;
  reason_codes?: unknown;
};

// Exported for the focused lens regression test.
// eslint-disable-next-line react-refresh/only-export-components
export function isGraduateTraineeCandidate(context: SeniorSignalContext & { is_grad_program?: unknown }): boolean {
  return contractIsGraduateTraineeCandidate(context);
}

function requiresThreePlusYears(job: {
  headline?: string | null;
  career_stage?: unknown;
  career_stage_confidence?: unknown;
  years_required_min?: unknown;
  reason_codes?: unknown;
}): boolean {
  if (hasSeniorRoleSignal(job)) return true;
  const years = numberValue(job.years_required_min, -1);
  if (years >= 3) return true;
  if (!Array.isArray(job.reason_codes)) return false;
  return job.reason_codes.some((value) => String(value).toLowerCase() === "years_required_3plus");
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDeadlineDisplay(deadline: string | null | undefined): string {
  if (!deadline) return "Deadline not listed";
  const parsed = new Date(`${deadline}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "Deadline not listed";

  const today = startOfLocalDay(new Date());
  const targetDay = startOfLocalDay(parsed);
  const diffDays = Math.floor((targetDay.getTime() - today.getTime()) / 86_400_000);

  if (diffDays <= 0) return "Closes today";
  if (diffDays === 1) return "Closes tomorrow";
  return `Closes ${targetDay.toLocaleDateString("en-SE", { month: "long", day: "numeric" })}`;
}

function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-SE", { year: "numeric", month: "short", day: "numeric" });
}

function languageLabel(value: string | null | undefined): string {
  if (value === "en") return "English";
  if (value === "sv") return "Swedish";
  if (value === "mixed") return "English & Swedish";
  return "Language not listed";
}

function pluralizeJobs(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "job" : "jobs"}`;
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

  const lensParam = searchParams.get("lens");
  const [lens, setLens] = useState<Lens>(() => normalizeLensParam(lensParam));
  const [search, setSearch] = useState(() => searchParams.get("q") ?? searchParams.get("search") ?? "");
  const [lang, setLang] = useState(() =>
    normalizeLanguageParam(searchParams.get("language") ?? searchParams.get("lang")),
  );
  const [remoteOnly, setRemoteOnly] = useState(
    () => searchParams.get("remote") === "true" || searchParams.get("remote") === "1",
  );
  const [hideSwedishRequired, setHideSwedishRequired] = useState(true);
  const [hideCitizenshipRestricted, setHideCitizenshipRestricted] = useState(true);
  const [hideThreePlusYears, setHideThreePlusYears] = useState(true);
  const [hideConsultancies, setHideConsultancies] = useState(true);
  const [confirmedGraduateOnly, setConfirmedGraduateOnly] = useState(
    () => searchParams.get("confirmed") === "true" || searchParams.get("confirmed") === "1",
  );
  const [includeJobtechInHighSignal, setIncludeJobtechInHighSignal] = useState(
    () => searchParams.get("jobtech") === "1",
  );
  const [sortBy, setSortBy] = useState<JobSort>("relevance");
  const [selectedAtsResumeId, setSelectedAtsResumeId] = useState<string>("auto");
  const [resumeUploadOpen, setResumeUploadOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [hiddenJobIds, setHiddenJobIds] = useState<Set<number>>(() => {
    if (typeof window === "undefined") return new Set<number>();
    try {
      const raw = window.localStorage.getItem("swejobs.jobs.hidden-ids");
      const parsed = raw ? (JSON.parse(raw) as number[]) : [];
      return new Set(parsed.filter((value) => Number.isFinite(value)));
    } catch {
      return new Set<number>();
    }
  });
  const [tipDismissed, setTipDismissed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("swejobs.explore.tip-dismissed") === "true",
  );
  const syncingFromUrlRef = useRef(false);
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

  useEffect(() => {
    syncingFromUrlRef.current = true;
    setLens(normalizeLensParam(lensParam));
    setSearch(searchParams.get("q") ?? searchParams.get("search") ?? "");
    setLang(normalizeLanguageParam(searchParams.get("language") ?? searchParams.get("lang")));
    setRemoteOnly(searchParams.get("remote") === "true" || searchParams.get("remote") === "1");
    setConfirmedGraduateOnly(
      searchParams.get("confirmed") === "true" || searchParams.get("confirmed") === "1",
    );
    setPage(0);
    Promise.resolve().then(() => {
      syncingFromUrlRef.current = false;
    });
  }, [lensParam, searchParams]);

  useEffect(() => {
    if (syncingFromUrlRef.current) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("search");
      next.delete("lang");
      if (search.trim()) next.set("q", search.trim());
      else next.delete("q");
      if (lang !== "all") next.set("language", lang);
      else next.delete("language");
      if (remoteOnly) next.set("remote", "true");
      else next.delete("remote");
      if (confirmedGraduateOnly) next.set("confirmed", "true");
      else next.delete("confirmed");
      return next.toString() === current.toString() ? current : next;
    }, { replace: true });
  }, [confirmedGraduateOnly, lang, remoteOnly, search, setSearchParams]);

  const selectLens = (nextLens: Lens) => {
    setLens(nextLens);
    setPage(0);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextLens === "broad") {
        next.delete("lens");
      } else {
        next.set("lens", nextLens);
      }
      return next;
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (searchParams.get("jobtech") === "1") return;
    const saved = window.localStorage.getItem("swejobs.high-signal.include-jobtech");
    setIncludeJobtechInHighSignal(saved === "true");
  }, [searchParams]);

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

  const { data: userRankingState } = useQuery({
    queryKey: ["user-ranking-state", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_ranking_state")
        .select(
          "high_signal_score_delta,preferred_companies,demoted_companies,preferred_role_families,demoted_role_families",
        )
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const pushFeedbackEvent = async (payload: {
    signalType: "apply" | "save" | "follow_company" | "hide" | "skip";
    jobId: number;
    employerName?: string | null;
    roleFamily?: string | null;
    sourceUrl?: string | null;
  }) => {
    if (!user) return;
    const jobExternalKey = payload.sourceUrl?.trim() || `job:${payload.jobId}`;
    const { error } = await supabase.from("job_feedback_events").insert({
      user_id: user.id,
      job_id: payload.jobId,
      job_external_key: jobExternalKey,
      signal_type: payload.signalType,
      employer_name: payload.employerName ?? null,
      role_family: payload.roleFamily ?? null,
    });
    if (error) {
      console.warn("job_feedback_events insert failed", error.message);
    }
  };

  const {
    data: rawJobsData,
    isLoading,
    isFetching,
    error: jobsError,
    refetch: refetchJobs,
  } = useQuery({
    queryKey: ["jobs-v3", lens, includeJobtechInHighSignal, debouncedSearch, lang, remoteOnly, deadlineFocus],
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
      const useHighSignalFeedJoin = lens === "high_signal" && !includeJobtechInHighSignal;
      const feedSelect = useHighSignalFeedJoin
        ? "source_feed_registry!inner(quality_band,high_signal_eligible,enabled)"
        : "source_feed_registry(quality_band,high_signal_eligible,enabled)";
      let query = supabase
        .from("jobs")
        .select(
          "id, is_active, headline, headline_en, description, description_en, employer_name, company_canonical, company_tier, municipality, region, lang, remote_flag, " +
          "published_at, application_deadline, employment_type, working_hours, occupation_label, source_url, " +
            "relevance_score, role_family, role_family_confidence, career_stage, career_stage_confidence, is_grad_program, years_required_min, " +
            "swedish_required, consultancy_flag, citizenship_required, security_clearance_required, reason_codes, " +
            "source_provider, source_kind, source_feed_key, is_direct_company_source, is_target_role, is_noise, " +
            feedSelect,
        )
        .eq("is_active", true)
        .limit(LIST_FETCH_LIMIT);

      if (useHighSignalFeedJoin) {
        query = query
          .eq("is_target_role", true)
          .eq("is_noise", false)
          .gte("relevance_score", 30)
          .eq("source_feed_registry.enabled", true)
          .eq("source_feed_registry.high_signal_eligible", true)
          .in("source_feed_registry.quality_band", ["trusted", "verified"]);
      } else if (lens === "graduate_trainee") {
        query = query
          .eq("is_noise", false)
          .gte("relevance_score", 15)
          .or("is_grad_program.eq.true,career_stage.in.(graduate,trainee,junior),years_required_min.lte.2");
      } else if (lens === "broad") {
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
  const activeJobCountQuery = useQuery({
    queryKey: ["active-job-count"],
    staleTime: 300_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);
      if (error) throw error;
      return count ?? 0;
    },
  });

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
        .select("id, label, file_name, parsed_text, is_default, created_at")
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

    const feedFor = (job: (typeof sourceJobs)[number]) =>
      (
        job as {
          source_feed_registry?: {
            quality_band?: string | null;
            high_signal_eligible?: boolean | null;
            enabled?: boolean | null;
          } | null;
        }
      ).source_feed_registry;

    const passesLens = (job: (typeof sourceJobs)[number], currentLens: Lens) => {
      return jobPassesLens(job, currentLens, feedFor(job), includeJobtechInHighSignal);
    };

    const applyFilters = (
      jobs: typeof sourceJobs,
      options: {
        currentLens: Lens;
        hideSwedish: boolean;
        hideCitizenship: boolean;
        hideYears: boolean;
        hideConsultancies: boolean;
        confirmedGraduateOnly?: boolean;
      },
    ) => {
      let rows = jobs.filter((job) => passesLens(job, options.currentLens));
      if (options.currentLens === "graduate_trainee" && options.confirmedGraduateOnly) {
        rows = rows.filter((job) => {
          const stage = effectiveCareerStage(job.career_stage, job.career_stage_confidence);
          return boolValue(job.is_grad_program) || stage === "graduate" || stage === "trainee";
        });
      }

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
      if (options.hideConsultancies) {
        rows = rows.filter((job) => !effectiveConsultancyFlag(job));
      }

      return rows;
    };

    let rows = applyFilters(sourceJobs, {
      currentLens: lens,
      hideSwedish: hideSwedishRequired,
      hideCitizenship: hideCitizenshipRestricted,
      hideYears: hideThreePlusYears,
      hideConsultancies,
      confirmedGraduateOnly,
    });
    let fallbackMode: SearchFallbackMode = "none";

    if (normalizedSearchTerm && rows.length === 0) {
      const fallbacks: Array<{
        mode: SearchFallbackMode;
        options: {
          currentLens: Lens;
          hideSwedish: boolean;
          hideCitizenship: boolean;
          hideYears: boolean;
          hideConsultancies: boolean;
          confirmedGraduateOnly?: boolean;
        };
      }> = [];

      if (hideThreePlusYears) {
        fallbacks.push(
          {
            mode: "show_experience",
            options: {
              currentLens: lens,
              hideSwedish: hideSwedishRequired,
              hideCitizenship: hideCitizenshipRestricted,
              hideYears: false,
              hideConsultancies,
            },
          },
          {
            mode: "show_both",
            options: {
              currentLens: lens,
              hideSwedish: hideSwedishRequired,
              hideCitizenship: hideCitizenshipRestricted,
              hideYears: false,
              hideConsultancies,
            },
          },
        );
      }

      if (lens !== "high_signal") {
        fallbacks.push({
          mode: "show_both_best_matches",
          options: {
            currentLens: "high_signal",
            hideSwedish: hideSwedishRequired,
            hideCitizenship: hideCitizenshipRestricted,
            hideYears: hideThreePlusYears,
            hideConsultancies,
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

    const bestByKey = new Map<string, (typeof rows)[number]>();
    const orderByKey = new Map<string, number>();
    rows.forEach((job, index) => {
      const semanticKey = semanticJobDedupeKey(job);
      const dedupeKey = semanticKey || normalizeDedupeValue(job.source_url) || String(job.id);
      if (!orderByKey.has(dedupeKey)) orderByKey.set(dedupeKey, index);
      const existing = bestByKey.get(dedupeKey);
      if (!existing || duplicateCandidateScore(job) > duplicateCandidateScore(existing)) {
        bestByKey.set(dedupeKey, job);
      }
    });
    rows = Array.from(bestByKey.entries())
      .sort((a, b) => (orderByKey.get(a[0]) ?? 0) - (orderByKey.get(b[0]) ?? 0))
      .map(([, job]) => job);

    return { rows, fallbackMode };
  }, [
    rawJobsData,
    hideSwedishRequired,
    hideCitizenshipRestricted,
    hideThreePlusYears,
    hideConsultancies,
    confirmedGraduateOnly,
    lens,
    debouncedSearch,
    includeJobtechInHighSignal,
  ]);

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
      return {} as Record<number, AtsScanResult>;
    }

    return rankAndFilterJobs.reduce<Record<number, AtsScanResult>>((acc, job) => {
      const tags = tagsByJobId[job.id] ?? [];
      const result = matchResumeToJob(jobRecordToAtsKeywordInput(job, tags), {
        resumeText: parsedText,
        trackedSkills: userSkills ?? [],
      });
      if (result.keywordCount === 0) return acc;
      acc[job.id] = result;
      return acc;
    }, {});
  }, [activeAtsResume?.parsed_text, rankAndFilterJobs, rankedJobIds.length, tagsByJobId, userSkills]);

  const suitabilityByJobId = useMemo(() => {
    const preferredCompanies = new Set(
      (userRankingState?.preferred_companies ?? []).map((value) => normalizeCompanyName(value)),
    );
    const demotedCompanies = new Set(
      (userRankingState?.demoted_companies ?? []).map((value) => normalizeCompanyName(value)),
    );
    const preferredRoleFamilies = new Set(
      (userRankingState?.preferred_role_families ?? []).map((value) => String(value).toLowerCase()),
    );
    const demotedRoleFamilies = new Set(
      (userRankingState?.demoted_role_families ?? []).map((value) => String(value).toLowerCase()),
    );

    return rankAndFilterJobs.reduce<Record<number, ReturnType<typeof suitabilityScore>>>((acc, job) => {
      const canonical = normalizeCompanyName(job.company_canonical || job.employer_name);
      const roleFamily = String(job.role_family || "").toLowerCase();
      const feed = (
        job as {
          source_feed_registry?: { quality_band?: string | null } | null;
        }
      ).source_feed_registry;
      let feedbackDelta = 0;
      if (canonical && preferredCompanies.has(canonical)) feedbackDelta += 10;
      if (canonical && demotedCompanies.has(canonical)) feedbackDelta -= 15;
      if (roleFamily && preferredRoleFamilies.has(roleFamily)) feedbackDelta += 8;
      if (roleFamily && demotedRoleFamilies.has(roleFamily)) feedbackDelta -= 12;

      acc[job.id] = suitabilityScore(job, {
        atsMatch: activeAtsResume?.parsed_text ? (atsByJobId[job.id]?.score ?? null) : null,
        watched: watchedSet.has(canonical),
        qualityBand: feed?.quality_band,
        feedbackDelta,
      });
      return acc;
    }, {});
  }, [activeAtsResume?.parsed_text, atsByJobId, rankAndFilterJobs, userRankingState, watchedSet]);

  const sortedJobs = useMemo(() => {
    const rows = [...rankAndFilterJobs];
    if (rows.length <= 1) return rows;

    const baseOrderById = new Map(rows.map((job, index) => [job.id, index]));
    const baseOrderDiff = (aId: number, bId: number) => (baseOrderById.get(aId) ?? 0) - (baseOrderById.get(bId) ?? 0);
    const recommendationTieBreak = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
      const targetDiff =
        Number(boolValue((b as { is_target_role?: unknown }).is_target_role)) -
        Number(boolValue((a as { is_target_role?: unknown }).is_target_role));
      if (targetDiff !== 0) return targetDiff;

      const directDiff =
        Number(boolValue((b as { is_direct_company_source?: unknown }).is_direct_company_source)) -
        Number(boolValue((a as { is_direct_company_source?: unknown }).is_direct_company_source));
      if (directDiff !== 0) return directDiff;

      const stageDiff =
        careerStageAdjustment(effectiveCareerStage(b.career_stage, b.career_stage_confidence)) -
        careerStageAdjustment(effectiveCareerStage(a.career_stage, a.career_stage_confidence));
      if (stageDiff !== 0) return stageDiff;

      const yearsDiff = yearsValue(a.years_required_min) - yearsValue(b.years_required_min);
      if (yearsDiff !== 0) return yearsDiff;

      const langDiff = langRank(String(b.lang || "")) - langRank(String(a.lang || ""));
      if (langDiff !== 0) return langDiff;

      if (effectiveConsultancyFlag(a) !== effectiveConsultancyFlag(b)) {
        return Number(effectiveConsultancyFlag(a)) - Number(effectiveConsultancyFlag(b));
      }

      const tierA = TIER_RANK[String(a.company_tier || "unknown")] ?? 3;
      const tierB = TIER_RANK[String(b.company_tier || "unknown")] ?? 3;
      if (tierA !== tierB) return tierA - tierB;

      const freshnessDiff = timeValue(String(b.published_at || "")) - timeValue(String(a.published_at || ""));
      if (freshnessDiff !== 0) return freshnessDiff;

      return numberValue(b.id) - numberValue(a.id);
    };

    if (sortBy === "relevance") {
      return rows.sort((a, b) => {
        const diff = (suitabilityByJobId[b.id]?.score ?? 0) - (suitabilityByJobId[a.id]?.score ?? 0);
        if (diff !== 0) return diff;
        return recommendationTieBreak(a, b);
      });
    }

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
      const bScore = atsByJobId[b.id]?.score ?? -1;
      const aScore = atsByJobId[a.id]?.score ?? -1;
      const diff = bScore - aScore;
      if (diff !== 0) return diff;
      return baseOrderDiff(a.id, b.id);
    });
  }, [activeAtsResume?.parsed_text, atsByJobId, rankAndFilterJobs, sortBy, suitabilityByJobId]);

  const visibleJobs = useMemo(
    () => sortedJobs.filter((job) => !hiddenJobIds.has(job.id)),
    [sortedJobs, hiddenJobIds],
  );

  const total = visibleJobs.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const jobs = useMemo(() => {
    const start = page * PAGE_SIZE;
    return visibleJobs.slice(start, start + PAGE_SIZE);
  }, [page, visibleJobs]);

  useEffect(() => {
    setPage(0);
  }, [
    lens,
    hideSwedishRequired,
    hideCitizenshipRestricted,
    hideThreePlusYears,
    hideConsultancies,
    confirmedGraduateOnly,
    includeJobtechInHighSignal,
    search,
    lang,
    remoteOnly,
    deadlineFocus,
    sortBy,
  ]);

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
    lens !== "broad" ||
    sortBy !== "relevance" ||
    lang !== "all" ||
    remoteOnly ||
    !hideSwedishRequired ||
    !hideCitizenshipRestricted ||
    !hideThreePlusYears ||
    !hideConsultancies ||
    confirmedGraduateOnly ||
    includeJobtechInHighSignal ||
    hiddenJobIds.size > 0 ||
    search.trim().length > 0;

  const activeFilterCount =
    Number(lang !== "all") +
    Number(remoteOnly) +
    Number(!hideThreePlusYears) +
    Number(!hideConsultancies) +
    Number(confirmedGraduateOnly) +
    Number(!hideSwedishRequired) +
    Number(!hideCitizenshipRestricted) +
    Number(includeJobtechInHighSignal) +
    Number(hiddenJobIds.size > 0);

  const clearFilters = () => {
    setLens("broad");
    setSearch("");
    setLang("all");
    setRemoteOnly(false);
    setHideSwedishRequired(true);
    setHideCitizenshipRestricted(true);
    setHideThreePlusYears(true);
    setHideConsultancies(true);
    setConfirmedGraduateOnly(false);
    setIncludeJobtechInHighSignal(false);
    setHiddenJobIds(new Set());
    setSortBy("relevance");
    setPage(0);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("swejobs.high-signal.include-jobtech", "false");
      window.localStorage.setItem("swejobs.jobs.hidden-ids", "[]");
    }
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("deadline");
      next.delete("search");
      next.delete("q");
      next.delete("coverage");
      next.delete("lang");
      next.delete("language");
      next.delete("remote");
      next.delete("confirmed");
      next.delete("lens");
      next.delete("jobtech");
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

  const {
    data: detail,
    isLoading: detailLoading,
    isError: detailIsError,
    refetch: refetchDetail,
  } = useQuery({
    queryKey: ["job", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id, headline, headline_en, description, description_en, employer_name, company_canonical, company_tier, municipality, region, lang, " +
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
        .select("id, status, notes, created_at, updated_at")
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
  const [showOriginalDescription, setShowOriginalDescription] = useState(false);
  const [showFullDescription, setShowFullDescription] = useState(false);

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
    setShowOriginalDescription(false);
    setShowFullDescription(false);
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
      if (selectedId && detail) {
        void pushFeedbackEvent({
          signalType: values.status === "applied" ? "apply" : "save",
          jobId: selectedId,
          employerName: detail.company_canonical || detail.employer_name,
          roleFamily: detail.role_family,
          sourceUrl: detail.source_url,
        });
      }
      if (values.status === "applied") {
        setAppliedFeedbackJobId(selectedId ?? null);
        toast({ title: "Added to Applications" });
      } else {
        toast({ title: "Saved" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const trackApplyClick = () => {
    if (!user || !selectedId || !detail || upsertTracking.isPending) {
      return;
    }
    upsertTracking.mutate({ status: "applied", notes });
  };

  const watchCompany = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("watched_companies").upsert(
        {
          user_id: user!.id,
          employer_name: name,
        },
        { onConflict: "user_id,employer_name", ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onSuccess: (_data, name) => {
      qc.invalidateQueries({ queryKey: ["watched-companies", user?.id] });
      if (selectedId && detail) {
        void pushFeedbackEvent({
          signalType: "follow_company",
          jobId: selectedId,
          employerName: detail.company_canonical || detail.employer_name,
          roleFamily: detail.role_family,
          sourceUrl: detail.source_url,
        });
      }
      toast({
        title: `Following ${name}`,
        description: "This company now gets extra ranking priority.",
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
      items[selectedIdx]?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIdx]);

  const listAtsByJobId = atsByJobId;

  const detailAtsResult = useMemo(() => {
    const parsedText = activeAtsResume?.parsed_text;
    if (!detail || !parsedText) return null;

    if (detail.id != null && atsByJobId[detail.id]) {
      return atsByJobId[detail.id];
    }

    return matchResumeToJob(jobRecordToAtsKeywordInput(detail, detailTags ?? []), {
      resumeText: parsedText,
      trackedSkills: userSkills ?? [],
    });
  }, [activeAtsResume?.parsed_text, atsByJobId, detail, detailTags, userSkills]);
  const visibleMatchedKeywords = detailAtsResult?.matchedKeywords.slice(0, 6) ?? [];
  const visibleMissingKeywords = detailAtsResult?.missingKeywords.slice(0, 6) ?? [];
  const previewMissingKeywords = detailAtsResult?.missingKeywords.slice(0, 3) ?? [];
  const detailSuitability = useMemo(() => {
    if (!detail?.id) return null;
    const cached = suitabilityByJobId[detail.id as number];
    if (cached) return cached;
    const canonical = normalizeCompanyName(detail.company_canonical || detail.employer_name);
    return suitabilityScore(detail, {
      atsMatch: detailAtsResult?.score ?? null,
      watched: watchedSet.has(canonical),
    });
  }, [detail, detailAtsResult?.score, suitabilityByJobId, watchedSet]);
  const detailFitReason = detailSuitability ? primarySuitabilityReason(detailSuitability) : null;
  const detailRestrictions = useMemo(() => {
    if (!detail) return [];
    const restrictions: string[] = [];
    if (detail.years_required_min != null) restrictions.push(`${detail.years_required_min}+ years requested`);
    if (detail.swedish_required) restrictions.push("Swedish required");
    if (detail.citizenship_required) restrictions.push("Citizenship/work permit restriction");
    if (detail.security_clearance_required) restrictions.push("Security clearance");
    if (effectiveConsultancyFlag(detail)) restrictions.push("Consultancy role");
    return restrictions;
  }, [detail]);

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
              ? `${pluralizeJobs(total)} due today`
              : deadlineFocus === "week"
                ? `${pluralizeJobs(total)} closing this week`
                : deadlineFocus === "upcoming"
                  ? `${pluralizeJobs(total)} with upcoming deadlines`
                  : `${pluralizeJobs(total)} in this view`}
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
              onClick={() => selectLens(item.id)}
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
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                aria-label="Open filters"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] font-medium">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(calc(100vw-2rem),22rem)] space-y-4 p-4">
              <div className="space-y-2 border-b border-border/60 pb-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Role visibility</h3>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    4 safeguards on
                  </Badge>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Senior, consultancy, Swedish-required, and restricted roles are hidden by default.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Language</p>
                  <Select value={lang} onValueChange={(value) => setLang(normalizeLanguageParam(value))}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All languages</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="mixed">English & Swedish</SelectItem>
                      <SelectItem value="sv">Swedish</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Preferences</p>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs">Remote only</span>
                    <Switch checked={remoteOnly} onCheckedChange={setRemoteOnly} />
                  </div>
                </div>

                {lens === "high_signal" && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs">Include JobTech in High Signal</span>
                    <Switch
                      checked={includeJobtechInHighSignal}
                      onCheckedChange={(next) => {
                        setIncludeJobtechInHighSignal(next);
                        if (typeof window !== "undefined") {
                          window.localStorage.setItem("swejobs.high-signal.include-jobtech", String(next));
                        }
                      }}
                    />
                  </div>
                )}
                {lens === "graduate_trainee" && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs">Confirmed programs only</span>
                    <Switch checked={confirmedGraduateOnly} onCheckedChange={setConfirmedGraduateOnly} />
                  </div>
                )}

                <div className="space-y-3 border-t border-border/60 pt-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Safety filters</p>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs">Hide 3+ years experience</span>
                    <Switch checked={hideThreePlusYears} onCheckedChange={setHideThreePlusYears} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs">Hide consultancies</span>
                    <Switch checked={hideConsultancies} onCheckedChange={setHideConsultancies} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs">Hide Swedish-required</span>
                    <Switch checked={hideSwedishRequired} onCheckedChange={setHideSwedishRequired} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs">Hide citizenship-restricted</span>
                    <Switch checked={hideCitizenshipRestricted} onCheckedChange={setHideCitizenshipRestricted} />
                  </div>
                </div>

                <div className="space-y-3 border-t border-border/60 pt-3 sm:hidden">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Sort and match</p>
                  <Select value={sortBy} onValueChange={(value) => setSortBy(value as JobSort)}>
                    <SelectTrigger className="h-8 w-full text-xs" aria-label="Sort jobs">
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
                  {user && (atsResumes?.length ?? 0) > 1 ? (
                    <Select value={selectedAtsResumeId} onValueChange={setSelectedAtsResumeId}>
                      <SelectTrigger className="h-8 w-full text-xs" aria-label="Résumé for job matching">
                        <SelectValue placeholder="Résumé for match" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">
                          {activeAtsResume
                            ? `Default (${activeAtsResume.file_name || activeAtsResume.label})`
                            : "Default résumé"}
                        </SelectItem>
                        {(atsResumes ?? []).map((resume) => (
                          <SelectItem key={resume.id} value={resume.id}>
                            {resume.file_name || resume.label}
                            {resume.is_default ? " (Default)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 w-full text-xs">
                  Reset all controls
                </Button>
              )}
            </PopoverContent>
          </Popover>

          <Select value={sortBy} onValueChange={(value) => setSortBy(value as JobSort)}>
            <SelectTrigger className="hidden h-8 w-44 text-xs sm:flex" aria-label="Sort jobs">
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

          {user && (atsResumes?.length ?? 0) > 1 ? (
            <Select value={selectedAtsResumeId} onValueChange={setSelectedAtsResumeId}>
              <SelectTrigger className="hidden h-8 w-56 text-xs sm:flex" aria-label="Résumé for job matching">
                <SelectValue placeholder="Resume for match" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  {activeAtsResume
                    ? `Default (${activeAtsResume.file_name || activeAtsResume.label})`
                    : "Default résumé"}
                </SelectItem>
                {(atsResumes ?? []).map((resume) => (
                  <SelectItem key={resume.id} value={resume.id}>
                    {resume.file_name || resume.label}
                    {resume.is_default ? " (Default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {user && (atsResumes?.length ?? 0) === 1 && activeAtsResume ? (
            <Badge variant="outline" className="hidden h-8 rounded-md px-2 text-xs font-normal sm:inline-flex">
              Résumé: {activeAtsResume.file_name || activeAtsResume.label}
            </Badge>
          ) : null}
          {user ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setResumeUploadOpen(true)}
            >
              <FileUp className="h-3.5 w-3.5" />
              {(atsResumes?.length ?? 0) === 0 ? "Add résumé" : "Upload another"}
            </Button>
          ) : null}

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 px-2 text-xs">
              Reset controls
            </Button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5">
            {lang !== "all" && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                Language: {languageLabel(lang)}
                <button type="button" onClick={() => setLang("all")} className="hover:text-foreground" aria-label="Clear language filter">
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )}
            {remoteOnly && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                Remote only
                <button type="button" onClick={() => setRemoteOnly(false)} className="hover:text-foreground" aria-label="Clear remote-only filter">
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )}
            {confirmedGraduateOnly && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                Confirmed programs only
                <button
                  type="button"
                  onClick={() => setConfirmedGraduateOnly(false)}
                  className="hover:text-foreground"
                  aria-label="Include possible early-career roles"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )}
            {!hideThreePlusYears && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                Including 3+ years
                <button
                  type="button"
                  onClick={() => setHideThreePlusYears(true)}
                  className="hover:text-foreground"
                  aria-label="Require up to 2 years experience"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )}
            {includeJobtechInHighSignal && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                JobTech pass-through enabled
                <button
                  type="button"
                  onClick={() => {
                    setIncludeJobtechInHighSignal(false);
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem("swejobs.high-signal.include-jobtech", "false");
                    }
                  }}
                  className="hover:text-foreground"
                  aria-label="Disable JobTech pass-through"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )}
            {!hideConsultancies && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                Including consultancies
                <button
                  type="button"
                  onClick={() => setHideConsultancies(true)}
                  className="hover:text-foreground"
                  aria-label="Hide consultancy roles"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )}
            {hiddenJobIds.size > 0 && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                {hiddenJobIds.size} hidden
                <button
                  type="button"
                  onClick={() => {
                    setHiddenJobIds(new Set());
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem("swejobs.jobs.hidden-ids", "[]");
                    }
                  }}
                  className="hover:text-foreground"
                  aria-label="Unhide all jobs"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )}
            {deadlineFocus !== "none" && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                Deadline: {deadlineFocus}
                <button
                  type="button"
                  onClick={() =>
                    setSearchParams((current) => {
                      const next = new URLSearchParams(current);
                      next.delete("deadline");
                      return next;
                    })
                  }
                  className="hover:text-foreground"
                  aria-label="Clear deadline focus"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )}
          </div>
        )}

        {!tipDismissed && (
          <div className="flex items-center justify-between rounded-lg border border-border/40 bg-primary/5 px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-primary">Tip:</span>{" "}
              Use the SweJobs Chrome extension to capture jobs from LinkedIn, Greenhouse, Lever, and any career page directly into your Applications.
            </span>
            <button
              type="button"
              className="ml-3 shrink-0 text-muted-foreground/60 hover:text-foreground"
              onClick={() => {
                window.localStorage.setItem("swejobs.explore.tip-dismissed", "true");
                setTipDismissed(true);
              }}
              aria-label="Dismiss explore tip"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {sortBy === "ats_desc" && !activeAtsResume?.parsed_text ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">
              Add a résumé to sort jobs by keyword match.
            </p>
            {user ? (
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setResumeUploadOpen(true)}>
                Add résumé
              </Button>
            ) : null}
          </div>
        ) : null}
        {sortBy === "ats_desc" && activeAtsResume?.parsed_text ? (
          <p className="text-[11px] text-muted-foreground">
            Keyword match is not a full hiring-fit score. Experience and seniority requirements still apply.
          </p>
        ) : null}

        <div className="flex min-w-0 flex-col gap-4 md:h-[calc(100vh-320px)] md:flex-row">
          <div
            className={cn(
              "min-w-0 flex-col transition-all duration-200",
              selectedId
                ? "hidden md:flex md:w-[380px] md:shrink-0"
                : "flex w-full md:max-w-2xl",
            )}
          >
            {searchParams.get("coverage") === "1" && coverageBanner && (
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
              <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
                <div>
                  <p className="font-medium text-destructive">Jobs could not be loaded</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {jobsError instanceof Error ? jobsError.message : "The jobs query failed unexpectedly."}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void refetchJobs()}>
                  <RotateCcw className="h-3.5 w-3.5" /> Retry
                </Button>
              </div>
            ) : jobs.length === 0 ? (
              <div className="space-y-3 rounded-lg border border-dashed border-border/60 px-5 py-12 text-center">
                <p className="text-sm font-medium">
                  {(activeJobCountQuery.data ?? 0) === 0
                    ? "No active jobs are available yet"
                    : debouncedSearch.trim()
                      ? `No results for “${debouncedSearch.trim()}”`
                      : "No jobs match these filters"}
                </p>
                <p className="mx-auto max-w-md text-xs text-muted-foreground">
                  {(activeJobCountQuery.data ?? 0) === 0
                    ? "Connected sources are still being populated. Try again after the next ingestion cycle."
                    : searchParams.get("coverage") === "1" && coverageBanner
                      ? coverageBanner.body
                      : debouncedSearch.trim()
                        ? activeSearchCount === 0
                          ? "Try a broader title or company name, or clear the search."
                          : searchCoverage?.visibleCount === 0
                            ? "Current matches were excluded by the software-role trust filters."
                            : "Try clearing the search or resetting filters."
                        : "Reset the filters to return to the recommended For You view."}
                </p>
                {(activeJobCountQuery.data ?? 0) > 0 ? (
                  <div className="flex justify-center gap-2">
                    {debouncedSearch.trim() ? (
                      <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                        Clear search
                      </Button>
                    ) : null}
                    <Button size="sm" onClick={clearFilters}>Reset filters</Button>
                  </div>
                ) : null}
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
                      const careerBucket = earlyCareerBucket(job);
                      const displayEmployer = companyDisplayName(job.company_canonical, job.employer_name);
                      const suitability = suitabilityByJobId[job.id];
                      const fitReason = suitability ? primarySuitabilityReason(suitability) : null;
                      const statusIcons: Array<{ key: string; node: JSX.Element }> = [];
                      if (trackedStatus === "applied") {
                        statusIcons.push({
                          key: "applied",
                          node: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-label="Applied" />,
                        });
                      } else if (trackedStatus === "saved") {
                        statusIcons.push({
                          key: "saved",
                          node: <Bookmark className="h-3.5 w-3.5 fill-primary/20 text-primary" aria-label="Saved" />,
                        });
                      }
                      if (watched && statusIcons.length < 2) {
                        statusIcons.push({
                          key: "following",
                          node: <Star className="h-3.5 w-3.5 fill-amber-400/20 text-amber-400" aria-label="Following company" />,
                        });
                      }

                      return (
                        <div key={job.id} className="relative">
                          <div
                            data-job-item
                            role="button"
                            tabIndex={0}
                            aria-label={`Open details for ${(job.lang === "sv" ? job.headline_en : null) || job.headline}`}
                            onClick={() => {
                              setSelectedId(job.id);
                              setSelectedIdx(idx);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedId(job.id);
                                setSelectedIdx(idx);
                              }
                            }}
                            className={cn(
                              "cursor-pointer rounded-md border-l-2 px-3 py-2.5 pr-16 transition-all duration-200 focus:outline-none focus:ring-1 focus:ring-primary/50",
                              isSelected && "border-l-primary bg-primary/5 shadow-sm ring-1 ring-primary/20",
                              !isSelected && "border-l-transparent hover:bg-muted/40",
                              !isSelected && job.company_tier === "A" && "border-l-emerald-500/40",
                              !isSelected && job.company_tier === "B" && "border-l-sky-500/30",
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="min-w-0 flex-1 text-sm font-medium leading-snug line-clamp-1">
                                {(job.lang === "sv" ? job.headline_en : null) || job.headline}
                              </h3>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {suitability ? (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <Badge
                                            variant="outline"
                                            className={cn(
                                              "h-4 px-1.5 text-[9px] font-normal",
                                              suitability.label === "Strong" && "border-primary/30 text-primary",
                                              suitability.label === "Possible" && "border-sky-500/30 text-sky-300",
                                              suitability.label === "Stretch" && "border-muted-foreground/30 text-muted-foreground",
                                            )}
                                          >
                                            {suitability.label} fit
                                          </Badge>
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs text-xs">
                                        {suitability.score}/100 — role relevance, career stage, résumé match, source quality, and your preferences.
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : null}
                                {statusIcons.map((item) => (
                                  <span key={item.key}>{item.node}</span>
                                ))}
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
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {job.municipality && <span>{job.municipality}</span>}
                            {job.remote_flag && <span>Remote</span>}
                            {job.lang && <span>{languageLabel(job.lang)}</span>}
                            <span>
                              {lens === "graduate_trainee" || careerBucket !== "stretch"
                                ? EARLY_CAREER_LABELS[careerBucket]
                                : stage !== "unknown"
                                  ? stage
                                  : "experience unspecified"}
                            </span>
                            <span>{formatDeadlineDisplay(job.application_deadline)}</span>
                          </div>
                          {fitReason ? (
                            <p className="mt-1 text-[10px] text-muted-foreground/80">{fitReason}</p>
                          ) : null}

                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {tags.slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="outline" className="h-4 px-1.5 text-[9px] font-normal">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                          </div>
                          <button
                            type="button"
                            className="absolute right-2 top-2.5 inline-flex h-6 items-center rounded border border-border/50 bg-background/80 px-1.5 text-[9px] text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                            aria-label={`Hide ${(job.lang === "sv" ? job.headline_en : null) || job.headline}`}
                            onClick={() => {
                              setHiddenJobIds((previous) => {
                                const next = new Set(previous);
                                next.add(job.id);
                                if (typeof window !== "undefined") {
                                  window.localStorage.setItem("swejobs.jobs.hidden-ids", JSON.stringify(Array.from(next)));
                                }
                                return next;
                              });
                              void pushFeedbackEvent({
                                signalType: "hide",
                                jobId: job.id,
                                employerName: job.company_canonical || job.employer_name,
                                roleFamily: job.role_family,
                                sourceUrl: job.source_url,
                              });
                            }}
                          >
                            <EyeOff className="mr-0.5 h-2.5 w-2.5" />
                            Hide
                          </button>
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
                      aria-label="Previous page"
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
                      aria-label="Next page"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
                      className="h-7 w-7 p-0"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  Click a role or use ↑↓ Navigate · Enter Open · Esc Close
                </p>
              </>
            )}
          </div>

          <AnimatePresence>
            {selectedId && detailLoading && (
              <motion.div
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className="min-h-[50vh] min-w-0 flex-1 space-y-4 rounded-lg border border-border/40 bg-card p-5 md:min-h-0"
              >
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-48 w-full" />
              </motion.div>
            )}
            {selectedId && detailIsError && (
              <motion.div
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className="min-h-[50vh] min-w-0 flex-1 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 p-6 md:min-h-0"
              >
                <div className="max-w-sm text-center">
                  <p className="text-sm font-medium">This job could not be opened</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    It may have expired or the detail query may have failed.
                  </p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => void refetchDetail()}>Retry</Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedId(null);
                        setSelectedIdx(-1);
                      }}
                    >
                      Close
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
            {selectedId && detail && (
              <motion.div
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
                className="h-[calc(100vh-9rem)] min-w-0 flex-1 overflow-hidden rounded-lg border border-border/40 bg-card md:h-auto"
              >
                <ScrollArea className="h-full">
                  <div className="space-y-5 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold leading-tight">
                          {(detail.lang === "sv" ? detail.headline_en : null) || detail.headline}
                        </h2>
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
                          {detail.lang && <span>{languageLabel(detail.lang)}</span>}
                          {effectiveCareerStage(detail.career_stage, detail.career_stage_confidence) !== "unknown" && (
                            <span>{effectiveCareerStage(detail.career_stage, detail.career_stage_confidence)}</span>
                          )}
                          {detail.published_at && (
                            <span>Published {formatDisplayDate(detail.published_at)}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Close job details"
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
                        <Button asChild variant="default" size="sm" className="h-8 gap-1.5 text-xs">
                          <a href={detail.source_url} target="_blank" rel="noopener noreferrer" onClick={trackApplyClick}>
                            <ExternalLink className="h-3 w-3" /> Apply
                          </a>
                        </Button>
                      )}
                      {user && (
                        <>
                          <Button
                            size="sm"
                            variant={tracking?.status === "saved" ? "secondary" : "outline"}
                            className="h-8 text-xs"
                            onClick={() => upsertTracking.mutate({ status: "saved", notes })}
                            disabled={upsertTracking.isPending}
                          >
                            <Bookmark className="mr-1 h-3 w-3" /> Save
                          </Button>
                          <Button
                            size="sm"
                            variant={tracking?.status === "applied" ? "secondary" : "outline"}
                            className="h-8 text-xs"
                            onClick={() => upsertTracking.mutate({ status: "applied", notes })}
                            disabled={upsertTracking.isPending}
                          >
                            <CheckCircle2 className="mr-1 h-3 w-3" /> I Applied
                          </Button>
                        </>
                      )}
                      {user && detailDisplayEmployer && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-xs text-muted-foreground"
                          onClick={() => watchCompany.mutate(detail.company_canonical || detailDisplayEmployer)}
                        >
                          <Star className="h-3 w-3" /> Follow
                        </Button>
                      )}
                    </div>

                    {selectedId && appliedFeedbackJobId === selectedId ? (
                      <p className="text-xs text-emerald-300">
                        Added to Applications.{" "}
                        <Link to="/applications" className="underline">
                          View →
                        </Link>
                      </p>
                    ) : null}

                    {detailRestrictions.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {detailRestrictions.map((restriction) => (
                          <Badge key={restriction} variant="outline" className="border-amber-500/30 text-xs font-normal text-amber-200">
                            {restriction}
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    {detailFitReason ? (
                      <p className="text-xs text-muted-foreground">{detailFitReason}</p>
                    ) : null}

                    <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                      {detail.remote_flag && <span>Remote</span>}
                      {detail.is_direct_company_source && <span>{detailProviderLabel}</span>}
                      {detail.employment_type && <span>{detail.employment_type}</span>}
                      {detail.working_hours && <span>{detail.working_hours}</span>}
                      {detail.application_deadline && <span>{formatDeadlineDisplay(detail.application_deadline)}</span>}
                    </div>

                    {detailAtsResult && detailAtsResult.keywordCount > 0 ? (
                      <Collapsible open={showAtsDetails} onOpenChange={setShowAtsDetails}>
                        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <h3 className="text-sm font-semibold">Keyword match</h3>
                              {!showAtsDetails ? (
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                  {previewMissingKeywords.length > 0
                                    ? `Top gaps: ${previewMissingKeywords.join(", ")}`
                                    : "Résumé keywords align with this role."}
                                </p>
                              ) : (
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                  Deterministic keyword comparison between your résumé and this job.
                                </p>
                              )}
                            </div>
                            <Badge variant="outline" className={cn("text-xs font-normal", atsBadgeClass(detailAtsResult.score))}>
                              {detailAtsResult.score}%
                            </Badge>
                          </div>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="mt-2 h-7 gap-1.5 px-2 text-xs">
                              {showAtsDetails ? "Hide keyword analysis" : "Show keyword analysis"}
                              <ChevronsUpDown className="h-3.5 w-3.5" />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="space-y-3 pt-2">
                            <div className="flex flex-wrap gap-1.5 text-[10px]">
                              <Badge variant="secondary">
                                Career stage: {effectiveCareerStage(detail.career_stage, detail.career_stage_confidence)}
                              </Badge>
                              {detailRestrictions.length === 0 ? (
                                <Badge variant="outline" className="border-emerald-500/30 text-emerald-200">
                                  No detected restrictions
                                </Badge>
                              ) : null}
                            </div>
                            {(visibleMatchedKeywords.length > 0 || visibleMissingKeywords.length > 0) && (
                              <div className="grid gap-3 md:grid-cols-2">
                                <div>
                                  <p className="mb-1 text-[11px] font-medium text-emerald-200">Keywords found</p>
                                  <div className="flex flex-wrap gap-1">
                                    {visibleMatchedKeywords.length > 0 ? (
                                      visibleMatchedKeywords.map((keyword) => (
                                        <Badge key={keyword} variant="secondary" className="text-[10px] font-normal">
                                          {keyword}
                                        </Badge>
                                      ))
                                    ) : (
                                      <span className="text-[11px] text-muted-foreground">No direct keyword matches yet</span>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <p className="mb-1 text-[11px] font-medium text-amber-200">Keyword gaps</p>
                                  <div className="flex flex-wrap gap-1">
                                    {visibleMissingKeywords.length > 0 ? (
                                      visibleMissingKeywords.map((keyword) => (
                                        <Badge key={keyword} variant="outline" className="text-[10px] font-normal">
                                          {keyword}
                                        </Badge>
                                      ))
                                    ) : (
                                      <span className="text-[11px] text-muted-foreground">No obvious keyword gaps</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                            <p className="text-[11px] text-muted-foreground">
                              Keyword overlap supports your decision; it does not predict hiring outcomes.
                            </p>
                            <div>
                              <p className="mb-1 text-xs text-muted-foreground">All matched keywords</p>
                              <div className="flex flex-wrap gap-1">
                                {detailAtsResult.matchedKeywords.slice(0, 10).map((keyword) => (
                                  <Badge key={keyword} variant="secondary" className="text-[10px] font-normal">
                                    {keyword}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="mb-1 text-xs text-muted-foreground">All missing keywords</p>
                              <div className="flex flex-wrap gap-1">
                                {detailAtsResult.missingKeywords.slice(0, 10).map((keyword) => (
                                  <Badge key={keyword} variant="outline" className="text-[10px] font-normal">
                                    {keyword}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    ) : user ? (
                      <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4">
                        <h3 className="text-sm font-semibold">See keyword match details</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Add a résumé to compare your skills with the job requirements without leaving Explore.
                        </p>
                        <Button size="sm" className="mt-3 gap-1.5" onClick={() => setResumeUploadOpen(true)}>
                          <FileUp className="h-3.5 w-3.5" /> Add résumé to see your fit
                        </Button>
                      </div>
                    ) : null}

                    {user && (
                      <div className="space-y-2 border-t border-border/40 pt-4">
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

                    <Collapsible open={showFullDescription} onOpenChange={setShowFullDescription}>
                      <div className="rounded-lg border border-border/50">
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" className="flex h-11 w-full justify-between rounded-lg px-3 text-sm">
                            Full description
                            <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="border-t border-border/50 px-3 pb-4 pt-3">
                          {detail.lang === "sv" && detail.description_en ? (
                            <button
                              type="button"
                              className="mb-3 text-[11px] text-primary hover:text-primary/80"
                              onClick={() => setShowOriginalDescription((previous) => !previous)}
                            >
                              {showOriginalDescription ? "Show English translation" : "Show original Swedish"}
                            </button>
                          ) : null}
                          <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                            {(detail.lang === "sv" && detail.description_en && !showOriginalDescription
                              ? detail.description_en
                              : detail.description) || "No description available."}
                          </p>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  </div>
                </ScrollArea>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {user ? (
        <ResumeUploadDialog
          open={resumeUploadOpen}
          onOpenChange={setResumeUploadOpen}
          userId={user.id}
          makeDefault={(atsResumes?.length ?? 0) === 0}
          onUploaded={async (resume) => {
            await qc.invalidateQueries({ queryKey: ["ats-resumes", user.id] });
            setSelectedAtsResumeId(resume.id);
          }}
        />
      ) : null}
    </AppLayout>
  );
}
