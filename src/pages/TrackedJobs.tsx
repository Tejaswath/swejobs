import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, Navigate } from "react-router-dom";
import { Trash2, Bookmark, Compass } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const COLUMNS = [
  { key: "saved", label: "Saved" },
  { key: "applied", label: "Applied" },
  { key: "interviewing", label: "Interviewing" },
  { key: "rejected", label: "Rejected" },
  { key: "ignored", label: "Ignored" },
] as const;

export default function TrackedJobs() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: trackedJobs } = useQuery({
    queryKey: ["all-tracked"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("tracked_jobs")
        .select("*, jobs(id, headline, employer_name, municipality)")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  const deleteTracking = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("tracked_jobs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["all-tracked"] }); toast({ title: "Removed" }); },
  });

  if (!loading && !user) return <Navigate to="/auth" replace />;

  const isEmpty = !trackedJobs || trackedJobs.length === 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tracker</h1>
          <p className="text-xs text-muted-foreground">Your application pipeline</p>
        </div>

        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Bookmark className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h2 className="text-lg font-medium">No tracked jobs yet</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm">
              Save jobs from Explore to start building your pipeline
            </p>
            <Link to="/jobs" className="mt-5">
              <Button className="gap-2">
                <Compass className="h-4 w-4" /> Browse jobs
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-5">
            {COLUMNS.map((col) => {
              const items = trackedJobs?.filter((t) => t.status === col.key) ?? [];
              return (
                <div key={col.key}>
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-xs font-medium text-muted-foreground">{col.label}</h3>
                    <Badge variant="secondary" className="text-[10px] font-normal">{items.length}</Badge>
                  </div>
                  <div className="min-h-[200px] space-y-1.5 rounded-lg bg-muted/30 p-2">
                    {items.map((item) => {
                      const job = item.jobs as any;
                      return (
                        <div key={item.id} className="group relative rounded-md bg-card p-3">
                          <Link to={`/jobs/${item.job_id}`} className="block">
                            <p className="text-sm font-medium leading-tight hover:text-primary">
                              {job?.headline ?? `Job #${item.job_id}`}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{job?.employer_name}</p>
                          </Link>
                          {item.notes && (
                            <p className="mt-1 text-[11px] text-muted-foreground italic line-clamp-2">{item.notes}</p>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1 h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
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
        )}
      </div>
    </AppLayout>
  );
}
