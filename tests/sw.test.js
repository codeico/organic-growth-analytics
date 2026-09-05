import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

describe("service worker", () => {
  it("precaches the public app shell without private data", () => {
    expect(sw).toContain('const CACHE = "oga-shell-v8"');
    expect(sw).toContain('"/index.html"');
    expect(sw).toContain('"/offline.html"');
    expect(sw).not.toMatch(/token|functions\/v1/);
  });

  it("serves only the current app shell and its built assets offline", () => {
    expect(sw).toContain("caches.open(CACHE)");
    expect(sw).toContain('cache.match("/index.html")');
    expect(sw).not.toContain('caches.match("/index.html")');
    expect(sw).toMatch(/response(?:\.clone\(\))?\.text\(\)/);
    expect(sw).toContain("/assets/");
    expect(sw).toContain("Promise.allSettled");
    expect(sw).not.toContain("cache.addAll(SHELL)");
  });

  it("lets an installed update activate on request", () => {
    expect(sw).toContain('event.data === "SKIP_WAITING"');
  });

  it("never intercepts Supabase or cross-origin requests", () => {
    expect(sw).toContain("url.origin !== self.location.origin");
    expect(sw).toContain('url.pathname.startsWith("/auth/confirm")');
  });
});
