import { describe, expect, it, vi } from "vitest";
import {
  clearDashboardSnapshot,
  loadDashboardSnapshot,
  saveDashboardSnapshot,
} from "../src/lib/offline.js";

function fakeCaches() {
  const values = new Map();
  return {
    open: vi.fn().mockResolvedValue({
      put: vi.fn(async (request, response) => {
        values.set(request.url, response.clone());
      }),
      match: vi.fn(async (request) => values.get(request.url)),
      delete: vi.fn(async (request) => values.delete(request.url)),
    }),
  };
}

describe("offline dashboard snapshot", () => {
  it("stores and restores only the signed-in user's last dashboard", async () => {
    const cacheStorage = fakeCaches();
    const snapshot = {
      accounts: [{ id: "account-a", username: "creator" }],
      selectedIds: ["account-a"],
      analytics: {
        accountId: "account-a",
        metrics: [],
        media: [],
        audience: [],
      },
    };

    await saveDashboardSnapshot(cacheStorage, "user-a", snapshot);

    await expect(
      loadDashboardSnapshot(cacheStorage, "user-a"),
    ).resolves.toMatchObject(snapshot);
    await expect(
      loadDashboardSnapshot(cacheStorage, "user-b"),
    ).resolves.toBeNull();
  });

  it("removes the user's private snapshot on logout", async () => {
    const cacheStorage = fakeCaches();
    await saveDashboardSnapshot(cacheStorage, "user-a", {
      accounts: [],
      selectedIds: [],
      analytics: { accountId: null, metrics: [], media: [], audience: [] },
    });

    await clearDashboardSnapshot(cacheStorage, "user-a");

    await expect(
      loadDashboardSnapshot(cacheStorage, "user-a"),
    ).resolves.toBeNull();
  });
});
