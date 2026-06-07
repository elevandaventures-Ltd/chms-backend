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
  ministry_leader: [
    "members.read",
    "groups.read",
    "groups.write",
    "events.read",
    "events.write",
  ],
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
