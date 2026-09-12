// Initial types generated from the migration in PostgreSQL (PGlite).
// Regenerate from Supabase after applying migrations: pnpm db:types
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
export type Database = {
  public: {
    Tables: {
      crop_cycles: {
        Row: {
          id: string;
          plot_id: string;
          crop_code: string;
          season_label: string;
          sown_on: string | null;
          stage_code: string | null;
          stage_as_of: string | null;
          ended_on: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          plot_id: string;
          crop_code: string;
          season_label: string;
          sown_on?: string | null;
          stage_code?: string | null;
          stage_as_of?: string | null;
          ended_on?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          plot_id?: string;
          crop_code?: string;
          season_label?: string;
          sown_on?: string | null;
          stage_code?: string | null;
          stage_as_of?: string | null;
          ended_on?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crop_cycles_plot_id_fkey";
            columns: ["plot_id"];
            isOneToOne: false;
            referencedRelation: "plots";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          id: string;
          farm_id: string;
          source_code: string;
          source_event_key: string;
          kind: "frost" | "severe-storm" | "hail" | "extreme-heat";
          title: string;
          starts_at: string;
          ends_at: string;
          issued_at: string | null;
          retrieved_at: string;
          source_url: string | null;
          status: string;
          evidence: Json;
          is_demo: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          farm_id: string;
          source_code: string;
          source_event_key: string;
          kind?: "frost" | "severe-storm" | "hail" | "extreme-heat";
          title: string;
          starts_at: string;
          ends_at: string;
          issued_at?: string | null;
          retrieved_at: string;
          source_url?: string | null;
          status?: string;
          evidence: Json;
          is_demo: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          farm_id?: string;
          source_code?: string;
          source_event_key?: string;
          kind?: "frost" | "severe-storm" | "hail" | "extreme-heat";
          title?: string;
          starts_at?: string;
          ends_at?: string;
          issued_at?: string | null;
          retrieved_at?: string;
          source_url?: string | null;
          status?: string;
          evidence?: Json;
          is_demo?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_farm_id_fkey";
            columns: ["farm_id"];
            isOneToOne: false;
            referencedRelation: "farms";
            referencedColumns: ["id"];
          },
        ];
      };
      farms: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          province: string;
          locality: string | null;
          timezone: string;
          data_mode: string;
          boundary_geojson: Json;
          declared_area_ha: number;
          data_version: number;
          forecast_summary: Json | null;
          last_attempt_at: string | null;
          last_success_at: string | null;
          last_error_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          province: string;
          locality?: string | null;
          timezone?: string;
          data_mode?: string;
          boundary_geojson: Json;
          declared_area_ha: number;
          data_version?: number;
          forecast_summary?: Json | null;
          last_attempt_at?: string | null;
          last_success_at?: string | null;
          last_error_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          province?: string;
          locality?: string | null;
          timezone?: string;
          data_mode?: string;
          boundary_geojson?: Json;
          declared_area_ha?: number;
          data_version?: number;
          forecast_summary?: Json | null;
          last_attempt_at?: string | null;
          last_success_at?: string | null;
          last_error_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "farms_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      plot_alerts: {
        Row: {
          id: string;
          farm_id: string;
          plot_id: string;
          event_id: string;
          assessment_state: string;
          risk_level: "low" | "moderate" | "high" | "critical" | null;
          reason: string;
          recommended_actions: Json;
          input_snapshot: Json;
          rule_version: string;
          generated_at: string;
          valid_until: string;
          generation_method: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          farm_id: string;
          plot_id: string;
          event_id: string;
          assessment_state: string;
          risk_level?: "low" | "moderate" | "high" | "critical" | null;
          reason: string;
          recommended_actions?: Json;
          input_snapshot: Json;
          rule_version: string;
          generated_at: string;
          valid_until: string;
          generation_method?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          farm_id?: string;
          plot_id?: string;
          event_id?: string;
          assessment_state?: string;
          risk_level?: "low" | "moderate" | "high" | "critical" | null;
          reason?: string;
          recommended_actions?: Json;
          input_snapshot?: Json;
          rule_version?: string;
          generated_at?: string;
          valid_until?: string;
          generation_method?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plot_alerts_event_id_farm_id_fkey";
            columns: ["event_id", "farm_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id", "farm_id"];
          },
          {
            foreignKeyName: "plot_alerts_farm_id_fkey";
            columns: ["farm_id"];
            isOneToOne: false;
            referencedRelation: "farms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plot_alerts_plot_id_farm_id_fkey";
            columns: ["plot_id", "farm_id"];
            isOneToOne: false;
            referencedRelation: "plots";
            referencedColumns: ["id", "farm_id"];
          },
        ];
      };
      plots: {
        Row: {
          id: string;
          farm_id: string;
          name: string;
          boundary_geojson: Json;
          sample_point_geojson: Json;
          declared_area_ha: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          farm_id: string;
          name: string;
          boundary_geojson: Json;
          sample_point_geojson: Json;
          declared_area_ha: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          farm_id?: string;
          name?: string;
          boundary_geojson?: Json;
          sample_point_geojson?: Json;
          declared_area_ha?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plots_farm_id_fkey";
            columns: ["farm_id"];
            isOneToOne: false;
            referencedRelation: "farms";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
