const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    if (!authorizationHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const response = await fetch(parsedUrl.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SweJobsBot/1.0; +https://swejobs.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeout);

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
