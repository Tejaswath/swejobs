import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
import type { Tables } from "@/integrations/supabase/types";
import {
  type AtsScanResult,
  extractKeywordsFromJobText,
  runAtsScan,
} from "@/lib/ats";
import {
  APPLICATION_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  type ApplicationInsert,
  type ApplicationRow,
  type ApplicationSort,
  type ApplicationStatus,
  computeApplicationMetrics,
  formatApplicationDate,
  formatApplicationDateInput,
} from "@/lib/applications";
import { getErrorMessage, toDisplayError } from "@/lib/errors";
import { downloadCSV } from "@/lib/export";
import {
  deriveResumeLabel,
  uploadResumeVersion,
} from "@/lib/resumes";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = ["25", "50", "100"] as const;
const RESUME_NONE = "__none";

type FilterStatus = "all" | ApplicationStatus;
type ResumeVersion = Tables<"resume_versions">;
type JobTag = { job_id: number; tag: string };
type JobSummary = { id: number; headline: string; description: string | null };

type ApplicationFormState = {
  company: string;
  job_title: string;
  status: ApplicationStatus;
  job_url: string;
  applied_at: string;
  resume_version_id: string;
  notes: string;
};

const SORT_OPTIONS: Array<{ value: ApplicationSort; label: string }> = [
  { value: "applied_desc", label: "Applied date (newest)" },
  { value: "applied_asc", label: "Applied date (oldest)" },
  { value: "company_asc", label: "Company (A-Z)" },
  { value: "company_desc", label: "Company (Z-A)" },
  { value: "status", label: "Status" },
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
    resume_version_id: defaultResumeId || RESUME_NONE,
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
    resume_version_id: matchingResumeVersion?.storage_path ? matchingResumeVersion.id : RESUME_NONE,
    notes: application.notes ?? "",
  };
}

