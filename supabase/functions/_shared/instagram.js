const GRAPH = "https://graph.instagram.com/v25.0";

/** @param {string} value */
function bytesToBase64(value) {
  return btoa(value);
}

/** @param {Uint8Array} value */
function binary(value) {
  return String.fromCharCode(...value);
}

/** @param {string} encodedKey */
async function cryptoKey(encodedKey) {
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(encodedKey), (char) => char.charCodeAt(0)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

/** @param {string} value @param {string} encodedKey */
export async function encryptToken(value, encodedKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await cryptoKey(encodedKey),
      new TextEncoder().encode(value),
    ),
  );
  return `${bytesToBase64(binary(iv))}.${bytesToBase64(binary(cipher))}`;
}

/** @param {string} encrypted @param {string} encodedKey */
export async function decryptToken(encrypted, encodedKey) {
  const [iv, cipher] = encrypted.split(".");
  if (!iv || !cipher) throw new Error("Invalid encrypted token");
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: Uint8Array.from(atob(iv), (char) => char.charCodeAt(0)),
    },
    await cryptoKey(encodedKey),
    Uint8Array.from(atob(cipher), (char) => char.charCodeAt(0)),
  );
  return new TextDecoder().decode(plain);
}

/** @param {typeof fetch} fetcher @param {string} accessToken */
export async function refreshInstagramToken(fetcher, accessToken) {
  const response = await graph(fetcher, "/refresh_access_token", {
    grant_type: "ig_refresh_token",
    access_token: accessToken,
  });
  if (!response.access_token) throw new Error("Instagram token refresh failed");
  return {
    accessToken: response.access_token,
    expiresIn: Number(response.expires_in ?? 5_184_000),
  };
}

/** @param {typeof fetch} fetcher @param {string} path @param {Record<string, string>} params */
async function graph(fetcher, path, params) {
  const url = new URL(`${GRAPH}${path}`);
  url.search = new URLSearchParams(params).toString();
  const response = await fetcher(url);
  const body = await response.json();
  if (!response.ok)
    throw new Error(body?.error?.message ?? `Instagram API ${response.status}`);
  return body;
}

/** @param {Array<Record<string, any>>} rows */
function metricValues(rows) {
  return Object.fromEntries(
    rows.map((metric) => [
      metric.name,
      metric.total_value?.value ?? metric.values?.at(-1)?.value ?? null,
    ]),
  );
}

/**
 * Flattens `total_value.breakdowns[].results[]` into `{ label, value }` pairs.
 * @param {Record<string, any> | undefined} metric
 */
function breakdownRows(metric) {
  const rows = [];
  for (const breakdown of metric?.total_value?.breakdowns ?? []) {
    for (const result of breakdown.results ?? []) {
      rows.push({
        label: String(result.dimension_values?.at(-1) ?? "Unknown"),
        value: Number(result.value ?? 0),
      });
    }
  }
  return rows;
}

/** @param {PromiseSettledResult<any>} result */
const dataOf = (result) =>
  result.status === "fulfilled" ? (result.value.data ?? []) : [];

// Interaction metrics that support `period=day` + `total_value`.
// Per-media metric sets differ by surface (see IG Media Insights reference).
// `reposts` is documented but rejected by the API ("does not support the metrics: reposts").
// Album children have no insights at all; CAROUSEL_ALBUM itself only the FEED set.
const REELS_METRICS =
  "reach,views,saved,shares,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate";
const FEED_METRICS =
  "reach,views,saved,shares,total_interactions,profile_visits,follows";
/** @param {{ media_product_type?: string }} item */
export function mediaMetrics(item) {
  return item.media_product_type === "REELS" ? REELS_METRICS : FEED_METRICS;
}

const DAILY_TOTALS =
  "views,accounts_engaged,total_interactions,likes,comments,saves,shares,replies,profile_links_taps";
// Only reach supports `time_series` in practice (views returns [] despite docs),
// which is what makes the 30-day backfill possible.
const TIME_SERIES = "reach";
const SURFACE_METRICS =
  "reach,views,total_interactions,likes,comments,saves,shares";
const DEMOGRAPHIC_DIMENSIONS = ["country", "city", "age", "gender"];

