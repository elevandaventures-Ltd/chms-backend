import { z } from "zod";

/**
 * Zod response/entity schemas shared across the people-facing routes (members,
 * households, groups). Kept in one neutral module so, e.g., the member profile
 * can embed a household and a household's detail can embed members without the
 * route files importing each other (which would be a cycle).
 *
 * Entity schemas mirror the snake_case DB rows; request-body schemas (camelCase)
 * live with their own routes. jsonb columns are typed `unknown` so the DB Json
 * value passes through serialization untouched.
 */

/** Shared { error, message } error reply, mirroring the JSON-Schema routes. */
export const errorZ = z.object({ error: z.string(), message: z.string() });

/** Pagination metadata returned by the list endpoints. */
export const paginationZ = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});

/** A free-form JSON object (used for jsonb request fields). */
export const jsonObjectZ = z.record(z.string(), z.unknown());

export const MEMBER_STATUSES = [
  "prospect",
  "visitor",
  "active",
  "inactive",
  "transferred",
  "deceased",
  "archived",
] as const;

export const memberStatusZ = z.enum(MEMBER_STATUSES);

export const memberEventTypeZ = z.enum([
  "check_in",
  "giving",
  "group_join",
  "group_leave",
  "event_attendance",
  "pastoral_note",
  "status_change",
  "milestone",
  "communication",
  "note",
]);

/** A member as returned by the API: the public.members row (snake_case). */
export const memberZ = z.object({
  id: z.string(),
  church_id: z.string(),
  user_id: z.string().nullable(),
  first_name: z.string(),
  last_name: z.string().nullable(),
  preferred_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  gender: z.string().nullable(),
  marital_status: z.string().nullable(),
  photo_url: z.string().nullable(),
  address_line1: z.string().nullable(),
  address_line2: z.string().nullable(),
  city: z.string().nullable(),
  state_region: z.string().nullable(),
  postal_code: z.string().nullable(),
  country: z.string().nullable(),
  geo_lat: z.number().nullable(),
  geo_lng: z.number().nullable(),
  neighbourhood: z.string().nullable(),
  baptism_date: z.string().nullable(),
  communion_date: z.string().nullable(),
  confirmation_date: z.string().nullable(),
  ordination_date: z.string().nullable(),
  spiritual_milestones: z.unknown(),
  status: memberStatusZ,
  joined_at: z.string().nullable(),
  notes: z.string().nullable(),
  custom_fields: z.unknown(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const memberTimelineEventZ = z.object({
  id: z.string(),
  church_id: z.string(),
  member_id: z.string(),
  event_type: memberEventTypeZ,
  metadata: z.unknown(),
  occurred_at: z.string(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});

/** A member at-risk alert as returned by the API (public.member_alerts row). */
export const memberAlertZ = z.object({
  id: z.string(),
  church_id: z.string(),
  member_id: z.string(),
  alert_type: z.enum(["inactive"]),
  threshold_days: z.number().int(),
  days_inactive: z.number().int(),
  last_activity_at: z.string().nullable(),
  status: z.string(),
  detected_at: z.string(),
  resolved_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const HOUSEHOLD_RELATIONSHIP_TYPES = ["parent", "child", "spouse", "sibling"] as const;

export const householdRelationshipTypeZ = z.enum(HOUSEHOLD_RELATIONSHIP_TYPES);

/** A household as returned by the API: the public.households row (snake_case). */
export const householdZ = z.object({
  id: z.string(),
  church_id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  geo_lat: z.number().nullable(),
  geo_lng: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** A member's household membership, as embedded in their profile. */
export const memberHouseholdSummaryZ = z.object({
  household: householdZ,
  relationship_type: householdRelationshipTypeZ,
});

export const GROUP_TYPES = ["campus", "department", "ministry", "small_group"] as const;

export const groupTypeZ = z.enum(GROUP_TYPES);

/** A group/ministry node as returned by the API: the public.groups row. */
export const groupZ = z.object({
  id: z.string(),
  church_id: z.string(),
  parent_id: z.string().nullable(),
  group_type: groupTypeZ,
  name: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** A member's membership of a group, as embedded in their profile. */
export const memberGroupSummaryZ = z.object({
  group: groupZ,
  role: z.string().nullable(),
});
