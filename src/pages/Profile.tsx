import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileText,
  Pencil,
  Plus,
  Star,
  Trash2,
  Upload,
} from "lucide-react";

import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage, toDisplayError } from "@/lib/errors";
import {
  deleteResumeVersion,
  deriveResumeLabel,
  formatResumeFileSize,
  MAX_RESUMES_PER_USER,
  openResumeDownload,
  uploadResumeVersion,
  type ResumeVersionRow,
} from "@/lib/resumes";

const RESUME_ARCHIVE_UNUSED_DAYS = 60;

type ResumeVersionFormState = {
  label: string;
  is_default: boolean;
};

type ResumeUsageRow = {
  resume_version_id: string | null;
  applied_at: string | null;
  updated_at: string | null;
};

function emptyResumeVersionForm(): ResumeVersionFormState {
  return {
    label: "",
    is_default: false,
  };
}

function toResumeVersionForm(version: ResumeVersionRow): ResumeVersionFormState {
  return {
    label: version.label,
    is_default: version.is_default,
  };
}

export default function Profile() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
  const [editingResumeVersion, setEditingResumeVersion] = useState<ResumeVersionRow | null>(null);
  const [resumeVersionForm, setResumeVersionForm] = useState<ResumeVersionFormState>(emptyResumeVersionForm());

  const invalidateResumeCaches = () => {
    if (!user) return Promise.resolve();
    return Promise.all([
      qc.invalidateQueries({ queryKey: ["resume-versions", user.id] }),
      qc.invalidateQueries({ queryKey: ["default-resume-for-ats", user.id] }),
    ]).then(() => undefined);
  };

  useEffect(() => {
    document.title = "Resume Library | SweJobs";
  }, []);

  const resumeVersionsQuery = useQuery({
    queryKey: ["resume-versions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resume_versions")
        .select(
          "id, user_id, label, target_role, notes, is_default, storage_path, file_name, file_size_bytes, mime_type, " +
            "text_extracted_at, created_at, updated_at",
        )
        .eq("user_id", user!.id)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw toDisplayError(error, "Could not load your resume library.");
      return data ?? [];
    },
  });

  const resumeUsageQuery = useQuery({
    queryKey: ["resume-usage", user?.id],
    enabled: !!user && (resumeVersionsQuery.data?.length ?? 0) > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("resume_version_id, applied_at, updated_at")
        .eq("user_id", user!.id)
        .not("resume_version_id", "is", null);
      if (error) throw toDisplayError(error, "Could not load resume usage history.");
      return (data ?? []) as ResumeUsageRow[];
    },
  });

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
      void invalidateResumeCaches();
      toast({
        title: "Resume uploaded",
        description: resumeVersion.text_extracted_at
          ? "PDF stored and ready for ATS scans."
          : "PDF stored. Text extraction was limited, so ATS scans may be weaker for this file.",
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not upload resume", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const updateResumeVersionMutation = useMutation({
    mutationFn: async () => {
      if (!user || !editingResumeVersion) throw new Error("Resume version not selected");

      if (resumeVersionForm.is_default) {
        const { error: clearError } = await supabase
          .from("resume_versions")
          .update({ is_default: false })
          .eq("user_id", user.id)
          .eq("is_default", true);
        if (clearError) throw toDisplayError(clearError, "Could not update the default resume.");
      }

      const { error } = await supabase
        .from("resume_versions")
        .update({
          label: resumeVersionForm.label.trim(),
          is_default: resumeVersionForm.is_default,
        })
        .eq("id", editingResumeVersion.id);

      if (error) throw toDisplayError(error, "Could not update this resume.");
    },
    onSuccess: () => {
      void invalidateResumeCaches();
      toast({ title: "Resume details updated" });
      setResumeDialogOpen(false);
      setEditingResumeVersion(null);
      setResumeVersionForm(emptyResumeVersionForm());
    },
    onError: (error: unknown) => {
      toast({ title: "Could not update resume", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (resumeVersion: ResumeVersionRow) => {
      if (!user) throw new Error("Sign in required");

      const { error: clearError } = await supabase
        .from("resume_versions")
        .update({ is_default: false })
        .eq("user_id", user.id)
        .eq("is_default", true);
      if (clearError) throw toDisplayError(clearError, "Could not update the default resume.");

      const { error } = await supabase
        .from("resume_versions")
        .update({ is_default: true })
        .eq("id", resumeVersion.id);
      if (error) throw toDisplayError(error, "Could not set the default resume.");
    },
    onSuccess: () => {
      void invalidateResumeCaches();
      toast({ title: "Default resume updated" });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not set default resume", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const deleteResumeMutation = useMutation({
    mutationFn: async (resumeVersion: ResumeVersionRow) => deleteResumeVersion(supabase, resumeVersion),
    onSuccess: () => {
      void invalidateResumeCaches();
      toast({ title: "Resume deleted" });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not delete resume", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const deleteArchiveCandidatesMutation = useMutation({
    mutationFn: async (candidates: ResumeVersionRow[]) => {
      for (const resumeVersion of candidates) {
        await deleteResumeVersion(supabase, resumeVersion);
      }
    },
    onSuccess: (_data, candidates) => {
      void invalidateResumeCaches();
      toast({
        title: "Archive cleanup complete",
        description: `Deleted ${candidates.length} unused resume${candidates.length === 1 ? "" : "s"}.`,
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not clean archive candidates", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const downloadResumeMutation = useMutation({
    mutationFn: async (resumeVersion: ResumeVersionRow) => openResumeDownload(supabase, resumeVersion),
    onError: (error: unknown) => {
      toast({ title: "Could not open resume", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const resumeVersions = resumeVersionsQuery.data ?? [];
  const resumeLimitReached = resumeVersions.length >= MAX_RESUMES_PER_USER;
  const lastUsedByResumeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const usage of resumeUsageQuery.data ?? []) {
      if (!usage.resume_version_id) continue;
      const candidate = usage.applied_at ?? usage.updated_at;
      if (!candidate) continue;
      const previous = map.get(usage.resume_version_id);
      if (!previous || new Date(candidate).getTime() > new Date(previous).getTime()) {
        map.set(usage.resume_version_id, candidate);
      }
    }
    return map;
  }, [resumeUsageQuery.data]);

  const archiveCandidates = useMemo(() => {
    const nowMs = Date.now();
    return resumeVersions.filter((resumeVersion) => {
      if (!resumeVersion.storage_path) return false;
      if (resumeVersion.is_default) return false;
      const referenceIso = lastUsedByResumeId.get(resumeVersion.id) ?? resumeVersion.created_at;
      if (!referenceIso) return false;
      const referenceMs = new Date(referenceIso).getTime();
      if (Number.isNaN(referenceMs)) return false;
      const ageDays = Math.floor((nowMs - referenceMs) / 86_400_000);
      return ageDays >= RESUME_ARCHIVE_UNUSED_DAYS;
    });
  }, [lastUsedByResumeId, resumeVersions]);

  const archiveCandidateSet = useMemo(() => new Set(archiveCandidates.map((resumeVersion) => resumeVersion.id)), [archiveCandidates]);

  if (!loading && !user) return <Navigate to="/auth" replace />;

  const openEditResumeDialog = (resumeVersion: ResumeVersionRow) => {
    setEditingResumeVersion(resumeVersion);
    setResumeVersionForm(toResumeVersionForm(resumeVersion));
    setResumeDialogOpen(true);
  };

  const handleUploadInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (resumeLimitReached) {
      toast({
        title: "Resume limit reached",
        description: `You can store up to ${MAX_RESUMES_PER_USER} resumes. Delete an older one to upload a new PDF.`,
        variant: "destructive",
      });
      return;
    }
    await uploadResumeMutation.mutateAsync(file);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Resume Library</h1>
          <p className="text-sm text-muted-foreground">
            Upload your resume PDFs here. Pick one when logging an application.
          </p>
        </div>

        <Card className="border-border/40 bg-card/60">
          <CardHeader className="gap-2 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <CardTitle>Saved resumes</CardTitle>
              <CardDescription>
                PDF only, 3 MB max.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={uploadInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={handleUploadInput}
              />
              <Button
                className="gap-2"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploadResumeMutation.isPending || resumeLimitReached}
              >
                <Upload className="h-4 w-4" />
                {uploadResumeMutation.isPending ? "Uploading…" : "Upload PDF"}
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                disabled={archiveCandidates.length === 0 || deleteArchiveCandidatesMutation.isPending}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Delete ${archiveCandidates.length} resume archive candidate${
                        archiveCandidates.length === 1 ? "" : "s"
                      }? This cannot be undone.`,
                    )
                  ) {
                    return;
                  }
                  deleteArchiveCandidatesMutation.mutate(archiveCandidates);
                }}
              >
                <Trash2 className="h-4 w-4" />
                {deleteArchiveCandidatesMutation.isPending
                  ? "Cleaning…"
                  : `Delete stale (${archiveCandidates.length})`}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {resumeLimitReached ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Resume limit reached ({MAX_RESUMES_PER_USER}). Delete an older resume to upload a new one.
              </div>
            ) : null}
            {archiveCandidates.length > 0 ? (
              <div className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
                {archiveCandidates.length} resume{archiveCandidates.length === 1 ? "" : "s"} unused for {RESUME_ARCHIVE_UNUSED_DAYS}+ days flagged as archive candidates.
              </div>
            ) : null}
            {resumeVersionsQuery.isLoading ? (
              <div className="rounded-lg border border-border/50 bg-background/30 p-8 text-sm text-muted-foreground">
                Loading your resume library…
              </div>
            ) : resumeVersionsQuery.isError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                Could not load resume library. {getErrorMessage(resumeVersionsQuery.error)}
              </div>
            ) : resumeVersions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 bg-background/20 p-10 text-center">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-4 text-sm font-medium">No resume PDFs yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload your first PDF resume so Applications can attach the exact version you used.
                </p>
                <Button className="mt-4 gap-2" onClick={() => uploadInputRef.current?.click()}>
                  <Plus className="h-4 w-4" /> Upload first resume
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {resumeVersions.map((resumeVersion) => {
                  const lastUsedAt = lastUsedByResumeId.get(resumeVersion.id);
                  const referenceIso = lastUsedAt ?? resumeVersion.created_at;
                  const ageDays = referenceIso
                    ? Math.max(0, Math.floor((Date.now() - new Date(referenceIso).getTime()) / 86_400_000))
                    : 0;
                  const isArchiveCandidate = archiveCandidateSet.has(resumeVersion.id);

                  return (
                    <div
                      key={resumeVersion.id}
                      className="flex flex-col gap-4 rounded-xl border border-border/50 bg-background/20 p-4 md:flex-row md:items-start md:justify-between"
                    >
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{resumeVersion.label}</p>
                          {resumeVersion.is_default ? <Badge>Default</Badge> : null}
                          {resumeVersion.storage_path ? (
                            <Badge variant="secondary">PDF attached</Badge>
                          ) : (
                            <Badge variant="outline">Label only</Badge>
                          )}
                          {isArchiveCandidate ? (
                            <Badge variant="outline" className="border-amber-500/50 text-amber-300">
                              Archive candidate
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span>{resumeVersion.file_name ?? "No file name"}</span>
                          <span>{formatResumeFileSize(resumeVersion.file_size_bytes)}</span>
                          <span>
                            {lastUsedAt ? `Last used ${ageDays}d ago` : `Not used yet · age ${ageDays}d`}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {!resumeVersion.is_default ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => setDefaultMutation.mutate(resumeVersion)}
                            disabled={setDefaultMutation.isPending}
                          >
                            <Star className="h-3.5 w-3.5" /> Set default
                          </Button>
                        ) : null}
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => openEditResumeDialog(resumeVersion)}>
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => downloadResumeMutation.mutate(resumeVersion)}
                          disabled={!resumeVersion.storage_path || downloadResumeMutation.isPending}
                        >
                          <Download className="h-3.5 w-3.5" /> Open
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 text-destructive hover:text-destructive"
                          onClick={() => deleteResumeMutation.mutate(resumeVersion)}
                          disabled={deleteResumeMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={resumeDialogOpen} onOpenChange={setResumeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit resume details</DialogTitle>
            <DialogDescription>
              Give this resume a short name you'll recognize.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="resume-label">Label</Label>
              <Input
                id="resume-label"
                value={resumeVersionForm.label}
                onChange={(event) => setResumeVersionForm((current) => ({ ...current, label: event.target.value }))}
                placeholder="Backend, General, Finance"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={resumeVersionForm.is_default}
                onChange={(event) =>
                  setResumeVersionForm((current) => ({ ...current, is_default: event.target.checked }))
                }
              />
              Make this the default resume for new applications
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResumeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateResumeVersionMutation.mutate()}
              disabled={!resumeVersionForm.label.trim() || updateResumeVersionMutation.isPending}
            >
              Save details
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
