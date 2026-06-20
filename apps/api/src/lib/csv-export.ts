import { stringify } from "csv-stringify/sync";
import type { Database } from "@repo/db";

/**
 * Member directory -> CSV. The column set is the human-friendly, flat projection
 * of a member used by both the export endpoint and bulk export. csv-stringify
 * handles quoting/escaping (commas, quotes, newlines in values). Null cells become
 * empty strings. Pairs with pdf-export.ts, which renders a reduced set for print.
 */

type MemberRow = Database["public"]["Tables"]["members"]["Row"];

/** Exported columns, in order, with their CSV header label. */
export const EXPORT_COLUMNS: { key: keyof MemberRow; label: string }[] = [
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "preferred_name", label: "Preferred Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "status", label: "Status" },
  { key: "gender", label: "Gender" },
  { key: "marital_status", label: "Marital Status" },
  { key: "date_of_birth", label: "Date of Birth" },
  { key: "address_line1", label: "Address Line 1" },
  { key: "address_line2", label: "Address Line 2" },
  { key: "city", label: "City" },
  { key: "state_region", label: "State/Region" },
  { key: "postal_code", label: "Postal Code" },
  { key: "country", label: "Country" },
  { key: "neighbourhood", label: "Neighbourhood" },
  { key: "joined_at", label: "Joined" },
];

function cell(value: MemberRow[keyof MemberRow]): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Render members as a CSV string (header row + one row per member). */
export function membersToCsv(members: MemberRow[]): string {
  const header = EXPORT_COLUMNS.map((c) => c.label);
  const rows = members.map((m) => EXPORT_COLUMNS.map((c) => cell(m[c.key])));
  return stringify([header, ...rows]);
}
