import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  ClipboardList,
  ExternalLink,
  FileDown,
  FileSearch,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import {
  type AtsScanResult,
  extractKeywordsFromJobText,
  runAtsScan,
} from "@/lib/ats";
import {
  companyRegistry,
} from "@/lib/companyRegistry";
import {
  APPLICATION_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  buildSweJobsApplication,
  type ApplicationInsert,
  type ApplicationRow,
  type ApplicationSort,
  type ApplicationStatus,
  sweJobsApplicationRequestId,
  computeApplicationMetrics,
  formatApplicationDate,
  formatApplicationDateInput,
} from "@/lib/applications";
import { getErrorMessage, toDisplayError } from "@/lib/errors";
import { downloadCSV } from "@/lib/export";
import {
  buildUrlLookupCandidates,
  canonicalizeJobUrl,
  hostLookupIlikePatterns,
  selectBestSimilarUrlMatch,
} from "@/lib/jobUrlMatching";
import {
  deriveResumeLabel,
  MAX_RESUMES_PER_USER,
  uploadResumeVersion,
} from "@/lib/resumes";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = ["25", "50", "100"] as const;
const RESUME_NONE = "__none";

type FilterStatus = "all" | ApplicationStatus;
type ResumeVersion = Tables<"resume_versions">;
type JobTag = { job_id: number; tag: string };
type JobSummary = { id: number; headline: string; description: string | null };
type UrlMatchJob = { id: number; headline: string; employer_name: string | null; source_url: string | null };
type StatusTimelineEntry = { status: ApplicationStatus; at: string };
type TrackedAppliedRow = {
  job_id: number;
  status: string;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  jobs: { id: number; headline: string; employer_name: string | null; source_url: string | null } | null;
};

type ApplicationFormState = {
  company: string;
  job_title: string;
  status: ApplicationStatus;
  job_url: string;
  applied_at: string;
  job_id: number | null;
  resume_version_id: string;
  ats_job_description: string;
  notes: string;
};

const SORT_OPTIONS: Array<{ value: ApplicationSort; label: string }> = [
  { value: "applied_desc", label: "Applied date (newest)" },
  { value: "applied_asc", label: "Applied date (oldest)" },
  { value: "company_asc", label: "Company (A-Z)" },
  { value: "company_desc", label: "Company (Z-A)" },
  { value: "status", label: "Status" },
  { value: "ats_desc", label: "ATS score (highest)" },
  { value: "ats_asc", label: "ATS score (lowest)" },
];

function toAppliedAtIso(dateValue: string) {
  return new Date(`${dateValue}T12:00:00`).toISOString();
}

function emptyFormState(defaultResumeId = ""): ApplicationFormState {
  return {
    company: "",
    job_title: "",
    status: "applied",
    job_url: "",
    applied_at: formatApplicationDateInput(new Date().toISOString()),
    job_id: null,
    resume_version_id: defaultResumeId || RESUME_NONE,
    ats_job_description: "",
    notes: "",
  };
}

function buildFormState(application: ApplicationRow, resumeVersions: ResumeVersion[]): ApplicationFormState {
  const matchingResumeVersion = application.resume_version_id
    ? resumeVersions.find((resumeVersion) => resumeVersion.id === application.resume_version_id)
    : null;

  return {
    company: application.company,
    job_title: application.job_title,
    status: application.status as ApplicationStatus,
    job_url: application.job_url,
    applied_at: formatApplicationDateInput(application.applied_at),
    job_id: application.job_id,
    resume_version_id: matchingResumeVersion?.storage_path ? matchingResumeVersion.id : RESUME_NONE,
    ats_job_description: "",
    notes: application.notes ?? "",
  };
}

function compareApplications(a: ApplicationRow, b: ApplicationRow, sort: ApplicationSort) {
  if (sort === "applied_asc") {
    const diff = a.applied_at.localeCompare(b.applied_at);
    if (diff !== 0) return diff;
  }
  if (sort === "company_asc") {
    const diff = a.company.localeCompare(b.company, "sv");
    if (diff !== 0) return diff;
  }
  if (sort === "company_desc") {
    const diff = b.company.localeCompare(a.company, "sv");
    if (diff !== 0) return diff;
  }
  if (sort === "ats_desc") {
    const diff = (b.ats_score ?? -1) - (a.ats_score ?? -1);
    if (diff !== 0) return diff;
  }
  if (sort === "ats_asc") {
    const diff = (a.ats_score ?? 101) - (b.ats_score ?? 101);
    if (diff !== 0) return diff;
  }
  if (sort === "status") {
    const statusCompare = a.status.localeCompare(b.status, "sv");
    if (statusCompare !== 0) return statusCompare;
  }
  const appliedCompare = b.applied_at.localeCompare(a.applied_at);
  if (appliedCompare !== 0) return appliedCompare;
  return b.id.localeCompare(a.id, "sv");
}

function applicationRowTint(status: ApplicationStatus): string {
  if (status === "offer") return "bg-emerald-900/10";
  if (status === "interviewing" || status === "oa") return "bg-amber-900/10";
  if (status === "rejected") return "bg-rose-900/10";
  if (status === "withdrawn") return "bg-zinc-800/10";
  return "";
}

function daysSinceApplied(value: string | null | undefined): number | null {
  if (!value) return null;
  const appliedAt = new Date(value);
  if (Number.isNaN(appliedAt.getTime())) return null;
  const now = new Date();
  const diff = now.getTime() - appliedAt.getTime();
  if (diff < 0) return 0;
  return Math.floor(diff / 86_400_000);
}

function formatDaysSinceApplied(value: string | null | undefined): string {
  const days = daysSinceApplied(value);
  if (days == null) return "—";
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function parseStatusHistory(value: Json | null | undefined): StatusTimelineEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const status = record.status;
      const at = record.at;
      if (typeof status !== "string" || typeof at !== "string") return null;
      if (!APPLICATION_STATUSES.includes(status as ApplicationStatus)) return null;
      return { status: status as ApplicationStatus, at };
    })
    .filter((entry): entry is StatusTimelineEntry => Boolean(entry));
}

function createStatusHistory(status: ApplicationStatus, at: string): StatusTimelineEntry[] {
  return [{ status, at }];
}

