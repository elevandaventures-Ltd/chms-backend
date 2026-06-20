import { parse } from "csv-parse/sync";
import { z } from "zod";
import { memberStatusZ } from "./schemas.js";

/**
 * CSV parsing + field mapping + per-row validation for the member import endpoint
 * (POST /members/import). Pure and side-effect-free: it turns raw CSV text into
 * cleaned, validated member rows plus a row-level error list, with no database or
 * network access. The route layer ([routes/members-import.ts]) handles duplicate
 * detection against the DB and the actual inserts.
 *
 * Headers are matched leniently (case-insensitive, punctuation-normalised, with a
 * generous alias table) so a spreadsheet exported from anywhere has a fair chance
 * of mapping cleanly. Anything we don't recognise is reported as an ignored column
 * rather than failing the import. Two failure tiers:
 *   - File/header problems (empty file, missing required column, ambiguous columns,
 *     unparseable CSV) throw {@link CsvImportError} -> the route returns 400.
 *   - Per-row problems (bad email, unknown status, ...) are collected as
 *     {@link ImportRowError} and the row is skipped; the rest of the import proceeds.
 */

/** The member columns importable from a CSV (snake_case, matching the DB row). */
export const IMPORT_FIELDS = [
  "first_name",
  "last_name",
  "preferred_name",
  "email",
  "phone",
  "date_of_birth",
  "gender",
  "marital_status",
  "address_line1",
  "address_line2",
  "city",
  "state_region",
  "postal_code",
  "country",
  "neighbourhood",
  "status",
  "joined_at",
  "notes",
  "geo_lat",
  "geo_lng",
] as const;

type ImportField = (typeof IMPORT_FIELDS)[number];

/**
 * Maps a normalised header (see {@link normalizeHeader}) to a member field.
 * Generous on purpose: real-world CSVs spell these many ways.
 */
const HEADER_ALIASES: Record<string, ImportField> = {
  first_name: "first_name",
  firstname: "first_name",
  first: "first_name",
  given_name: "first_name",
  last_name: "last_name",
  lastname: "last_name",
  last: "last_name",
  surname: "last_name",
  family_name: "last_name",
  preferred_name: "preferred_name",
  nickname: "preferred_name",
  goes_by: "preferred_name",
  email: "email",
  email_address: "email",
  e_mail: "email",
  mail: "email",
  phone: "phone",
  phone_number: "phone",
  mobile: "phone",
  mobile_number: "phone",
  cell: "phone",
  cellphone: "phone",
  telephone: "phone",
  tel: "phone",
  msisdn: "phone",
  date_of_birth: "date_of_birth",
  dob: "date_of_birth",
  birthdate: "date_of_birth",
  birth_date: "date_of_birth",
  gender: "gender",
  sex: "gender",
  marital_status: "marital_status",
  marriage_status: "marital_status",
  address_line1: "address_line1",
  address: "address_line1",
  address1: "address_line1",
  street: "address_line1",
  street_address: "address_line1",
  address_line2: "address_line2",
  address2: "address_line2",
  city: "city",
  town: "city",
  state_region: "state_region",
  state: "state_region",
  region: "state_region",
  province: "state_region",
  postal_code: "postal_code",
  zip: "postal_code",
  zip_code: "postal_code",
  postcode: "postal_code",
  country: "country",
  neighbourhood: "neighbourhood",
  neighborhood: "neighbourhood",
  area: "neighbourhood",
  suburb: "neighbourhood",
  status: "status",
  member_status: "status",
  joined_at: "joined_at",
  joined: "joined_at",
  join_date: "joined_at",
  date_joined: "joined_at",
  membership_date: "joined_at",
  notes: "notes",
  note: "notes",
  comments: "notes",
  geo_lat: "geo_lat",
  latitude: "geo_lat",
  lat: "geo_lat",
  geo_lng: "geo_lng",
  longitude: "geo_lng",
  lng: "geo_lng",
  lon: "geo_lng",
  long: "geo_lng",
};

/**
 * One validated, cleaned member row (snake_case, ready to spread into a members
 * Insert). Every field but first_name is optional; empty cells become absent.
 */
