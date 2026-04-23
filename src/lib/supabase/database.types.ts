export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      metrics: {
        Row: {
          category: string
          code: string
          description: string | null
          direction: string | null
          label_en: string | null
          label_pt: string
          unit: string | null
        }
        Insert: {
          category: string
          code: string
          description?: string | null
          direction?: string | null
          label_en?: string | null
          label_pt: string
          unit?: string | null
        }
        Update: {
          category?: string
          code?: string
          description?: string | null
          direction?: string | null
          label_en?: string | null
          label_pt?: string
          unit?: string | null
        }
        Relationships: []
      }
      player_notes: {
        Row: {
          contact_info: Json | null
          created_at: string | null
          id: string
          note: string | null
          owner: string | null
          player_id: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          contact_info?: Json | null
          created_at?: string | null
          id?: string
          note?: string | null
          owner?: string | null
          player_id: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          contact_info?: Json | null
          created_at?: string | null
          id?: string
          note?: string | null
          owner?: string | null
          player_id?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_notes_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_stats: {
        Row: {
          created_at: string | null
          id: string
          metric_code: string
          metric_source: string | null
          metric_value: number | null
          player_id: string
          raw_label: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          metric_code: string
          metric_source?: string | null
          metric_value?: number | null
          player_id: string
          raw_label?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          metric_code?: string
          metric_source?: string | null
          metric_value?: number | null
          player_id?: string
          raw_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_stats_metric_code_fkey"
            columns: ["metric_code"]
            isOneToOne: false
            referencedRelation: "metrics"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "player_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          age: number | null
          birth_date: string | null
          contract_until: string | null
          created_at: string | null
          current_team: string | null
          external_id: string | null
          foot: string | null
          games_played: number | null
          height_cm: number | null
          id: string
          market_value_eur: number | null
          minutes_played: number | null
          name: string
          nationality: string | null
          naturality: string | null
          on_loan: boolean | null
          pool_id: string
          position_primary: string | null
          positions_secondary: string[] | null
          weight_kg: number | null
        }
        Insert: {
          age?: number | null
          birth_date?: string | null
          contract_until?: string | null
          created_at?: string | null
          current_team?: string | null
          external_id?: string | null
          foot?: string | null
          games_played?: number | null
          height_cm?: number | null
          id?: string
          market_value_eur?: number | null
          minutes_played?: number | null
          name: string
          nationality?: string | null
          naturality?: string | null
          on_loan?: boolean | null
          pool_id: string
          position_primary?: string | null
          positions_secondary?: string[] | null
          weight_kg?: number | null
        }
        Update: {
          age?: number | null
          birth_date?: string | null
          contract_until?: string | null
          created_at?: string | null
          current_team?: string | null
          external_id?: string | null
          foot?: string | null
          games_played?: number | null
          height_cm?: number | null
          id?: string
          market_value_eur?: number | null
          minutes_played?: number | null
          name?: string
          nationality?: string | null
          naturality?: string | null
          on_loan?: boolean | null
          pool_id?: string
          position_primary?: string | null
          positions_secondary?: string[] | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "players_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
        ]
      }
      pools: {
        Row: {
          competition: string | null
          created_at: string | null
          file_name: string | null
          id: string
          name: string
          notes: string | null
          owner: string | null
          season: string
          source: string
        }
        Insert: {
          competition?: string | null
          created_at?: string | null
          file_name?: string | null
          id?: string
          name: string
          notes?: string | null
          owner?: string | null
          season: string
          source: string
        }
        Update: {
          competition?: string | null
          created_at?: string | null
          file_name?: string | null
          id?: string
          name?: string
          notes?: string | null
          owner?: string | null
          season?: string
          source?: string
        }
        Relationships: []
      }
      scouting_profiles: {
        Row: {
          created_at: string | null
          description: string | null
          filters: Json | null
          id: string
          name: string
          owner: string | null
          tags: string[] | null
          updated_at: string | null
          weights: Json | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          filters?: Json | null
          id?: string
          name: string
          owner?: string | null
          tags?: string[] | null
          updated_at?: string | null
          weights?: Json | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          filters?: Json | null
          id?: string
          name?: string
          owner?: string | null
          tags?: string[] | null
          updated_at?: string | null
          weights?: Json | null
        }
        Relationships: []
      }
      shortlist_players: {
        Row: {
          shortlist_id: string
          player_id: string
          added_at: string | null
          snapshot_score: number | null
          snapshot_rank: number | null
          shortlist_note: string | null
        }
        Insert: {
          shortlist_id: string
          player_id: string
          added_at?: string | null
          snapshot_score?: number | null
          snapshot_rank?: number | null
          shortlist_note?: string | null
        }
        Update: {
          shortlist_id?: string
          player_id?: string
          added_at?: string | null
          snapshot_score?: number | null
          snapshot_rank?: number | null
          shortlist_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shortlist_players_shortlist_id_fkey"
            columns: ["shortlist_id"]
            isOneToOne: false
            referencedRelation: "shortlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shortlist_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      shortlists: {
        Row: {
          created_at: string | null
          id: string
          name: string
          owner: string | null
          pool_id: string | null
          profile_id: string | null
          result_snapshot: Json | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          owner?: string | null
          pool_id?: string | null
          profile_id?: string | null
          result_snapshot?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          owner?: string | null
          pool_id?: string | null
          profile_id?: string | null
          result_snapshot?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "shortlists_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shortlists_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "scouting_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
  public: {
    Enums: {},
  },
} as const
