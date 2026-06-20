import { describe, expect, it } from "vitest";
import type { Database } from "@repo/db";
import { EXPORT_COLUMNS, membersToCsv } from "./csv-export.js";

type MemberRow = Database["public"]["Tables"]["members"]["Row"];

function member(overrides: Partial<MemberRow>): MemberRow {
  return {
    first_name: "Jane",
    last_name: null,
    preferred_name: null,
    email: null,
    phone: null,
    status: "active",
    gender: null,
    marital_status: null,
    date_of_birth: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state_region: null,
    postal_code: null,
    country: null,
    neighbourhood: null,
    joined_at: null,
    ...overrides,
  } as unknown as MemberRow;
}

describe("membersToCsv", () => {
  it("emits the header row from EXPORT_COLUMNS", () => {
    const csv = membersToCsv([]);
    const firstLine = csv.split("\n")[0]?.trim();
    expect(firstLine).toBe(EXPORT_COLUMNS.map((c) => c.label).join(","));
  });

  it("renders values and leaves nulls empty", () => {
    const csv = membersToCsv([
      member({ first_name: "Jane", last_name: "Doe", email: "jane@example.com", status: "active" }),
    ]);
    // first_name, last_name, preferred_name(empty), email, ...
    expect(csv).toContain("Jane,Doe,,jane@example.com");
  });

  it("quotes values containing commas", () => {
    const csv = membersToCsv([member({ first_name: "Jane", city: "Springfield, IL" })]);
    expect(csv).toContain('"Springfield, IL"');
  });
});