/** @param {typeof fetch} fetcher @param {string} token @param {Date} now */
export async function fetchInstagramSnapshot(fetcher, token, now = new Date()) {
  const access = { access_token: token };
  const profile = await graph(fetcher, "/me", {
    ...access,
    fields:
      "id,user_id,username,name,account_type,profile_picture_url,followers_count",
  });
  const today = now.toISOString().slice(0, 10);
  const since = String(Math.floor((now.getTime() - 29 * 86_400_000) / 1000));
  const until = String(Math.floor(now.getTime() / 1000));
  const daySince = String(Math.floor((now.getTime() - 86_400_000) / 1000));
  const day = { ...access, period: "day", since: daySince, until };
  const demographic = (metric, breakdown) =>
    graph(fetcher, "/me/insights", {
      ...access,
      metric,
      period: "lifetime",
      timeframe: "this_month",
      metric_type: "total_value",
      breakdown,
    });

  const requests = [
    graph(fetcher, "/me/insights", {
      ...access,
      metric: TIME_SERIES,
      period: "day",
      metric_type: "time_series",
      since,
      until,
    }),
    graph(fetcher, "/me/insights", {
      ...day,
      metric: DAILY_TOTALS,
      metric_type: "total_value",
    }),
    graph(fetcher, "/me/insights", {
      ...day,
      metric: "follows_and_unfollows",
      metric_type: "total_value",
      breakdown: "follow_type",
    }),
    graph(fetcher, "/me/insights", {
      ...day,
      metric: SURFACE_METRICS,
      metric_type: "total_value",
      breakdown: "media_product_type",
    }),
    graph(fetcher, "/me/media", {
      ...access,
      fields:
        "id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp,like_count,comments_count",
      limit: "50",
    }),
    demographic("engaged_audience_demographics", "country"),
    ...DEMOGRAPHIC_DIMENSIONS.map((dimension) =>
      demographic("follower_demographics", dimension),
    ),
  ];
  const settled = await Promise.allSettled(requests);
  const [
    seriesResult,
    totalsResult,
    followsResult,
    surfaceResult,
    mediaResult,
    engagedResult,
    ...followerDemographics
  ] = settled;
  const requestNames = [
    "time_series",
    "daily_totals",
    "follows",
    "surface",
    "media",
    "engaged_demographics",
    ...DEMOGRAPHIC_DIMENSIONS,
  ];
  // Partial failures are tolerated but must be visible, not silent.
  const warnings = settled.flatMap((result, index) =>
    result.status === "rejected"
      ? [`${requestNames[index]}: ${result.reason?.message ?? result.reason}`]
      : [],
  );

  // 30-day daily rows keyed by date, from time_series.
  /** @type {Map<string, Record<string, any>>} */
  const daily = new Map();
  for (const metric of dataOf(seriesResult)) {
    for (const point of metric.values ?? []) {
      const date = String(point.end_time ?? "").slice(0, 10);
      if (!date) continue;
      const row = daily.get(date) ?? { metric_date: date };
      row[metric.name] = Number(point.value ?? 0);
      daily.set(date, row);
    }
  }
  const todayRow = daily.get(today) ?? { metric_date: today };
  todayRow.followers_count = profile.followers_count ?? null;
  daily.set(today, todayRow);
  const dailyMetrics = [...daily.values()].sort((a, b) =>
    a.metric_date.localeCompare(b.metric_date),
  );

  const totals = metricValues(dataOf(totalsResult));
  const follows = Object.fromEntries(
    breakdownRows(dataOf(followsResult)[0]).map((r) => [r.label, r.value]),
  );

  const breakdowns = [];
  for (const metric of dataOf(surfaceResult)) {
    for (const row of breakdownRows(metric)) {
      breakdowns.push({
        metric_date: today,
        metric: metric.name,
        product_type: row.label,
        value: row.value,
      });
    }
  }

  const rawMedia = dataOf(mediaResult);
  /** @type {string[]} */
  const mediaWarnings = [];
  const media = await Promise.all(
    rawMedia.map(async (item) => {
      let insights = {};
      try {
        insights = metricValues(
          (
            await graph(fetcher, `/${item.id}/insights`, {
              ...access,
              metric: mediaMetrics(item),
            })
          ).data ?? [],
        );
      } catch (error) {
        // Some metrics are not available for every media type; surface why.
        mediaWarnings.push(
          `media ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return {
        instagram_media_id: String(item.id),
        caption: item.caption ?? null,
        media_type: item.media_type,
        media_product_type: item.media_product_type ?? null,
        // Graph only sets thumbnail_url for VIDEO; images/carousels expose media_url.
        thumbnail_url: item.thumbnail_url ?? item.media_url ?? null,
        permalink: item.permalink ?? null,
        published_at: item.timestamp,
        likes: item.like_count ?? null,
        comments: item.comments_count ?? null,
        reach: insights.reach ?? null,
        views: insights.views ?? null,
        saved: insights.saved ?? null,
        shares: insights.shares ?? null,
        total_interactions: insights.total_interactions ?? null,
        profile_visits: insights.profile_visits ?? null,
        follows: insights.follows ?? null,
        avg_watch_time_ms: insights.ig_reels_avg_watch_time ?? null,
        total_watch_time_ms: insights.ig_reels_video_view_total_time ?? null,
        skip_rate: insights.reels_skip_rate ?? null,
        insights_synced_at: new Date().toISOString(),
      };
    }),
  );

  const audience = [];
  followerDemographics.forEach((result, index) => {
    for (const row of breakdownRows(dataOf(result)[0])) {
      audience.push({
        snapshot_date: today,
        dimension: DEMOGRAPHIC_DIMENSIONS[index],
        ...row,
      });
    }
  });
  for (const row of breakdownRows(dataOf(engagedResult)[0])) {
    audience.push({
      snapshot_date: today,
      dimension: "engaged_country",
      ...row,
    });
  }

  return {
    profile: {
      instagram_user_id: String(profile.user_id ?? profile.id),
      username: profile.username,
      name: profile.name ?? null,
      account_type: profile.account_type,
      profile_picture_url: profile.profile_picture_url ?? null,
    },
    metric: {
      metric_date: today,
      followers_count: profile.followers_count ?? null,
      reach: todayRow.reach ?? null,
      views: totals.views ?? null,
      accounts_engaged: totals.accounts_engaged ?? null,
      total_interactions: totals.total_interactions ?? null,
      likes: totals.likes ?? null,
      comments: totals.comments ?? null,
      saves: totals.saves ?? null,
      shares: totals.shares ?? null,
      replies: totals.replies ?? null,
      profile_links_taps: totals.profile_links_taps ?? null,
      follows: follows.FOLLOWER ?? null,
      unfollows: follows.NON_FOLLOWER ?? null,
    },
    dailyMetrics,
    breakdowns,
    media,
    audience,
    warnings: [...warnings, ...mediaWarnings.slice(0, 3)],
  };
}
