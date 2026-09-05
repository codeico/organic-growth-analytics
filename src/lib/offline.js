const CACHE_NAME = "oga-private-v1";

/** @param {string} userId */
function snapshotRequest(userId) {
  return new Request(
    `https://offline.organic-growth.local/dashboard/${encodeURIComponent(userId)}`,
  );
}

/**
 * @param {CacheStorage} cacheStorage
 * @param {string} userId
 * @param {Record<string, unknown>} snapshot
 */
export async function saveDashboardSnapshot(cacheStorage, userId, snapshot) {
  const cache = await cacheStorage.open(CACHE_NAME);
  await cache.put(
    snapshotRequest(userId),
    new Response(
      JSON.stringify({
        ...snapshot,
        userId,
        savedAt: new Date().toISOString(),
      }),
      {
        headers: { "content-type": "application/json" },
      },
    ),
  );
}

/** @param {CacheStorage} cacheStorage @param {string} userId */
export async function loadDashboardSnapshot(cacheStorage, userId) {
  const cache = await cacheStorage.open(CACHE_NAME);
  const response = await cache.match(snapshotRequest(userId));
  if (!response) return null;
  const snapshot = await response.json();
  return snapshot.userId === userId ? snapshot : null;
}

/** @param {CacheStorage} cacheStorage @param {string} userId */
export async function clearDashboardSnapshot(cacheStorage, userId) {
  const cache = await cacheStorage.open(CACHE_NAME);
  await cache.delete(snapshotRequest(userId));
}
