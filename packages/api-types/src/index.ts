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
