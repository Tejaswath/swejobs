import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Download, FileSpreadsheet, FileJson } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function downloadCSV(filename: string, headers: string[], rows: any[][]) {
  const BOM = "\uFEFF";
  const csv = BOM + [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJSON(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Export() {
  const { user } = useAuth();
  const { toast } = useToast();

  const exportActiveJobs = async () => {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, headline, employer_name, municipality, region, lang, remote_flag, occupation_label, published_at, application_deadline, source_url")
      .eq("is_active", true)
      .eq("is_target_role", true)
      .order("published_at", { ascending: false })
      .limit(10000);

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

    const headers = ["ID", "Headline", "Employer", "Municipality", "Region", "Language", "Remote", "Occupation", "Published", "Deadline", "URL"];
    const rows = (data ?? []).map((j) => [j.id, j.headline, j.employer_name, j.municipality, j.region, j.lang, j.remote_flag, j.occupation_label, j.published_at, j.application_deadline, j.source_url]);
    downloadCSV("jobs_active.csv", headers, rows);
    toast({ title: `Exported ${rows.length} jobs` });
  };

  const exportDelta = async () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("job_events")
      .select("id, job_id, event_type, event_time")
      .gte("event_time", weekAgo)
      .order("event_time", { ascending: false })
      .limit(10000);

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

    const headers = ["EventID", "JobID", "EventType", "EventTime"];
    const rows = (data ?? []).map((e) => [e.id, e.job_id, e.event_type, e.event_time]);
    downloadCSV("jobs_delta_7d.csv", headers, rows);
    toast({ title: `Exported ${rows.length} events` });
  };

  const exportDigest = async () => {
    const { data, error } = await supabase
      .from("weekly_digests")
      .select("*")
      .order("period_end", { ascending: false })
      .limit(1)
      .single();

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    downloadJSON("weekly_digest.json", data?.digest_json);
    toast({ title: "Digest exported" });
  };

  const exportTracked = async () => {
    if (!user) { toast({ title: "Sign in to export tracked jobs", variant: "destructive" }); return; }
    const { data, error } = await supabase
      .from("tracked_jobs")
      .select("id, job_id, status, notes, created_at, updated_at, jobs(headline, employer_name)")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

    const headers = ["TrackID", "JobID", "Headline", "Employer", "Status", "Notes", "Created", "Updated"];
    const rows = (data ?? []).map((t) => {
      const job = t.jobs as any;
      return [t.id, t.job_id, job?.headline, job?.employer_name, t.status, t.notes, t.created_at, t.updated_at];
    });
    downloadCSV("my_tracked_jobs.csv", headers, rows);
    toast({ title: `Exported ${rows.length} tracked jobs` });
  };

  const EXPORTS = [
    { title: "Active Jobs", desc: "All currently active relevant jobs", icon: FileSpreadsheet, action: exportActiveJobs, format: "CSV" },
    { title: "7-Day Delta", desc: "Created/Updated/Removed events this week", icon: FileSpreadsheet, action: exportDelta, format: "CSV" },
    { title: "Latest Digest", desc: "Most recent weekly digest artifact", icon: FileJson, action: exportDigest, format: "JSON" },
    { title: "My Tracked Jobs", desc: "Your personal tracking history", icon: FileSpreadsheet, action: exportTracked, format: "CSV", requiresAuth: true },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight">Export Data</h1>
          <p className="text-sm text-muted-foreground">Download clean data for your own analysis</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {EXPORTS.map((exp) => (
            <Card key={exp.title}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <exp.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{exp.title}</CardTitle>
                    <CardDescription>{exp.desc}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={exp.action}
                  disabled={exp.requiresAuth && !user}
                >
                  <Download className="h-4 w-4" /> Download {exp.format}
                </Button>
                {exp.requiresAuth && !user && (
                  <p className="mt-2 text-xs text-muted-foreground">Sign in required</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
