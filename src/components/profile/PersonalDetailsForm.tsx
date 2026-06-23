import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errors";
import {
  getUserProfile,
  normalizeUserProfileInput,
  suggestProfileFieldsFromResumeText,
  upsertUserProfile,
  type UserProfileInput,
  type UserProfileRow,
} from "@/lib/profile";
import type { ResumeVersionRow } from "@/lib/resumes";

type PersonalDetailsFormProps = {
  userId: string;
  defaultResume?: ResumeVersionRow | null;
};

function toFormState(profile: UserProfileRow | null | undefined): UserProfileInput {
  return {
    first_name: profile?.first_name ?? "",
    last_name: profile?.last_name ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    headline: profile?.headline ?? "",
    location: profile?.location ?? "",
    linkedin_url: profile?.linkedin_url ?? "",
    portfolio_url: profile?.portfolio_url ?? "",
    about_me: profile?.about_me ?? "",
  };
}

export function PersonalDetailsForm({ userId, defaultResume }: PersonalDetailsFormProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<UserProfileInput>(toFormState(null));

  const profileQuery = useQuery({
    queryKey: ["user-profile", userId],
    queryFn: () => getUserProfile(supabase, userId),
  });

  useEffect(() => {
    if (profileQuery.data) {
      setForm(toFormState(profileQuery.data));
    }
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => upsertUserProfile(supabase, userId, form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["user-profile", userId] });
      toast({ title: "Profile saved", description: "Your apply-assist details are updated." });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not save profile", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const applyResumeSuggestions = () => {
    const suggestions = suggestProfileFieldsFromResumeText(defaultResume?.parsed_text);
    if (Object.keys(suggestions).length === 0) {
      toast({
        title: "No suggestions found",
        description: "Upload a resume with extractable text first.",
        variant: "destructive",
      });
      return;
    }

    setForm((current) => ({ ...current, ...suggestions }));
    toast({ title: "Suggestions applied", description: "Review and save when ready." });
  };

  const normalized = normalizeUserProfileInput(form);

  return (
    <Card className="border-border/40 bg-card/60">
      <CardHeader className="gap-2 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <CardTitle>Personal details</CardTitle>
          <CardDescription>
            Used for cover letters and extension form fill. Split names help ATS forms.
          </CardDescription>
        </div>
        {defaultResume ? (
          <Button type="button" variant="outline" size="sm" onClick={applyResumeSuggestions}>
            Prefill from résumé
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="profile-first-name">First name</Label>
            <Input
              id="profile-first-name"
              value={form.first_name ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-last-name">Last name</Label>
            <Input
              id="profile-last-name"
              value={form.last_name ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input
              id="profile-email"
              type="email"
              value={form.email ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-phone">Phone</Label>
            <Input
              id="profile-phone"
              value={form.phone ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="profile-headline">Headline</Label>
            <Input
              id="profile-headline"
              value={form.headline ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, headline: event.target.value }))}
              placeholder="Junior software engineer"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-location">Location</Label>
            <Input
              id="profile-location"
              value={form.location ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
              placeholder="Stockholm, Sweden"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="profile-linkedin">LinkedIn URL</Label>
            <Input
              id="profile-linkedin"
              value={form.linkedin_url ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, linkedin_url: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-portfolio">Portfolio URL</Label>
            <Input
              id="profile-portfolio"
              value={form.portfolio_url ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, portfolio_url: event.target.value }))}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="profile-about">About you</Label>
          <Textarea
            id="profile-about"
            rows={4}
            value={form.about_me ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, about_me: event.target.value }))}
            placeholder="Two or three sentences on your background and what you're looking for."
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Saved as {normalized.full_name || "unnamed profile"}
          </p>
          <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            Save profile
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
