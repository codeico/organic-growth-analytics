import { describe, expect, it, vi } from "vitest";
import {
  beginInstagramConnection,
  requestInstagramSync,
  requestAiInsight,
  buildMetricSummary,
  buildTrendPoints,
  mergeAnalytics,
  parseInline,
  parseMarkdown,
  pickAccounts,
  sumWindow,
  summarizeContent,
} from "../src/lib/dashboard.js";

describe("dashboard data", () => {
  it("keeps existing selections and falls back to the first account", () => {
    const accounts = [{ id: "account-a" }, { id: "account-b" }];
    expect(pickAccounts(accounts, ["unknown"]).map((a) => a.id)).toEqual([
      "account-a",
    ]);
    expect(
      pickAccounts(accounts, ["account-b", "gone"]).map((a) => a.id),
    ).toEqual(["account-b"]);
    expect(pickAccounts(accounts, ["account-a", "account-b"]).length).toBe(2);
  });

  it("uses real latest metrics and calculates period growth", () => {
    const summary = buildMetricSummary([
      {
        metric_date: "2026-09-01",
        followers_count: 100,
        reach: 200,
        total_interactions: 20,
        accounts_engaged: 10,
      },
      {
        metric_date: "2026-09-02",
        followers_count: 110,
        reach: 250,
        total_interactions: 30,
        accounts_engaged: 14,
      },
    ]);

    expect(summary).toMatchObject({
      followers: 110,
      followerGrowth: 10,
      reach: 250,
      interactions: 30,
      accountsEngaged: 14,
    });
  });

  it("maps real follower values into an SVG trend without inventing missing days", () => {
    expect(
      buildTrendPoints(
        [
          { metric_date: "2026-09-01", followers_count: 100 },
          { metric_date: "2026-09-03", followers_count: 120 },
        ],
        300,
        120,
      ),
    ).toEqual("0,120 300,0");
    expect(
      buildTrendPoints(
        [
          { metric_date: "2026-09-01", reach: 5 },
          { metric_date: "2026-09-02", reach: 10 },
        ],
        100,
        50,
        "reach",
      ),
    ).toEqual("0,50 100,0");
  });

  it("sums the period and compares against the previous window", () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({
      metric_date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      reach: i < 7 ? 10 : 20,
      views: null,
    }));
    expect(sumWindow(rows, "reach", 7)).toEqual({
      current: 140,
      previous: 70,
      change: 1,
    });
    expect(sumWindow(rows, "views", 7)).toEqual({
      current: null,
      previous: null,
      change: null,
    });
  });

  it("compares content by format and finds the best publishing hour from real posts", () => {
    const media = [
      {
        media_product_type: "REELS",
        published_at: "2026-09-01T13:00:00Z",
        reach: 300,
        total_interactions: 30,
      },
      {
        media_product_type: "REELS",
        published_at: "2026-09-02T13:30:00Z",
        reach: 100,
        total_interactions: 10,
      },
      {
        media_product_type: "FEED",
        published_at: "2026-09-03T02:00:00Z",
        reach: 50,
        total_interactions: 2,
      },
    ];
    const summary = summarizeContent(media);
    expect(summary.byFormat).toEqual([
      { format: "REELS", count: 2, avgReach: 200, avgInteractions: 20 },
      { format: "FEED", count: 1, avgReach: 50, avgInteractions: 2 },
    ]);
    // 13:00Z = 20:00 WIB; 02:00Z = 09:00 WIB
    expect(summary.bestHours[0]).toEqual({ hour: 20, count: 2, avgReach: 200 });
    expect(summarizeContent([]).bestHours).toEqual([]);
  });

  it("merges several accounts by summing per day, label, and breakdown", () => {
    const merged = mergeAnalytics([
      {
        metrics: [
          {
            account_id: "a",
            metric_date: "2026-09-01",
            reach: 10,
            followers_count: 100,
          },
          {
            account_id: "a",
            metric_date: "2026-09-02",
            reach: 12,
            followers_count: 101,
          },
        ],
        media: [{ id: "m1", published_at: "2026-09-01T00:00:00Z", reach: 5 }],
        audience: [
          {
            snapshot_date: "2026-09-02",
            dimension: "country",
            label: "ID",
            value: 70,
          },
        ],
        breakdowns: [
          {
            metric_date: "2026-09-02",
            metric: "reach",
            product_type: "REELS",
            value: 8,
          },
        ],
      },
      {
        metrics: [
          {
            account_id: "b",
            metric_date: "2026-09-02",
            reach: 3,
            followers_count: 50,
            views: 9,
          },
        ],
        media: [{ id: "m2", published_at: "2026-09-02T00:00:00Z", reach: 7 }],
        audience: [
          {
            snapshot_date: "2026-09-01",
            dimension: "country",
            label: "ID",
            value: 30,
          },
          {
            snapshot_date: "2026-09-01",
            dimension: "country",
            label: "MY",
            value: 5,
          },
        ],
        breakdowns: [
          {
            metric_date: "2026-09-02",
            metric: "reach",
            product_type: "REELS",
            value: 2,
          },
        ],
      },
    ]);
    expect(merged.metrics).toEqual([
      { metric_date: "2026-09-01", reach: 10, followers_count: 100 },
      { metric_date: "2026-09-02", reach: 15, followers_count: 151, views: 9 },
    ]);
    expect(merged.media.map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(merged.audience).toEqual([
      { dimension: "country", label: "ID", value: 100 },
      { dimension: "country", label: "MY", value: 5 },
    ]);
    expect(merged.breakdowns).toEqual([
      {
        metric_date: "2026-09-02",
        metric: "reach",
        product_type: "REELS",
        value: 10,
      },
    ]);
  });

  it("asks the AI edge function for a grounded insight", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { answer: "Reach naik 2x.", mode: "summary" },
      error: null,
    });
    await expect(
      requestAiInsight({ functions: { invoke } }, "account-a", "summary", ""),
    ).resolves.toBe("Reach naik 2x.");
    expect(invoke).toHaveBeenCalledWith("ai-insights", {
      body: { account_id: "account-a", mode: "summary", question: "" },
    });
  });

  it("returns the Instagram OAuth URL from the server boundary", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { url: "https://instagram.com/oauth/authorize" },
      error: null,
    });
    await expect(
      beginInstagramConnection({ functions: { invoke } }),
    ).resolves.toBe("https://instagram.com/oauth/authorize");
    expect(invoke).toHaveBeenCalledWith("instagram-connect");
  });

  it("surfaces a safe server error when Instagram secrets are missing", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: {
        context: {
          json: vi.fn().mockResolvedValue({
            error: "Koneksi Instagram belum dikonfigurasi",
          }),
        },
      },
    });
    await expect(
      beginInstagramConnection({ functions: { invoke } }),
    ).rejects.toThrow("Koneksi Instagram belum dikonfigurasi");
  });

  it("requests a user-scoped manual sync", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { results: [{ account_id: "account-a", status: "succeeded" }] },
      error: null,
    });
    await expect(
      requestInstagramSync({ functions: { invoke } }),
    ).resolves.toEqual([{ account_id: "account-a", status: "succeeded" }]);
    expect(invoke).toHaveBeenCalledWith("instagram-sync");
  });

  it("parses the AI markdown subset into blocks without touching HTML", () => {
    const blocks = parseMarkdown(
      "## Temuan\n- reach **13.391**\n- views 27.106\n\n## Langkah\n1. Posting jam 19:00\n2. Ulangi reels\nCatatan <b>x</b>",
    );
    expect(blocks).toEqual([
      { type: "h2", text: "Temuan" },
      { type: "ul", items: ["reach **13.391**", "views 27.106"] },
      { type: "h2", text: "Langkah" },
      { type: "ol", items: ["Posting jam 19:00", "Ulangi reels"] },
      { type: "p", text: "Catatan <b>x</b>" },
    ]);
    expect(parseInline("reach **13.391** naik")).toEqual([
      { bold: false, text: "reach " },
      { bold: true, text: "13.391" },
      { bold: false, text: " naik" },
    ]);
  });
});
