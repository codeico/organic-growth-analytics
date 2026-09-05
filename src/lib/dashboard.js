/** @param {unknown} value */
const number = (value) => (typeof value === "number" ? value : null);

/**
 * Keep only selections that still exist; fall back to the first account.
 * @template {{ id: string }} T
 * @param {T[]} accounts
 * @param {string[]} selectedIds
 * @returns {T[]}
 */
export function pickAccounts(accounts, selectedIds) {
  const kept = accounts.filter((account) => selectedIds.includes(account.id));
  return kept.length ? kept : accounts.slice(0, 1);
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
 * @param {string} key
 */
export function buildTrendPoints(rows, width, height, key = "followers_count") {
  const values = rows
    .map((row) => number(row[key]))
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

/** @typedef {Record<string, unknown>} Row */

/**
 * Sum of numeric `key` over `rows`; null when no numeric value exists.
 * @param {Row[]} rows
 * @param {string} key
 */
function sumOf(rows, key) {
  /** @type {number[]} */
  const values = [];
  for (const row of rows) {
    const value = number(row[key]);
    if (value !== null) values.push(value);
  }
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

/**
 * Sum of the last `days` rows vs the `days` before them. Null when no data.
 * @param {Row[]} rows sorted ascending by metric_date
 * @param {string} key
 * @param {number} days
 */
export function sumWindow(rows, key, days) {
  const current = sumOf(rows.slice(-days), key);
  const previous = sumOf(rows.slice(-days * 2, -days), key);
  const change =
    current === null || previous === null || previous === 0
      ? null
      : (current - previous) / previous;
  return { current, previous, change };
}

const WIB_OFFSET_HOURS = 7;

/**
 * @param {Row[]} items
 * @param {string} key
 */
function avgOf(items, key) {
  const total = sumOf(items, key);
  if (total === null) return null;
  const count = items.filter((m) => number(m[key]) !== null).length;
  return Math.round(total / count);
}

/**
 * @template K
 * @param {Row[]} items
 * @param {(item: Row) => K | null} keyOf
 * @returns {Map<K, Row[]>}
 */
function groupBy(items, keyOf) {
  /** @type {Map<K, Row[]>} */
  const map = new Map();
  for (const item of items) {
    const k = keyOf(item);
    if (k === null) continue;
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

/**
 * Real-post comparison by format and by publishing hour (WIB).
 * @param {Row[]} media
 */
export function summarizeContent(media) {
  const byFormat = [
    ...groupBy(media, (m) =>
      String(m.media_product_type ?? m.media_type ?? "LAINNYA"),
    ),
  ]
    .map(([format, items]) => ({
      format,
      count: items.length,
      avgReach: avgOf(items, "reach"),
      avgInteractions: avgOf(items, "total_interactions"),
    }))
    .sort((a, b) => (b.avgReach ?? -1) - (a.avgReach ?? -1));

  const bestHours = [
    ...groupBy(media, (m) => {
      const at = new Date(String(m.published_at));
      return Number.isNaN(at.getTime())
        ? null
        : (at.getUTCHours() + WIB_OFFSET_HOURS) % 24;
    }),
  ]
    .map(([hour, items]) => ({
      hour,
      count: items.length,
      avgReach: avgOf(items, "reach"),
    }))
    .filter(
      /** @returns {h is { hour: number, count: number, avgReach: number }} */
      (h) => h.avgReach !== null,
    )
    .sort((a, b) => b.avgReach - a.avgReach || b.count - a.count)
    .slice(0, 5);

  return { byFormat, bestHours };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} accountId
 * @param {"summary" | "ask" | "captions" | "ideas"} mode
 * @param {string} question
 * @returns {Promise<string>}
 */
export async function requestAiInsight(client, accountId, mode, question) {
  const { data, error } = await client.functions.invoke("ai-insights", {
    body: { account_id: accountId, mode, question },
  });
  if (error) {
    const body = await error.context?.json?.().catch(() => null);
    throw new Error(body?.error ?? "Analisis AI gagal");
  }
  if (typeof data?.answer !== "string") throw new Error("Analisis AI kosong");
  return data.answer;
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
 * Group `rows` by `keyOf` and sum every numeric field except the key fields.
 * Non-numeric fields keep the first value seen.
 * @param {Row[]} rows
 * @param {string[]} keys
 */
function sumBy(rows, keys) {
  /** @type {Map<string, Row>} */
  const out = new Map();
  for (const row of rows) {
    const id = keys.map((k) => String(row[k])).join("|");
    const acc = out.get(id) ?? Object.fromEntries(keys.map((k) => [k, row[k]]));
    for (const [field, value] of Object.entries(row)) {
      if (keys.includes(field) || field === "account_id" || field === "id")
        continue;
      const n = number(value);
      if (n === null) {
        acc[field] ??= value;
        continue;
      }
      const prev = number(acc[field]);
      acc[field] = prev === null ? n : prev + n;
    }
    out.set(id, acc);
  }
  return [...out.values()];
}

/**
 * Combine per-account analytics into one view. Daily metrics, audience
 * labels, and breakdowns are summed; media is pooled. Averages are never
 * summed here because callers recompute them from the merged rows.
 * @param {Array<{ metrics: Row[], media: Row[], audience: Row[], breakdowns: Row[] }>} parts
 */
export function mergeAnalytics(parts) {
  if (parts.length === 1) return parts[0];
  /** @param {Row} a @param {Row} b */
  const byDate = (a, b) =>
    String(a.metric_date).localeCompare(String(b.metric_date));
  const audience = sumBy(
    parts.flatMap((p) =>
      p.audience.map(({ snapshot_date, ...r }) => (void snapshot_date, r)),
    ),
    ["dimension", "label"],
  ).sort((a, b) => (number(b.value) ?? 0) - (number(a.value) ?? 0));
  return {
    metrics: sumBy(
      parts.flatMap((p) => p.metrics),
      ["metric_date"],
    ).sort(byDate),
    media: parts
      .flatMap((p) => p.media)
      .sort((a, b) =>
        String(b.published_at).localeCompare(String(a.published_at)),
      ),
    audience,
    breakdowns: sumBy(
      parts.flatMap((p) => p.breakdowns),
      ["metric_date", "metric", "product_type"],
    ).sort((a, b) => byDate(b, a)),
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string[]} accountIds
 */
export async function loadAccountAnalytics(client, accountIds) {
  const [metrics, media, audience, breakdowns] = await Promise.all([
    client
      .from("instagram_account_metrics")
      .select("*")
      .in("account_id", accountIds)
      .order("metric_date")
      .limit(90 * accountIds.length),
    client
      .from("instagram_media")
      .select("*")
      .in("account_id", accountIds)
      .order("published_at", { ascending: false })
      .limit(50 * accountIds.length),
    client
      .from("instagram_audience_demographics")
      .select("account_id,snapshot_date,dimension,label,value")
      .in("account_id", accountIds)
      .order("snapshot_date", { ascending: false })
      .order("value", { ascending: false })
      .limit(300 * accountIds.length),
    client
      .from("instagram_metric_breakdowns")
      .select("account_id,metric_date,metric,product_type,value")
      .in("account_id", accountIds)
      .order("metric_date", { ascending: false })
      .limit(60 * accountIds.length),
  ]);

  for (const result of [metrics, media, audience, breakdowns]) {
    if (result.error) throw result.error;
  }

  return mergeAnalytics(
    accountIds.map((id) => {
      const own = (/** @type {Row[] | null} */ rows) =>
        (rows ?? []).filter((r) => r.account_id === id);
      const aud = own(audience.data);
      // Only the latest demographic snapshot per account is meaningful.
      const latest = aud[0]?.snapshot_date;
      return {
        metrics: own(metrics.data),
        media: own(media.data),
        audience: aud.filter((r) => r.snapshot_date === latest),
        breakdowns: own(breakdowns.data),
      };
    }),
  );
}

/**
 * Renders the small markdown subset the AI is told to use (##/### headings,
 * -/1. lists, **bold**, paragraphs) into React elements. No HTML is ever
 * injected, so model output cannot script the page.
 * ponytail: subset renderer; swap for a markdown lib if prompts grow tables/links.
 * @param {string} text
 */
export function parseMarkdown(text) {
  /** @type {Array<{ type: "h2" | "h3" | "p" | "ul" | "ol", text?: string, items?: string[] }>} */
  const blocks = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: h[1].length === 2 ? "h2" : "h3", text: h[2] });
      continue;
    }
    const li = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const type = /^\d/.test(line) ? "ol" : "ul";
      const last = blocks.at(-1);
      if (last && last.type === type && last.items) last.items.push(li[1]);
      else blocks.push({ type, items: [li[1]] });
      continue;
    }
    blocks.push({ type: "p", text: line });
  }
  return blocks;
}

/**
 * Splits `**bold**` runs into alternating plain/bold segments.
 * @param {string} text
 * @returns {Array<{ bold: boolean, text: string }>}
 */
export function parseInline(text) {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? { bold: true, text: part.slice(2, -2) }
        : { bold: false, text: part },
    );
}
