import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle,
  Clock,
  Copy,
  Eye,
  Mail,
  Pencil,
  Plus,
  Send,
  Settings2,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";

import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { parseCsvText } from "@/lib/csv";

type Recruiter = Tables<"recruiters">;
type EmailTemplate = Tables<"email_templates">;
type EmailConfig = Tables<"email_config">;
type EmailLog = Tables<"email_logs"> & {
  recruiters: Pick<Recruiter, "name" | "email" | "company"> | null;
};

type RecruiterFormState = {
  name: string;
  email: string;
  company: string;
  title: string;
  linkedin_url: string;
  notes: string;
};

type TemplateFormState = {
  name: string;
  subject: string;
  body: string;
};

const PREVIEW_RECRUITER: Recruiter = {
  id: "preview",
  user_id: "preview",
  name: "Jane Recruiter",
  email: "jane@example.com",
  company: "Example Corp",
  title: "Recruiter",
  linkedin_url: "",
  notes: "",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function emptyRecruiterForm(): RecruiterFormState {
  return {
    name: "",
    email: "",
    company: "",
    title: "",
    linkedin_url: "",
    notes: "",
  };
}

function emptyTemplateForm(): TemplateFormState {
  return {
    name: "",
    subject: "",
    body: "",
  };
}

function recruiterToForm(recruiter: Recruiter): RecruiterFormState {
  return {
    name: recruiter.name,
    email: recruiter.email ?? "",
    company: recruiter.company ?? "",
    title: recruiter.title ?? "",
    linkedin_url: recruiter.linkedin_url ?? "",
    notes: recruiter.notes ?? "",
  };
}

function templateToForm(template: EmailTemplate): TemplateFormState {
  return {
    name: template.name,
    subject: template.subject,
    body: template.body,
  };
}

function fillPlaceholders(template: string, recruiter: Recruiter) {
  const firstName = recruiter.name.trim().split(/\s+/)[0] ?? recruiter.name;
  return template
    .replaceAll("{{name}}", recruiter.name)
    .replaceAll("{{firstName}}", firstName)
    .replaceAll("{{company}}", recruiter.company ?? "")
    .replaceAll("{{title}}", recruiter.title ?? "");
}

export default function Outreach() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState("recruiters");
  const [search, setSearch] = useState("");
  const [recruiterDialogOpen, setRecruiterDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingRecruiter, setEditingRecruiter] = useState<Recruiter | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [recruiterForm, setRecruiterForm] = useState<RecruiterFormState>(emptyRecruiterForm);
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(emptyTemplateForm);
  const [selectedRecruiterIds, setSelectedRecruiterIds] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("manual");
  const [manualCompose, setManualCompose] = useState({ subject: "", body: "" });
  const [gmailEmail, setGmailEmail] = useState("");
  const [gmailAppPassword, setGmailAppPassword] = useState("");
  const [sendingRecruiterId, setSendingRecruiterId] = useState<string | null>(null);
  const smtpEnabled = import.meta.env.VITE_OUTREACH_SMTP_ENABLED === "true";

  const debouncedSearch = useDebouncedValue(search, 250).trim().toLowerCase();

  useEffect(() => {
    document.title = "Outreach | SweJobs";
  }, []);

  const recruitersQuery = useQuery({
    queryKey: ["recruiters", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recruiters")
        .select("id, user_id, name, email, company, title, linkedin_url, notes, created_at, updated_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const templatesQuery = useQuery({
    queryKey: ["email-templates", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("id, user_id, name, subject, body, created_at, updated_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const gmailConfigQuery = useQuery({
    queryKey: ["email-config", user?.id],
    enabled: !!user && smtpEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_config")
        .select("user_id, gmail_email, gmail_app_password, created_at, updated_at")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as EmailConfig | null;
    },
  });

  const emailLogsQuery = useQuery({
    queryKey: ["email-logs", user?.id],
    enabled: !!user && smtpEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_logs")
        .select(
          "id, user_id, recruiter_id, template_id, subject, body, status, error_message, sent_at, opened_at, " +
            "open_count, created_at, updated_at, recruiters(name, email, company)",
        )
        .eq("user_id", user!.id)
        .order("sent_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as EmailLog[];
    },
  });

  useEffect(() => {
    if (!gmailConfigQuery.data) return;
    setGmailEmail(gmailConfigQuery.data.gmail_email ?? "");
    setGmailAppPassword("");
  }, [gmailConfigQuery.data]);

  const filteredRecruiters = useMemo(() => {
    return (recruitersQuery.data ?? []).filter((recruiter) => {
      if (!debouncedSearch) return true;
      const haystack = [recruiter.name, recruiter.email ?? "", recruiter.company ?? "", recruiter.title ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(debouncedSearch);
    });
  }, [debouncedSearch, recruitersQuery.data]);

  const selectedTemplate = useMemo(() => {
    if (selectedTemplateId === "manual") return null;
    return (templatesQuery.data ?? []).find((template) => template.id === selectedTemplateId) ?? null;
  }, [selectedTemplateId, templatesQuery.data]);

  const selectedRecruiters = useMemo(
    () => (recruitersQuery.data ?? []).filter((recruiter) => selectedRecruiterIds.includes(recruiter.id)),
    [recruitersQuery.data, selectedRecruiterIds],
  );

  const recruiterMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in required");
      if (!recruiterForm.name.trim()) throw new Error("Name is required");
      const payload = {
        user_id: user.id,
        name: recruiterForm.name.trim(),
        email: recruiterForm.email.trim() || null,
        company: recruiterForm.company.trim(),
        title: recruiterForm.title.trim(),
        linkedin_url: recruiterForm.linkedin_url.trim(),
        notes: recruiterForm.notes.trim(),
      };

      if (editingRecruiter) {
        const { error } = await supabase.from("recruiters").update(payload).eq("id", editingRecruiter.id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("recruiters").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recruiters", user?.id] });
      setRecruiterDialogOpen(false);
      setEditingRecruiter(null);
      setRecruiterForm(emptyRecruiterForm());
      toast({ title: editingRecruiter ? "Recruiter updated" : "Recruiter added" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not save recruiter", description: error.message, variant: "destructive" });
    },
  });

  const templateMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in required");
      if (!templateForm.name.trim()) throw new Error("Template name is required");
      const payload = {
        user_id: user.id,
        name: templateForm.name.trim(),
        subject: templateForm.subject,
        body: templateForm.body,
      };

      if (editingTemplate) {
        const { error } = await supabase.from("email_templates").update(payload).eq("id", editingTemplate.id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("email_templates").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["email-templates", user?.id] });
      setTemplateDialogOpen(false);
      setEditingTemplate(null);
      setTemplateForm(emptyTemplateForm());
      toast({ title: editingTemplate ? "Template updated" : "Template added" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not save template", description: error.message, variant: "destructive" });
    },
  });

  const deleteRecruiterMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recruiters").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recruiters", user?.id] });
      toast({ title: "Recruiter deleted" });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("email_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["email-templates", user?.id] });
      toast({ title: "Template deleted" });
    },
  });

  const saveGmailConfigMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in required");
      if (!smtpEnabled) throw new Error("SMTP sending is disabled.");
      const nextEmail = gmailEmail.trim();
      const nextPassword = gmailAppPassword.trim();
      const existing = gmailConfigQuery.data;

      if (!nextEmail) throw new Error("Gmail address is required.");
      if (!existing && !nextPassword) {
        throw new Error("App password is required for initial setup.");
      }

      const payload: Partial<EmailConfig> & { user_id: string; gmail_email: string } = {
        user_id: user.id,
        gmail_email: nextEmail,
      };
      if (nextPassword) {
        payload.gmail_app_password = nextPassword;
      }

      const { error } = await supabase.from("email_config").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["email-config", user?.id] });
      setGmailAppPassword("");
      toast({ title: "Gmail config saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not save Gmail config", description: error.message, variant: "destructive" });
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async (values: {
      recruiterId: string;
      templateId: string | null;
      subject: string;
      body: string;
    }) => {
      if (!smtpEnabled) throw new Error("SMTP sending is disabled.");
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        throw new Error("Not authenticated.");
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error("Missing VITE_SUPABASE_URL.");
      }
      const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          recruiter_id: values.recruiterId,
          template_id: values.templateId,
          subject: values.subject,
          body: values.body,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error ?? "Send failed"));
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["email-logs", user?.id] });
      toast({ title: "Email sent" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not send email", description: error.message, variant: "destructive" });
    },
  });

  if (!loading && !user) return <Navigate to="/auth" replace />;

  const activeSubject = selectedTemplate ? selectedTemplate.subject : manualCompose.subject;
  const activeBody = selectedTemplate ? selectedTemplate.body : manualCompose.body;

  const openRecruiterDialog = (recruiter?: Recruiter) => {
    setEditingRecruiter(recruiter ?? null);
    setRecruiterForm(recruiter ? recruiterToForm(recruiter) : emptyRecruiterForm());
    setRecruiterDialogOpen(true);
  };

  const openTemplateDialog = (template?: EmailTemplate) => {
    setEditingTemplate(template ?? null);
    setTemplateForm(template ? templateToForm(template) : emptyTemplateForm());
    setTemplateDialogOpen(true);
  };

  const toggleRecruiterSelection = (id: string) => {
    setSelectedRecruiterIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch (error) {
      toast({
        title: `Could not copy ${label.toLowerCase()}`,
        description: error instanceof Error ? error.message : "Clipboard unavailable",
        variant: "destructive",
      });
    }
  };

  const sendRecruiterEmail = async (recruiter: Recruiter, subject: string, body: string) => {
    if (!smtpEnabled) return;
    setSendingRecruiterId(recruiter.id);
    try {
      await sendEmailMutation.mutateAsync({
        recruiterId: recruiter.id,
        templateId: selectedTemplate?.id ?? null,
        subject,
        body,
      });
    } finally {
      setSendingRecruiterId(null);
    }
  };

  const handleCsvImport = async (file: File) => {
    if (!user) return;
    const text = await file.text();
    const rows = parseCsvText(text);
    if (rows.length < 2) {
      toast({ title: "No rows found", variant: "destructive" });
      return;
    }

    const headers = rows[0].map((value) => value.trim().toLowerCase());
    const indexOf = (name: string) => headers.indexOf(name.toLowerCase());
    const nameIndex = indexOf("name");
    const emailIndex = indexOf("email");
    const companyIndex = indexOf("company");
    const titleIndex = indexOf("title");
    const linkedInIndex = indexOf("linkedin");
    const notesIndex = indexOf("notes");

    if (nameIndex < 0) {
      toast({ title: "Missing Name column", variant: "destructive" });
      return;
    }

    const existingEmails = new Set(
      (recruitersQuery.data ?? [])
        .map((recruiter) => recruiter.email?.toLowerCase())
        .filter(Boolean),
    );

    const inserts = rows.slice(1).flatMap((row) => {
      const name = row[nameIndex]?.trim() ?? "";
      const email = emailIndex >= 0 ? row[emailIndex]?.trim() ?? "" : "";
      if (!name) return [];
      if (email && existingEmails.has(email.toLowerCase())) return [];
      if (email) existingEmails.add(email.toLowerCase());
      return [
        {
          user_id: user.id,
          name,
          email: email || null,
          company: companyIndex >= 0 ? row[companyIndex]?.trim() ?? "" : "",
          title: titleIndex >= 0 ? row[titleIndex]?.trim() ?? "" : "",
          linkedin_url: linkedInIndex >= 0 ? row[linkedInIndex]?.trim() ?? "" : "",
          notes: notesIndex >= 0 ? row[notesIndex]?.trim() ?? "" : "",
        },
      ];
    });

    if (inserts.length === 0) {
      toast({ title: "No new recruiters to import" });
      return;
    }

    const { error } = await supabase.from("recruiters").insert(inserts);
    if (error) {
      toast({ title: "Could not import recruiters", description: error.message, variant: "destructive" });
      return;
    }

    void qc.invalidateQueries({ queryKey: ["recruiters", user.id] });
    toast({ title: `Imported ${inserts.length} recruiters` });
  };

  const composePreviewCards = selectedRecruiters.map((recruiter) => {
    const subject = fillPlaceholders(activeSubject, recruiter);
    const body = fillPlaceholders(activeBody, recruiter);
    const mailto = `mailto:${encodeURIComponent(recruiter.email ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return { recruiter, subject, body, mailto };
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Outreach</h1>
          <p className="text-sm text-muted-foreground">
            Organize recruiter contacts, keep reusable templates, and generate personalized drafts with optional in-app sending.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="recruiters">Recruiters</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="compose">Compose</TabsTrigger>
            {smtpEnabled ? (
              <>
                <TabsTrigger value="history">Send History</TabsTrigger>
                <TabsTrigger value="settings">
                  <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                  Settings
                </TabsTrigger>
              </>
            ) : null}
          </TabsList>

          <TabsContent value="recruiters" className="space-y-4">
            <Card className="border-border/40 bg-card/60">
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-base">Recruiter contacts</CardTitle>
                  <p className="text-sm text-muted-foreground">Search, edit, and import the people you want to reach out to.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void handleCsvImport(file);
                      }
                      event.currentTarget.value = "";
                    }}
                  />
                  <Button variant="outline" className="gap-2" onClick={() => importInputRef.current?.click()}>
                    <Upload className="h-4 w-4" /> Import CSV
                  </Button>
                  <Button className="gap-2" onClick={() => openRecruiterDialog()}>
                    <Plus className="h-4 w-4" /> Add Recruiter
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name, company, email..."
                />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>LinkedIn</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRecruiters.length > 0 ? (
                      filteredRecruiters.map((recruiter) => (
                        <TableRow key={recruiter.id}>
                          <TableCell className="font-medium">{recruiter.name}</TableCell>
                          <TableCell>{recruiter.email || "—"}</TableCell>
                          <TableCell>{recruiter.company || "—"}</TableCell>
                          <TableCell>{recruiter.title || "—"}</TableCell>
                          <TableCell className="max-w-[180px] truncate">
                            {recruiter.linkedin_url ? (
                              <a href={recruiter.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                {recruiter.linkedin_url}
                              </a>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate">{recruiter.notes || "—"}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={() => openRecruiterDialog(recruiter)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => deleteRecruiterMutation.mutate(recruiter.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                          No recruiters yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="templates" className="space-y-4">
            <Card className="border-border/40 bg-card/60">
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-base">Email templates</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Use placeholders like <code>{"{{name}}"}</code>, <code>{"{{firstName}}"}</code>, <code>{"{{company}}"}</code>, and <code>{"{{title}}"}</code>.
                  </p>
                </div>
                <Button className="gap-2" onClick={() => openTemplateDialog()}>
                  <Plus className="h-4 w-4" /> Add Template
                </Button>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-[1fr,340px]">
                <div className="space-y-3">
                  {(templatesQuery.data ?? []).length > 0 ? (
                    (templatesQuery.data ?? []).map((template) => (
                      <div key={template.id} className="rounded-xl border border-border/50 bg-background/35 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="font-medium">{template.name}</p>
                            <p className="text-sm text-muted-foreground">Subject: {template.subject || "Untitled"}</p>
                            <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{template.body}</p>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => openTemplateDialog(template)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteTemplateMutation.mutate(template.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/60 bg-background/30 p-8 text-sm text-muted-foreground">
                      No templates yet.
                    </div>
                  )}
                </div>

                <Card className="border-border/40 bg-background/35">
                  <CardHeader>
                    <CardTitle className="text-base">Live preview</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {selectedTemplate ? (
                      <>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Subject</p>
                          <p className="mt-1">{fillPlaceholders(selectedTemplate.subject, filteredRecruiters[0] ?? PREVIEW_RECRUITER)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Body</p>
                          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                            {fillPlaceholders(selectedTemplate.body, filteredRecruiters[0] ?? PREVIEW_RECRUITER)}
                          </p>
                        </div>
                      </>
                    ) : (
                      <p className="text-muted-foreground">Select a template from Compose to preview real placeholder output.</p>
                    )}
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="compose" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[340px,1fr]">
              <Card className="border-border/40 bg-card/60">
                <CardHeader>
                  <CardTitle className="text-base">Compose settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Template</Label>
                    <select
                      value={selectedTemplateId}
                      onChange={(event) => setSelectedTemplateId(event.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="manual">Manual draft</option>
                      {(templatesQuery.data ?? []).map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {!selectedTemplate ? (
                    <>
                      <div className="space-y-2">
                        <Label>Subject</Label>
                        <Input
                          value={manualCompose.subject}
                          onChange={(event) => setManualCompose((current) => ({ ...current, subject: event.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Body</Label>
                        <Textarea
                          value={manualCompose.body}
                          onChange={(event) => setManualCompose((current) => ({ ...current, body: event.target.value }))}
                          rows={8}
                        />
                      </div>
                    </>
                  ) : null}

                  <div className="space-y-2">
                    <Label>Recruiters</Label>
                    <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-lg border border-border/50 bg-background/30 p-3">
                      {(filteredRecruiters.length > 0 ? filteredRecruiters : recruitersQuery.data ?? []).map((recruiter) => (
                        <label key={recruiter.id} className="flex items-start gap-2">
                          <Checkbox
                            checked={selectedRecruiterIds.includes(recruiter.id)}
                            onCheckedChange={() => toggleRecruiterSelection(recruiter.id)}
                          />
                          <span className="space-y-0.5 text-sm">
                            <span className="block font-medium">{recruiter.name}</span>
                            <span className="block text-xs text-muted-foreground">
                              {[recruiter.company, recruiter.title, recruiter.email].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/40 bg-card/60">
                <CardHeader>
                  <CardTitle className="text-base">Personalized drafts</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {composePreviewCards.length > 0 ? (
                    composePreviewCards.map(({ recruiter, subject, body, mailto }) => (
                      <div key={recruiter.id} className="rounded-xl border border-border/50 bg-background/35 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{recruiter.name}</p>
                              {recruiter.company ? <Badge variant="secondary">{recruiter.company}</Badge> : null}
                            </div>
                            <p className="text-sm text-muted-foreground">{recruiter.email || "No email recorded"}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => void copyText(subject, "Subject")}>
                              <Copy className="mr-2 h-4 w-4" /> Copy subject
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => void copyText(body, "Body")}>
                              <Copy className="mr-2 h-4 w-4" /> Copy body
                            </Button>
                            {recruiter.email ? (
                              <>
                                <Button asChild size="sm" variant="outline">
                                  <a href={mailto}>
                                    <Mail className="mr-2 h-4 w-4" /> mailto
                                  </a>
                                </Button>
                                {smtpEnabled ? (
                                  gmailConfigQuery.data ? (
                                    <Button
                                      size="sm"
                                      className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                                      disabled={sendingRecruiterId === recruiter.id || sendEmailMutation.isPending}
                                      onClick={() => void sendRecruiterEmail(recruiter, subject, body)}
                                    >
                                      <Send className="h-4 w-4" />
                                      {sendingRecruiterId === recruiter.id ? "Sending..." : "Send email"}
                                    </Button>
                                  ) : (
                                    <Button size="sm" variant="outline" disabled>
                                      <Send className="mr-2 h-4 w-4" /> Configure Gmail first
                                    </Button>
                                  )
                                ) : null}
                              </>
                            ) : (
                              <Button size="sm" disabled>
                                <Mail className="mr-2 h-4 w-4" /> No email
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 space-y-3 text-sm">
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Subject</p>
                            <p className="mt-1">{subject}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Body</p>
                            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{body}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/60 bg-background/30 p-8 text-sm text-muted-foreground">
                      Select one or more recruiters to generate drafts.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {smtpEnabled ? (
            <TabsContent value="history" className="space-y-4">
              <Card className="border-border/40 bg-card/60">
                <CardHeader>
                  <CardTitle className="text-base">Send history</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Recruiter</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead>Opens</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(emailLogsQuery.data ?? []).length > 0 ? (
                        (emailLogsQuery.data ?? []).map((log) => (
                          <TableRow key={log.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{log.recruiters?.name ?? "Unknown"}</p>
                                <p className="text-xs text-muted-foreground">{log.recruiters?.email ?? ""}</p>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[260px] truncate">{log.subject}</TableCell>
                            <TableCell>
                              {log.status === "sent" ? (
                                <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                                  <CheckCircle className="h-3 w-3" /> Sent
                                </Badge>
                              ) : log.status === "failed" ? (
                                <Badge variant="destructive" className="gap-1">
                                  <XCircle className="h-3 w-3" /> Failed
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="gap-1">
                                  <Clock className="h-3 w-3" /> Pending
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(log.sent_at).toLocaleString("sv-SE")}
                            </TableCell>
                            <TableCell>
                              {log.open_count > 0 ? (
                                <div className="flex items-center gap-1.5">
                                  <Eye className="h-3.5 w-3.5 text-emerald-400" />
                                  <span className="text-sm font-medium text-emerald-400">{log.open_count}×</span>
                                  <span className="text-xs text-muted-foreground">
                                    {log.opened_at ? new Date(log.opened_at).toLocaleString("sv-SE") : ""}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">Not opened</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                            No emails sent yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          ) : null}

          {smtpEnabled ? (
            <TabsContent value="settings" className="space-y-4">
              <Card className="border-border/40 bg-card/60">
                <CardHeader>
                  <CardTitle className="text-base">Gmail SMTP</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Use a Google App Password (not your normal password). Generate one at{" "}
                    <a
                      href="https://myaccount.google.com/apppasswords"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      myaccount.google.com/apppasswords
                    </a>
                    .
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Gmail address</Label>
                      <Input
                        value={gmailEmail}
                        onChange={(event) => setGmailEmail(event.target.value)}
                        placeholder="you@gmail.com"
                        type="email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>App password</Label>
                      <Input
                        value={gmailAppPassword}
                        onChange={(event) => setGmailAppPassword(event.target.value)}
                        placeholder={gmailConfigQuery.data ? "••••••••••••••••" : "xxxx xxxx xxxx xxxx"}
                        type="password"
                      />
                    </div>
                  </div>

                  <Button
                    onClick={() => saveGmailConfigMutation.mutate()}
                    disabled={saveGmailConfigMutation.isPending || !gmailEmail.trim()}
                  >
                    {saveGmailConfigMutation.isPending
                      ? "Saving..."
                      : gmailConfigQuery.data
                        ? "Update config"
                        : "Save config"}
                  </Button>

                  {gmailConfigQuery.data ? (
                    <p className="text-xs text-emerald-400">Configured for {gmailConfigQuery.data.gmail_email}</p>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          ) : null}
        </Tabs>
      </div>

      <Dialog open={recruiterDialogOpen} onOpenChange={setRecruiterDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRecruiter ? "Edit recruiter" : "Add recruiter"}</DialogTitle>
            <DialogDescription>Keep contact details and notes for manual outreach.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={recruiterForm.name} onChange={(event) => setRecruiterForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input value={recruiterForm.email} onChange={(event) => setRecruiterForm((current) => ({ ...current, email: event.target.value }))} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>Company</Label>
                <Input value={recruiterForm.company} onChange={(event) => setRecruiterForm((current) => ({ ...current, company: event.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>Title</Label>
                <Input value={recruiterForm.title} onChange={(event) => setRecruiterForm((current) => ({ ...current, title: event.target.value }))} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>LinkedIn URL</Label>
              <Input
                value={recruiterForm.linkedin_url}
                onChange={(event) => setRecruiterForm((current) => ({ ...current, linkedin_url: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea value={recruiterForm.notes} onChange={(event) => setRecruiterForm((current) => ({ ...current, notes: event.target.value }))} rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecruiterDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => recruiterMutation.mutate()} disabled={recruiterMutation.isPending}>
              {editingRecruiter ? "Save changes" : "Add recruiter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit template" : "Add template"}</DialogTitle>
            <DialogDescription>Templates power both mailto drafts and optional in-app SMTP sending.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Subject</Label>
              <Input value={templateForm.subject} onChange={(event) => setTemplateForm((current) => ({ ...current, subject: event.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Body</Label>
              <Textarea value={templateForm.body} onChange={(event) => setTemplateForm((current) => ({ ...current, body: event.target.value }))} rows={10} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => templateMutation.mutate()} disabled={templateMutation.isPending}>
              {editingTemplate ? "Save changes" : "Add template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
