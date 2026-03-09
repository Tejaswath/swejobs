import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Search, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function SavedSearches() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [englishOnly, setEnglishOnly] = useState(false);

  const { data: searches } = useQuery({
    queryKey: ["saved-searches"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("saved_searches")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Count new matches per search
  const { data: matchCounts } = useQuery({
    queryKey: ["search-match-counts", searches?.map((s) => s.id)],
    enabled: !!searches && searches.length > 0,
    queryFn: async () => {
      const counts: Record<number, number> = {};
      for (const s of searches!) {
        let query = supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .eq("is_target_role", true)
          .gt("published_at", s.last_checked_at ?? s.created_at!);

        if (s.remote_only) query = query.eq("remote_flag", true);
        if (s.english_only) query = query.eq("lang", "en");
        if (s.keywords && s.keywords.length > 0) {
          const orClauses = s.keywords.map((kw) => `headline.ilike.%${kw}%`).join(",");
          query = query.or(orClauses);
        }

        const { count } = await query;
        counts[s.id] = count ?? 0;
      }
      return counts;
    },
  });

  const createSearch = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("saved_searches").insert({
        user_id: user!.id,
        name,
        keywords: keywords ? keywords.split(",").map((k) => k.trim()) : [],
        remote_only: remoteOnly,
        english_only: englishOnly,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches"] });
      setOpen(false);
      setName("");
      setKeywords("");
      setRemoteOnly(false);
      setEnglishOnly(false);
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
      qc.invalidateQueries({ queryKey: ["saved-searches"] });
      toast({ title: "Deleted" });
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
      qc.invalidateQueries({ queryKey: ["saved-searches"] });
      qc.invalidateQueries({ queryKey: ["search-match-counts"] });
    },
  });

  if (!loading && !user) return <Navigate to="/auth" replace />;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-2xl font-bold tracking-tight">Saved Searches</h1>
            <p className="text-sm text-muted-foreground">Get notified about new matches</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
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
                <Button className="w-full" onClick={() => createSearch.mutate()} disabled={!name || createSearch.isPending}>
                  Save
                </Button>
              </div>
            </DialogContent>
          </Dialog>
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
                          <Badge className="text-[10px]">{newCount} new</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {s.keywords?.map((kw) => (
                          <Badge key={kw} variant="outline" className="text-[10px]">{kw}</Badge>
                        ))}
                        {s.remote_only && <Badge variant="outline" className="text-[10px]">Remote</Badge>}
                        {s.english_only && <Badge variant="outline" className="text-[10px]">EN</Badge>}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Checked {s.last_checked_at ? new Date(s.last_checked_at).toLocaleDateString("sv-SE") : "never"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {newCount > 0 && (
                      <Button variant="outline" size="sm" onClick={() => markChecked.mutate(s.id)}>
                        Mark seen
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => deleteSearch.mutate(s.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
