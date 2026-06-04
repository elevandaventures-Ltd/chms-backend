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
