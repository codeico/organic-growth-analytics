import { describe, expect, it, vi } from "vitest";
import {
  beginInstagramConnection,
  requestInstagramSync,
  buildMetricSummary,
  buildTrendPoints,
  pickAccount,
} from "../src/lib/dashboard.js";

describe("dashboard data", () => {
  it("falls back to the first owned account", () => {
    const accounts = [{ id: "account-a" }, { id: "account-b" }];
    expect(pickAccount(accounts, "unknown")?.id).toBe("account-a");
    expect(pickAccount(accounts, "account-b")?.id).toBe("account-b");
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
});
