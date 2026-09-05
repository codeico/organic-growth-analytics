import { createClient } from "npm:@supabase/supabase-js@2";
import {
  decryptToken,
  encryptToken,
  fetchInstagramSnapshot,
  refreshInstagramToken,
} from "../_shared/instagram.js";

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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response(null, { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);
  const authorization = request.headers.get("authorization");
  const cronSecret = request.headers.get("x-cron-secret");
  const body = await request.json().catch(() => ({}));
  const requestedAccountId =
    typeof body.account_id === "string" ? body.account_id : null;
  let userId: string | null = null;

  if (cronSecret && cronSecret === Deno.env.get("CRON_SECRET")) {
    userId = null;
  } else if (authorization) {
    const auth = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
    });
    const { data, error } = await auth.auth.getUser();
    if (error || !data.user) return json({ error: "Sesi tidak valid" }, 401);
    userId = data.user.id;
  } else {
    return json({ error: "Otorisasi diperlukan" }, 401);
  }

  const { data: accounts, error } = await admin.rpc(
    "instagram_accounts_for_sync_v2",
    {
      target_user_id: userId,
      target_account_id: userId ? null : requestedAccountId,
    },
  );
  if (error) return json({ error: "Gagal memuat akun" }, 500);

  const results = [];
  for (const account of accounts ?? []) {
    const { data: run } = await admin
      .from("instagram_sync_runs")
      .insert({ account_id: account.id, status: "running" })
      .select("id")
      .single();
    try {
      const encryptionKey = Deno.env.get("TOKEN_ENCRYPTION_KEY")!;
      let token = await decryptToken(
        account.encrypted_access_token,
        encryptionKey,
      );
      if (
        account.token_expires_at &&
        new Date(account.token_expires_at).getTime() - Date.now() <
          7 * 86_400_000
      ) {
        const refreshed = await refreshInstagramToken(fetch, token);
        token = refreshed.accessToken;
        const { error: refreshError } = await admin.rpc(
          "store_instagram_token",
          {
            target_account_id: account.id,
            encrypted_token: await encryptToken(token, encryptionKey),
            token_expires_at: new Date(
              Date.now() + refreshed.expiresIn * 1000,
            ).toISOString(),
          },
        );
        if (refreshError) throw refreshError;
      }
      const snapshot = await fetchInstagramSnapshot(fetch, token);
      const now = new Date().toISOString();
      const { error: accountError } = await admin
        .from("instagram_accounts")
        .update({
          ...snapshot.profile,
          last_synced_at: now,
          next_sync_at: new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString(),
        })
        .eq("id", account.id);
      if (accountError) throw accountError;

      const { error: metricError } = await admin
        .from("instagram_account_metrics")
        .upsert({ account_id: account.id, ...snapshot.metric });
      if (metricError) throw metricError;

      if (snapshot.media.length) {
        const { error: mediaError } = await admin
          .from("instagram_media")
          .upsert(
            snapshot.media.map((item) => ({ account_id: account.id, ...item })),
            { onConflict: "account_id,instagram_media_id" },
          );
        if (mediaError) throw mediaError;
      }

      if (snapshot.audience.length) {
        await admin
          .from("instagram_audience_demographics")
          .delete()
          .eq("account_id", account.id)
          .eq("snapshot_date", snapshot.metric.metric_date);
        const { error: audienceError } = await admin
          .from("instagram_audience_demographics")
          .insert(
            snapshot.audience.map((item) => ({
              account_id: account.id,
              ...item,
            })),
          );
        if (audienceError) throw audienceError;
      }

      if (run)
        await admin
          .from("instagram_sync_runs")
          .update({ status: "succeeded", finished_at: now })
          .eq("id", run.id);
      results.push({ account_id: account.id, status: "succeeded" });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Sync failed";
      await admin
        .from("instagram_accounts")
        .update({
          next_sync_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        })
        .eq("id", account.id);
      if (run)
        await admin
          .from("instagram_sync_runs")
          .update({
            status: "failed",
            error_message: message.slice(0, 500),
            finished_at: new Date().toISOString(),
          })
          .eq("id", run.id);
      results.push({ account_id: account.id, status: "failed" });
    }
  }

  return json({ results });
});
