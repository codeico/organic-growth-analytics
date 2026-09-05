import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name) =>
  readFileSync(
    new URL(`../supabase/functions/${name}/index.ts`, import.meta.url),
    "utf8",
  );

describe("Instagram OAuth Edge Functions", () => {
  it("authenticates connect requests and stores one-time state", () => {
    const source = read("instagram-connect");
    expect(source).toContain("auth.getUser");
    expect(source).toContain('from("instagram_oauth_states")');
    expect(source).toContain("instagram_business_manage_insights");
  });

  it("exchanges codes server-side and encrypts long-lived tokens", () => {
    const source = read("instagram-callback");
    expect(source).toContain("api.instagram.com/oauth/access_token");
    expect(source).toContain("graph.instagram.com/access_token");
    expect(source).toContain("crypto.subtle.encrypt");
    expect(source).not.toMatch(/access_token.*redirect/i);
  });
});
