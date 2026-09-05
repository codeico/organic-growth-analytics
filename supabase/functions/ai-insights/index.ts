import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildAnalyticsContext,
  buildMessages,
  complete,
} from "../_shared/ai.js";

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

  const authorization = request.headers.get("authorization");
  if (!authorization) return json({ error: "Otorisasi diperlukan" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  // User-scoped client: RLS guarantees we only read this user's rows.
  const db = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) return json({ error: "Sesi tidak valid" }, 401);

  const body = await request.json().catch(() => ({}));
  const accountId = typeof body.account_id === "string" ? body.account_id : "";
  const mode = typeof body.mode === "string" ? body.mode : "summary";
  const question = typeof body.question === "string" ? body.question : "";
  if (!accountId) return json({ error: "account_id diperlukan" }, 400);

  const [account, metrics, media, audience, breakdowns] = await Promise.all([
    db
      .from("instagram_accounts")
      .select("username,account_type")
      .eq("id", accountId)
      .single(),
    db
      .from("instagram_account_metrics")
      .select("*")
      .eq("account_id", accountId)
      .order("metric_date", { ascending: false })
      .limit(30),
    db
      .from("instagram_media")
      .select("*")
      .eq("account_id", accountId)
      .order("published_at", { ascending: false })
      .limit(30),
    db
      .from("instagram_audience_demographics")
      .select("dimension,label,value,snapshot_date")
      .eq("account_id", accountId)
      .order("snapshot_date", { ascending: false })
      .order("value", { ascending: false })
      .limit(60),
    db
      .from("instagram_metric_breakdowns")
      .select("metric,product_type,value,metric_date")
      .eq("account_id", accountId)
      .order("metric_date", { ascending: false })
      .limit(40),
  ]);
  if (account.error || !account.data)
    return json({ error: "Akun tidak ditemukan" }, 404);
  if (!metrics.data?.length)
    return json(
      { error: "Belum ada data untuk dianalisis. Sinkronkan dulu." },
      409,
    );

  const latestDate = audience.data?.[0]?.snapshot_date;
  const context = buildAnalyticsContext({
    account: account.data,
    metrics: metrics.data ?? [],
    media: media.data ?? [],
    audience: (audience.data ?? []).filter(
      (a) => a.snapshot_date === latestDate,
    ),
    breakdowns: (breakdowns.data ?? []).filter(
      (b) => b.metric_date === breakdowns.data?.[0]?.metric_date,
    ),
  });

  try {
    const answer = await complete(
      fetch,
      {
        baseUrl: Deno.env.get("LLM_BASE_URL")!,
        apiKey: Deno.env.get("LLM_API_KEY")!,
        model: Deno.env.get("LLM_MODEL")!,
      },
      buildMessages(mode, context, question),
    );
    return json({ answer, mode, generated_at: new Date().toISOString() });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "AI gagal";
    return json({ error: message }, 502);
  }
});
