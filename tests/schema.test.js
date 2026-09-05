import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../supabase/migrations/202609050002_instagram_analytics.sql",
  import.meta.url,
);

describe("Instagram analytics schema", () => {
  it("enforces five accounts per user and read-only browser access", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/count\(\*\).*>= 5/is);
    expect(sql).toMatch(/revoke all.*from anon, authenticated/is);
    expect(sql).toMatch(/grant select.*to authenticated/is);
  });

  it("keeps access tokens outside the public schema", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("private.instagram_tokens");
    expect(sql).not.toMatch(/create table public\.instagram_tokens/i);
  });
});