const importRowZ = z.object({
  first_name: z.string().trim().min(1).max(200),
  last_name: z.string().trim().max(200).optional(),
  preferred_name: z.string().trim().max(200).optional(),
  email: z.email().max(320).optional(),
  phone: z.string().trim().max(50).optional(),
  date_of_birth: z.iso.date().optional(),
  gender: z.string().trim().max(50).optional(),
  marital_status: z.string().trim().max(50).optional(),
  address_line1: z.string().trim().max(300).optional(),
  address_line2: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  state_region: z.string().trim().max(120).optional(),
  postal_code: z.string().trim().max(40).optional(),
  country: z.string().trim().max(120).optional(),
  neighbourhood: z.string().trim().max(200).optional(),
  // Case-insensitive: "Active" / "ACTIVE" -> "active" before the enum check.
  status: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    memberStatusZ.optional(),
  ),
  joined_at: z.iso.date().optional(),
  notes: z.string().trim().max(10_000).optional(),
  geo_lat: z.coerce.number().min(-90).max(90).optional(),
  geo_lng: z.coerce.number().min(-180).max(180).optional(),
});

export type MemberImportRow = z.infer<typeof importRowZ>;

/** A row that failed validation (or, later, failed to insert). 1-based file line. */
export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

/** A successfully parsed row, tagged with its file line for error reporting. */
export interface ParsedRow {
  row: number;
  data: MemberImportRow;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: ImportRowError[];
  ignoredColumns: string[];
  /** Data rows considered (valid + failed); blank lines excluded. */
  totalRows: number;
  /** Rows that failed validation (counted once even when they have many issues). */
  failedRows: number;
}

/** A file/header-level problem that prevents the import from running at all. */
export class CsvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvImportError";
  }
}

/** lowercase, collapse runs of space/punctuation to a single underscore, trim `_`. */
function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Parse member CSV text into validated rows + a row-level error list.
 *
 * @throws {CsvImportError} on file/header problems (empty, unparseable, missing
 *   `first_name`, or two columns mapping to the same field).
 */
export function parseMembersCsv(text: string, opts?: { maxRows?: number }): ParseResult {
  const maxRows = opts?.maxRows ?? 5000;

  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as string[][];
  } catch (err) {
    throw new CsvImportError(`Could not parse the CSV file: ${(err as Error).message}`);
  }

  const header = records[0];
  if (!header) {
    throw new CsvImportError("The CSV file is empty.");
  }
  const fieldByIndex = header.map((h) => HEADER_ALIASES[normalizeHeader(h)] ?? null);

  // Reject two columns mapping to the same field — silently dropping one would
  // hide data loss from the user.
  const mapped = new Set<ImportField>();
  for (const field of fieldByIndex) {
    if (!field) continue;
    if (mapped.has(field)) {
      throw new CsvImportError(
        `Two columns both map to "${field}". Remove or rename the duplicate column.`,
      );
    }
    mapped.add(field);
  }

  if (!mapped.has("first_name")) {
    throw new CsvImportError(
      'Missing required column "first_name" (a column for the member\'s first name).',
    );
  }

  const ignoredColumns = header.filter((h, i) => fieldByIndex[i] === null && h.trim() !== "");

  const dataRecords = records.slice(1);
  if (dataRecords.length > maxRows) {
    throw new CsvImportError(
      `Too many rows: ${dataRecords.length} (maximum ${maxRows}). Split the file and import in batches.`,
    );
  }

  const rows: ParsedRow[] = [];
  const errors: ImportRowError[] = [];
  let failedRows = 0;

  for (let i = 0; i < dataRecords.length; i++) {
    const rec = dataRecords[i];
    if (!rec) continue;
    const rowNumber = i + 2; // file line: header is line 1, first data row is line 2.

    const raw: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      const field = fieldByIndex[c];
      if (!field) continue;
      const cell = (rec[c] ?? "").trim();
      if (cell !== "") raw[field] = cell;
    }

    // A wholly empty line (e.g. trailing commas) isn't a row; skip and don't count.
    if (Object.keys(raw).length === 0) continue;

    const result = importRowZ.safeParse(raw);
    if (!result.success) {
      failedRows++;
      for (const issue of result.error.issues) {
        errors.push({
          row: rowNumber,
          field: typeof issue.path[0] === "string" ? issue.path[0] : undefined,
          message: issue.message,
        });
      }
      continue;
    }

    rows.push({ row: rowNumber, data: result.data });
  }

  return { rows, errors, ignoredColumns, totalRows: rows.length + failedRows, failedRows };
}
