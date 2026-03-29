import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SendEmailRequest = {
  recruiter_id: string;
  template_id: string | null;
  subject: string;
  body: string;
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const smtpEnabled = String(Deno.env.get("OUTREACH_SMTP_ENABLED") ?? "false").toLowerCase() === "true";
  if (!smtpEnabled) {
    return jsonResponse({ error: "SMTP sending is disabled." }, 503);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return jsonResponse({ error: "Server configuration is incomplete." }, 500);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing authorization header." }, 401);
  }
  const accessToken = authHeader.replace("Bearer ", "").trim();

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  let payload: SendEmailRequest;
  try {
    payload = (await request.json()) as SendEmailRequest;
  } catch (_error) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const recruiterId = String(payload.recruiter_id ?? "").trim();
  const templateId = payload.template_id ? String(payload.template_id).trim() : null;
  const subject = String(payload.subject ?? "").trim();
  const body = String(payload.body ?? "").trim();

  if (!recruiterId || !subject || !body) {
    return jsonResponse({ error: "Recruiter, subject, and body are required." }, 400);
  }

  const dbClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: recruiter, error: recruiterError } = await dbClient
    .from("recruiters")
    .select("id, user_id, name, email, company")
    .eq("id", recruiterId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (recruiterError || !recruiter) {
    return jsonResponse({ error: "Recruiter not found." }, 404);
  }
  if (!recruiter.email) {
    return jsonResponse({ error: "Recruiter has no email." }, 400);
  }

  const { data: emailConfig, error: configError } = await dbClient
    .from("email_config")
    .select("user_id, gmail_email, gmail_app_password")
    .eq("user_id", user.id)
    .maybeSingle();
  if (configError || !emailConfig) {
    return jsonResponse({ error: "Gmail configuration not found." }, 400);
  }
  if (!emailConfig.gmail_email || !emailConfig.gmail_app_password) {
    return jsonResponse({ error: "Gmail configuration is incomplete." }, 400);
  }

  const { data: logEntry, error: logError } = await dbClient
    .from("email_logs")
    .insert({
      user_id: user.id,
      recruiter_id: recruiter.id,
      template_id: templateId,
      subject,
      body,
      status: "pending",
    })
    .select("id")
    .single();
  if (logError || !logEntry) {
    return jsonResponse({ error: "Could not create email log." }, 500);
  }

  const trackingPixelUrl = `${supabaseUrl}/functions/v1/track-pixel?id=${encodeURIComponent(logEntry.id)}`;
  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #101828;">
      ${escapeHtml(body).replaceAll("\n", "<br>")}
    </div>
    <img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />
  `;

  const smtpClient = new SmtpClient();
  try {
    await smtpClient.connectTLS({
      hostname: "smtp.gmail.com",
      port: 465,
      username: emailConfig.gmail_email,
      password: emailConfig.gmail_app_password,
    });

    await smtpClient.send({
      from: emailConfig.gmail_email,
      to: recruiter.email,
      subject,
      content: body,
      html: htmlBody,
    });
  } catch (error) {
    await dbClient
      .from("email_logs")
      .update({
        status: "failed",
        error_message: String(error instanceof Error ? error.message : "SMTP send failed"),
      })
      .eq("id", logEntry.id);
    return jsonResponse({ error: "Failed to send email." }, 500);
  } finally {
    await smtpClient.close().catch(() => undefined);
  }

  await dbClient
    .from("email_logs")
    .update({
      status: "sent",
      error_message: null,
      sent_at: new Date().toISOString(),
    })
    .eq("id", logEntry.id);

  return jsonResponse({ success: true, log_id: logEntry.id }, 200);
});
