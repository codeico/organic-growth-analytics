/** @param {unknown} value */
const number = (value) => (typeof value === "number" ? value : null);

/**
 * @template {{ id: string }} T
 * @param {T[]} accounts
 * @param {string | null} selectedId
 * @returns {T | null}
 */
export function pickAccount(accounts, selectedId) {
  return (
    accounts.find((account) => account.id === selectedId) ?? accounts[0] ?? null
  );
}

/** @param {Array<Record<string, unknown>>} rows */
export function buildMetricSummary(rows) {
  const metrics = [...rows].sort((a, b) =>
    String(a.metric_date).localeCompare(String(b.metric_date)),
  );
  const first = metrics[0] ?? {};
  const latest = metrics.at(-1) ?? {};
  const firstFollowers = number(first.followers_count);
  const followers = number(latest.followers_count);

  return {
    followers,
    followerGrowth:
      followers === null || firstFollowers === null
        ? null
        : followers - firstFollowers,
    reach: number(latest.reach),
    interactions: number(latest.total_interactions),
    accountsEngaged: number(latest.accounts_engaged),
  };
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {number} width
 * @param {number} height
 */
export function buildTrendPoints(rows, width, height) {
  const values = rows
    .map((row) => number(row.followers_count))
    .filter((value) => value !== null);
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${Math.round(x)},${Math.round(y)}`;
    })
    .join(" ");
}

/** @param {import("@supabase/supabase-js").SupabaseClient} client */
export async function beginInstagramConnection(client) {
  const { data, error } = await client.functions.invoke("instagram-connect");
  if (error) {
    const body = await error.context?.json?.().catch(() => null);
    throw new Error(body?.error ?? "Koneksi Instagram belum tersedia");
  }
  if (!data?.url) throw new Error("URL koneksi Instagram tidak tersedia");
  return data.url;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @returns {Promise<Array<{ account_id: string, status: string }>>}
 */
export async function requestInstagramSync(client) {
  const { data, error } = await client.functions.invoke("instagram-sync");
  if (error) {
    const body = await error.context?.json?.().catch(() => null);
    throw new Error(body?.error ?? "Sinkronisasi Instagram gagal");
  }
  return data?.results ?? [];
}

/** @param {import("@supabase/supabase-js").SupabaseClient} client */
export async function listInstagramAccounts(client) {
  const { data, error } = await client
    .from("instagram_accounts")
    .select(
      "id,username,name,account_type,profile_picture_url,status,last_synced_at,created_at",
    )
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} accountId
 */
export async function loadAccountAnalytics(client, accountId) {
  const [metrics, media, audience] = await Promise.all([
    client
      .from("instagram_account_metrics")
      .select(
        "metric_date,followers_count,reach,total_interactions,accounts_engaged",
      )
      .eq("account_id", accountId)
      .order("metric_date")
      .limit(90),
    client
      .from("instagram_media")
      .select(
        "id,caption,media_type,thumbnail_url,permalink,published_at,reach,likes,comments,saved,shares,total_interactions",
      )
      .eq("account_id", accountId)
      .order("published_at", { ascending: false })
      .limit(12),
    client
      .from("instagram_audience_demographics")
      .select("snapshot_date,dimension,label,value")
      .eq("account_id", accountId)
      .order("snapshot_date", { ascending: false })
      .order("value", { ascending: false })
      .limit(100),
  ]);

  for (const result of [metrics, media, audience]) {
    if (result.error) throw result.error;
  }

  return {
    metrics: metrics.data ?? [],
    media: media.data ?? [],
    audience: audience.data ?? [],
  };
}
