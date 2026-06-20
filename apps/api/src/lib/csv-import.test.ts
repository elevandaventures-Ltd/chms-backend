import { describe, expect, it } from "vitest";
import { CsvImportError, parseMembersCsv } from "./csv-import.js";

describe("parseMembersCsv — headers", () => {
  it("maps aliased, mixed-case, punctuated headers to member fields", () => {
    const csv = ["First Name,E-mail,Mobile Number,Member Status", "Jane,jane@example.com,+254700000000,Active"].join(
      "\n",
    );
    const result = parseMembersCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.data).toMatchObject({
      first_name: "Jane",
      email: "jane@example.com",
      phone: "+254700000000",
      status: "active",
    });
    expect(result.ignoredColumns).toEqual([]);
  });

  it("reports unrecognised columns as ignored without failing", () => {
    const csv = ["first_name,favourite_colour", "Jane,blue"].join("\n");
    const result = parseMembersCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.ignoredColumns).toEqual(["favourite_colour"]);
  });

  it("throws when the required first_name column is missing", () => {
    const csv = ["last_name,email", "Doe,jane@example.com"].join("\n");
    expect(() => parseMembersCsv(csv)).toThrow(CsvImportError);
  });

  it("throws when two columns map to the same field", () => {
    const csv = ["first_name,firstname", "Jane,Janet"].join("\n");
    expect(() => parseMembersCsv(csv)).toThrow(/both map to/i);
  });

  it("throws on an empty file", () => {
    expect(() => parseMembersCsv("")).toThrow(CsvImportError);
  });
});

describe("parseMembersCsv — rows", () => {
  it("collects a row-level error (with line + field) and skips the bad row", () => {
    const csv = [
      "first_name,email",
      "Jane,jane@example.com",
      "Bad,not-an-email",
      "Mary,mary@example.com",
    ].join("\n");
    const result = parseMembersCsv(csv);

    expect(result.rows.map((r) => r.data.first_name)).toEqual(["Jane", "Mary"]);
    expect(result.failedRows).toBe(1);
    expect(result.errors).toHaveLength(1);
    // "Bad" is on file line 3 (header is line 1).
    expect(result.errors[0]).toMatchObject({ row: 3, field: "email" });
    expect(result.totalRows).toBe(3);
  });

  it("rejects an unknown status value", () => {
    const csv = ["first_name,status", "Jane,vip"].join("\n");
    const result = parseMembersCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.failedRows).toBe(1);
    expect(result.errors[0]).toMatchObject({ row: 2, field: "status" });
  });

  it("treats empty cells as absent (not validation errors)", () => {
    const csv = ["first_name,last_name,email", "Jane,,"].join("\n");
    const result = parseMembersCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.data).toEqual({ first_name: "Jane" });
  });

  it("ignores wholly blank lines without counting them", () => {
    const csv = ["first_name,email", "Jane,jane@example.com", ",", "Mary,mary@example.com"].join(
      "\n",
    );
    const result = parseMembersCsv(csv);
    expect(result.rows).toHaveLength(2);
    expect(result.totalRows).toBe(2);
  });

  it("summarises a realistic 50-row file (47 valid, 3 invalid)", () => {
    const lines = ["first_name,last_name,email,status"];
    for (let i = 1; i <= 50; i++) {
      // Rows 10, 20, 30 carry a malformed email and should fail validation.
      const email = [10, 20, 30].includes(i) ? "bad-email" : `member${i}@example.com`;
      lines.push(`Member${i},Test,${email},active`);
    }
    const result = parseMembersCsv(lines.join("\n"));

    expect(result.totalRows).toBe(50);
    expect(result.rows).toHaveLength(47);
    expect(result.failedRows).toBe(3);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.map((e) => e.row).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([11, 21, 31]);
  });

  it("enforces the row cap", () => {
    expect(() => parseMembersCsv("first_name\nJane\nMary", { maxRows: 1 })).toThrow(/too many rows/i);
  });
});
