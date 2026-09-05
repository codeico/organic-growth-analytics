import { describe, expect, it } from "vitest";
import { routeForUser } from "../src/lib/access.js";

describe("routeForUser", () => {
  it("redirects an anonymous dashboard request to login", () => {
    expect(routeForUser("/dashboard", null)).toBe("/login");
  });

  it("allows a signed-in dashboard request", () => {
    expect(routeForUser("/dashboard", { id: "user-1" })).toBe("/dashboard");
  });
});
