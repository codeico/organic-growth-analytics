const CACHE = "oga-shell-v9";
const SHELL = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(
        SHELL.map(async (path) => {
          const asset = await fetch(path, { cache: "reload" });
          if (asset.ok) await cache.put(path, asset);
        }),
      );
      const response = await fetch("/index.html", { cache: "reload" });
      if (!response.ok) return;
      const html = await response.clone().text();
      const assets = [
        ...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g),
      ].map((match) => match[1]);
      await cache.put("/index.html", response);
      await Promise.allSettled(
        [...new Set(assets)].map(async (path) => {
          const asset = await fetch(path, { cache: "reload" });
          if (asset.ok) await cache.put(path, asset);
        }),
      );
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("oga-shell-") && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  if (url.pathname.startsWith("/auth/confirm")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE);
        return (
          (await cache.match("/index.html")) ?? cache.match("/offline.html")
        );
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ??
          fetch(event.request).then((response) => {
            if (response.ok) {
              caches
                .open(CACHE)
                .then((cache) => cache.put(event.request, response.clone()));
            }
            return response;
          }),
      ),
    );
  }
});
