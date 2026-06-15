import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { lazy, Suspense, useEffect } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const queryClient = new QueryClient();
const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const Jobs = lazy(() => import("./pages/Jobs"));
const JobDetail = lazy(() => import("./pages/JobDetail"));
const TrackedJobs = lazy(() => import("./pages/TrackedJobs"));
const Applications = lazy(() => import("./pages/Applications"));
const Profile = lazy(() => import("./pages/Profile"));
const SavedSearches = lazy(() => import("./pages/SavedSearches"));
const Export = lazy(() => import("./pages/Export"));
const SkillGap = lazy(() => import("./pages/SkillGap"));
const Outreach = lazy(() => import("./pages/Outreach"));
const Admin = lazy(() => import("./pages/Admin"));
const Privacy = lazy(() => import("./pages/Privacy"));
const NotFound = lazy(() => import("./pages/NotFound"));

function App() {
  useEffect(() => {
    document.title = "SweJobs";
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ErrorBoundary>
              <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route
                  path="/jobs"
                  element={
                    <ErrorBoundary>
                      <Jobs />
                    </ErrorBoundary>
                  }
                />
                <Route path="/jobs/:id" element={<JobDetail />} />
                <Route path="/tracked" element={<TrackedJobs />} />
                <Route path="/applications" element={<Applications />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/resumes" element={<Profile />} />
                <Route path="/outreach" element={<Outreach />} />
                <Route path="/searches" element={<SavedSearches />} />
                <Route path="/export" element={<Export />} />
                <Route path="/skills" element={<SkillGap />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              </Suspense>
            </ErrorBoundary>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
