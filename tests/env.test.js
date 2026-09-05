import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "../src/lib/env.js";

describe("parsePublicEnv", () => {
  it("accepts a Supabase URL and publishable key", () => {
    expect(
      parsePublicEnv({
        VITE_SUPABASE_URL: "https://project.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      }),
    ).toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabaseKey: "sb_publishable_test",
    });
  });

  it("rejects missing configuration", () => {
    expect(() => parsePublicEnv({})).toThrow(
      "Konfigurasi Supabase belum lengkap",
    );
  });
});
