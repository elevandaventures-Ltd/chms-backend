export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      church_profiles: {
        Row: {
          church_id: string
          created_at: string
          custom_fields: Json
          denomination: string | null
          logo_url: string | null
          primary_color: string
          secondary_color: string
          timezone: string
          updated_at: string
        }
        Insert: {
          church_id: string
          created_at?: string
          custom_fields?: Json
          denomination?: string | null
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          church_id?: string
          created_at?: string
          custom_fields?: Json
          denomination?: string | null
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "church_profiles_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: true
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
      churches: {
        Row: {
          created_at: string
          id: string
          locale: string
          name: string
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          locale?: string
          name: string
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          locale?: string
          name?: string
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      groups: {
        Row: {
          church_id: string
          created_at: string
          description: string | null
          group_type: Database["public"]["Enums"]["group_type"]
          id: string
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          church_id: string
          created_at?: string
          description?: string | null
          group_type: Database["public"]["Enums"]["group_type"]
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          church_id?: string
          created_at?: string
          description?: string | null
          group_type?: Database["public"]["Enums"]["group_type"]
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          church_id: string
          created_at: string
          created_by: string | null
          group_id: string
          member_id: string
          role: string | null
        }
        Insert: {
          church_id: string
          created_at?: string
          created_by?: string | null
          group_id: string
          member_id: string
          role?: string | null
        }
        Update: {
          church_id?: string
          created_at?: string
          created_by?: string | null
          group_id?: string
          member_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          address: string | null
          church_id: string
          created_at: string
          geo_lat: number | null
          geo_lng: number | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          church_id: string
          created_at?: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          church_id?: string
          created_at?: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "households_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          church_id: string
          created_at: string
          created_by: string | null
          household_id: string
          member_id: string
          relationship_type: Database["public"]["Enums"]["household_relationship_type"]
        }
        Insert: {
          church_id: string
          created_at?: string
          created_by?: string | null
          household_id: string
          member_id: string
          relationship_type: Database["public"]["Enums"]["household_relationship_type"]
        }
        Update: {
          church_id?: string
          created_at?: string
          created_by?: string | null
          household_id?: string
          member_id?: string
          relationship_type?: Database["public"]["Enums"]["household_relationship_type"]
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_members_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          baptism_date: string | null
          church_id: string
          city: string | null
          communion_date: string | null
          confirmation_date: string | null
          country: string | null
          created_at: string
          custom_fields: Json
          date_of_birth: string | null
          deleted_at: string | null
          email: string | null
          first_name: string
          gender: string | null
          geo_lat: number | null
          geo_lng: number | null
          id: string
          joined_at: string | null
          last_name: string | null
          marital_status: string | null
          neighbourhood: string | null
          notes: string | null
          ordination_date: string | null
          phone: string | null
          photo_url: string | null
          postal_code: string | null
          preferred_name: string | null
          spiritual_milestones: Json
          state_region: string | null
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          baptism_date?: string | null
          church_id: string
          city?: string | null
          communion_date?: string | null
          confirmation_date?: string | null
          country?: string | null
          created_at?: string
          custom_fields?: Json
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name: string
          gender?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          joined_at?: string | null
          last_name?: string | null
          marital_status?: string | null
          neighbourhood?: string | null
          notes?: string | null
          ordination_date?: string | null
          phone?: string | null
          photo_url?: string | null
          postal_code?: string | null
          preferred_name?: string | null
          spiritual_milestones?: Json
          state_region?: string | null
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          baptism_date?: string | null
          church_id?: string
          city?: string | null
          communion_date?: string | null
          confirmation_date?: string | null
          country?: string | null
          created_at?: string
          custom_fields?: Json
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name?: string
          gender?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          joined_at?: string | null
          last_name?: string | null
          marital_status?: string | null
          neighbourhood?: string | null
          notes?: string | null
          ordination_date?: string | null
          phone?: string | null
          photo_url?: string | null
          postal_code?: string | null
          preferred_name?: string | null
          spiritual_milestones?: Json
          state_region?: string | null
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      member_timeline: {
        Row: {
          church_id: string
          created_at: string
          created_by: string | null
          event_type: Database["public"]["Enums"]["member_event_type"]
          id: string
          member_id: string
          metadata: Json
          occurred_at: string
        }
        Insert: {
          church_id: string
          created_at?: string
          created_by?: string | null
          event_type: Database["public"]["Enums"]["member_event_type"]
          id?: string
          member_id: string
          metadata?: Json
          occurred_at?: string
        }
        Update: {
          church_id?: string
          created_at?: string
          created_by?: string | null
          event_type?: Database["public"]["Enums"]["member_event_type"]
          id?: string
          member_id?: string
          metadata?: Json
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_timeline_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_timeline_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_timeline_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      member_alerts: {
        Row: {
          alert_type: Database["public"]["Enums"]["member_alert_type"]
          church_id: string
          created_at: string
          days_inactive: number
          detected_at: string
          id: string
          last_activity_at: string | null
          member_id: string
          resolved_at: string | null
          status: string
          threshold_days: number
          updated_at: string
        }
        Insert: {
          alert_type?: Database["public"]["Enums"]["member_alert_type"]
          church_id: string
          created_at?: string
          days_inactive: number
          detected_at?: string
          id?: string
          last_activity_at?: string | null
          member_id: string
          resolved_at?: string | null
          status?: string
          threshold_days: number
          updated_at?: string
        }
        Update: {
          alert_type?: Database["public"]["Enums"]["member_alert_type"]
          church_id?: string
          created_at?: string
          days_inactive?: number
          detected_at?: string
          id?: string
          last_activity_at?: string | null
          member_id?: string
          resolved_at?: string | null
          status?: string
          threshold_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_alerts_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_alerts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          key: Database["public"]["Enums"]["user_role"]
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key: Database["public"]["Enums"]["user_role"]
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key?: Database["public"]["Enums"]["user_role"]
          name?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          created_at: string
          description: string
          id: string
          key: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          key: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          key?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_church_roles: {
        Row: {
          assigned_by: string | null
          church_id: string
          created_at: string
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          church_id: string
          created_at?: string
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          church_id?: string
          created_at?: string
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_church_roles_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_church_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_church_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          church_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          church_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          church_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      member_activity: {
        Row: {
          church_id: string | null
          deleted_at: string | null
          last_activity_at: string | null
          member_id: string | null
          status: Database["public"]["Enums"]["member_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "members_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      create_church_with_owner: {
        Args: {
          p_owner_id: string
          p_name: string
          p_slug: string
          p_timezone?: string
          p_locale?: string
          p_denomination?: string | null
          p_logo_url?: string | null
          p_primary_color?: string
          p_secondary_color?: string
          p_custom_fields?: Json
        }
        Returns: Database["public"]["Tables"]["churches"]["Row"]
      }
    }
    Enums: {
      group_type: "campus" | "department" | "ministry" | "small_group"
      household_relationship_type: "parent" | "child" | "spouse" | "sibling"
      member_alert_type: "inactive"
      member_event_type:
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
      member_status:
        | "prospect"
        | "visitor"
        | "active"
        | "inactive"
        | "transferred"
        | "deceased"
        | "archived"
      user_role:
        | "owner"
        | "admin"
        | "senior_pastor"
        | "admin_staff"
        | "ministry_leader"
        | "finance_officer"
        | "member"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      group_type: ["campus", "department", "ministry", "small_group"],
      household_relationship_type: ["parent", "child", "spouse", "sibling"],
      member_alert_type: ["inactive"],
      member_event_type: [
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
      ],
      member_status: [
        "prospect",
        "visitor",
        "active",
        "inactive",
        "transferred",
        "deceased",
        "archived",
      ],
      user_role: [
        "owner",
        "admin",
        "senior_pastor",
        "admin_staff",
        "ministry_leader",
        "finance_officer",
        "member",
      ],
    },
  },
} as const
