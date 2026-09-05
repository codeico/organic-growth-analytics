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

  const [accountResult, mediaResult, audienceResult] = await Promise.allSettled(
    [
      graph(fetcher, "/me/insights", {
        ...access,
        metric: "reach,accounts_engaged,total_interactions",
        period: "day",
        metric_type: "total_value",
        since,
        until,
      }),
      graph(fetcher, "/me/media", {
        ...access,
        fields:
          "id,caption,media_type,thumbnail_url,permalink,timestamp,like_count,comments_count",
        limit: "25",
      }),
      graph(fetcher, "/me/insights", {
        ...access,
        metric: "follower_demographics",
        period: "lifetime",
        timeframe: "this_month",
        metric_type: "total_value",
        breakdown: "country",
      }),
    ],
  );

  const accountMetrics =
    accountResult.status === "fulfilled"
      ? metricValues(accountResult.value.data ?? [])
      : {};
  const rawMedia =
    mediaResult.status === "fulfilled" ? (mediaResult.value.data ?? []) : [];
  const media = await Promise.all(
    rawMedia.map(async (item) => {
      let insights = {};
      try {
        insights = metricValues(
          (
            await graph(fetcher, `/${item.id}/insights`, {
              ...access,
              metric: "reach,saved,shares,total_interactions",
            })
          ).data ?? [],
        );
      } catch {
        // Some metrics are not available for every media type.
      }
      return {
        instagram_media_id: String(item.id),
        caption: item.caption ?? null,
        media_type: item.media_type,
        thumbnail_url: item.thumbnail_url ?? null,
        permalink: item.permalink ?? null,
        published_at: item.timestamp,
        likes: item.like_count ?? null,
        comments: item.comments_count ?? null,
        reach: insights.reach ?? null,
        saved: insights.saved ?? null,
        shares: insights.shares ?? null,
        total_interactions: insights.total_interactions ?? null,
      };
    }),
  );

  const audience = [];
  if (audienceResult.status === "fulfilled") {
    for (const metric of audienceResult.value.data ?? []) {
      for (const breakdown of metric.total_value?.breakdowns ?? []) {
        for (const result of breakdown.results ?? []) {
          audience.push({
            snapshot_date: today,
            dimension: "country",
            label: String(result.dimension_values?.[0] ?? "Unknown"),
            value: Number(result.value ?? 0),
          });
        }
      }
    }
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
      reach: accountMetrics.reach ?? null,
      accounts_engaged: accountMetrics.accounts_engaged ?? null,
      total_interactions: accountMetrics.total_interactions ?? null,
    },
    media,
    audience,
  };
}
