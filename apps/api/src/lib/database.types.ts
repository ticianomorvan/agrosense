// Initial types generated from the migration in PostgreSQL (PGlite).
// Regenerate from Supabase after applying migrations: pnpm db:types
import type { AutomationFunctions } from "../automation/database.types";
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
          custom_rules?: Json;
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
          custom_rules?: Json;
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
          custom_rules?: Json;
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
    Functions: AutomationFunctions & {
      get_farm_dashboard_snapshot: {
        Args: { p_farm_id: string };
        Returns: Json;
      };
      update_crop_cycle: {
        Args: {
          p_farm_id: string;
          p_plot_id: string;
          p_expected_data_version: number;
          p_patch: Json;
        };
        Returns: Json;
      };
      admit_farm_refresh: {
        Args: { p_owner_id: string; p_farm_id: string; p_attempt_at: string };
        Returns: Json;
      };
      publish_farm_refresh: {
        Args: {
          p_owner_id: string;
          p_farm_id: string;
          p_expected_data_version: number;
          p_attempt_at: string;
          p_published_at: string;
          p_forecast: Json;
          p_events: Json;
        };
        Returns: Json;
      };
      fail_farm_refresh: {
        Args: {
          p_owner_id: string;
          p_farm_id: string;
          p_expected_data_version: number;
          p_attempt_at: string;
          p_completed_at: string;
          p_error_code: string;
        };
        Returns: boolean;
      };
      import_demo_seed: {
        Args: { p_owner_id: string; p_payload: Json };
        Returns: Json;
      };
      create_user_farm: {
        Args: { p_owner_id: string; p_payload: Json };
        Returns: Json;
      };
      create_farm_plot: {
        Args: {
          p_owner_id: string;
          p_farm_id: string;
          p_expected_data_version: number;
          p_payload: Json;
        };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