function compareApplications(a: ApplicationRow, b: ApplicationRow, sort: ApplicationSort) {
  if (sort === "applied_asc") return a.applied_at.localeCompare(b.applied_at);
  if (sort === "company_asc") return a.company.localeCompare(b.company, "sv");
  if (sort === "company_desc") return b.company.localeCompare(a.company, "sv");
  if (sort === "status") {
    const statusCompare = a.status.localeCompare(b.status, "sv");
    if (statusCompare !== 0) return statusCompare;
  }
  return b.applied_at.localeCompare(a.applied_at);
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

export default function Applications() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const resumeUploadInputRef = useRef<HTMLInputElement | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingApplication, setEditingApplication] = useState<ApplicationRow | null>(null);
  const [form, setForm] = useState<ApplicationFormState>(emptyFormState());
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ApplicationSort>("applied_desc");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>("25");
  const [page, setPage] = useState(0);

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
        .select("*")
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
        .select("*")
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

  const availableResumes = (resumeVersionsQuery.data ?? []).filter((resumeVersion) => Boolean(resumeVersion.storage_path));
  const defaultResume = useMemo(
    () => availableResumes.find((resumeVersion) => resumeVersion.is_default) ?? availableResumes[0] ?? null,
    [availableResumes],
  );
  const defaultResumeId = defaultResume?.id ?? "";

  const filteredApplications = useMemo(() => {
    return (applicationsQuery.data ?? [])
      .filter((application) => (statusFilter === "all" ? true : application.status === statusFilter))
      .filter((application) => matchesSearch(application, debouncedSearch))
      .sort((a, b) => compareApplications(a, b, sort));
  }, [applicationsQuery.data, debouncedSearch, sort, statusFilter]);

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

  const metrics = useMemo(() => computeApplicationMetrics(applicationsQuery.data ?? []), [applicationsQuery.data]);

  const uploadResumeMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Sign in required");
      return uploadResumeVersion({
        supabase,
        userId: user.id,
        file,
        label: deriveResumeLabel(file.name),
        isDefault: (resumeVersionsQuery.data?.length ?? 0) === 0,
      });
    },
    onSuccess: (resumeVersion) => {
      void qc.invalidateQueries({ queryKey: ["resume-versions", user?.id] });
      setForm((current) => ({ ...current, resume_version_id: resumeVersion.id }));
      toast({
        title: "Resume uploaded",
        description: resumeVersion.parsed_text
          ? "Attached and ready for ATS scans."
          : "Uploaded successfully. Text extraction was limited for this PDF.",
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not upload resume", description: getErrorMessage(error), variant: "destructive" });
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
    mutationFn: async ({ id, status }: { id: string; status: ApplicationStatus }) => {
      const { error } = await supabase.from("applications").update({ status }).eq("id", id);
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["applications", user?.id] });
      toast({ title: "Application deleted" });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not delete application", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  if (!loading && !user) return <Navigate to="/auth" replace />;

  const openCreateDialog = () => {
    setEditingApplication(null);
    setForm(emptyFormState(defaultResumeId));
    setDialogOpen(true);
  };

  const openEditDialog = (application: ApplicationRow) => {
    setEditingApplication(application);
    setForm(buildFormState(application, resumeVersionsQuery.data ?? []));
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

    upsertMutation.mutate({
      id: editingApplication?.id,
      user_id: user.id,
      company: form.company.trim(),
      job_title: form.job_title.trim(),
      status: form.status,
      job_url: form.job_url.trim(),
      applied_at: toAppliedAtIso(form.applied_at),
      resume_version_id: resumeSnapshot.resume_version_id,
      resume_label: resumeSnapshot.resume_label,
      notes: form.notes.trim(),
      source: editingApplication?.source ?? "manual",
      request_id: editingApplication?.request_id ?? null,
      job_id: editingApplication?.job_id ?? null,
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
      application.notes ?? "",
    ]);

    downloadCSV(
      "my_applications.csv",
      ["Company", "JobTitle", "Status", "JobURL", "AppliedAt", "ResumeUsed", "Source", "Notes"],
      rows,
    );
    toast({ title: `Exported ${rows.length} applications` });
  };

  const handleResumeUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
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

    setAtsResult(
      runAtsScan({
        resumeText: resumeVersion.parsed_text,
        targetKeywords,
        trackedSkills: userSkillsQuery.data ?? [],
      }),
    );
  };

  const isLoadingPage = loading || applicationsQuery.isLoading;

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
              Applied through SweJobs? It appears here automatically when you mark a role as{" "}
              <span className="font-medium text-foreground">applied</span>. Applied elsewhere? Add it manually and
              keep the same pipeline in one place.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={exportApplications} disabled={!applicationsQuery.data?.length}>
              <FileDown className="h-4 w-4" /> Export CSV
            </Button>
            <Button className="gap-2" onClick={openCreateDialog}>
              <Plus className="h-4 w-4" /> New Application
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Card className="border-border/40 bg-card/60">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Applications</p>
              <p className="mt-2 text-2xl font-semibold">{metrics.total}</p>
            </CardContent>
          </Card>
          <Card className="border-border/40 bg-card/60">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">OAs</p>
              <p className="mt-2 text-2xl font-semibold">{metrics.oa}</p>
            </CardContent>
          </Card>
          <Card className="border-border/40 bg-card/60">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Interviews</p>
              <p className="mt-2 text-2xl font-semibold">{metrics.interviewing}</p>
            </CardContent>
          </Card>
          <Card className="border-border/40 bg-card/60">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Response Rate</p>
              <p className="mt-2 text-2xl font-semibold">{metrics.responseRate}%</p>
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Applied</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Resume</TableHead>
                      <TableHead>Job URL</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((application) => (
                      <TableRow key={application.id}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatApplicationDate(application.applied_at)}
                        </TableCell>
                        <TableCell className="font-medium">{application.company}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium">{application.job_title}</p>
                            {application.notes ? (
                              <p className="line-clamp-2 text-xs text-muted-foreground">{application.notes}</p>
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
                              })
                            }
                          >
                            <SelectTrigger
                              className={cn(
                                "w-[150px] border-0 shadow-none",
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
                        <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
                          {application.resume_label || "No resume attached"}
                        </TableCell>
                        <TableCell>
                          {application.job_url ? (
                            <a
                              href={application.job_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-[180px] items-center gap-1 truncate text-sm text-primary hover:underline"
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
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" className="gap-1" onClick={() => openEditDialog(application)}>
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </Button>
                            <Button variant="outline" size="sm" className="gap-1" onClick={() => openAtsDialog(application)}>
                              <FileSearch className="h-3.5 w-3.5" /> ATS
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-destructive hover:text-destructive"
                              onClick={() => deleteMutation.mutate(application.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

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
              Tracker
            </Link>
            . Manage uploaded PDFs in{" "}
            <Link to="/profile" className="text-primary underline">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingApplication ? "Edit application" : "New application"}</DialogTitle>
            <DialogDescription>
              Manual applications live here, and SweJobs-linked ones can be completed with the PDF resume you actually used.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="application-company">Company</Label>
              <Input
                id="application-company"
                value={form.company}
                onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))}
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

            <div className="grid gap-2">
              <Label htmlFor="application-url">Job URL</Label>
              <Input
                id="application-url"
                value={form.job_url}
                onChange={(event) => setForm((current) => ({ ...current, job_url: event.target.value }))}
                placeholder="https://company.example/jobs/123"
              />
            </div>

            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="application-resume-choice">Resume used</Label>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => resumeUploadInputRef.current?.click()}>
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
                Manage PDF resumes in{" "}
                <Link to="/profile" className="text-primary underline">
                  Resume Library
                </Link>
                . Upload here if you want to stay in flow.
              </p>

              {editingApplication?.resume_label && !editingApplication.resume_version_id ? (
                <p className="text-xs text-muted-foreground">
                  This row still has a legacy label saved: <span className="font-medium text-foreground">{editingApplication.resume_label}</span>.
                  Select a PDF resume to replace it.
                </p>
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>ATS Scan</DialogTitle>
            <DialogDescription>
              Run a quick keyword match between one uploaded resume and this application target.
            </DialogDescription>
          </DialogHeader>

          {atsApplication ? (
            <div className="grid gap-4">
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
