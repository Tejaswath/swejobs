import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";

import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { downloadCSV } from "@/lib/export";

type DateRange = "30d" | "90d" | "all";

export default function Export() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState<DateRange>("90d");

  useEffect(() => {
    document.title = "Export | SweJobs";
  }, []);

  const rangeStartIso = useMemo(() => {
    if (dateRange === "all") return null;
    const now = new Date();
    const days = dateRange === "30d" ? 30 : 90;
    now.setDate(now.getDate() - days);
    return now.toISOString();
  }, [dateRange]);

  const exportTracked = async () => {
    if (!user) {
      toast({ title: "Sign in to export tracked jobs", variant: "destructive" });
      return;
    }

    let query = supabase
      .from("tracked_jobs")
      .select("id, job_id, status, notes, created_at, updated_at, jobs(headline, employer_name)")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (rangeStartIso) {
      query = query.gte("updated_at", rangeStartIso);
    }
    const { data, error } = await query;

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    const headers = ["TrackID", "JobID", "Headline", "Employer", "Status", "Notes", "Created", "Updated"];
    const rows = (data ?? []).map((tracked) => {
      const job = tracked.jobs as { headline?: string | null; employer_name?: string | null } | null;
      return [
        tracked.id,
        tracked.job_id,
        job?.headline ?? "",
        job?.employer_name ?? "",
        tracked.status,
        tracked.notes ?? "",
        tracked.created_at ?? "",
        tracked.updated_at ?? "",
      ];
    });

    if (rows.length === 0) {
      toast({ title: "No tracked jobs to export", variant: "destructive" });
      return;
    }

    downloadCSV("my_tracked_jobs.csv", headers, rows);
    toast({ title: `Exported ${rows.length} tracked jobs` });
  };

  const exportApplications = async () => {
    if (!user) {
      toast({ title: "Sign in to export applications", variant: "destructive" });
      return;
    }

    let query = supabase
      .from("applications")
      .select("company, job_title, status, job_url, applied_at, resume_label, source, ats_score, notes")
      .eq("user_id", user.id)
      .order("applied_at", { ascending: false });
    if (rangeStartIso) {
      query = query.gte("applied_at", rangeStartIso);
    }
    const { data, error } = await query;

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    const headers = ["Company", "JobTitle", "Status", "JobURL", "AppliedAt", "ResumeUsed", "Source", "ATSScore", "Notes"];
    const rows = (data ?? []).map((application) => [
      application.company,
      application.job_title,
      application.status,
      application.job_url,
      application.applied_at,
      application.resume_label ?? "",
      application.source,
      application.ats_score ?? "",
      application.notes ?? "",
    ]);

    if (rows.length === 0) {
      toast({ title: "No applications to export", variant: "destructive" });
      return;
    }

    downloadCSV("my_applications.csv", headers, rows);
    toast({ title: `Exported ${rows.length} applications` });
  };

    const exports = [
      {
      title: "My Shortlist",
      description: "Your discovery list from Explore and Shortlist.",
      action: exportTracked,
    },
    {
      title: "My Applications",
      description: "Your actual application pipeline across SweJobs and manual entries.",
      action: exportApplications,
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Personal Exports</h1>
          <p className="text-sm text-muted-foreground">
            Download only the job-search data you personally manage in SweJobs.
          </p>
        </div>

        <div className="flex w-full max-w-[220px] flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Date range</label>
          <Select value={dateRange} onValueChange={(value) => setDateRange(value as DateRange)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {exports.map((item) => (
            <Card key={item.title}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <FileSpreadsheet className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <CardDescription>{item.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={item.action}
                  disabled={!user}
                >
                  <Download className="h-4 w-4" />
                  Download CSV
                </Button>
                {!user ? <p className="mt-2 text-xs text-muted-foreground">Sign in required</p> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
