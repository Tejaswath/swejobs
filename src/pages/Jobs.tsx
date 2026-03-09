import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  MapPin, Globe, Clock, ChevronLeft, ChevronRight,
  ExternalLink, Building, Bookmark, X, Star, TrendingUp, Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

const PAGE_SIZE = 25;
const STATUSES = ["saved", "applied", "interviewing", "rejected", "ignored"] as const;
const REGIONS = [
  { code: "01", label: "Stockholm" },
  { code: "14", label: "Västra Götaland" },
  { code: "12", label: "Skåne" },
  { code: "03", label: "Uppsala" },
];

export default function Jobs() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("all");
  const [lang, setLang] = useState("all");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const hasActiveFilters = region !== "all" || lang !== "all" || remoteOnly;

  const clearFilters = () => {
    setRegion("all");
    setLang("all");
    setRemoteOnly(false);
    setPage(0);
  };

  // Job list
  const { data, isLoading } = useQuery({
    queryKey: ["jobs", search, region, lang, remoteOnly, page],
    queryFn: async () => {
      let query = supabase
        .from("jobs")
        .select("id, headline, employer_name, municipality, region, region_code, lang, remote_flag, published_at, application_deadline, employment_type, working_hours, occupation_label", { count: "exact" })
        .eq("is_active", true)
        .eq("is_target_role", true)
        .order("published_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (region !== "all") query = query.eq("region_code", region);
      if (lang !== "all") query = query.eq("lang", lang);
      if (remoteOnly) query = query.eq("remote_flag", true);
      if (search) query = query.or(`headline.ilike.%${search}%,employer_name.ilike.%${search}%`);

      return query;
    },
  });

  const jobs = data?.data ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Fetch tags for visible jobs (for card badges)
  const jobIds = jobs.map((j) => j.id);
  const { data: allJobTags } = useQuery({
    queryKey: ["job-tags-list", jobIds.join(",")],
    enabled: jobIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("job_tags")
        .select("job_id, tag")
        .in("job_id", jobIds);
      return data ?? [];
    },
  });

  const tagsByJobId = (allJobTags ?? []).reduce((acc, t) => {
    if (!acc[t.job_id]) acc[t.job_id] = [];
    acc[t.job_id].push(t.tag);
    return acc;
  }, {} as Record<number, string[]>);

  // Detail
  const { data: detail } = useQuery({
    queryKey: ["job", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data } = await supabase.from("jobs").select("*").eq("id", selectedId!).single();
      return data;
    },
  });

  const { data: detailTags } = useQuery({
    queryKey: ["job-tags", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data } = await supabase.from("job_tags").select("tag").eq("job_id", selectedId!);
      return data?.map((t) => t.tag) ?? [];
    },
  });

  // User skills for "why this matches"
  const { data: userSkills } = useQuery({
    queryKey: ["user-skills", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("user_skills").select("skill").eq("user_id", user!.id);
      return new Set((data ?? []).map((s) => s.skill.toLowerCase()));
    },
  });

  const { data: tracking } = useQuery({
    queryKey: ["tracked", selectedId],
    enabled: !!user && !!selectedId,
    queryFn: async () => {
      const { data } = await supabase
        .from("tracked_jobs")
        .select("*")
        .eq("job_id", selectedId!)
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string>("saved");

  useEffect(() => {
    if (tracking) { setNotes(tracking.notes ?? ""); setStatus(tracking.status); }
    else { setNotes(""); setStatus("saved"); }
  }, [tracking]);

  const upsertTracking = useMutation({
    mutationFn: async (vals: { status: string; notes: string }) => {
      const { error } = await supabase.from("tracked_jobs").upsert(
        { user_id: user!.id, job_id: selectedId!, status: vals.status, notes: vals.notes },
        { onConflict: "user_id,job_id" }
      );
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tracked", selectedId] }); toast({ title: "Saved" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Watch company from detail
  const watchCompany = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("watched_companies").insert({
        user_id: user!.id,
        employer_name: name,
      });
      if (error) throw error;
    },
    onSuccess: (_data, name) => {
      qc.invalidateQueries({ queryKey: ["watched-companies"] });
      toast({
        title: `Watching ${name}`,
        description: "You'll see new openings in your Company Watchlist.",
        action: (
          <a href="/watchlist">
            <Button variant="outline" size="sm" className="h-7 text-xs">
              View Watchlist
            </Button>
          </a>
        ),
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Keyboard nav
  useEffect(() => {
    if (!jobs.length) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((prev) => { const next = Math.min(prev + 1, jobs.length - 1); setSelectedId(jobs[next].id); return next; });
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((prev) => { const next = Math.max(prev - 1, 0); setSelectedId(jobs[next].id); return next; });
      } else if (e.key === "Escape") { setSelectedId(null); setSelectedIdx(-1); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [jobs]);

  useEffect(() => {
    if (selectedIdx >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("[data-job-item]");
      items[selectedIdx]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIdx]);

  // Matching tags
  const matchingTags = detailTags?.filter((t) => userSkills?.has(t.toLowerCase())) ?? [];
  const missingTags = detailTags?.filter((t) => !userSkills?.has(t.toLowerCase())) ?? [];

  return (
    <AppLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Explore</h1>
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString()} jobs
          </p>
        </div>

        {/* Search — full width */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search jobs, companies..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="h-10 pl-10 text-base"
          />
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={region} onValueChange={(v) => { setRegion(v); setPage(0); }}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Region" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All regions</SelectItem>
              {REGIONS.map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={lang} onValueChange={(v) => { setLang(v); setPage(0); }}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All langs</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="sv">Swedish</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <Switch checked={remoteOnly} onCheckedChange={(v) => { setRemoteOnly(v); setPage(0); }} className="scale-75" />
            <span className="text-[11px] text-muted-foreground">Remote</span>
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
              Clear filters
            </Button>
          )}
        </div>

        {/* Split pane */}
        <div className="flex gap-4" style={{ height: "calc(100vh - 260px)" }}>
          {/* Job list */}
          <div className={`flex flex-col ${selectedId ? "w-[380px] shrink-0" : "w-full max-w-2xl"} transition-all duration-200`}>
            {isLoading ? (
              <div className="space-y-2 p-1">
                {[...Array(8)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-md bg-muted/50" />)}
              </div>
            ) : jobs.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No jobs found.</p>
            ) : (
              <>
                <ScrollArea className="flex-1" ref={listRef}>
                  <div className="space-y-px pr-2">
                    {jobs.map((job, idx) => {
                      const isSelected = job.id === selectedId;
                      const tags = tagsByJobId[job.id] ?? [];
                      return (
                        <div
                          key={job.id}
                          data-job-item
                          onClick={() => { setSelectedId(job.id); setSelectedIdx(idx); }}
                          className={`cursor-pointer rounded-md px-3 py-2.5 transition-colors ${
                            isSelected ? "bg-primary/5" : "hover:bg-muted/40"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm font-medium leading-snug line-clamp-1">{job.headline}</h3>
                            {job.remote_flag && (
                              <Badge variant="secondary" className="shrink-0 text-[9px] h-4 px-1 font-normal">Remote</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{job.employer_name}</p>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                            {job.municipality && <span>{job.municipality}</span>}
                            {job.lang && <span>{job.lang.toUpperCase()}</span>}
                            {job.published_at && <span>{new Date(job.published_at).toLocaleDateString("sv-SE")}</span>}
                          </div>
                          {/* Skill tags */}
                          {tags.length > 0 && (
                            <div className="mt-1.5 flex items-center gap-1">
                              {tags.slice(0, 3).map((tag) => (
                                <Badge key={tag} variant="outline" className="text-[9px] font-normal h-4 px-1.5">{tag}</Badge>
                              ))}
                              {tags.length > 3 && (
                                <span className="text-[9px] text-muted-foreground">…</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-3 mt-2">
                    <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)} className="h-7 w-7 p-0">
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="font-mono text-[11px] text-muted-foreground">{page + 1}/{totalPages}</span>
                    <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} className="h-7 w-7 p-0">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Detail panel */}
          <AnimatePresence>
            {selectedId && detail && (
              <motion.div
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
                className="flex-1 overflow-hidden rounded-lg border border-border/40 bg-card"
              >
                <ScrollArea className="h-full">
                  <div className="p-5 space-y-5">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold leading-tight">{detail.headline}</h2>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {detail.employer_name && (
                            <span className="flex items-center gap-1"><Building className="h-3 w-3" /> {detail.employer_name}</span>
                          )}
                          {detail.municipality && (
                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {detail.municipality}</span>
                          )}
                          {detail.lang && <span>{detail.lang.toUpperCase()}</span>}
                          {detail.published_at && <span>{new Date(detail.published_at).toLocaleDateString("sv-SE")}</span>}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setSelectedId(null); setSelectedIdx(-1); }}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Quick actions */}
                    <div className="flex flex-wrap gap-2">
                      {detail.source_url && (
                        <a href={detail.source_url} target="_blank" rel="noopener noreferrer">
                          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
                            <ExternalLink className="h-3 w-3" /> Apply
                          </Button>
                        </a>
                      )}
                      {user && detail.employer_name && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-xs h-8 text-muted-foreground"
                          onClick={() => watchCompany.mutate(detail.employer_name!)}
                        >
                          <Star className="h-3 w-3" /> Watch {detail.employer_name}
                        </Button>
                      )}
                    </div>

                    {/* Badges */}
                    <div className="flex flex-wrap gap-1.5">
                      {detail.remote_flag && <Badge>Remote</Badge>}
                      {detail.employment_type && <Badge variant="outline" className="text-[10px] font-normal">{detail.employment_type}</Badge>}
                      {detail.working_hours && <Badge variant="outline" className="text-[10px] font-normal">{detail.working_hours}</Badge>}
                      {detail.application_deadline && (
                        <Badge variant="outline" className="text-[10px] font-mono font-normal">
                          Due {detail.application_deadline.slice(0, 10)}
                        </Badge>
                      )}
                    </div>

                    {/* Why this matches */}
                    {user && detailTags && detailTags.length > 0 && userSkills && userSkills.size > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <TrendingUp className="h-3 w-3" /> Skill match
                        </h3>
                        <div className="flex flex-wrap gap-1">
                          {matchingTags.map((tag) => (
                            <Badge key={tag} className="text-[10px] font-normal bg-primary/10 text-primary border-primary/20">{tag}</Badge>
                          ))}
                          {missingTags.slice(0, 6).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[10px] font-normal text-muted-foreground">{tag}</Badge>
                          ))}
                        </div>
                        {matchingTags.length > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            {matchingTags.length} of {detailTags.length} skills match your profile
                          </p>
                        )}
                      </div>
                    )}

                    {/* Skills (when not logged in or no user skills) */}
                    {detailTags && detailTags.length > 0 && (!user || !userSkills || userSkills.size === 0) && (
                      <div>
                        <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Skills</h3>
                        <div className="flex flex-wrap gap-1">
                          {detailTags.map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[10px] font-normal">{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tracking — moved ABOVE description */}
                    {user && (
                      <div className="border-t border-border/40 pt-4 space-y-3">
                        <h3 className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          <Bookmark className="h-3 w-3" /> Track
                        </h3>
                        <div className="flex items-center gap-2">
                          <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => upsertTracking.mutate({ status, notes })}
                            disabled={upsertTracking.isPending}
                          >
                            {tracking ? "Update" : "Save"}
                          </Button>
                        </div>
                        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes..." rows={2} className="text-xs" />
                      </div>
                    )}

                    {/* Description — last */}
                    <div>
                      <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Description</h3>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {detail.description || "No description available."}
                      </p>
                    </div>
                  </div>
                </ScrollArea>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </AppLayout>
  );
}
