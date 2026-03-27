import { useEffect, useRef, useState, type ChangeEvent } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { getErrorMessage, toDisplayError } from "@/lib/errors";
import {
  deleteResumeVersion,
  deriveResumeLabel,
  formatResumeFileSize,
  openResumeDownload,
  uploadResumeVersion,
  type ResumeVersionRow,
} from "@/lib/resumes";

type UserProfile = Tables<"user_profile">;

type ResumeVersionFormState = {
  label: string;
  target_role: string;
  notes: string;
  is_default: boolean;
};

function emptyResumeVersionForm(): ResumeVersionFormState {
  return {
    label: "",
    target_role: "",
    notes: "",
    is_default: false,
  };
}

function toResumeVersionForm(version: ResumeVersionRow): ResumeVersionFormState {
  return {
    label: version.label,
    target_role: version.target_role ?? "",
    notes: version.notes ?? "",
    is_default: version.is_default,
  };
}

export default function Profile() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [profileForm, setProfileForm] = useState({
    full_name: "",
    headline: "",
    location: "",
    linkedin_url: "",
    portfolio_url: "",
  });
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
  const [editingResumeVersion, setEditingResumeVersion] = useState<ResumeVersionRow | null>(null);
  const [resumeVersionForm, setResumeVersionForm] = useState<ResumeVersionFormState>(emptyResumeVersionForm());

  useEffect(() => {
    document.title = "Resume Library | SweJobs";
  }, []);

  const profileQuery = useQuery({
    queryKey: ["user-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_profile")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw toDisplayError(error, "Could not load your application basics.");
      return data;
    },
  });

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

  useEffect(() => {
    if (!profileQuery.data) return;
    setProfileForm({
      full_name: profileQuery.data.full_name ?? "",
      headline: profileQuery.data.headline ?? "",
      location: profileQuery.data.location ?? "",
      linkedin_url: profileQuery.data.linkedin_url ?? "",
      portfolio_url: profileQuery.data.portfolio_url ?? "",
    });
  }, [profileQuery.data]);

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in required");
      const payload: UserProfile = {
        user_id: user.id,
        full_name: profileForm.full_name.trim(),
        headline: profileForm.headline.trim(),
        location: profileForm.location.trim(),
        linkedin_url: profileForm.linkedin_url.trim(),
        portfolio_url: profileForm.portfolio_url.trim(),
        created_at: profileQuery.data?.created_at ?? new Date().toISOString(),
        updated_at: profileQuery.data?.updated_at ?? new Date().toISOString(),
      };

      const { error } = await supabase.from("user_profile").upsert(payload);
      if (error) throw toDisplayError(error, "Could not save your application basics.");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["user-profile", user?.id] });
      toast({ title: "Basics saved" });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not save basics", description: getErrorMessage(error), variant: "destructive" });
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
      void qc.invalidateQueries({ queryKey: ["resume-versions", user?.id] });
      toast({
        title: "Resume uploaded",
        description: resumeVersion.parsed_text
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
          target_role: resumeVersionForm.target_role.trim(),
          notes: resumeVersionForm.notes.trim(),
          is_default: resumeVersionForm.is_default,
        })
        .eq("id", editingResumeVersion.id);

      if (error) throw toDisplayError(error, "Could not update this resume.");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["resume-versions", user?.id] });
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
      void qc.invalidateQueries({ queryKey: ["resume-versions", user?.id] });
      toast({ title: "Default resume updated" });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not set default resume", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const deleteResumeMutation = useMutation({
    mutationFn: async (resumeVersion: ResumeVersionRow) => deleteResumeVersion(supabase, resumeVersion),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["resume-versions", user?.id] });
      toast({ title: "Resume deleted" });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not delete resume", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const downloadResumeMutation = useMutation({
    mutationFn: async (resumeVersion: ResumeVersionRow) => openResumeDownload(supabase, resumeVersion),
    onError: (error: unknown) => {
      toast({ title: "Could not open resume", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const resumeVersions = resumeVersionsQuery.data ?? [];
  const defaultResume = resumeVersions.find((resumeVersion) => resumeVersion.is_default) ?? null;

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
    await uploadResumeMutation.mutateAsync(file);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Resume Library</h1>
          <p className="text-sm text-muted-foreground">
            Upload the PDF resumes you actually reuse, then attach them directly in Applications.
          </p>
        </div>

        <Card className="border-border/40 bg-card/60">
          <CardHeader className="gap-2 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <CardTitle>Saved resumes</CardTitle>
              <CardDescription>
                Keep this simple: PDF only, 3 MB max, one clear label per version.
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
              <Button className="gap-2" onClick={() => uploadInputRef.current?.click()} disabled={uploadResumeMutation.isPending}>
                <Upload className="h-4 w-4" />
                {uploadResumeMutation.isPending ? "Uploading…" : "Upload PDF"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border/50 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
              Applications will reuse the label you choose here. Your default resume is preselected whenever you add a new application.
            </div>

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
                {resumeVersions.map((resumeVersion) => (
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
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span>{resumeVersion.file_name ?? "No file name"}</span>
                        <span>{formatResumeFileSize(resumeVersion.file_size_bytes)}</span>
                        <span>{resumeVersion.parsed_text ? "ATS-ready" : "Limited text extraction"}</span>
                      </div>
                      {resumeVersion.target_role ? (
                        <p className="text-sm text-muted-foreground">Target role: {resumeVersion.target_role}</p>
                      ) : null}
                      {resumeVersion.notes ? <p className="text-sm text-muted-foreground">{resumeVersion.notes}</p> : null}
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
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/60">
          <CardHeader className="gap-2 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <CardTitle>Application basics</CardTitle>
              <CardDescription>
                Optional identity fields you want to keep around while applying.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {defaultResume ? (
                <Badge variant="secondary">Default resume: {defaultResume.label}</Badge>
              ) : (
                <Badge variant="outline">No default resume yet</Badge>
              )}
              <Button onClick={() => saveProfileMutation.mutate()} disabled={saveProfileMutation.isPending}>
                Save basics
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="profile-full-name">Full name</Label>
              <Input
                id="profile-full-name"
                value={profileForm.full_name}
                onChange={(event) => setProfileForm((current) => ({ ...current, full_name: event.target.value }))}
                placeholder="Your full name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-headline">Headline</Label>
              <Input
                id="profile-headline"
                value={profileForm.headline}
                onChange={(event) => setProfileForm((current) => ({ ...current, headline: event.target.value }))}
                placeholder="Backend engineer focused on distributed systems"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-location">Location</Label>
              <Input
                id="profile-location"
                value={profileForm.location}
                onChange={(event) => setProfileForm((current) => ({ ...current, location: event.target.value }))}
                placeholder="Stockholm, Sweden"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-linkedin">LinkedIn URL</Label>
              <Input
                id="profile-linkedin"
                value={profileForm.linkedin_url}
                onChange={(event) => setProfileForm((current) => ({ ...current, linkedin_url: event.target.value }))}
                placeholder="https://linkedin.com/in/..."
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="profile-portfolio">Portfolio URL</Label>
              <Input
                id="profile-portfolio"
                value={profileForm.portfolio_url}
                onChange={(event) => setProfileForm((current) => ({ ...current, portfolio_url: event.target.value }))}
                placeholder="https://your-site.dev"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={resumeDialogOpen} onOpenChange={setResumeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit resume details</DialogTitle>
            <DialogDescription>
              Keep the label clear. Applications will reuse it as the exact resume you sent.
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
            <div className="grid gap-2">
              <Label htmlFor="resume-target-role">Target role</Label>
              <Input
                id="resume-target-role"
                value={resumeVersionForm.target_role}
                onChange={(event) => setResumeVersionForm((current) => ({ ...current, target_role: event.target.value }))}
                placeholder="Backend Engineer"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="resume-notes">Notes</Label>
              <Textarea
                id="resume-notes"
                rows={4}
                value={resumeVersionForm.notes}
                onChange={(event) => setResumeVersionForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="What this version emphasizes, and when you use it."
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