function appendStatusHistory(
  current: Json | null | undefined,
  nextStatus: ApplicationStatus,
  at: string = new Date().toISOString(),
): StatusTimelineEntry[] {
  const timeline = parseStatusHistory(current);
  const last = timeline[timeline.length - 1];
  if (last && last.status === nextStatus) {
    return timeline;
  }
  return [...timeline, { status: nextStatus, at }];
}

function formatStatusHistoryTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("sv-SE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildAtsPersistencePayload(result: AtsScanResult, source: "job_tags" | "job_description") {
  return {
    ats_score: result.score,
    ats_keywords_json: {
      matched: result.matchedKeywords,
      missing: result.missingKeywords,
      tracked_missing: result.trackedMissingKeywords,
      source,
      scanned_at: new Date().toISOString(),
    },
  };
}

function matchesSearch(application: ApplicationRow, query: string) {
  if (!query) return true;
  const haystack = [application.company, application.job_title, application.job_url, application.resume_label ?? ""]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function buildResumeSnapshot(
  resumeVersions: ResumeVersion[],
  application: ApplicationRow | null,
  selectedResumeId: string,
) {
  if (selectedResumeId && selectedResumeId !== RESUME_NONE) {
    const selectedResume = resumeVersions.find((resumeVersion) => resumeVersion.id === selectedResumeId);
    if (!selectedResume) {
      throw new Error("Selected resume could not be found.");
    }

    return {
      resume_version_id: selectedResume.id,
      resume_label: selectedResume.label,
    };
  }

  return {
    resume_version_id: null,
    resume_label:
      application && !application.resume_version_id && application.resume_label
        ? application.resume_label
        : "",
  };
}

function domainFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_error) {
    return "";
  }
}

function companyFaviconUrl(jobUrl: string): string | null {
  const domain = domainFromUrl(jobUrl);
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

function companyFromCareerPageDomain(url: string): string | null {
  const pastedDomain = domainFromUrl(url);
  if (!pastedDomain) return null;

  for (const entry of companyRegistry) {
    if (!entry.career_page_url) continue;
    const careerDomain = domainFromUrl(entry.career_page_url);
    if (!careerDomain) continue;
    if (pastedDomain === careerDomain || pastedDomain.endsWith(`.${careerDomain}`)) {
      return entry.display_name;
    }
  }

  return null;
}

async function fetchExternalJobTitle(url: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("extract-job-title", {
      body: { url },
    });

    if (error) return null;
    const title = typeof data?.title === "string" ? data.title.trim() : "";
    return title || null;
  } catch (_error) {
    return null;
  }
}

