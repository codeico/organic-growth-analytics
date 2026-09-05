import { describe, expect, it } from "vitest";
import {
  buildAnalyticsContext,
  buildMessages,
} from "../supabase/functions/_shared/ai.js";

const account = { username: "creator", account_type: "MEDIA_CREATOR" };
const metrics = [
  { metric_date: "2026-09-01", followers_count: 100, reach: 10, views: 50 },
  { metric_date: "2026-09-07", followers_count: 110, reach: 30, views: 90 },
];
const media = [
  {
    caption: "Reel A",
    media_product_type: "REELS",
    published_at: "2026-09-02T13:00:00Z",
    reach: 500,
    likes: 40,
    comments: 3,
    saved: 2,
    shares: 1,
    views: 900,
  },
];
const audience = [
  { dimension: "country", label: "ID", value: 80 },
  { dimension: "age", label: "25-34", value: 40 },
];

describe("AI analytics context", () => {
  it("serialises only real numbers from the database", () => {
    const context = buildAnalyticsContext({
      account,
      metrics,
      media,
      audience,
    });
    expect(context).toContain("creator");
    expect(context).toContain("followers 100 -> 110");
    expect(context).toContain("Reel A");
    expect(context).toContain("ID: 80");
    expect(context).not.toMatch(/undefined|NaN/);
  });

  it("builds a grounded prompt per mode and refuses to invent data", () => {
    const summary = buildMessages("summary", "ctx", "");
    expect(summary[0].role).toBe("system");
    expect(summary[0].content).toMatch(/jangan mengarang|tidak tersedia/i);
    expect(summary.at(-1).content).toContain("ctx");

    const ask = buildMessages("ask", "ctx", "kenapa reach turun?");
    expect(ask.at(-1).content).toContain("kenapa reach turun?");

    expect(() => buildMessages("hack", "ctx", "")).toThrow();
  });
});
