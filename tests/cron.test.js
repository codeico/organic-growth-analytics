import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const initial = readFileSync(
  new URL(
    "../supabase/migrations/202609050005_daily_instagram_sync.sql",
    import.meta.url,
  ),
  "utf8",
);
const batched = readFileSync(
  new URL(
    "../supabase/migrations/202609050006_batched_instagram_sync.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("daily Instagram sync", () => {
  it("uses pg_cron and reads the request secret from Vault", () => {
    expect(initial).toContain("create extension if not exists pg_cron");
    expect(initial).toContain("create extension if not exists pg_net");
    expect(initial).toContain("instagram_sync_cron_secret");
    expect(initial).not.toMatch(/x-cron-secret',\s*'[A-Za-z0-9_-]{20,}/);
  });

  it("fans out bounded per-account sync jobs", () => {
    expect(batched).toContain("*/5 * * * *");
    expect(batched).toMatch(/limit 20/i);
    expect(batched).toContain("jsonb_build_object('account_id', account.id)");
    expect(batched).toContain("/functions/v1/instagram-sync");
  });
});
