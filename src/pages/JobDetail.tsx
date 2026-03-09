import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, MapPin, Globe, Clock, Building, ExternalLink, Bookmark } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

const STATUSES = ["saved", "applied", "interviewing", "rejected", "ignored"] as const;

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: job, isLoading } = useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      const { data } = await supabase.from("jobs").select("*").eq("id", Number(id)).single();
      return data;
    },
  });

  const { data: tags } = useQuery({
    queryKey: ["job-tags", id],
    queryFn: async () => {
      const { data } = await supabase.from("job_tags").select("tag").eq("job_id", Number(id));
      return data?.map((t) => t.tag) ?? [];
    },
  });

  const { data: tracking } = useQuery({
    queryKey: ["tracked", id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("tracked_jobs")
        .select("*")
        .eq("job_id", Number(id))
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string>("saved");

  useEffect(() => {
    if (tracking) {
      setNotes(tracking.notes ?? "");
      setStatus(tracking.status);
    }
  }, [tracking]);

  const upsertTracking = useMutation({
    mutationFn: async (vals: { status: string; notes: string }) => {
      const { error } = await supabase.from("tracked_jobs").upsert(
        { user_id: user!.id, job_id: Number(id), status: vals.status, notes: vals.notes },
        { onConflict: "user_id,job_id" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracked", id] });
      toast({ title: "Saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <AppLayout><div className="animate-pulse h-64 bg-muted rounded-lg" /></AppLayout>;
  if (!job) return <AppLayout><p>Job not found</p></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-6">
        <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to jobs
        </Link>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main content */}
          <div className="space-y-4 lg:col-span-2">
            <div>
              <h1 className="font-mono text-2xl font-bold">{job.headline}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {job.employer_name && (
                  <span className="flex items-center gap-1"><Building className="h-4 w-4" /> {job.employer_name}</span>
                )}
                {job.municipality && (
                  <span className="flex items-center gap-1"><MapPin className="h-4 w-4" /> {job.municipality}, {job.region}</span>
                )}
                {job.lang && (
                  <span className="flex items-center gap-1"><Globe className="h-4 w-4" /> {job.lang.toUpperCase()}</span>
                )}
                {job.published_at && (
                  <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {new Date(job.published_at).toLocaleDateString("sv-SE")}</span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {job.remote_flag && <Badge>Remote</Badge>}
              {job.employment_type && <Badge variant="outline">{job.employment_type}</Badge>}
              {job.working_hours && <Badge variant="outline">{job.working_hours}</Badge>}
              {job.occupation_label && <Badge variant="secondary">{job.occupation_label}</Badge>}
            </div>

            {tags && tags.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">Skills</h3>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="bg-primary/5 text-xs">{tag}</Badge>
                  ))}
                </div>
              </div>
            )}

            <Card>
              <CardHeader><CardTitle className="text-base">Description</CardTitle></CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {job.description || "No description available."}
                </p>
              </CardContent>
            </Card>

            {job.source_url && (
              <a href={job.source_url} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="gap-2">
                  <ExternalLink className="h-4 w-4" /> Apply on source site
                </Button>
              </a>
            )}
          </div>

          {/* Sidebar: tracking */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bookmark className="h-4 w-4" /> Track this job
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!user ? (
                  <p className="text-sm text-muted-foreground">
                    <Link to="/auth" className="text-primary underline">Sign in</Link> to track jobs.
                  </p>
                ) : (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">Status</label>
                      <Select value={status} onValueChange={setStatus}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">Notes</label>
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Add personal notes..."
                        rows={4}
                      />
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => upsertTracking.mutate({ status, notes })}
                      disabled={upsertTracking.isPending}
                    >
                      {tracking ? "Update" : "Save"} tracking
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            {job.application_deadline && (
              <Card className="mt-4">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Deadline</p>
                  <p className="font-mono font-medium">{job.application_deadline}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
