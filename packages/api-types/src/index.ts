// UserRole must stay in sync with the `user_role` enum in the DB migrations.
// Last updated: migration 20260604120000_update_user_role_enum.sql
export type UserRole =
  | "owner"
  | "admin"
  | "senior_pastor"
  | "admin_staff"
  | "ministry_leader"
  | "finance_officer"
  | "member"

export interface Church {
  id: string
  slug: string
  name: string
  timezone: string
  locale: string
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  display_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface UserRoleRecord {
  id: string
  user_id: string
  church_id: string
  role: UserRole
  created_at: string
}

/**
 * A row in the global RBAC role catalog (public.roles). `key` is the canonical
 * UserRole; the table shares the DB `user_role` enum so the catalog never drifts
 * from the enum-based auth path. Added: migration 20260604160000.
 */
export interface Role {
  id: string
  key: UserRole
  name: string
  description: string | null
  is_system: boolean
  created_at: string
}

/** A row in the global permission catalog (public.permissions). */
export interface Permission {
  id: string
  key: string
  description: string
  created_at: string
}

/**
 * The granular capability keys seeded in public.permissions (migration
 * 20260604160000). This union is the canonical, compile-time-checked view of
 * that catalog; the DB seed remains the source of truth and these must stay in
 * lockstep with it.
 */
export type PermissionKey =
  | "members.read"
  | "members.write"
  | "members.delete"
  | "groups.read"
  | "groups.write"
  | "events.read"
  | "events.write"
  | "finances.read"
  | "finances.write"
  | "reports.read"
  | "roles.read"
  | "roles.assign"
  | "church.manage"

/**
 * Which permissions each role grants. A code mirror of the role_permissions
 * seed in migration 20260604160000 so the API can authorise requests
 * synchronously from the JWT `user_role` claim without a per-request DB lookup.
 *
 * IMPORTANT: this MUST stay in sync with the migration seed. The DB catalog
 * remains the source of truth; if you change a role's permissions there, mirror
 * it here (and vice versa). See [[rbac-two-role-systems]].
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly PermissionKey[]> = {
  // owner + admin: every permission.
  owner: [
    "members.read",
    "members.write",
    "members.delete",
    "groups.read",
    "groups.write",
    "events.read",
    "events.write",
    "finances.read",
    "finances.write",
    "reports.read",
    "roles.read",
    "roles.assign",
    "church.manage",
  ],
  admin: [
    "members.read",
    "members.write",
    "members.delete",
    "groups.read",
    "groups.write",
    "events.read",
    "events.write",
    "finances.read",
    "finances.write",
    "reports.read",
    "roles.read",
    "roles.assign",
    "church.manage",
  ],
  // senior_pastor: full people/group/event oversight + read reports & roles.
  senior_pastor: [
    "members.read",
    "members.write",
    "members.delete",
    "groups.read",
    "groups.write",
    "events.read",
    "events.write",
    "reports.read",
    "roles.read",
  ],
  // admin_staff: operational people/group/event access + read reports.
  admin_staff: [
    "members.read",
    "members.write",
    "groups.read",
    "groups.write",
    "events.read",
    "events.write",
    "reports.read",
  ],
  // ministry_leader: manages their groups and events; reads members.
  ministry_leader: ["members.read", "groups.read", "groups.write", "events.read", "events.write"],
  // finance_officer: owns finances + reports; reads members.
  finance_officer: ["members.read", "finances.read", "finances.write", "reports.read"],
  // member: directory read only.
  member: ["members.read"],
}

/** True when `role` grants `permission` per {@link ROLE_PERMISSIONS}. */
export function roleHasPermission(role: UserRole, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

/** A per-tenant role assignment row (public.user_church_roles). */
export interface UserChurchRole {
  id: string
  user_id: string
  church_id: string
  role_id: string
  assigned_by: string | null
  created_at: string
}

export interface ChurchProfile {
  church_id: string
  denomination: string | null
  logo_url: string | null
  primary_color: string
  secondary_color: string
  timezone: string
  custom_fields: Record<string, unknown>
  created_at: string
  updated_at: string
}

/**
 * Request body for POST /churches (tenant registration). Only `name` is
 * required; everything else has a server-side default. `slug` is derived from
 * `name` when omitted.
 */
export interface CreateChurchRequest {
  name: string
  slug?: string
  timezone?: string
  locale?: string
  denomination?: string
  logoUrl?: string
  primaryColor?: string
  secondaryColor?: string
  customFields?: Record<string, unknown>
}

/**
 * Response from a successful POST /churches. The caller's existing access token
 * does NOT yet carry the new church_id/user_role claims — those are injected by
 * custom_access_token_hook on the next token issuance, so the client must
 * refresh its session (or sign in again) before tenant-scoped requests resolve.
 */
export interface CreateChurchResponse {
  church: Church
  role: UserRole
  message: string
}

/**
 * Request body for POST /role-assignments. The target church is taken from the
 * caller's JWT (`church_id`), never the body — a caller can only assign roles
 * within their own church. `roleKey` must be one of the seeded UserRole values.
 */
export interface AssignRoleRequest {
  userId: string
  roleKey: UserRole
}

/**
 * A role assignment as returned by the API: the join row flattened with the
 * resolved role key/name so clients don't have to look roles up separately.
 */
export interface RoleAssignment {
  id: string
  userId: string
  churchId: string
  roleKey: UserRole
  roleName: string
  assignedBy: string | null
  createdAt: string
}

export interface AssignRoleResponse {
  assignment: RoleAssignment
  message: string
}

export interface ListRoleAssignmentsResponse {
  assignments: RoleAssignment[]
}

export interface RemoveRoleResponse {
  message: string
}

// Members --------------------------------------------------------------------
// Mirrors the public.member_status / public.member_event_type enums (migrations
// 20260612120000 / 20260612120100). Keep in lockstep with the DB.

export type MemberStatus =
  | "prospect"
  | "visitor"
  | "active"
  | "inactive"
  | "transferred"
  | "deceased"
  | "archived"

export type MemberEventType =
  | "check_in"
  | "giving"
  | "group_join"
  | "group_leave"
  | "event_attendance"
  | "pastoral_note"
  | "status_change"
  | "milestone"
  | "communication"
  | "note"

/**
 * A member (person) as returned by the API. Mirrors the public.members row
 * (snake_case), matching the Church/User entity convention. Request bodies, by
 * contrast, are camelCase (see CreateMemberRequest), matching CreateChurchRequest.
 */
export interface Member {
  id: string
  church_id: string
  user_id: string | null
  first_name: string
  last_name: string | null
  preferred_name: string | null
  email: string | null
  phone: string | null
  date_of_birth: string | null
  gender: string | null
  marital_status: string | null
  photo_url: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_region: string | null
  postal_code: string | null
  country: string | null
  geo_lat: number | null
  geo_lng: number | null
  neighbourhood: string | null
  baptism_date: string | null
  communion_date: string | null
  confirmation_date: string | null
  ordination_date: string | null
  spiritual_milestones: unknown[]
  status: MemberStatus
  joined_at: string | null
  notes: string | null
  custom_fields: Record<string, unknown>
  /** Soft-delete tombstone; null = active. The API hides deleted members by default. */
  deleted_at: string | null
  created_at: string
  updated_at: string
}

/** A single append-only event on a member's timeline (public.member_timeline). */
export interface MemberTimelineEvent {
  id: string
  church_id: string
  member_id: string
  event_type: MemberEventType
  metadata: Record<string, unknown>
  occurred_at: string
  created_by: string | null
  created_at: string
}

/**
 * Request body for POST /members. camelCase; the server maps it to the
 * snake_case columns. Only firstName is required; the church is taken from the
 * caller's JWT, never the body. Dates are ISO date strings (YYYY-MM-DD).
 */
export interface CreateMemberRequest {
  firstName: string
  lastName?: string
  preferredName?: string
  email?: string
  phone?: string
  dateOfBirth?: string
  gender?: string
  maritalStatus?: string
  photoUrl?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  stateRegion?: string
  postalCode?: string
  country?: string
  geoLat?: number
  geoLng?: number
  neighbourhood?: string
  baptismDate?: string
  communionDate?: string
  confirmationDate?: string
  ordinationDate?: string
  spiritualMilestones?: unknown[]
  status?: MemberStatus
  joinedAt?: string
  notes?: string
  customFields?: Record<string, unknown>
  /** Optional link to an auth-backed user in the same church. */
  userId?: string
}

export interface CreateMemberResponse {
  member: Member
  message: string
}

/** Query params for GET /members (paginated, filterable directory list). */
export interface MemberListQuery {
  page?: number
  pageSize?: number
  status?: MemberStatus
  search?: string
  /** Include soft-deleted members in the results (default false). */
  includeDeleted?: boolean
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export interface MemberListResponse {
  members: Member[]
  pagination: PaginationMeta
}

/**
 * GET /members/:id — a member's full profile: the record, recent timeline, their
 * household grouping (or null), and the groups they belong to.
 */
export interface MemberProfileResponse {
  member: Member
  timeline: MemberTimelineEvent[]
  household: MemberHouseholdSummary | null
  groups: MemberGroupSummary[]
}

/**
 * Request body for PATCH /members/:id (partial update). Every field is optional;
 * at least one must be present. Nullable fields accept `null` to clear them
 * (firstName/status/customFields/spiritualMilestones cannot be nulled — their
 * columns are NOT NULL).
 */
export interface UpdateMemberRequest {
  firstName?: string
  lastName?: string | null
  preferredName?: string | null
  email?: string | null
  phone?: string | null
  dateOfBirth?: string | null
  gender?: string | null
  maritalStatus?: string | null
  photoUrl?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  stateRegion?: string | null
  postalCode?: string | null
  country?: string | null
  geoLat?: number | null
  geoLng?: number | null
  neighbourhood?: string | null
  baptismDate?: string | null
  communionDate?: string | null
  confirmationDate?: string | null
  ordinationDate?: string | null
  spiritualMilestones?: unknown[]
  status?: MemberStatus
  joinedAt?: string | null
  notes?: string | null
  customFields?: Record<string, unknown>
  userId?: string | null
}

export interface UpdateMemberResponse {
  member: Member
  message: string
}

export interface DeleteMemberResponse {
  member: Member
  message: string
}

export interface RestoreMemberResponse {
  member: Member
  message: string
}

/**
 * One hit from GET /members/search. A lightweight projection of a member indexed
 * in Meilisearch (enough to render a result row); fetch the full profile by id.
 */
export interface MemberSearchHit {
  id: string
  church_id: string
  first_name: string
  last_name: string | null
  preferred_name: string | null
  email: string | null
  phone: string | null
  status: MemberStatus
}

export interface MemberSearchResponse {
  query: string
  hits: MemberSearchHit[]
  estimatedTotalHits: number
  limit: number
  offset: number
}

// Member CSV import (POST /members/import) -----------------------------------

/** A failed import row. `row` is the 1-based file line (header is line 1); it is
 * absent for batch-level failures (e.g. the atomic insert rolling back). */
export interface MemberImportRowError {
  row?: number
  field?: string
  message: string
}

/** A row skipped as a duplicate (against the church or earlier in the file). */
export interface MemberImportSkippedRow {
  row: number
  reason: string
}

export interface MemberImportSummary {
  totalRows: number
  added: number
  updated: number
  skipped: number
  failed: number
}

/**
 * Response from POST /members/import. `mode` is how duplicates were handled
 * (skip|update) and `dryRun` is true when nothing was written. `errors` lists
 * failed rows; `skippedRows` lists duplicates that were intentionally skipped.
 */
export interface MemberImportResponse {
  dryRun: boolean
  mode: "skip" | "update"
  summary: MemberImportSummary
  errors: MemberImportRowError[]
  skippedRows: MemberImportSkippedRow[]
  ignoredColumns: string[]
  message: string
}

// Member status transitions (POST /members/:id/status) ----------------------

/** Request body for POST /members/:id/status. `reason` is recorded on the event. */
export interface ChangeMemberStatusRequest {
  status: MemberStatus
  reason?: string
}

export interface ChangeMemberStatusResponse {
  member: Member
  message: string
}

// At-risk member alerts (GET /members/alerts) --------------------------------
// Mirrors public.member_alerts (migration 20260618130000), populated by the daily
// aging job. `days` is an inactivity floor: 30 includes the 60/90 buckets.

export type MemberAlertType = "inactive"

export interface MemberAlert {
  id: string
  church_id: string
  member_id: string
  alert_type: MemberAlertType
  /** The crossed inactivity bucket: 30, 60, or 90 days. */
  threshold_days: number
  days_inactive: number
  last_activity_at: string | null
  status: string
  detected_at: string
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface MemberAlertsQuery {
  type?: MemberAlertType
  days?: 30 | 60 | 90
  page?: number
  pageSize?: number
}

/** An alert paired with its member, as returned by GET /members/alerts. */
export interface MemberAlertEntry {
  alert: MemberAlert
  member: Member
}

export interface MemberAlertsResponse {
  alerts: MemberAlertEntry[]
  pagination: PaginationMeta
}

// Bulk member actions (POST /members/bulk-action) ----------------------------

export type BulkMemberAction = "assign-ministry" | "change-status" | "export" | "archive"

export interface BulkMemberActionRequest {
  action: BulkMemberAction
  memberIds: string[]
  params?: {
    /** Required for assign-ministry: the target group id. */
    groupId?: string
    /** Required for change-status: the target lifecycle status. */
    status?: MemberStatus
    /** Optional for export (default csv). */
    format?: "csv" | "pdf"
  }
}

export interface BulkMemberActionError {
  memberId: string
  message: string
}

export interface BulkMemberActionResponse {
  action: BulkMemberAction
  requested: number
  succeeded: number
  failed: number
  errors: BulkMemberActionError[]
  /** Present only for action "export": where to fetch the generated file. */
  download?: { format: "csv" | "pdf"; url: string; count: number }
}

// Member export (GET /members/export) ----------------------------------------

export interface MemberExportQuery {
  format?: "csv" | "pdf"
  status?: MemberStatus
  search?: string
  includeDeleted?: boolean
  /** Comma-separated member ids; overrides the directory filters when present. */
  ids?: string
}

// Member geo-clustering (GET /members/geo-cluster) ---------------------------

export interface GeoMemberPin {
  id: string
  name: string
  lat: number
  lng: number
}

export interface GeoCluster {
  neighbourhood: string
  count: number
  centroid: { lat: number; lng: number }
  members: GeoMemberPin[]
}

export interface MemberGeoClusterResponse {
  clusters: GeoCluster[]
  /** Active members missing coordinates (not placed on the map). */
  unmapped: number
  totalMapped: number
}

// Full-text search hits (GET /groups/search, /households/search) -------------
// Members reuse the existing MemberSearchHit above.

export interface GroupSearchHit {
  id: string
  church_id: string
  name: string
  description: string | null
  group_type: GroupType
}

export interface HouseholdSearchHit {
  id: string
  church_id: string
  name: string
  address: string | null
}

// Households -----------------------------------------------------------------
// Mirrors public.household_relationship_type (migration 20260614130000).

export type HouseholdRelationshipType = "parent" | "child" | "spouse" | "sibling"

/** A household (family unit) as returned by the API. Mirrors public.households. */
export interface Household {
  id: string
  church_id: string
  name: string
  address: string | null
  geo_lat: number | null
  geo_lng: number | null
  created_at: string
  updated_at: string
}

/** A member's link row to a household (public.household_members). */
export interface HouseholdMemberLink {
  household_id: string
  member_id: string
  relationship_type: HouseholdRelationshipType
  created_at: string
}

/** Request body for POST /households. camelCase; church taken from the JWT. */
export interface CreateHouseholdRequest {
  name: string
  address?: string
  geoLat?: number
  geoLng?: number
}

/** Request body for PATCH /households/:id. Nullable fields accept null to clear. */
export interface UpdateHouseholdRequest {
  name?: string
  address?: string | null
  geoLat?: number | null
  geoLng?: number | null
}

export interface CreateHouseholdResponse {
  household: Household
  message: string
}

export interface UpdateHouseholdResponse {
  household: Household
  message: string
}

export interface DeleteHouseholdResponse {
  message: string
}

export interface HouseholdListResponse {
  households: Household[]
  pagination: PaginationMeta
}

/** A member within a household, with their family relationship. */
export interface HouseholdMemberEntry {
  member: Member
  relationship_type: HouseholdRelationshipType
}

export interface HouseholdDetailResponse {
  household: Household
  members: HouseholdMemberEntry[]
}

/** Request body for POST /households/:id/members (family linking). */
export interface LinkMemberToHouseholdRequest {
  memberId: string
  relationshipType: HouseholdRelationshipType
}

export interface LinkMemberToHouseholdResponse {
  link: HouseholdMemberLink
  message: string
}

export interface UnlinkMemberFromHouseholdResponse {
  message: string
}

/** A member's household membership, as embedded in their profile. */
export interface MemberHouseholdSummary {
  household: Household
  relationship_type: HouseholdRelationshipType
}

// Groups / ministries --------------------------------------------------------
// Mirrors public.group_type (migration 20260614140000). Hierarchy is an
// adjacency list: each group points at its parent via parent_id (null = root).

export type GroupType = "campus" | "department" | "ministry" | "small_group"

/** A group/ministry node as returned by the API. Mirrors public.groups. */
export interface Group {
  id: string
  church_id: string
  parent_id: string | null
  group_type: GroupType
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

/** A member's assignment row to a group (public.group_members). */
export interface GroupMemberLink {
  group_id: string
  member_id: string
  role: string | null
  created_at: string
}

/** Request body for POST /groups. parentId null/omitted makes a root node. */
export interface CreateGroupRequest {
  name: string
  groupType: GroupType
  parentId?: string | null
  description?: string
}

/** Request body for PATCH /groups/:id. Nullable fields accept null to clear. */
export interface UpdateGroupRequest {
  name?: string
  groupType?: GroupType
  parentId?: string | null
  description?: string | null
}

export interface CreateGroupResponse {
  group: Group
  message: string
}

export interface UpdateGroupResponse {
  group: Group
  message: string
}

export interface DeleteGroupResponse {
  message: string
}

/** Query params for GET /groups (flat list; clients assemble the tree). */
export interface GroupListQuery {
  groupType?: GroupType
  parentId?: string
  search?: string
}

export interface GroupListResponse {
  groups: Group[]
}

/** A member within a group, with their role in it. */
export interface GroupMemberEntry {
  member: Member
  role: string | null
}

export interface GroupDetailResponse {
  group: Group
  children: Group[]
  members: GroupMemberEntry[]
}

/** Request body for POST /groups/:id/members (member-group assignment). */
export interface AssignMemberToGroupRequest {
  memberId: string
  role?: string
}

export interface AssignMemberToGroupResponse {
  assignment: GroupMemberLink
  message: string
}

export interface RemoveMemberFromGroupResponse {
  message: string
}

/** A member's group membership, as embedded in their profile. */
export interface MemberGroupSummary {
  group: Group
  role: string | null
}