export default function Applications() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const resumeUploadInputRef = useRef<HTMLInputElement | null>(null);
  const handledPrefillRef = useRef<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingApplication, setEditingApplication] = useState<ApplicationRow | null>(null);
  const [form, setForm] = useState<ApplicationFormState>(emptyFormState());
  const [urlMatchNotice, setUrlMatchNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ApplicationSort>("applied_desc");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>("25");
  const [page, setPage] = useState(0);
  const [selectedApplicationIds, setSelectedApplicationIds] = useState<string[]>([]);

  const [atsDialogOpen, setAtsDialogOpen] = useState(false);
  const [atsApplication, setAtsApplication] = useState<ApplicationRow | null>(null);
  const [atsResumeId, setAtsResumeId] = useState<string>(RESUME_NONE);
  const [manualJobDescription, setManualJobDescription] = useState("");
  const [atsResult, setAtsResult] = useState<AtsScanResult | null>(null);

  const debouncedSearch = useDebouncedValue(search, 275).trim().toLowerCase();

  useEffect(() => {
    document.title = "Applications | SweJobs";
  }, []);

  const resumeVersionsQuery = useQuery({
    queryKey: ["resume-versions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resume_versions")
        .select(
          "id, user_id, label, is_default, parsed_text, storage_path, file_name, file_size_bytes, mime_type, " +
            "text_extracted_at, created_at, updated_at",
        )
        .eq("user_id", user!.id)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw toDisplayError(error, "Could not load your resume library.");
      return data ?? [];
    },
  });

  const applicationsQuery = useQuery({
    queryKey: ["applications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select(
          "id, user_id, request_id, job_id, company, job_title, job_url, status, applied_at, notes, resume_label, " +
            "resume_version_id, ats_score, ats_keywords_json, status_history, created_at, updated_at",
        )
        .eq("user_id", user!.id)
        .order("applied_at", { ascending: false });
      if (error) throw toDisplayError(error, "Could not load your applications.");
      return data ?? [];
    },
  });

  const jobIds = useMemo(
    () => Array.from(new Set((applicationsQuery.data ?? []).map((application) => application.job_id).filter(Boolean))) as number[],
    [applicationsQuery.data],
  );

  const jobsQuery = useQuery({
    queryKey: ["application-jobs", jobIds.join(",")],
    enabled: jobIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, headline, description")
        .in("id", jobIds);
      if (error) throw toDisplayError(error, "Could not load linked job details.");
      return (data ?? []) as JobSummary[];
    },
  });

  const jobTagsQuery = useQuery({
    queryKey: ["application-job-tags", jobIds.join(",")],
    enabled: jobIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_tags")
        .select("job_id, tag")
        .in("job_id", jobIds);
      if (error) throw toDisplayError(error, "Could not load job tags for ATS scans.");
      return (data ?? []) as JobTag[];
    },
  });

  const userSkillsQuery = useQuery({
    queryKey: ["user-skills", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_skills")
        .select("skill")
        .eq("user_id", user!.id);
      if (error) throw toDisplayError(error, "Could not load your tracked skills.");
      return (data ?? []).map((item) => item.skill);
    },
  });

  const jobsById = useMemo(() => {
    return (jobsQuery.data ?? []).reduce<Record<number, JobSummary>>((acc, job) => {
      acc[job.id] = job;
      return acc;
    }, {});
  }, [jobsQuery.data]);

  const tagsByJobId = useMemo(() => {
    return (jobTagsQuery.data ?? []).reduce<Record<number, string[]>>((acc, item) => {
      if (!acc[item.job_id]) acc[item.job_id] = [];
      acc[item.job_id].push(item.tag);
      return acc;
    }, {});
  }, [jobTagsQuery.data]);

  const formLinkedJobQuery = useQuery({
    queryKey: ["application-form-job", form.job_id],
    enabled: dialogOpen && !!form.job_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, headline, description")
        .eq("id", form.job_id!)
        .maybeSingle();
      if (error) throw toDisplayError(error, "Could not load the linked job for ATS preflight.");
      return data as JobSummary | null;
    },
  });

  const formLinkedJobTagsQuery = useQuery({
    queryKey: ["application-form-job-tags", form.job_id],
    enabled: dialogOpen && !!form.job_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_tags")
        .select("tag")
        .eq("job_id", form.job_id!);
      if (error) throw toDisplayError(error, "Could not load linked job tags for ATS preflight.");
      return (data ?? []).map((item) => item.tag);
    },
  });

  const availableResumes = (resumeVersionsQuery.data ?? []).filter((resumeVersion) => Boolean(resumeVersion.storage_path));
  const resumeLimitReached = (resumeVersionsQuery.data?.length ?? 0) >= MAX_RESUMES_PER_USER;
  const defaultResume = useMemo(
    () => availableResumes.find((resumeVersion) => resumeVersion.is_default) ?? availableResumes[0] ?? null,
    [availableResumes],
  );
  const defaultResumeId = defaultResume?.id ?? "";

  const preflightAts = useMemo(() => {
    if (!dialogOpen) return null;
    if (!form.resume_version_id || form.resume_version_id === RESUME_NONE) return null;
    const selectedResume = availableResumes.find((resumeVersion) => resumeVersion.id === form.resume_version_id);
    if (!selectedResume?.parsed_text) return null;

    const targetKeywords =
      formLinkedJobTagsQuery.data && formLinkedJobTagsQuery.data.length > 0
        ? formLinkedJobTagsQuery.data
        : formLinkedJobQuery.data
          ? extractKeywordsFromJobText(
              [formLinkedJobQuery.data.headline, formLinkedJobQuery.data.description ?? ""].join(" "),
              35,
            )
          : extractKeywordsFromJobText(form.ats_job_description, 35);

    if (targetKeywords.length === 0) return null;

    const result = runAtsScan({
      resumeText: selectedResume.parsed_text,
      targetKeywords,
      trackedSkills: userSkillsQuery.data ?? [],
    });

    return {
      result,
      source: formLinkedJobTagsQuery.data && formLinkedJobTagsQuery.data.length > 0 ? "job_tags" as const : "job_description" as const,
    };
  }, [
    availableResumes,
    dialogOpen,
    form.ats_job_description,
    form.resume_version_id,
    formLinkedJobQuery.data,
    formLinkedJobTagsQuery.data,
    userSkillsQuery.data,
  ]);

  useEffect(() => {
    if (!user) return;
    const prefillJobId = searchParams.get("prefill_job_id");
    if (!prefillJobId || handledPrefillRef.current === prefillJobId) return;
    handledPrefillRef.current = prefillJobId;

    void (async () => {
      const jobId = Number(prefillJobId);
      if (!Number.isFinite(jobId)) return;

      const { data, error } = await supabase
        .from("jobs")
        .select("id, headline, employer_name, source_url")
        .eq("id", jobId)
        .maybeSingle();
      if (error || !data) return;

      setEditingApplication(null);
      setForm({
        ...emptyFormState(defaultResumeId),
        company: data.employer_name ?? "",
        job_title: data.headline,
        job_url: data.source_url ?? "",
        job_id: data.id,
      });
      setUrlMatchNotice("Prefilled from Explore.");
      setDialogOpen(true);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("prefill_job_id");
        return next;
      }, { replace: true });
    })();
  }, [defaultResumeId, searchParams, setSearchParams, user]);

  const filteredApplications = useMemo(() => {
    return (applicationsQuery.data ?? [])
      .filter((application) => (statusFilter === "all" ? true : application.status === statusFilter))
      .filter((application) => matchesSearch(application, debouncedSearch))
      .sort((a, b) => compareApplications(a, b, sort));
  }, [applicationsQuery.data, debouncedSearch, sort, statusFilter]);

  const applicationsById = useMemo(
    () => new Map((applicationsQuery.data ?? []).map((application) => [application.id, application])),
    [applicationsQuery.data],
  );

  const pageSizeValue = Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredApplications.length / pageSizeValue));

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, sort, statusFilter, pageSize]);

  useEffect(() => {
    if (page >= totalPages) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [page, totalPages]);

  useEffect(() => {
    const existingIds = new Set((applicationsQuery.data ?? []).map((application) => application.id));
    setSelectedApplicationIds((current) => current.filter((id) => existingIds.has(id)));
  }, [applicationsQuery.data]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        setEditingApplication(null);
        setForm(emptyFormState(defaultResumeId));
        setDialogOpen(true);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [defaultResumeId]);

  const pageItems = useMemo(() => {
    const start = page * pageSizeValue;
    return filteredApplications.slice(start, start + pageSizeValue);
  }, [filteredApplications, page, pageSizeValue]);

  const selectedApplicationSet = useMemo(() => new Set(selectedApplicationIds), [selectedApplicationIds]);
  const selectedOnPage = useMemo(
    () => pageItems.map((application) => application.id).filter((id) => selectedApplicationSet.has(id)),
    [pageItems, selectedApplicationSet],
  );
  const allOnPageSelected = pageItems.length > 0 && selectedOnPage.length === pageItems.length;

  const toggleSelection = (id: string, checked: boolean) => {
    setSelectedApplicationIds((current) => {
      if (checked) {
        if (current.includes(id)) return current;
        return [...current, id];
      }
      return current.filter((value) => value !== id);
    });
  };

  const toggleSelectAllOnPage = (checked: boolean) => {
    const pageIds = pageItems.map((application) => application.id);
    setSelectedApplicationIds((current) => {
      if (checked) {
        const merged = new Set([...current, ...pageIds]);
        return Array.from(merged);
      }
      const pageIdSet = new Set(pageIds);
      return current.filter((id) => !pageIdSet.has(id));
    });
  };

  const metrics = useMemo(() => computeApplicationMetrics(applicationsQuery.data ?? []), [applicationsQuery.data]);
  const editingStatusTimeline = useMemo(
    () => parseStatusHistory(editingApplication?.status_history),
    [editingApplication?.status_history],
  );

  const uploadResumeMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Sign in required");
      return uploadResumeVersion({
        supabase,
        userId: user.id,
        file,
        label: deriveResumeLabel(file.name),
        isDefault: (resumeVersionsQuery.data?.length ?? 0) === 0,
        extractText: false,
      });
    },
    onSuccess: (resumeVersion) => {
      void qc.invalidateQueries({ queryKey: ["resume-versions", user?.id] });
      void qc.invalidateQueries({ queryKey: ["default-resume-for-ats", user?.id] });
      setForm((current) => ({ ...current, resume_version_id: resumeVersion.id }));
      toast({
        title: "Resume uploaded",
        description: resumeVersion.text_extracted_at
          ? "Attached and ready for ATS scans."
          : "Uploaded successfully. Text extraction was limited for this PDF.",
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not upload resume", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const persistAtsMutation = useMutation({
    mutationFn: async (payload: {
      applicationId: string;
      result: AtsScanResult;
      source: "job_tags" | "job_description";
    }) => {
      const { error } = await supabase
        .from("applications")
        .update(buildAtsPersistencePayload(payload.result, payload.source))
        .eq("id", payload.applicationId);
      if (error) throw toDisplayError(error, "Could not save ATS results on this application.");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["applications", user?.id] });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not save ATS result", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (payload: ApplicationInsert & { id?: string }) => {
      const { id, ...values } = payload;
      if (id) {
        const { error } = await supabase.from("applications").update(values).eq("id", id);
        if (error) throw toDisplayError(error, "Could not update this application.");
        return;
      }

      const { error } = await supabase.from("applications").insert(values);
      if (error) throw toDisplayError(error, "Could not create this application.");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["applications", user?.id] });
      toast({ title: editingApplication ? "Application updated" : "Application created" });
      setDialogOpen(false);
      setEditingApplication(null);
      setForm(emptyFormState(defaultResumeId));
    },
    onError: (error: unknown) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      statusHistory,
    }: {
      id: string;
      status: ApplicationStatus;
      statusHistory: Json | null | undefined;
    }) => {
      const payload = {
        status,
        status_history: appendStatusHistory(statusHistory, status),
      };
      const { error } = await supabase.from("applications").update(payload).eq("id", id);
      if (error) throw toDisplayError(error, "Could not update the application status.");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["applications", user?.id] });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not update status", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("applications").delete().eq("id", id);
      if (error) throw toDisplayError(error, "Could not delete this application.");
    },
    onSuccess: (_data, deletedId) => {
      void qc.invalidateQueries({ queryKey: ["applications", user?.id] });
      toast({ title: "Application deleted" });
      setSelectedApplicationIds((current) => current.filter((id) => id !== deletedId));
    },
    onError: (error: unknown) => {
      toast({ title: "Could not delete application", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: ApplicationStatus }) => {
      const updates = ids
        .map((id) => {
          const application = applicationsById.get(id);
          if (!application) return null;
          return supabase
            .from("applications")
            .update({
              status,
              status_history: appendStatusHistory(application.status_history, status),
            })
            .eq("id", id);
        })
        .filter(Boolean);

      const results = await Promise.all(updates);
      const failed = results.find((result) => result?.error);
      if (failed?.error) throw toDisplayError(failed.error, "Could not update selected applications.");
    },
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ["applications", user?.id] });
      toast({ title: `Updated ${variables.ids.length} applications` });
      setSelectedApplicationIds([]);
    },
    onError: (error: unknown) => {
      toast({ title: "Could not update selected applications", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("applications").delete().in("id", ids);
      if (error) throw toDisplayError(error, "Could not delete selected applications.");
    },
    onSuccess: (_data, ids) => {
      void qc.invalidateQueries({ queryKey: ["applications", user?.id] });
      toast({ title: `Deleted ${ids.length} applications` });
      setSelectedApplicationIds([]);
    },
    onError: (error: unknown) => {
      toast({ title: "Could not delete selected applications", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const importSavedAppliedMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in required");
      const { data, error } = await supabase
        .from("tracked_jobs")
        .select("job_id, status, notes, created_at, updated_at, jobs!inner(id, headline, employer_name, source_url)")
        .eq("user_id", user.id)
        .eq("status", "applied");
      if (error) throw toDisplayError(error, "Could not load applied jobs from Shortlist.");

      const trackedRows = (data ?? []) as TrackedAppliedRow[];
      if (trackedRows.length === 0) {
        return { upserted: 0 };
      }

      const rows = trackedRows
        .map((tracked) => {
          if (!tracked.jobs) return null;
          const appliedAt = tracked.updated_at ?? tracked.created_at ?? new Date().toISOString();
          const base = buildSweJobsApplication({
            userId: user.id,
            jobId: tracked.jobs.id,
            company: tracked.jobs.employer_name ?? "Unknown company",
            jobTitle: tracked.jobs.headline,
            jobUrl: tracked.jobs.source_url,
          });

          return {
            ...base,
            status: "applied",
            applied_at: appliedAt,
            notes: tracked.notes ?? "",
            request_id: sweJobsApplicationRequestId(user.id, tracked.jobs.id),
            status_history: createStatusHistory("applied", appliedAt),
          } satisfies ApplicationInsert;
        })
        .filter((row): row is ApplicationInsert => Boolean(row));

      if (rows.length === 0) {
        return { upserted: 0 };
      }

      const { error: upsertError } = await supabase
        .from("applications")
        .upsert(rows, { onConflict: "user_id,request_id" });
      if (upsertError) throw toDisplayError(upsertError, "Could not import applications from Shortlist.");

      return { upserted: rows.length };
    },
    onSuccess: ({ upserted }) => {
      void qc.invalidateQueries({ queryKey: ["applications", user?.id] });
      toast({
        title: upserted > 0 ? `Imported ${upserted} application${upserted === 1 ? "" : "s"} from Shortlist` : "No applied Shortlist jobs to import",
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not import from Shortlist", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  if (!loading && !user) return <Navigate to="/auth" replace />;

  const openCreateDialog = () => {
    setEditingApplication(null);
    setForm(emptyFormState(defaultResumeId));
    setUrlMatchNotice(null);
    setDialogOpen(true);
  };

  const openEditDialog = (application: ApplicationRow) => {
    setEditingApplication(application);
    setForm(buildFormState(application, resumeVersionsQuery.data ?? []));
    setUrlMatchNotice(null);
    setDialogOpen(true);
  };

  const openAtsDialog = (application: ApplicationRow) => {
    const preferredResumeId =
      (resumeVersionsQuery.data ?? []).find(
        (resumeVersion) =>
          resumeVersion.id === application.resume_version_id && Boolean(resumeVersion.storage_path),
      )?.id ??
      (resumeVersionsQuery.data ?? []).find(
        (resumeVersion) =>
          resumeVersion.label === application.resume_label && Boolean(resumeVersion.storage_path),
      )?.id ??
      defaultResumeId ??
      RESUME_NONE;

    setAtsApplication(application);
    setAtsResumeId(preferredResumeId || RESUME_NONE);
    setManualJobDescription("");
    setAtsResult(null);
    setAtsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!user) return;
    if (!form.company.trim() || !form.job_title.trim()) {
      toast({ title: "Company and title are required", variant: "destructive" });
      return;
    }

    const resumeSnapshot = buildResumeSnapshot(resumeVersionsQuery.data ?? [], editingApplication, form.resume_version_id);
    const appliedAtIso = toAppliedAtIso(form.applied_at);
    const atsSnapshot = preflightAts
      ? buildAtsPersistencePayload(preflightAts.result, preflightAts.source)
      : {
          ats_score: editingApplication?.ats_score ?? null,
          ats_keywords_json: editingApplication?.ats_keywords_json ?? {},
        };
    const statusHistorySnapshot = editingApplication
      ? appendStatusHistory(editingApplication.status_history, form.status)
      : createStatusHistory(form.status, appliedAtIso);

    upsertMutation.mutate({
      id: editingApplication?.id,
      user_id: user.id,
      company: form.company.trim(),
      job_title: form.job_title.trim(),
      status: form.status,
      job_url: form.job_url.trim(),
      applied_at: appliedAtIso,
      resume_version_id: resumeSnapshot.resume_version_id,
      resume_label: resumeSnapshot.resume_label,
      notes: form.notes.trim(),
      source: editingApplication?.source ?? "manual",
      request_id: editingApplication?.request_id ?? null,
      job_id: form.job_id,
      status_history: statusHistorySnapshot,
      ...atsSnapshot,
    });
  };

  const exportApplications = () => {
    const rows = (applicationsQuery.data ?? []).map((application) => [
      application.company,
      application.job_title,
      STATUS_LABELS[application.status as ApplicationStatus] ?? application.status,
      application.job_url,
      application.applied_at,
      application.resume_label ?? "",
      application.source,
      application.ats_score ?? "",
      application.notes ?? "",
    ]);

    downloadCSV(
      "my_applications.csv",
      ["Company", "JobTitle", "Status", "JobURL", "AppliedAt", "ResumeUsed", "Source", "ATSScore", "Notes"],
      rows,
    );
    toast({ title: `Exported ${rows.length} applications` });
  };

  const handleResumeUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (resumeLimitReached) {
      toast({
        title: "Resume limit reached",
        description: `You can store up to ${MAX_RESUMES_PER_USER} resumes. Delete an older resume to upload a new PDF.`,
        variant: "destructive",
      });
      return;
    }
    await uploadResumeMutation.mutateAsync(file);
  };

  const runCurrentAtsScan = () => {
    if (!atsApplication) return;

    const resumeVersion = (resumeVersionsQuery.data ?? []).find((item) => item.id === atsResumeId);
    if (!resumeVersion) {
      toast({ title: "Choose a resume PDF first", variant: "destructive" });
      return;
    }

    if (!resumeVersion.parsed_text) {
      toast({
        title: "This resume is not ATS-ready yet",
        description: "The PDF uploaded successfully, but text extraction was limited. Try a text-based PDF instead.",
        variant: "destructive",
      });
      return;
    }

    const linkedJob = atsApplication.job_id ? jobsById[atsApplication.job_id] : null;
    const linkedJobTags = atsApplication.job_id ? tagsByJobId[atsApplication.job_id] ?? [] : [];
    const source: "job_tags" | "job_description" =
      linkedJobTags.length > 0 ? "job_tags" : "job_description";
    const targetKeywords =
      linkedJobTags.length > 0
        ? linkedJobTags
        : linkedJob
          ? extractKeywordsFromJobText([linkedJob.headline, linkedJob.description ?? ""].join(" "))
          : extractKeywordsFromJobText(manualJobDescription);

    if (targetKeywords.length === 0) {
      toast({
        title: "No job keywords found",
        description: atsApplication.job_id
          ? "This SweJobs role does not have enough tag data yet."
          : "Paste a job description before running the scan.",
        variant: "destructive",
      });
      return;
    }

    const result = runAtsScan({
      resumeText: resumeVersion.parsed_text,
      targetKeywords,
      trackedSkills: userSkillsQuery.data ?? [],
    });
    setAtsResult(result);
    void persistAtsMutation.mutateAsync({
      applicationId: atsApplication.id,
      result,
      source,
    });
  };

  const handleJobUrlPaste = async (event: ClipboardEvent<HTMLInputElement>) => {
    const pastedUrl = event.clipboardData.getData("text").trim();
    if (!pastedUrl) return;

    const canonical = canonicalizeJobUrl(pastedUrl);
    const normalizedUrl = canonical ?? pastedUrl;

    setForm((current) => ({ ...current, job_url: normalizedUrl }));
    setUrlMatchNotice(null);

    const exactLookupCandidates = buildUrlLookupCandidates(pastedUrl);

    const { data, error } = await supabase
      .from("jobs")
      .select("id, headline, employer_name, source_url")
      .in("source_url", exactLookupCandidates)
      .limit(5);

    const exactMatch = !error && data && data.length > 0 ? (data[0] as UrlMatchJob) : null;
    if (exactMatch) {
      setForm((current) => ({
        ...current,
        company: exactMatch.employer_name ?? current.company,
        job_title: exactMatch.headline,
        job_id: exactMatch.id,
      }));
      setUrlMatchNotice("Matched to SweJobs role.");
      return;
    }

    const hostPatterns = hostLookupIlikePatterns(pastedUrl);
    if (hostPatterns.length > 0) {
      const hostLookup = await supabase
        .from("jobs")
        .select("id, headline, employer_name, source_url")
        .or(`source_url.ilike.${hostPatterns[0]},source_url.ilike.${hostPatterns[1]}`)
        .order("published_at", { ascending: false })
        .limit(40);

      if (!hostLookup.error && hostLookup.data && hostLookup.data.length > 0) {
        const similarMatch = selectBestSimilarUrlMatch(
          pastedUrl,
          hostLookup.data as UrlMatchJob[],
        );
        if (similarMatch) {
          setForm((current) => ({
            ...current,
            company: similarMatch.employer_name ?? current.company,
            job_title: similarMatch.headline,
            job_id: similarMatch.id,
          }));
          setUrlMatchNotice("Matched to similar SweJobs role URL.");
          return;
        }
      }
    }

    const fallbackCompany = companyFromCareerPageDomain(pastedUrl);
    if (fallbackCompany) {
      setForm((current) => ({
        ...current,
        company: current.company.trim() ? current.company : fallbackCompany,
      }));
      setUrlMatchNotice(`Company matched from domain: ${fallbackCompany}.`);
    }

    const fetchedTitle = await fetchExternalJobTitle(pastedUrl);
    if (fetchedTitle) {
      setForm((current) => ({
        ...current,
        job_title: current.job_title.trim() ? current.job_title : fetchedTitle,
      }));
      setUrlMatchNotice((current) =>
        current ? `${current} Title fetched from job page.` : "Title fetched from job page.",
      );
    }
  };

  const isLoadingPage = loading || applicationsQuery.isLoading;
  const responseGoal = 10;
  const responseGap = Math.max(0, responseGoal - metrics.responseRate);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Applications</h1>
              <p className="text-sm text-muted-foreground">
                Your actual application tracker across SweJobs and manual entries.
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-3 text-sm text-muted-foreground">
              Mark SweJobs roles as applied to bring them here, or add applications manually.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={exportApplications} disabled={!applicationsQuery.data?.length}>
              <FileDown className="h-4 w-4" /> Export CSV
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => importSavedAppliedMutation.mutate()}
              disabled={importSavedAppliedMutation.isPending || !user}
            >
              <ArrowRightLeft className="h-4 w-4" />
              Import from Shortlist
            </Button>
            <Button className="gap-2" onClick={openCreateDialog}>
              <Plus className="h-4 w-4" /> New Application
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Card className="border-border/40 border-t-2 border-t-stone-500/40 bg-card/60">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Applications</p>
              <p className="mt-2 text-2xl font-semibold">{metrics.total}</p>
            </CardContent>
          </Card>
          <Card className="border-border/40 border-t-2 border-t-amber-500/40 bg-card/60">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Online Assessments</p>
              <p className="mt-2 text-2xl font-semibold">{metrics.oa}</p>
            </CardContent>
          </Card>
          <Card className="border-border/40 border-t-2 border-t-blue-500/40 bg-card/60">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Interviews</p>
              <p className="mt-2 text-2xl font-semibold">{metrics.interviewing}</p>
            </CardContent>
          </Card>
          <Card className="border-border/40 border-t-2 border-t-emerald-500/40 bg-card/60">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Response Rate</p>
              <p className="mt-2 text-2xl font-semibold">{metrics.responseRate}%</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Goal {responseGoal}% {responseGap > 0 ? `· ${responseGap}% to go` : "· on target"}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/40 bg-card/60">
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-[180px,minmax(0,1fr),220px,140px]">
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as FilterStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {APPLICATION_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search company, title, URL, resume..."
              />

              <Select value={sort} onValueChange={(value) => setSort(value as ApplicationSort)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={pageSize} onValueChange={(value) => setPageSize(value as (typeof PAGE_SIZE_OPTIONS)[number])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedApplicationIds.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/35 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {selectedApplicationIds.length} selected
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkStatusMutation.isPending}
                    onClick={() => bulkStatusMutation.mutate({ ids: selectedApplicationIds, status: "rejected" })}
                  >
                    Mark rejected
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={bulkDeleteMutation.isPending}
                    onClick={() => {
                      if (!window.confirm(`Delete ${selectedApplicationIds.length} selected applications?`)) return;
                      bulkDeleteMutation.mutate(selectedApplicationIds);
                    }}
                  >
                    Delete selected
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedApplicationIds([])}>
                    Clear
                  </Button>
                </div>
              </div>
            ) : null}

            {isLoadingPage ? (
              <div className="rounded-lg border border-border/50 bg-background/40 p-8 text-sm text-muted-foreground">
                Loading applications…
              </div>
            ) : applicationsQuery.isError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                Could not load applications. {getErrorMessage(applicationsQuery.error)}
              </div>
            ) : filteredApplications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 bg-background/30 p-10 text-center">
                <ClipboardList className="h-10 w-10 text-muted-foreground/40" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">No applications yet</p>
                  <p className="text-sm text-muted-foreground">
                    Mark SweJobs roles as applied to bring them here automatically, or add your outside applications manually.
                  </p>
                </div>
                <Button className="gap-2" onClick={openCreateDialog}>
                  <Plus className="h-4 w-4" /> Add your first application
                </Button>
              </div>
            ) : (
              <>
                <div className="w-full overflow-x-auto">
                  <Table className="w-full table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[42px]">
                          <Checkbox
                            checked={allOnPageSelected}
                            onCheckedChange={(checked) => toggleSelectAllOnPage(Boolean(checked))}
                            aria-label="Select all applications on this page"
                          />
                        </TableHead>
                        <TableHead className="w-[110px]">Applied</TableHead>
                        <TableHead className="w-[72px]">Age</TableHead>
                        <TableHead className="w-[154px]">Company</TableHead>
                        <TableHead className="w-[190px]">Title</TableHead>
                        <TableHead className="w-[148px]">Status</TableHead>
                        <TableHead className="w-[76px]">ATS</TableHead>
                        <TableHead className="w-[130px]">Resume</TableHead>
                        <TableHead className="w-[170px]">Job URL</TableHead>
                        <TableHead className="w-[90px]">Source</TableHead>
                        <TableHead className="w-[126px] text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageItems.map((application) => {
                        const faviconUrl = application.job_url ? companyFaviconUrl(application.job_url) : null;
                        return (
                        <TableRow
                          key={application.id}
                          className={cn(applicationRowTint(application.status as ApplicationStatus), "transition-colors hover:bg-muted/30")}
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedApplicationSet.has(application.id)}
                              onCheckedChange={(checked) => toggleSelection(application.id, Boolean(checked))}
                              aria-label={`Select application ${application.company} ${application.job_title}`}
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatApplicationDate(application.applied_at)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDaysSinceApplied(application.applied_at)}
                          </TableCell>
                          <TableCell className="max-w-[154px]">
                            <div className="flex items-center gap-2">
                              {faviconUrl ? (
                                <img
                                  src={faviconUrl}
                                  alt=""
                                  className="h-4 w-4 shrink-0 rounded-sm"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                              ) : null}
                              <span className="truncate font-medium" title={application.company}>
                                {application.company}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="truncate font-medium" title={application.job_title}>{application.job_title}</p>
                              {application.notes ? (
                                <p className="line-clamp-2 text-xs text-muted-foreground" title={application.notes}>{application.notes}</p>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={application.status}
                              onValueChange={(value) =>
                                statusMutation.mutate({
                                  id: application.id,
                                  status: value as ApplicationStatus,
                                  statusHistory: application.status_history,
                                })
                              }
                            >
                              <SelectTrigger
                                className={cn(
                                  "w-[124px] border-0 shadow-none",
                                  STATUS_COLORS[application.status as ApplicationStatus],
                                )}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {APPLICATION_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {STATUS_LABELS[status]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            {application.ats_score != null ? (
                              <Badge
                                variant="outline"
                                className={cn(
                                  application.ats_score >= 70
                                    ? "border-emerald-500/30 text-emerald-300"
                                    : application.ats_score >= 40
                                      ? "border-amber-500/30 text-amber-300"
                                      : "border-rose-500/30 text-rose-300",
                                )}
                              >
                                {application.ats_score}%
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[130px] truncate text-sm text-muted-foreground" title={application.resume_label || "No resume attached"}>
                            {application.resume_label || "No resume attached"}
                          </TableCell>
                          <TableCell>
                            {application.job_url ? (
                              <a
                                href={application.job_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex max-w-[156px] items-center gap-1 truncate text-sm text-primary hover:underline"
                                title={application.job_url}
                              >
                                <span className="truncate">{application.job_url}</span>
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">No link</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize">
                              {application.source}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                title="Edit application"
                                aria-label="Edit application"
                                onClick={() => openEditDialog(application)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                title="Run ATS scan"
                                aria-label="Run ATS scan"
                                onClick={() => openAtsDialog(application)}
                              >
                                <FileSearch className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                title="Delete application"
                                aria-label="Delete application"
                                onClick={() => deleteMutation.mutate(application.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-col gap-3 border-t border-border/50 pt-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                  <p>
                    Showing {Math.min(filteredApplications.length, page * pageSizeValue + 1)}-
                    {Math.min(filteredApplications.length, (page + 1) * pageSizeValue)} of {filteredApplications.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>
                      Previous
                    </Button>
                    <span>
                      Page {page + 1} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {!loading && user ? (
          <p className="text-xs text-muted-foreground">
            Discovery tracking still lives in{" "}
            <Link to="/tracked" className="text-primary underline">
              Shortlist
            </Link>
            . Manage uploaded PDFs in{" "}
            <Link to="/resumes" className="text-primary underline">
              Resume Library
            </Link>
            .
          </p>
        ) : null}
      </div>

      <input
        ref={resumeUploadInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handleResumeUpload}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingApplication ? "Edit application" : "New application"}</DialogTitle>
            <DialogDescription>
              Log where you applied. Paste a URL and we'll fill in what we can.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[calc(90vh-11rem)] gap-4 overflow-y-auto pr-1">
            <div className="grid gap-2">
              <Label htmlFor="application-url">Job URL</Label>
              <Input
                id="application-url"
                value={form.job_url}
                autoFocus={!editingApplication}
                onChange={(event) => {
                  setUrlMatchNotice(null);
                  setForm((current) => ({ ...current, job_url: event.target.value, job_id: null }));
                }}
                onPaste={(event) => {
                  void handleJobUrlPaste(event);
                }}
                placeholder="Paste the job posting URL"
              />
              <p className="text-xs text-muted-foreground">
                We'll try to fill in the company and title for you.
              </p>
              {urlMatchNotice ? (
                <p className="text-xs text-emerald-300">{urlMatchNotice}</p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="application-company">Company</Label>
              <Input
                id="application-company"
                value={form.company}
                onChange={(event) =>
                  setForm((current) => ({ ...current, company: event.target.value, job_id: null }))
                }
                placeholder="Company name"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="application-title">Job title</Label>
              <Input
                id="application-title"
                value={form.job_title}
                onChange={(event) => setForm((current) => ({ ...current, job_title: event.target.value }))}
                placeholder="Software Engineer"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="application-status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) => setForm((current) => ({ ...current, status: value as ApplicationStatus }))}
                >
                  <SelectTrigger id="application-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPLICATION_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="application-date">Applied date</Label>
                <Input
                  id="application-date"
                  type="date"
                  value={form.applied_at}
                  onChange={(event) => setForm((current) => ({ ...current, applied_at: event.target.value }))}
                />
              </div>
            </div>

            {editingApplication ? (
              <div className="rounded-md border border-border/50 bg-background/30 px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Status timeline</p>
                <div className="mt-2 space-y-1">
                  {editingStatusTimeline.length > 0 ? (
                    editingStatusTimeline.map((entry) => (
                      <p key={`${entry.status}-${entry.at}`} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{STATUS_LABELS[entry.status]}</span>
                        {" · "}
                        {formatStatusHistoryTimestamp(entry.at)}
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">No status timeline yet.</p>
                  )}
                </div>
              </div>
            ) : null}

            {!form.job_id ? (
              <div className="grid gap-2">
                <Label htmlFor="application-ats-target">Job description (optional for ATS preflight)</Label>
                <Textarea
                  id="application-ats-target"
                  value={form.ats_job_description}
                  onChange={(event) => setForm((current) => ({ ...current, ats_job_description: event.target.value }))}
                  placeholder="Paste key requirements if this role is not in SweJobs yet."
                  rows={4}
                />
              </div>
            ) : null}

            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="application-resume-choice">Resume used</Label>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={uploadResumeMutation.isPending || resumeLimitReached}
                  onClick={() => resumeUploadInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" /> Upload PDF
                </Button>
              </div>

              <Select
                value={form.resume_version_id}
                onValueChange={(value) => setForm((current) => ({ ...current, resume_version_id: value }))}
              >
                <SelectTrigger id="application-resume-choice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={RESUME_NONE}>No resume selected</SelectItem>
                  {availableResumes.map((resumeVersion) => (
                    <SelectItem key={resumeVersion.id} value={resumeVersion.id}>
                      {resumeVersion.label}
                      {resumeVersion.is_default ? " (Default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <p className="text-xs text-muted-foreground">
                Or upload a new PDF right here. You can also manage resumes in{" "}
                <Link to="/resumes" className="text-primary underline">
                  Resume Library
                </Link>
                .
              </p>

              {resumeLimitReached ? (
                <p className="text-xs text-amber-300">
                  Resume limit reached ({MAX_RESUMES_PER_USER}). Delete an older resume to upload a new one.
                </p>
              ) : null}

              {editingApplication?.resume_label && !editingApplication.resume_version_id ? (
                <p className="text-xs text-muted-foreground">
                  This row still has a legacy label saved: <span className="font-medium text-foreground">{editingApplication.resume_label}</span>.
                  Select a PDF resume to replace it.
                </p>
              ) : null}

              {preflightAts ? (
                <div className="rounded-md border border-border/50 bg-background/30 px-3 py-2 text-xs">
                  <p className="font-medium text-foreground">ATS preflight: {preflightAts.result.score}% match</p>
                  <p className="mt-1 text-muted-foreground">
                    Matched {preflightAts.result.matchedKeywords.length}, missing {preflightAts.result.missingKeywords.length}.
                  </p>
                  {preflightAts.result.missingKeywords.length > 0 ? (
                    <p className="mt-1 line-clamp-2 text-muted-foreground">
                      Missing: {preflightAts.result.missingKeywords.slice(0, 6).join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="application-notes">Notes</Label>
              <Textarea
                id="application-notes"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Outcome, recruiter name, next steps, anything you want to remember."
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={upsertMutation.isPending}>
              {editingApplication ? "Save changes" : "Create application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={atsDialogOpen} onOpenChange={setAtsDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>ATS Scan</DialogTitle>
            <DialogDescription>
              Run a quick keyword match between one uploaded resume and this application target.
            </DialogDescription>
          </DialogHeader>

          {atsApplication ? (
            <div className="grid max-h-[calc(90vh-11rem)] gap-4 overflow-y-auto pr-1">
              <div className="rounded-lg border border-border/50 bg-background/30 px-4 py-3">
                <p className="font-medium">
                  {atsApplication.company} · {atsApplication.job_title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {atsApplication.job_id
                    ? "Using SweJobs tags and job content already in the database."
                    : "Paste the job description below so the scan has target keywords."}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="ats-resume">Resume PDF</Label>
                <Select value={atsResumeId} onValueChange={setAtsResumeId}>
                  <SelectTrigger id="ats-resume">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={RESUME_NONE}>Choose a resume</SelectItem>
                    {availableResumes.map((resumeVersion) => (
                      <SelectItem key={resumeVersion.id} value={resumeVersion.id}>
                        {resumeVersion.label}
                        {resumeVersion.is_default ? " (Default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {!atsApplication.job_id ? (
                <div className="grid gap-2">
                  <Label htmlFor="ats-job-description">Job description</Label>
                  <Textarea
                    id="ats-job-description"
                    rows={8}
                    value={manualJobDescription}
                    onChange={(event) => setManualJobDescription(event.target.value)}
                    placeholder="Paste the job description here for manual applications."
                  />
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  This is a deterministic keyword scan. It does not rewrite your resume or use AI feedback.
                </p>
                <Button className="gap-2" onClick={runCurrentAtsScan}>
                  <FileSearch className="h-4 w-4" /> Run scan
                </Button>
              </div>

              {atsResult ? (
                <div className="space-y-4 rounded-lg border border-border/50 bg-background/30 p-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Card className="border-border/40 bg-card/60">
                      <CardContent className="p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Match score</p>
                        <p className="mt-2 text-2xl font-semibold">{atsResult.score}%</p>
                      </CardContent>
                    </Card>
                    <Card className="border-border/40 bg-card/60">
                      <CardContent className="p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Matched</p>
                        <p className="mt-2 text-2xl font-semibold">{atsResult.matchedKeywords.length}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-border/40 bg-card/60">
                      <CardContent className="p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Missing</p>
                        <p className="mt-2 text-2xl font-semibold">{atsResult.missingKeywords.length}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Matched keywords</p>
                      <div className="flex flex-wrap gap-2">
                        {atsResult.matchedKeywords.length > 0 ? (
                          atsResult.matchedKeywords.map((keyword) => (
                            <Badge key={keyword} variant="secondary">
                              {keyword}
                            </Badge>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">No matched keywords yet.</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium">Missing keywords</p>
                      <div className="flex flex-wrap gap-2">
                        {atsResult.missingKeywords.length > 0 ? (
                          atsResult.missingKeywords.map((keyword) => (
                            <Badge key={keyword} variant="outline">
                              {keyword}
                            </Badge>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">No major gaps from the target keywords.</p>
                        )}
                      </div>
                    </div>

                    {atsResult.recommendations.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Recommendations</p>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          {atsResult.recommendations.map((recommendation) => (
                            <li key={recommendation}>{recommendation}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAtsDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
