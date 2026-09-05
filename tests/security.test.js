import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("browser credential boundary", () => {
  it("does not reference privileged credentials in client source", () => {
    const source = files("src")
      .filter((path) => /\.(js|jsx)$/.test(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(source).not.toMatch(/INSTAGRAM_(ACCESS_TOKEN|APP_SECRET)/);
    expect(source).not.toMatch(/SUPABASE_(SECRET|SERVICE_ROLE)/);
    expect(source).not.toMatch(/VITE_.*(?:SECRET|TOKEN|PASSWORD)/);
  });
});
