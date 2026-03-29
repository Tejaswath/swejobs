import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { useEffect } from "react";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Jobs from "./pages/Jobs";
import JobDetail from "./pages/JobDetail";
import TrackedJobs from "./pages/TrackedJobs";
import Applications from "./pages/Applications";
import Profile from "./pages/Profile";
import SavedSearches from "./pages/SavedSearches";
import Digest from "./pages/Digest";
import Export from "./pages/Export";
import SkillGap from "./pages/SkillGap";
import CompanyWatchlist from "./pages/CompanyWatchlist";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const queryClient = new QueryClient();

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
                <Route path="/outreach" element={<Navigate to="/applications" replace />} />
                <Route path="/searches" element={<SavedSearches />} />
                <Route path="/digest" element={<Digest />} />
                <Route path="/export" element={<Export />} />
                <Route path="/skills" element={<SkillGap />} />
                <Route path="/watchlist" element={<CompanyWatchlist />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </ErrorBoundary>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
