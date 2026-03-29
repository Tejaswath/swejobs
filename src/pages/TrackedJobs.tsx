import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { ArrowRight, Bookmark, Compass, Trash2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const COLUMNS = [
  { key: "saved", label: "Shortlisted" },
  { key: "ignored", label: "Passed" },
] as const;

const PIPELINE_STATUSES = new Set(["applied", "interviewing", "rejected", "oa", "offer", "withdrawn"]);
const STATUS_OPTIONS = [
  { value: "saved", label: "Shortlisted" },
  { value: "ignored", label: "Passed" },
  { value: "applied", label: "Applied" },
  { value: "oa", label: "Online Assessment" },
  { value: "interviewing", label: "Interviewing" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
] as const;

type TrackedJobWithJob = Tables<"tracked_jobs"> & {
  jobs: Pick<Tables<"jobs">, "id" | "headline" | "employer_name" | "municipality"> | null;
};

export default function TrackedJobs() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    document.title = "Shortlist | SweJobs";
  }, []);

  const { data: trackedJobs } = useQuery({
    queryKey: ["all-tracked", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracked_jobs")
        .select("id, user_id, job_id, status, notes, created_at, updated_at, jobs(id, headline, employer_name, municipality)")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TrackedJobWithJob[];
    },
  });

  const updateTrackingStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const { error } = await supabase.from("tracked_jobs").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["all-tracked", user?.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not update status", description: error.message, variant: "destructive" });
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
      toast({ title: "Removed from shortlist" });
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
      toast({ title: `Removed ${ids.length} items` });
    },
    onError: (error: Error) => {
      toast({ title: "Could not remove selected items", description: error.message, variant: "destructive" });
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
          <h1 className="text-xl font-semibold tracking-tight">Shortlist</h1>
          <p className="text-xs text-muted-foreground">Discovery tracking for jobs you want to follow up on</p>
          <Link to="/applications" className="mt-2 inline-flex text-xs text-primary hover:underline">
            Track your full application pipeline →
          </Link>
        </div>

        {!isEmpty ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => toggleSelectAll(Boolean(checked))}
                aria-label="Select all shortlisted jobs"
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
                  if (!window.confirm(`Remove ${selectedIds.length} selected items from shortlist?`)) return;
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
            <h2 className="text-lg font-medium">No shortlist items yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Save jobs from Explore to start building your pipeline
            </p>
            <Link to="/jobs" className="mt-5">
              <Button className="gap-2">
                <Compass className="h-4 w-4" /> Browse jobs
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {pipelineItems.length > 0 ? (
              <div className="rounded-lg border border-border/50 bg-card/40 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-medium">In your pipeline</h2>
                    <p className="text-xs text-muted-foreground">
                      These roles are already in Applications. Manage interview/reject outcomes there.
                    </p>
                  </div>
                  <Link to="/applications">
                    <Button variant="outline" size="sm" className="gap-1.5">
                      Open Applications <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
                <div className="space-y-2">
                  {pipelineItems.slice(0, 8).map((item) => {
                    const job = item.jobs;
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-background/40 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Checkbox
                            checked={selectedSet.has(item.id)}
                            onCheckedChange={(checked) => toggleSelect(item.id, Boolean(checked))}
                            aria-label={`Select ${job?.headline ?? `Job ${item.job_id}`}`}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{job?.headline ?? `Job #${item.job_id}`}</p>
                            <p className="text-xs text-muted-foreground">{job?.employer_name ?? "Unknown company"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={item.status}
                            onValueChange={(status) => updateTrackingStatus.mutate({ id: item.id, status })}
                          >
                            <SelectTrigger className="h-8 w-40 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
                            <Link to="/applications">In Applications</Link>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              {COLUMNS.map((col) => {
                const items = discoveryItems.filter((item) => item.status === col.key) ?? [];
                return (
                  <div key={col.key}>
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-xs font-medium text-muted-foreground">{col.label}</h3>
                      <Badge variant="secondary" className="text-xs font-normal">
                        {items.length}
                      </Badge>
                    </div>
                    <div className="min-h-[200px] space-y-1.5 rounded-lg bg-muted/30 p-2">
                      {items.map((item) => {
                        const job = item.jobs;
                        return (
                          <div key={item.id} className="group relative rounded-md bg-card p-3">
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <Checkbox
                                  checked={selectedSet.has(item.id)}
                                  onCheckedChange={(checked) => toggleSelect(item.id, Boolean(checked))}
                                  aria-label={`Select ${job?.headline ?? `Job ${item.job_id}`}`}
                                />
                                <Link to={`/jobs/${item.job_id}`} className="min-w-0">
                                  <p className="truncate text-sm font-medium leading-tight hover:text-primary">
                                    {job?.headline ?? `Job #${item.job_id}`}
                                  </p>
                                  <p className="mt-0.5 text-xs text-muted-foreground">{job?.employer_name ?? "Unknown company"}</p>
                                </Link>
                              </div>
                            </div>

                            <div className="mb-2">
                              <Select
                                value={item.status}
                                onValueChange={(status) => updateTrackingStatus.mutate({ id: item.id, status })}
                              >
                                <SelectTrigger className="h-8 w-full text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {STATUS_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {item.notes ? (
                              <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">{item.notes}</p>
                            ) : null}

                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute right-1 top-1 h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                              onClick={() => deleteTracking.mutate(item.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
