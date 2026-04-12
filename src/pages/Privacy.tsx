import { useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Privacy() {
  useEffect(() => {
    document.title = "Privacy Policy | SweJobs";
  }, []);

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Last updated: April 12, 2026</p>
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Scope</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              This policy covers the SweJobs web app and the SweJobs Capture Chrome extension.
              SweJobs helps users find and track job opportunities and save applications from
              career pages.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Data We Process</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Account and authentication data: sign-in identifiers and session credentials needed
              to keep you authenticated.
            </p>
            <p>
              Job capture data: page URL, job title, company name, and optional recruiter details
              when available on a page you choose to capture.
            </p>
            <p>
              Usage data inside SweJobs: saved applications, tracked statuses, watchlist entries,
              saved searches, and profile preferences that power product features.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">How We Use Data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              We use data only to provide SweJobs features: capture job applications, sync your
              tracker, keep your account signed in, and show relevant dashboard and workflow views.
            </p>
            <p>
              We do not sell personal data and do not use data for creditworthiness or lending
              decisions.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Chrome Extension Permissions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              activeTab and scripting: used when you explicitly trigger capture on the current tab.
            </p>
            <p>
              storage and alarms: used to store local session state and refresh authentication.
            </p>
            <p>
              identity: used for user authentication.
            </p>
            <p>
              Host access: required to support capture across many employer and ATS domains where
              job pages are published.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Retention and Deletion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Account-scoped data remains available in your SweJobs workspace until removed by you
              or by account deletion workflows.
            </p>
            <p>
              Operational job-market ingestion data is retained according to pipeline compaction
              policies for service reliability and analytics.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Third-Party Services</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              SweJobs uses Supabase for authentication and database storage. Extension and app data
              required for core functionality is processed through this backend.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              For privacy questions, use the support channel on the SweJobs homepage:
              {" "}
              <a
                className="text-primary underline-offset-4 hover:underline"
                href="https://swejobs.vercel.app/"
                target="_blank"
                rel="noreferrer"
              >
                swejobs.vercel.app
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
