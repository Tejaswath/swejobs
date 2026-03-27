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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      applications: {
        Row: {
          applied_at: string
          company: string
          created_at: string
          id: string
          job_id: number | null
          job_title: string
          job_url: string
          notes: string | null
          request_id: string | null
          resume_label: string | null
          resume_version_id: string | null
          source: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_at?: string
          company: string
          created_at?: string
          id?: string
          job_id?: number | null
          job_title: string
          job_url?: string
          notes?: string | null
          request_id?: string | null
          resume_label?: string | null
          resume_version_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          applied_at?: string
          company?: string
          created_at?: string
          id?: string
          job_id?: number | null
          job_title?: string
          job_url?: string
          notes?: string | null
          request_id?: string | null
          resume_label?: string | null
          resume_version_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_resume_version_id_fkey"
            columns: ["resume_version_id"]
            isOneToOne: false
            referencedRelation: "resume_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          name: string
          subject?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ingestion_state: {
        Row: {
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      job_events: {
        Row: {
          event_time: string
          event_type: string
          id: number
          job_id: number
          payload_hash: string | null
        }
        Insert: {
          event_time?: string
          event_type: string
          id?: number
          job_id: number
          payload_hash?: string | null
        }
        Update: {
          event_time?: string
          event_type?: string
          id?: number
          job_id?: number
          payload_hash?: string | null
        }
        Relationships: []
      }
      job_tags: {
        Row: {
          job_id: number
          tag: string
        }
        Insert: {
          job_id: number
          tag: string
        }
        Update: {
          job_id?: number
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_tags_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          application_deadline: string | null
          career_stage: string
          career_stage_confidence: number
          citizenship_required: boolean
          company_canonical: string | null
          company_tier: string
          consultancy_flag: boolean
          description: string | null
          employer_id: string | null
          employer_name: string | null
          employment_type: string | null
          headline: string
          id: number
          ingested_at: string | null
          is_active: boolean | null
          is_noise: boolean
          is_grad_program: boolean
          is_relevant: boolean | null
          is_target_role: boolean
          lang: string | null
          municipality: string | null
          municipality_code: string | null
          occupation_id: string | null
          occupation_label: string | null
          published_at: string | null
          raw_json: Json | null
          reason_codes: string[]
          relevance_score: number
          region: string | null
          region_code: string | null
          remote_flag: boolean | null
          removed_at: string | null
          role_family: string
          security_clearance_required: boolean
          is_direct_company_source: boolean
          source_name: string
          source_company_key: string | null
          source_kind: string | null
          source_provider: string | null
          source_url: string | null
          swedish_required: boolean
          ssyk_code: string | null
          updated_at: string | null
          working_hours: string | null
          years_required_min: number | null
        }
        Insert: {
          application_deadline?: string | null
          career_stage?: string
          career_stage_confidence?: number
          citizenship_required?: boolean
          company_canonical?: string | null
          company_tier?: string
          consultancy_flag?: boolean
          description?: string | null
          employer_id?: string | null
          employer_name?: string | null
          employment_type?: string | null
          headline: string
          id: number
          ingested_at?: string | null
          is_active?: boolean | null
          is_noise?: boolean
          is_grad_program?: boolean
          is_relevant?: boolean | null
          is_target_role?: boolean
          lang?: string | null
          municipality?: string | null
          municipality_code?: string | null
          occupation_id?: string | null
          occupation_label?: string | null
          published_at?: string | null
          raw_json?: Json | null
          reason_codes?: string[]
          relevance_score?: number
          region?: string | null
          region_code?: string | null
          remote_flag?: boolean | null
          removed_at?: string | null
          role_family?: string
          security_clearance_required?: boolean
          is_direct_company_source?: boolean
          source_name?: string
          source_company_key?: string | null
          source_kind?: string | null
          source_provider?: string | null
          source_url?: string | null
          swedish_required?: boolean
          ssyk_code?: string | null
          updated_at?: string | null
          working_hours?: string | null
          years_required_min?: number | null
        }
        Update: {
          application_deadline?: string | null
          career_stage?: string
          career_stage_confidence?: number
          citizenship_required?: boolean
          company_canonical?: string | null
          company_tier?: string
          consultancy_flag?: boolean
          description?: string | null
          employer_id?: string | null
          employer_name?: string | null
          employment_type?: string | null
          headline?: string
          id?: number
          ingested_at?: string | null
          is_active?: boolean | null
          is_noise?: boolean
          is_grad_program?: boolean
          is_relevant?: boolean | null
          is_target_role?: boolean
          lang?: string | null
          municipality?: string | null
          municipality_code?: string | null
          occupation_id?: string | null
          occupation_label?: string | null
          published_at?: string | null
          raw_json?: Json | null
          reason_codes?: string[]
          relevance_score?: number
          region?: string | null
          region_code?: string | null
          remote_flag?: boolean | null
          removed_at?: string | null
          role_family?: string
          security_clearance_required?: boolean
          is_direct_company_source?: boolean
          source_name?: string
          source_company_key?: string | null
          source_kind?: string | null
          source_provider?: string | null
          source_url?: string | null
          swedish_required?: boolean
          ssyk_code?: string | null
          updated_at?: string | null
          working_hours?: string | null
          years_required_min?: number | null
        }
        Relationships: []
      }
      profile_facts: {
        Row: {
          created_at: string
          description: string | null
          end_date: string | null
          fact_type: string
          id: string
          is_current: boolean | null
          location: string | null
          organization: string | null
          sort_order: number
          start_date: string | null
          structured_data: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          fact_type: string
          id?: string
          is_current?: boolean | null
          location?: string | null
          organization?: string | null
          sort_order?: number
          start_date?: string | null
          structured_data?: Json
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          fact_type?: string
          id?: string
          is_current?: boolean | null
          location?: string | null
          organization?: string | null
          sort_order?: number
          start_date?: string | null
          structured_data?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      recruiters: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          id: string
          linkedin_url: string | null
          name: string
          notes: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          linkedin_url?: string | null
          name: string
          notes?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          linkedin_url?: string | null
          name?: string
          notes?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      resume_versions: {
        Row: {
          created_at: string
          file_name: string | null
          file_size_bytes: number | null
          id: string
          is_default: boolean
          label: string
          mime_type: string | null
          notes: string | null
          parsed_text: string | null
          storage_path: string | null
          target_role: string | null
          text_extracted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          is_default?: boolean
          label: string
          mime_type?: string | null
          notes?: string | null
          parsed_text?: string | null
          storage_path?: string | null
          target_role?: string | null
          text_extracted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          is_default?: boolean
          label?: string
          mime_type?: string | null
          notes?: string | null
          parsed_text?: string | null
          storage_path?: string | null
          target_role?: string | null
          text_extracted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_searches: {
        Row: {
          created_at: string | null
          english_only: boolean | null
          id: number
          keywords: string[] | null
          last_checked_at: string | null
          name: string
          regions: string[] | null
          remote_only: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          english_only?: boolean | null
          id?: number
          keywords?: string[] | null
          last_checked_at?: string | null
          name: string
          regions?: string[] | null
          remote_only?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          english_only?: boolean | null
          id?: number
          keywords?: string[] | null
          last_checked_at?: string | null
          name?: string
          regions?: string[] | null
          remote_only?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      taxonomy_cache: {
        Row: {
          cached_at: string | null
          concept_id: string
          concept_type: string
          parent_id: string | null
          preferred_label: string
          ssyk_code: string | null
        }
        Insert: {
          cached_at?: string | null
          concept_id: string
          concept_type: string
          parent_id?: string | null
          preferred_label: string
          ssyk_code?: string | null
        }
        Update: {
          cached_at?: string | null
          concept_id?: string
          concept_type?: string
          parent_id?: string | null
          preferred_label?: string
          ssyk_code?: string | null
        }
        Relationships: []
      }
      tracked_jobs: {
        Row: {
          created_at: string | null
          id: number
          job_id: number
          notes: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          job_id: number
          notes?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: number
          job_id?: number
          notes?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracked_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profile: {
        Row: {
          created_at: string
          full_name: string | null
          headline: string | null
          linkedin_url: string | null
          location: string | null
          portfolio_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          headline?: string | null
          linkedin_url?: string | null
          location?: string | null
          portfolio_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          headline?: string | null
          linkedin_url?: string | null
          location?: string | null
          portfolio_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_skills: {
        Row: {
          created_at: string | null
          id: number
          proficiency: string
          skill: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: never
          proficiency?: string
          skill: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: never
          proficiency?: string
          skill?: string
          user_id?: string
        }
        Relationships: []
      }
      watched_companies: {
        Row: {
          created_at: string | null
          employer_id: string | null
          employer_name: string
          id: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          employer_id?: string | null
          employer_name: string
          id?: never
          user_id: string
        }
        Update: {
          created_at?: string | null
          employer_id?: string | null
          employer_name?: string
          id?: never
          user_id?: string
        }
        Relationships: []
      }
      weekly_digests: {
        Row: {
          digest_json: Json
          generated_at: string | null
          id: number
          period_end: string
          period_start: string
        }
        Insert: {
          digest_json: Json
          generated_at?: string | null
          id?: number
          period_end: string
          period_start: string
        }
        Update: {
          digest_json?: Json
          generated_at?: string | null
          id?: number
          period_end?: string
          period_start?: string
        }
        Relationships: []
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
