import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

type SmtpConnectConfig = {
  hostname: string;
  port?: number;
  username?: string;
  password?: string;
};

type SmtpSendConfig = {
  from: string;
  to: string;
  subject: string;
  content: string;
  html?: string;
};

type SmtpCommand = {
  code: number;
  args: string;
};

class SmtpClient {
  private conn: Deno.Conn | null = null;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private incoming = "";

  async connectTLS(config: SmtpConnectConfig) {
    this.conn = await Deno.connectTls({
      hostname: config.hostname,
      port: config.port ?? 465,
    });

    this.assertCode(await this.readCommand(), 220);
    await this.writeCommand(`EHLO ${config.hostname}`);
    // Consume EHLO capabilities until last 250 line.
    while (true) {
      const cmd = await this.readCommand();
      if (!cmd || cmd.code !== 250) break;
      if (!cmd.args.startsWith("-")) break;
    }

    if (config.username && config.password) {
      await this.writeCommand("AUTH LOGIN");
      this.assertCode(await this.readCommand(), 334);

      await this.writeCommand(btoa(config.username));
      this.assertCode(await this.readCommand(), 334);

      await this.writeCommand(btoa(config.password));
      this.assertCode(await this.readCommand(), 235);
    }
  }

  async send(config: SmtpSendConfig) {
    const [fromEnvelope, fromHeader] = this.parseAddress(config.from);
    const [toEnvelope, toHeader] = this.parseAddress(config.to);

    await this.writeCommand(`MAIL FROM:${fromEnvelope}`);
    this.assertCode(await this.readCommand(), 250);

    await this.writeCommand(`RCPT TO:${toEnvelope}`);
    this.assertCode(await this.readCommand(), 250);

    await this.writeCommand("DATA");
    this.assertCode(await this.readCommand(), 354);

    const plainBody = (config.content || "").replaceAll("\r\n", "\n");
    const htmlBody = (config.html || "").replaceAll("\r\n", "\n");
    const boundary = "AlternativeBoundary";
    const message = [
      `Subject: ${config.subject}`,
      `From: ${fromHeader}`,
      `To: ${toHeader}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary=${boundary}`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "",
      plainBody,
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      "",
      htmlBody,
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    // SMTP dot-stuffing: any line starting with "." must be prefixed by another "."
    const safeMessage = message.replaceAll(/\r\n\./g, "\r\n..");
    await this.writeRaw(`${safeMessage}\r\n.\r\n`);
    this.assertCode(await this.readCommand(), 250);
  }

  async close() {
    if (!this.conn) return;
    try {
      await this.writeCommand("QUIT");
      await this.readCommand();
    } catch {
      // ignore best-effort close failures
    } finally {
      this.conn.close();
      this.conn = null;
      this.incoming = "";
    }
  }

  private parseAddress(input: string): [string, string] {
    const value = String(input || "").trim();
    const m = value.match(/(.*)\s<(.*)>/);
    if (m && m.length === 3) {
      return [`<${m[2]}>`, value];
    }
    return [`<${value}>`, `<${value}>`];
  }

  private assertCode(command: SmtpCommand | null, expected: number) {
    if (!command) {
      throw new Error("SMTP server closed connection unexpectedly");
    }
    if (command.code !== expected) {
      throw new Error(`${command.code}: ${command.args}`);
    }
  }

  private async writeCommand(line: string) {
    await this.writeRaw(`${line}\r\n`);
  }

  private async writeRaw(value: string) {
    if (!this.conn) throw new Error("SMTP connection not established");
    await this.conn.write(this.encoder.encode(value));
  }

  private async readCommand(): Promise<SmtpCommand | null> {
    const line = await this.readLine();
    if (line === null) return null;
    const code = Number.parseInt(line.slice(0, 3), 10);
    return {
      code: Number.isFinite(code) ? code : 0,
      args: line.slice(3).trim(),
    };
  }

  private async readLine(): Promise<string | null> {
    if (!this.conn) return null;
    while (true) {
      const newlineIndex = this.incoming.indexOf("\n");
      if (newlineIndex >= 0) {
        const line = this.incoming.slice(0, newlineIndex + 1);
        this.incoming = this.incoming.slice(newlineIndex + 1);
        return line.replace(/\r?\n$/, "");
      }
      const chunk = new Uint8Array(2048);
      const read = await this.conn.read(chunk);
      if (read === null) {
        if (!this.incoming) return null;
        const tail = this.incoming;
        this.incoming = "";
        return tail;
      }
      this.incoming += this.decoder.decode(chunk.subarray(0, read));
    }
  }
}

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
