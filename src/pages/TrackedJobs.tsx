import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { ArrowRight, Bookmark, Compass, Trash2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { buildSweJobsApplication } from "@/lib/applications";

const PIPELINE_STATUSES = new Set(["applied", "interviewing", "rejected", "oa", "offer", "withdrawn"]);

type TrackedJobWithJob = Tables<"tracked_jobs"> & {
  jobs: Pick<Tables<"jobs">, "id" | "headline" | "employer_name" | "municipality" | "source_url"> | null;
};

export default function TrackedJobs() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    document.title = "Saved Jobs | SweJobs";
  }, []);

  const { data: trackedJobs } = useQuery({
    queryKey: ["all-tracked", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracked_jobs")
        .select("id, user_id, job_id, status, notes, created_at, updated_at, jobs(id, headline, employer_name, municipality, source_url)")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TrackedJobWithJob[];
    },
  });

  const deleteTracking = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("tracked_jobs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, deletedId) => {
      void qc.invalidateQueries({ queryKey: ["all-tracked", user?.id] });
      setSelectedIds((current) => current.filter((id) => id !== deletedId));
      toast({ title: "Removed from saved jobs" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not remove item", description: error.message, variant: "destructive" });
    },
  });

  const bulkDeleteTracking = useMutation({
    mutationFn: async (ids: number[]) => {
      const { error } = await supabase.from("tracked_jobs").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_data, ids) => {
      void qc.invalidateQueries({ queryKey: ["all-tracked", user?.id] });
      setSelectedIds([]);
      toast({ title: `Removed ${ids.length} saved job${ids.length === 1 ? "" : "s"}` });
    },
    onError: (error: Error) => {
      toast({ title: "Could not remove selected items", description: error.message, variant: "destructive" });
    },
  });

  const moveToApplications = useMutation({
    mutationFn: async (item: TrackedJobWithJob) => {
      const job = item.jobs;
      if (!job) throw new Error("Job details are missing for this saved item.");

      const application = buildSweJobsApplication({
        userId: user!.id,
        jobId: item.job_id,
        company: job.employer_name ?? "Unknown company",
        jobTitle: job.headline ?? `Job #${item.job_id}`,
        jobUrl: job.source_url,
      });

      const { error: insertError } = await supabase.from("applications").insert(application);
      if (insertError) {
        const isDuplicate = insertError.code === "23505" || /duplicate|already exists/i.test(insertError.message ?? "");
        if (!isDuplicate) throw insertError;
      }

      const { error: deleteError } = await supabase.from("tracked_jobs").delete().eq("id", item.id);
      if (deleteError) throw deleteError;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["all-tracked", user?.id] });
      void qc.invalidateQueries({ queryKey: ["applications", user?.id] });
      toast({ title: "Moved to Applications" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not move to Applications", description: error.message, variant: "destructive" });
    },
  });

  const allTracked = trackedJobs ?? [];
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = allTracked.length > 0 && allTracked.every((item) => selectedSet.has(item.id));
  const discoveryItems = allTracked.filter((item) => !PIPELINE_STATUSES.has(item.status));
  const pipelineItems = allTracked.filter((item) => PIPELINE_STATUSES.has(item.status));
  const isEmpty = allTracked.length === 0;

  if (!loading && !user) return <Navigate to="/auth" replace />;

  const toggleSelect = (id: number, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((value) => value !== id);
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(allTracked.map((item) => item.id));
      return;
    }
    setSelectedIds([]);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Saved Jobs</h1>
          <p className="text-xs text-muted-foreground">
            Jobs you saved from Explore. Move them to Applications when you apply.
          </p>
        </div>

        {!isEmpty ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => toggleSelectAll(Boolean(checked))}
                aria-label="Select all saved jobs"
              />
              <span className="text-xs text-muted-foreground">
                {selectedIds.length > 0 ? `${selectedIds.length} selected` : "Select items for bulk actions"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={selectedIds.length === 0 || bulkDeleteTracking.isPending}
                onClick={() => {
                  if (!window.confirm(`Remove ${selectedIds.length} selected items from saved jobs?`)) return;
                  bulkDeleteTracking.mutate(selectedIds);
                }}
              >
                Remove selected
              </Button>
            </div>
          </div>
        ) : null}

        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Bookmark className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <h2 className="text-lg font-medium">No saved jobs yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Save jobs from Explore to keep track of roles you're interested in.
            </p>
            <Link to="/jobs" className="mt-5">
              <Button className="gap-2">
                <Compass className="h-4 w-4" /> Browse jobs
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {pipelineItems.length > 0 ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-medium">Already in Applications</h2>
                    <p className="text-xs text-muted-foreground">
                      {pipelineItems.length} saved job{pipelineItems.length !== 1 ? "s" : ""} already tracked in Applications. You can remove them from this list.
                    </p>
                  </div>
                  <Link to="/applications">
                    <Button variant="outline" size="sm" className="gap-1.5">
                      Open Applications <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              {discoveryItems.map((item) => {
                const job = item.jobs;
                return (
                  <div
                    key={item.id}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/40 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Checkbox
                        checked={selectedSet.has(item.id)}
                        onCheckedChange={(checked) => toggleSelect(item.id, Boolean(checked))}
                        aria-label={`Select ${job?.headline ?? `Job ${item.job_id}`}`}
                      />
                      <Link to={`/jobs/${item.job_id}`} className="min-w-0">
                        <p className="truncate text-sm font-medium leading-tight hover:text-primary">
                          {job?.headline ?? `Job #${item.job_id}`}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {job?.employer_name ?? "Unknown company"}
                          {job?.municipality ? ` · ${job.municipality}` : ""}
                        </p>
                      </Link>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={moveToApplications.isPending}
                        onClick={() => moveToApplications.mutate(item)}
                      >
                        Move to Applications
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                        onClick={() => deleteTracking.mutate(item.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {discoveryItems.length === 0 && pipelineItems.length > 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">All your saved jobs are already in Applications.</p>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
