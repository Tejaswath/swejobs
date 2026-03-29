import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_HTML_CONTENT_BYTES = 1_000_000;
const BLOCKED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const QUOTA_WINDOW_MINUTES = 60;
const QUOTA_MAX_REQUESTS = 60;

function isPrivateIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  if ([a, b].some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;
  if (a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  if (normalized.endsWith(".local") || normalized.endsWith(".internal")) return true;
  if (isPrivateIpv4(normalized)) return true;
  return false;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x27;/gi, "'");
}

function cleanTitle(rawTitle: string): string {
  const normalized = decodeHtmlEntities(rawTitle).replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const separators = [" | ", " - ", " — ", " · "];
  for (const separator of separators) {
    if (!normalized.includes(separator)) continue;
    const segments = normalized.split(separator).map((segment) => segment.trim()).filter(Boolean);
    if (segments.length < 2) continue;
    if (segments[0].split(" ").length >= 2) {
      return segments[0];
    }
  }

  return normalized;
}

function extractTitleFromHtml(html: string): string | null {
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  if (ogTitleMatch?.[1]) {
    const cleaned = cleanTitle(ogTitleMatch[1]);
    if (cleaned) return cleaned;
  }

  const twitterTitleMatch = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  if (twitterTitleMatch?.[1]) {
    const cleaned = cleanTitle(twitterTitleMatch[1]);
    if (cleaned) return cleaned;
  }

  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
  if (titleMatch?.[1]) {
    const cleaned = cleanTitle(titleMatch[1]);
    if (cleaned) return cleaned;
  }

  const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
  if (h1Match?.[1]) {
    const cleaned = cleanTitle(h1Match[1].replace(/<[^>]+>/g, " "));
    if (cleaned) return cleaned;
  }

  return null;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authorizationHeader = request.headers.get("Authorization");
    if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization header." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(JSON.stringify({ error: "Server auth config missing." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authorizationHeader },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: quotaResponse, error: quotaError } = await authClient.rpc("consume_edge_quota", {
      p_user_id: user.id,
      p_function_name: "extract-job-title",
      p_window_minutes: QUOTA_WINDOW_MINUTES,
      p_max_requests: QUOTA_MAX_REQUESTS,
    });

    const quota = Array.isArray(quotaResponse) ? quotaResponse[0] : quotaResponse;
    if (quotaError || !quota) {
      return new Response(JSON.stringify({ error: "Could not validate request quota." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!quota.allowed) {
      const retryAfterSeconds = Number.isFinite(Number(quota.retry_after_seconds))
        ? Math.max(1, Number(quota.retry_after_seconds))
        : 60;
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded for title extraction. Try again later.",
          retry_after_seconds: retryAfterSeconds,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(retryAfterSeconds),
          },
        },
      );
    }

    const { url } = await request.json();
    if (typeof url !== "string" || !url.trim()) {
      return new Response(JSON.stringify({ error: "A valid URL is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch (_error) {
      return new Response(JSON.stringify({ error: "Invalid URL." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return new Response(JSON.stringify({ error: "Only HTTP/HTTPS URLs are supported." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isBlockedHostname(parsedUrl.hostname)) {
      return new Response(JSON.stringify({ error: "This host is not allowed." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (parsedUrl.username || parsedUrl.password) {
      return new Response(JSON.stringify({ error: "Credentialed URLs are not supported." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (parsedUrl.port && !["80", "443"].includes(parsedUrl.port)) {
      return new Response(JSON.stringify({ error: "Only standard web ports are supported." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    let response: Response;
    try {
      response = await fetch(parsedUrl.toString(), {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SweJobsBot/1.0; +https://swejobs.app)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return new Response(JSON.stringify({ title: null, reason: `upstream_${response.status}` }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      return new Response(JSON.stringify({ title: null, reason: "not_html" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > MAX_HTML_CONTENT_BYTES) {
        return new Response(JSON.stringify({ title: null, reason: "response_too_large" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const html = await response.text();
    const title = extractTitleFromHtml(html);
    return new Response(JSON.stringify({ title: title ?? null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return new Response(JSON.stringify({ title: null, reason: "exception", error: message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
