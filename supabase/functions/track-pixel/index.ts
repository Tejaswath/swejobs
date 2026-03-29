import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const pixelPng = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (char) => char.charCodeAt(0),
);

const responseHeaders = {
  "Content-Type": "image/png",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Access-Control-Allow-Origin": "*",
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }

  const url = new URL(request.url);
  const logId = url.searchParams.get("id");
  if (!logId) {
    return new Response(pixelPng, { status: 200, headers: responseHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceRoleKey) {
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await supabase.rpc("increment_email_open", { log_id: logId });
    }
  } catch (_error) {
    // Keep pixel endpoint resilient for email clients.
  }

  return new Response(pixelPng, { status: 200, headers: responseHeaders });
});
