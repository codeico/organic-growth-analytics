import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

describe("service worker", () => {
  it("only precaches public shell assets", () => {
    expect(sw).toContain('"/offline.html"');
    expect(sw).not.toMatch(/dashboard|token|auth\/confirm|functions\/v1/);
  });

  it("does not cache API or authentication requests", () => {
    expect(sw).toContain('event.request.mode !== "navigate"');
    expect(sw).toContain(
      'fetch(event.request).catch(() => caches.match("/offline.html"))',
    );
  });
});
