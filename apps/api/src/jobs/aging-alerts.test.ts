import { describe, expect, it } from "vitest";
import { bucketFor } from "./aging-alerts.js";

describe("bucketFor", () => {
  it("returns null for an active member (< 30 days, or negative clock skew)", () => {
    expect(bucketFor(0)).toBeNull();
    expect(bucketFor(29)).toBeNull();
    expect(bucketFor(-5)).toBeNull();
  });

  it("buckets 30–59 days as 30", () => {
    expect(bucketFor(30)).toBe(30);
    expect(bucketFor(59)).toBe(30);
  });

  it("buckets 60–89 days as 60", () => {
    expect(bucketFor(60)).toBe(60);
    expect(bucketFor(89)).toBe(60);
  });

  it("buckets 90+ days as 90", () => {
    expect(bucketFor(90)).toBe(90);
    expect(bucketFor(365)).toBe(90);
  });
});
