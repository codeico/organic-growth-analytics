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
        return response({
          data: [
            { name: "reach", total_value: { value: 100 } },
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
    const demographics = calls.find((url) => url.searchParams.has("breakdown"));
    expect(accountInsights?.searchParams.get("since")).toMatch(/^\d+$/);
    expect(demographics?.searchParams.get("timeframe")).toBe("this_month");
    expect(demographics?.searchParams.has("since")).toBe(false);
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
