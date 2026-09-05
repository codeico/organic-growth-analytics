import { describe, expect, it, vi } from "vitest";
import {
  decryptToken,
  encryptToken,
  fetchInstagramSnapshot,
  refreshInstagramToken,
} from "../supabase/functions/_shared/instagram.js";

const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("Instagram sync", () => {
  it("round-trips encrypted access tokens", async () => {
    const key = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
    );
    const encrypted = await encryptToken("ig-access-token", key);
    expect(encrypted).not.toContain("ig-access-token");
    await expect(decryptToken(encrypted, key)).resolves.toBe("ig-access-token");
  });

  it("normalizes profile, account metrics, media, and demographics", async () => {
    const fetcher = vi.fn(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/me/media")) {
        return response({
          data: [
            {
              id: "media-1",
              caption: "Post terbaru",
              media_type: "IMAGE",
              media_url: "https://cdn.example/img.jpg",
              permalink: "https://instagram.com/p/example",
              timestamp: "2026-09-05T00:00:00Z",
              like_count: 12,
              comments_count: 3,
            },
          ],
        });
      }
      if (url.pathname.endsWith("/media-1/insights")) {
        return response({
          data: [
            { name: "reach", values: [{ value: 80 }] },
            { name: "saved", values: [{ value: 4 }] },
            { name: "shares", values: [{ value: 2 }] },
            { name: "total_interactions", values: [{ value: 21 }] },
          ],
        });
      }
      if (
        url.pathname.endsWith("/me/insights") &&
        url.searchParams.has("breakdown")
      ) {
        return response({
          data: [
            {
              name: "follower_demographics",
              total_value: {
                breakdowns: [
                  {
                    results: [{ dimension_values: ["ID"], value: 50 }],
                  },
                ],
              },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/me/insights")) {
        if (url.searchParams.get("metric_type") === "time_series") {
          return response({
            data: [
              {
                name: "reach",
                values: [{ value: 100, end_time: "2026-09-05T07:00:00+0000" }],
              },
            ],
          });
        }
        return response({
          data: [
            { name: "accounts_engaged", total_value: { value: 40 } },
            { name: "total_interactions", total_value: { value: 30 } },
          ],
        });
      }
      if (url.pathname.endsWith("/me")) {
        return response({
          id: "app-user-1",
          user_id: "ig-user-1",
          username: "creator",
          name: "Creator",
          account_type: "MEDIA_CREATOR",
          followers_count: 120,
        });
      }
      return response({ error: { message: "unknown" } }, 404);
    });

    const snapshot = await fetchInstagramSnapshot(
      fetcher,
      "token",
      new Date("2026-09-05T12:00:00Z"),
    );

    expect(snapshot.profile.instagram_user_id).toBe("ig-user-1");
    expect(snapshot.metric).toMatchObject({
      metric_date: "2026-09-05",
      followers_count: 120,
      reach: 100,
      accounts_engaged: 40,
      total_interactions: 30,
    });
    expect(snapshot.media[0]).toMatchObject({
      instagram_media_id: "media-1",
      thumbnail_url: "https://cdn.example/img.jpg",
      reach: 80,
      saved: 4,
      shares: 2,
      total_interactions: 21,
    });
    expect(snapshot.audience).toContainEqual({
      snapshot_date: "2026-09-05",
      dimension: "country",
      label: "ID",
      value: 50,
    });
    const calls = fetcher.mock.calls.map(([input]) => new URL(String(input)));
    const accountInsights = calls.find(
      (url) =>
        url.pathname.endsWith("/me/insights") &&
        !url.searchParams.has("breakdown"),
    );
    const demographics = calls.find(
      (url) => url.searchParams.get("metric") === "follower_demographics",
    );
    expect(accountInsights?.searchParams.get("since")).toMatch(/^\d+$/);
    expect(demographics?.searchParams.get("timeframe")).toBe("this_month");
    expect(demographics?.searchParams.has("since")).toBe(false);
  });

  it("backfills 30 days of daily metrics, surface breakdowns, and richer demographics", async () => {
    const fetcher = vi.fn(async (input) => {
      const url = new URL(String(input));
      const p = url.searchParams;
      if (url.pathname.endsWith("/me/media")) {
        return response({
          data: [
            {
              id: "media-1",
              media_type: "VIDEO",
              media_product_type: "REELS",
              timestamp: "2026-09-04T13:00:00Z",
              like_count: 1,
              comments_count: 0,
            },
          ],
        });
      }
      if (url.pathname.endsWith("/media-1/insights")) {
        expect(p.get("metric")).toContain("ig_reels_avg_watch_time");
        expect(p.get("metric")).not.toContain("profile_visits");
        return response({
          data: [
            { name: "views", values: [{ value: 900 }] },
            { name: "reach", values: [{ value: 500 }] },
            { name: "ig_reels_avg_watch_time", values: [{ value: 7300 }] },
            { name: "reels_skip_rate", values: [{ value: 0.42 }] },
          ],
        });
      }
      if (url.pathname.endsWith("/me/insights")) {
        if (p.get("metric_type") === "time_series") {
          return response({
            data: [
              {
                name: "reach",
                values: [
                  { value: 10, end_time: "2026-09-04T07:00:00+0000" },
                  { value: 12, end_time: "2026-09-05T07:00:00+0000" },
                ],
              },
            ],
          });
        }
        if (p.get("metric")?.startsWith("views,")) {
          return response({
            data: [{ name: "views", total_value: { value: 33 } }],
          });
        }
        if (p.get("breakdown") === "follow_type") {
          return response({
            data: [
              {
                name: "follows_and_unfollows",
                total_value: {
                  breakdowns: [
                    {
                      results: [
                        { dimension_values: ["FOLLOWER"], value: 9 },
                        { dimension_values: ["NON_FOLLOWER"], value: 4 },
                      ],
                    },
                  ],
                },
              },
            ],
          });
        }
        if (p.get("breakdown") === "media_product_type") {
          return response({
            data: [
              {
                name: "reach",
                total_value: {
                  breakdowns: [
                    {
                      results: [
                        { dimension_values: ["REELS"], value: 8 },
                        { dimension_values: ["FEED"], value: 4 },
                      ],
                    },
                  ],
                },
              },
            ],
          });
        }
        if (p.get("metric") === "engaged_audience_demographics") {
          return response({
            data: [
              {
                name: "engaged_audience_demographics",
                total_value: {
                  breakdowns: [
                    { results: [{ dimension_values: ["ID"], value: 3 }] },
                  ],
                },
              },
            ],
          });
        }
        if (p.get("metric") === "follower_demographics") {
          const dim = p.get("breakdown");
          return response({
            data: [
              {
                name: "follower_demographics",
                total_value: {
                  breakdowns: [
                    {
                      results: [
                        {
                          dimension_values: [dim === "age" ? "25-34" : "X"],
                          value: 7,
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          });
        }
        return response({ data: [] });
      }
      if (url.pathname.endsWith("/me")) {
        return response({
          id: "u",
          user_id: "ig",
          username: "c",
          account_type: "BUSINESS",
          followers_count: 5,
        });
      }
      return response({ error: { message: "unknown" } }, 404);
    });

    const snapshot = await fetchInstagramSnapshot(
      fetcher,
      "token",
      new Date("2026-09-05T12:00:00Z"),
    );

    expect(snapshot.dailyMetrics).toEqual([
      { metric_date: "2026-09-04", reach: 10 },
      { metric_date: "2026-09-05", reach: 12, followers_count: 5 },
    ]);
    expect(snapshot.metric).toMatchObject({
      metric_date: "2026-09-05",
      views: 33,
      follows: 9,
      unfollows: 4,
    });
    expect(snapshot.breakdowns).toContainEqual({
      metric_date: "2026-09-05",
      metric: "reach",
      product_type: "REELS",
      value: 8,
    });
    expect(snapshot.audience).toContainEqual({
      snapshot_date: "2026-09-05",
      dimension: "age",
      label: "25-34",
      value: 7,
    });
    expect(snapshot.audience).toContainEqual({
      snapshot_date: "2026-09-05",
      dimension: "engaged_country",
      label: "ID",
      value: 3,
    });
    expect(snapshot.media[0]).toMatchObject({
      media_product_type: "REELS",
      views: 900,
      avg_watch_time_ms: 7300,
      skip_rate: 0.42,
      profile_visits: null,
    });
    const ts = fetcher.mock.calls
      .map(([i]) => new URL(String(i)))
      .find((u) => u.searchParams.get("metric_type") === "time_series");
    const since = Number(ts?.searchParams.get("since"));
    expect(Math.round((Date.UTC(2026, 8, 5, 12) / 1000 - since) / 86_400)).toBe(
      29,
    );
  });

  it("refreshes a long-lived token using the official endpoint", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response({ access_token: "new-token", expires_in: 5_184_000 }),
      );

    await expect(refreshInstagramToken(fetcher, "old-token")).resolves.toEqual({
      accessToken: "new-token",
      expiresIn: 5_184_000,
    });
    expect(String(fetcher.mock.calls[0][0])).toContain("refresh_access_token");
  });
});
