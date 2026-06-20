import { describe, expect, it } from "vitest";
import type { Database } from "@repo/db";
import { membersToPdf } from "./pdf-export.js";

type MemberRow = Database["public"]["Tables"]["members"]["Row"];

function member(overrides: Partial<MemberRow>): MemberRow {
  return {
    first_name: "Jane",
    last_name: "Doe",
    preferred_name: null,
    email: "jane@example.com",
    phone: "+254700000000",
    status: "active",
    city: "Nairobi",
    joined_at: "2024-01-01",
    ...overrides,
  } as unknown as MemberRow;
}

describe("membersToPdf", () => {
  it("produces a PDF buffer with the PDF magic header", async () => {
    const buf = await membersToPdf([member({}), member({ first_name: "John" })], { title: "Test" });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(100);
  });

  it("handles an empty member list", async () => {
    const buf = await membersToPdf([]);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
