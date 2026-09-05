import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, apikey, content-type, x-client-info",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });

const hash = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response(null, { headers: cors });
  const authorization = request.headers.get("authorization");
  if (!authorization) return json({ error: "Sesi diperlukan" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const {
    data: { user },
    error,
  } = await auth.auth.getUser();
  if (error || !user) return json({ error: "Sesi tidak valid" }, 401);

  const appId = Deno.env.get("INSTAGRAM_APP_ID");
  const appUrl = Deno.env.get("APP_URL");
  if (!appId || !appUrl)
    return json({ error: "Koneksi Instagram belum dikonfigurasi" }, 503);

  const state = crypto.randomUUID() + crypto.randomUUID();
  const redirectUri = `${url}/functions/v1/instagram-callback`;
  const { error: insertError } = await admin
    .from("instagram_oauth_states")
    .insert({
      state_hash: await hash(state),
      user_id: user.id,
      return_to: `${appUrl}/dashboard`,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
  if (insertError)
    return json({ error: "Gagal memulai koneksi Instagram" }, 500);

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "instagram_business_basic,instagram_business_manage_insights",
    state,
  });
  return json({ url: `https://www.instagram.com/oauth/authorize?${params}` });
});
