import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Search, Clock, Bell, BellOff, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useInAppAlerts } from "@/hooks/useInAppAlerts";

export default function SavedSearches() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [englishOnly, setEnglishOnly] = useState(false);
  const [lens, setLens] = useState<"high_signal" | "broad" | "graduate_trainee">("high_signal");
  const [includeJobtechInHighSignal, setIncludeJobtechInHighSignal] = useState(false);

  const resetDialogState = () => {
    setName("");
    setKeywords("");
    setRemoteOnly(false);
    setEnglishOnly(false);
    setLens("high_signal");
    setIncludeJobtechInHighSignal(false);
  };

  useEffect(() => {
    document.title = "Saved Searches | SweJobs";
  }, []);

  const { data: searches } = useQuery({
    queryKey: ["saved-searches", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("saved_searches")
        .select(
          "id, user_id, name, keywords, regions, remote_only, english_only, last_checked_at, created_at, updated_at, " +
            "alerts_enabled, alert_frequency, alert_last_sent_at, lens, include_jobtech_in_high_signal",
        )
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Count new matches per search
  const { data: matchCounts } = useQuery({
    queryKey: ["search-match-counts", searches?.map((s) => `${s.id}:${s.last_checked_at ?? s.created_at}`).join("|")],
    enabled: !!searches && searches.length > 0,
    queryFn: async () => {
      if (!searches || searches.length === 0) {
        return {} as Record<number, number>;
      }

      const cutoffTimes = searches
        .map((search) => Date.parse(search.last_checked_at ?? search.created_at ?? ""))
        .filter((value) => Number.isFinite(value));

      const minCutoff = cutoffTimes.length > 0
        ? new Date(Math.min(...cutoffTimes)).toISOString()
        : new Date(0).toISOString();

      const { data: jobs, error } = await supabase
        .from("jobs")
        .select("id, headline, published_at, remote_flag, lang")
        .eq("is_active", true)
        .eq("is_target_role", true)
        .gte("published_at", minCutoff);

      if (error) throw error;

      const counts: Record<number, number> = {};
      const normalizedSearches = searches.map((search) => ({
        ...search,
        cutoff: Date.parse(search.last_checked_at ?? search.created_at ?? ""),
        keywords: (search.keywords ?? [])
          .map((keyword) => keyword.trim().toLowerCase())
          .filter(Boolean),
      }));

      for (const search of normalizedSearches) {
        counts[search.id] = 0;
      }

      for (const job of jobs ?? []) {
        const publishedAt = Date.parse(job.published_at ?? "");
        if (!Number.isFinite(publishedAt)) continue;
        const headline = (job.headline ?? "").toLowerCase();

        for (const search of normalizedSearches) {
          if (Number.isFinite(search.cutoff) && publishedAt <= search.cutoff) continue;
          if (search.remote_only && !job.remote_flag) continue;
          if (search.english_only && job.lang !== "en") continue;
          if (search.keywords.length > 0 && !search.keywords.some((keyword) => headline.includes(keyword))) continue;
          counts[search.id] += 1;
        }
      }

      return counts;
    },
  });

  const { alerts: inAppAlerts, unreadCount: unreadAlerts, markAlertRead } = useInAppAlerts(user?.id);

  const createSearch = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("saved_searches").insert({
        user_id: user!.id,
        name,
        keywords: keywords ? keywords.split(",").map((k) => k.trim()) : [],
        remote_only: remoteOnly,
        english_only: englishOnly,
        alerts_enabled: true,
        lens,
        include_jobtech_in_high_signal: includeJobtechInHighSignal,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches", user?.id] });
      setOpen(false);
      resetDialogState();
      toast({ title: "Search saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteSearch = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("saved_searches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches", user?.id] });
      toast({ title: "Deleted" });
    },
  });

  const updateSearchSettings = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: number;
      patch: {
        alerts_enabled?: boolean;
        alert_frequency?: "daily" | "weekly";
        lens?: "high_signal" | "broad" | "graduate_trainee";
        include_jobtech_in_high_signal?: boolean;
      };
    }) => {
      const { error } = await supabase.from("saved_searches").update(patch).eq("id", id).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches", user?.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  const markChecked = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase
        .from("saved_searches")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches", user?.id] });
      qc.invalidateQueries({ queryKey: ["search-match-counts"] });
    },
  });

  if (!loading && !user) return <Navigate to="/auth" replace />;

  const runSearch = (search: {
    keywords: string[] | null;
    remote_only: boolean | null;
    english_only: boolean | null;
    lens: "high_signal" | "broad" | "graduate_trainee" | null;
    include_jobtech_in_high_signal: boolean | null;
  }) => {
    const params = new URLSearchParams();
    const query = (search.keywords ?? []).join(" ").trim();
    if (query) params.set("search", query);
    if (search.remote_only) params.set("remote", "1");
    if (search.english_only) params.set("lang", "en");
    if (search.lens) params.set("lens", search.lens);
    if (search.include_jobtech_in_high_signal) params.set("jobtech", "1");
    navigate(`/jobs${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const alertsEnabledOnAnySearch = (searches ?? []).some((search) => search.alerts_enabled);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-2xl font-bold tracking-tight">Saved Searches</h1>
            <p className="text-sm text-muted-foreground">
              Get notified about new matches
              {unreadAlerts > 0 ? ` · ${unreadAlerts} unread alerts` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Dialog
              open={open}
              onOpenChange={(nextOpen) => {
                setOpen(nextOpen);
                if (!nextOpen) resetDialogState();
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" /> New search
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create saved search</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <Input placeholder="Name (e.g. Data Eng Stockholm)" value={name} onChange={(e) => setName(e.target.value)} />
                  <Input placeholder="Keywords (comma-separated)" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
                  <div className="space-y-1.5">
                    <span className="text-xs text-muted-foreground">Lens</span>
                    <Select value={lens} onValueChange={(value) => setLens(value as "high_signal" | "broad" | "graduate_trainee")}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high_signal">High Signal</SelectItem>
                        <SelectItem value="broad">Broad Discovery</SelectItem>
                        <SelectItem value="graduate_trainee">Graduate / Trainee</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Switch checked={remoteOnly} onCheckedChange={setRemoteOnly} />
                      <span className="text-sm">Remote only</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={englishOnly} onCheckedChange={setEnglishOnly} />
                      <span className="text-sm">English only</span>
                    </div>
                  </div>
                  {lens === "high_signal" && (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={includeJobtechInHighSignal}
                        onCheckedChange={setIncludeJobtechInHighSignal}
                      />
                      <span className="text-sm">Include JobTech pass-through</span>
                    </div>
                  )}
                  <Button className="w-full" onClick={() => createSearch.mutate()} disabled={!name || createSearch.isPending}>
                    Save
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {searches?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Search className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h2 className="text-lg font-medium">No saved searches yet</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm">
              Create a search to get notified when new jobs match your criteria
            </p>
            <Button size="sm" className="mt-5 gap-1.5" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> Create your first search
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {searches?.map((s) => {
              const newCount = matchCounts?.[s.id] ?? 0;
              return (
                <Card key={s.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <Search className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{s.name}</h3>
                        {newCount > 0 && (
                          <Badge className="text-xs">{newCount} matching</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {s.keywords?.map((kw) => (
                          <Badge key={kw} variant="outline" className="text-xs">{kw}</Badge>
                        ))}
                        {s.remote_only && <Badge variant="outline" className="text-xs">Remote</Badge>}
                        {s.english_only && <Badge variant="outline" className="text-xs">EN</Badge>}
                        <Badge variant="outline" className="text-xs">
                          {s.lens === "graduate_trainee"
                            ? "Graduate"
                            : s.lens === "broad"
                              ? "Broad"
                              : "High Signal"}
                        </Badge>
                        {s.alerts_enabled ? (
                          <Badge variant="outline" className="text-xs">
                            Alerts {s.alert_frequency === "weekly" ? "weekly" : "daily"}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            Alerts off
                          </Badge>
                        )}
                        {s.include_jobtech_in_high_signal && (
                          <Badge variant="outline" className="text-xs">JobTech pass-through</Badge>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Checked {s.last_checked_at ? new Date(s.last_checked_at).toLocaleDateString("en-SE") : "never"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1">
                      {s.alerts_enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                      <Switch
                        checked={s.alerts_enabled ?? false}
                        onCheckedChange={(checked) =>
                          updateSearchSettings.mutate({ id: s.id, patch: { alerts_enabled: checked } })
                        }
                      />
                      <Select
                        value={s.alert_frequency ?? "daily"}
                        onValueChange={(value) =>
                          updateSearchSettings.mutate({ id: s.id, patch: { alert_frequency: value as "daily" | "weekly" } })
                        }
                      >
                        <SelectTrigger className="h-7 w-20 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Select
                      value={s.lens ?? "high_signal"}
                      onValueChange={(value) =>
                        updateSearchSettings.mutate({
                          id: s.id,
                          patch: { lens: value as "high_signal" | "broad" | "graduate_trainee" },
                        })
                      }
                    >
                      <SelectTrigger className="h-7 w-36 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high_signal">High Signal</SelectItem>
                        <SelectItem value="broad">Broad</SelectItem>
                        <SelectItem value="graduate_trainee">Graduate</SelectItem>
                      </SelectContent>
                    </Select>
                    {(s.lens ?? "high_signal") === "high_signal" && (
                      <Button
                        variant={s.include_jobtech_in_high_signal ? "secondary" : "outline"}
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() =>
                          updateSearchSettings.mutate({
                            id: s.id,
                            patch: { include_jobtech_in_high_signal: !s.include_jobtech_in_high_signal },
                          })
                        }
                      >
                        JobTech {s.include_jobtech_in_high_signal ? "On" : "Off"}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runSearch(s)}
                    >
                      Run search
                    </Button>
                    {newCount > 0 && (
                      <Button variant="outline" size="sm" onClick={() => markChecked.mutate(s.id)}>
                        Mark seen
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (!window.confirm(`Delete saved search "${s.name}"?`)) return;
                        deleteSearch.mutate(s.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">In-app Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(inAppAlerts ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {alertsEnabledOnAnySearch
                  ? "No alert notifications yet — we check daily when new matches appear."
                  : "Turn on alerts on a saved search to get notified here."}
              </p>
            ) : (
              (inAppAlerts ?? []).map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{alert.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{alert.body}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(alert.created_at).toLocaleString("sv-SE")}
                      {alert.read_at ? " · Read" : " · Unread"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {alert.jobs?.source_url && (
                      <a href={alert.jobs.source_url} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]">
                          <ExternalLink className="h-3 w-3" /> Open
                        </Button>
                      </a>
                    )}
                    {!alert.read_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => markAlertRead.mutate(alert.id)}
                      >
                        Mark read
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
