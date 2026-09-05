import { createClient } from "npm:@supabase/supabase-js@2";

const hash = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const encrypt = async (value: string, encodedKey: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(encodedKey), (char) => char.charCodeAt(0)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(value),
    ),
  );
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...cipher))}`;
};

Deno.serve(async (request) => {
  const current = new URL(request.url);
  const state = current.searchParams.get("state");
  const code = current.searchParams.get("code")?.replace(/#_$/, "");
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const fallback = Deno.env.get("APP_URL") ?? "http://localhost:5173";
  if (!state || !code)
    return Response.redirect(`${fallback}/dashboard?instagram=denied`, 303);

  const stateHash = await hash(state);
  const { data: oauthState } = await admin
    .from("instagram_oauth_states")
    .delete()
    .eq("state_hash", stateHash)
    .gt("expires_at", new Date().toISOString())
    .select("user_id,return_to")
    .maybeSingle();
  if (!oauthState)
    return Response.redirect(
      `${fallback}/dashboard?instagram=invalid_state`,
      303,
    );

  try {
    const appId = Deno.env.get("INSTAGRAM_APP_ID")!;
    const appSecret = Deno.env.get("INSTAGRAM_APP_SECRET")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/instagram-callback`;
    const form = new FormData();
    form.set("client_id", appId);
    form.set("client_secret", appSecret);
    form.set("grant_type", "authorization_code");
    form.set("redirect_uri", redirectUri);
    form.set("code", code);

    const shortResponse = await fetch(
      "https://api.instagram.com/oauth/access_token",
      { method: "POST", body: form },
    );
    const short = await shortResponse.json();
    if (!shortResponse.ok || !short.access_token)
      throw new Error("short_token_failed");

    const longUrl = new URL("https://graph.instagram.com/access_token");
    longUrl.search = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: appSecret,
      access_token: short.access_token,
    }).toString();
    const longResponse = await fetch(longUrl);
    const long = await longResponse.json();
    if (!longResponse.ok || !long.access_token)
      throw new Error("long_token_failed");

    const profileUrl = new URL("https://graph.instagram.com/me");
    profileUrl.search = new URLSearchParams({
      fields: "id,username,name,account_type,profile_picture_url",
      access_token: long.access_token,
    }).toString();
    const profileResponse = await fetch(profileUrl);
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.id) throw new Error("profile_failed");

    const { data: account, error: accountError } = await admin
      .from("instagram_accounts")
      .upsert(
        {
          user_id: oauthState.user_id,
          instagram_user_id: String(profile.id),
          username: profile.username,
          name: profile.name ?? null,
          account_type: profile.account_type,
          profile_picture_url: profile.profile_picture_url ?? null,
          status: "active",
        },
        { onConflict: "user_id,instagram_user_id" },
      )
      .select("id")
      .single();
    if (accountError) throw accountError;

    const encrypted = await encrypt(
      long.access_token,
      Deno.env.get("TOKEN_ENCRYPTION_KEY")!,
    );
    const { error: tokenError } = await admin.rpc("store_instagram_token", {
      target_account_id: account.id,
      encrypted_token: encrypted,
      token_expires_at: new Date(
        Date.now() + Number(long.expires_in ?? 5_184_000) * 1000,
      ).toISOString(),
    });
    if (tokenError) throw tokenError;

    return Response.redirect(
      `${oauthState.return_to}?instagram=connected`,
      303,
    );
  } catch {
    return Response.redirect(`${oauthState.return_to}?instagram=error`, 303);
  }
});
