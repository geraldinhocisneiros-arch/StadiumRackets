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
      account_entries: {
        Row: {
          amount: number
          bucket: string
          client_id: string
          created_at: string
          description: string
          entry_date: string
          entry_type: Database["public"]["Enums"]["account_entry_type"]
          id: string
          is_demo: boolean
          payment_id: string | null
          recorded_by: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          bucket?: string
          client_id: string
          created_at?: string
          description: string
          entry_date?: string
          entry_type: Database["public"]["Enums"]["account_entry_type"]
          id?: string
          is_demo?: boolean
          payment_id?: string | null
          recorded_by?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          bucket?: string
          client_id?: string
          created_at?: string
          description?: string
          entry_date?: string
          entry_type?: Database["public"]["Enums"]["account_entry_type"]
          id?: string
          is_demo?: boolean
          payment_id?: string | null
          recorded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_entries_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      app_notifications: {
        Row: {
          body: string | null
          client_id: string | null
          created_at: string
          dedup_key: string | null
          id: string
          kind: string
          metadata: Json
          read_at: string | null
          requires_ack: boolean
          title: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          client_id?: string | null
          created_at?: string
          dedup_key?: string | null
          id?: string
          kind: string
          metadata?: Json
          read_at?: string | null
          requires_ack?: boolean
          title: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          client_id?: string | null
          created_at?: string
          dedup_key?: string | null
          id?: string
          kind?: string
          metadata?: Json
          read_at?: string | null
          requires_ack?: boolean
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Relationships: []
      }
      attachment_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachment_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "attachment_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          folder_id: string | null
          id: string
          mime_type: string | null
          name: string
          size_bytes: number | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name: string
          size_bytes?: number | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "attachment_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_name: string | null
          created_at: string
          details: Json | null
          entity: string
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          details?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          details?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
        }
        Relationships: []
      }
      boleiro_ranking_history: {
        Row: {
          booking_id: string
          candidates_snapshot: Json
          created_at: string
          id: string
          manual_by: string | null
          manual_reason: string | null
          resolved_at: string
          selected_client_id: string | null
          stage: number
          tiebreak_criterion: string | null
          was_manual: boolean
          was_specific_request: boolean
          window_id: string | null
        }
        Insert: {
          booking_id: string
          candidates_snapshot?: Json
          created_at?: string
          id?: string
          manual_by?: string | null
          manual_reason?: string | null
          resolved_at?: string
          selected_client_id?: string | null
          stage?: number
          tiebreak_criterion?: string | null
          was_manual?: boolean
          was_specific_request?: boolean
          window_id?: string | null
        }
        Update: {
          booking_id?: string
          candidates_snapshot?: Json
          created_at?: string
          id?: string
          manual_by?: string | null
          manual_reason?: string | null
          resolved_at?: string
          selected_client_id?: string | null
          stage?: number
          tiebreak_criterion?: string | null
          was_manual?: boolean
          was_specific_request?: boolean
          window_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boleiro_ranking_history_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boleiro_ranking_history_selected_client_id_fkey"
            columns: ["selected_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boleiro_ranking_history_window_id_fkey"
            columns: ["window_id"]
            isOneToOne: false
            referencedRelation: "boleiro_ranking_windows"
            referencedColumns: ["id"]
          },
        ]
      }
      boleiro_ranking_interests: {
        Row: {
          booking_id: string
          client_id: string
          id: string
          registered_at: string
          resolved_at: string | null
          status: string
          window_id: string | null
          withdrawn_at: string | null
        }
        Insert: {
          booking_id: string
          client_id: string
          id?: string
          registered_at?: string
          resolved_at?: string | null
          status?: string
          window_id?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          booking_id?: string
          client_id?: string
          id?: string
          registered_at?: string
          resolved_at?: string | null
          status?: string
          window_id?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boleiro_ranking_interests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boleiro_ranking_interests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boleiro_ranking_interests_window_id_fkey"
            columns: ["window_id"]
            isOneToOne: false
            referencedRelation: "boleiro_ranking_windows"
            referencedColumns: ["id"]
          },
        ]
      }
      boleiro_ranking_settings: {
        Row: {
          daily_limit: number
          id: boolean
          rules_enabled: boolean
          updated_at: string
          updated_by: string | null
          weekly_limit: number
          window_minutes: number
        }
        Insert: {
          daily_limit?: number
          id?: boolean
          rules_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
          weekly_limit?: number
          window_minutes?: number
        }
        Update: {
          daily_limit?: number
          id?: boolean
          rules_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
          weekly_limit?: number
          window_minutes?: number
        }
        Relationships: []
      }
      boleiro_ranking_windows: {
        Row: {
          booking_id: string
          closes_at: string
          created_at: string
          id: string
          opens_at: string
          stage: number
          status: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          closes_at: string
          created_at?: string
          id?: string
          opens_at?: string
          stage?: number
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          closes_at?: string
          created_at?: string
          id?: string
          opens_at?: string
          stage?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boleiro_ranking_windows_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      boleiro_suspensions: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          ends_on: string
          id: string
          reason: string | null
          starts_on: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          ends_on: string
          id?: string
          reason?: string | null
          starts_on: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          ends_on?: string
          id?: string
          reason?: string | null
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boleiro_suspensions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_confirmations: {
        Row: {
          booking_date: string
          booking_id: string | null
          created_at: string
          id: string
          notified_at: string
          responded_at: string | null
          schedule_id: string | null
          status: string
        }
        Insert: {
          booking_date: string
          booking_id?: string | null
          created_at?: string
          id?: string
          notified_at?: string
          responded_at?: string | null
          schedule_id?: string | null
          status?: string
        }
        Update: {
          booking_date?: string
          booking_id?: string | null
          created_at?: string
          id?: string
          notified_at?: string
          responded_at?: string | null
          schedule_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_confirmations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_confirmations_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "client_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_closings: {
        Row: {
          cash_user_id: string | null
          closed_at: string
          closed_by: string
          closing_date: string
          created_at: string
          differences: Json
          id: string
          is_demo: boolean
          notes: string | null
          pending_resolved: Json
          remotes_report: Json | null
          stock_report: Json | null
          totals_counted: Json
          totals_system: Json
          updated_at: string
        }
        Insert: {
          cash_user_id?: string | null
          closed_at?: string
          closed_by: string
          closing_date: string
          created_at?: string
          differences?: Json
          id?: string
          is_demo?: boolean
          notes?: string | null
          pending_resolved?: Json
          remotes_report?: Json | null
          stock_report?: Json | null
          totals_counted?: Json
          totals_system?: Json
          updated_at?: string
        }
        Update: {
          cash_user_id?: string | null
          closed_at?: string
          closed_by?: string
          closing_date?: string
          created_at?: string
          differences?: Json
          id?: string
          is_demo?: boolean
          notes?: string | null
          pending_resolved?: Json
          remotes_report?: Json | null
          stock_report?: Json | null
          totals_counted?: Json
          totals_system?: Json
          updated_at?: string
        }
        Relationships: []
      }
      cleaning_products: {
        Row: {
          active: boolean
          created_at: string
          current_stock: number
          id: string
          min_stock: number
          name: string
          supplier_id: string | null
          unit: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          current_stock?: number
          id?: string
          min_stock?: number
          name: string
          supplier_id?: string | null
          unit: string
        }
        Update: {
          active?: boolean
          created_at?: string
          current_stock?: number
          id?: string
          min_stock?: number
          name?: string
          supplier_id?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "cleaning_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaning_purchases: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          product_id: string
          purchase_date: string
          quantity: number
          stock_week_start: string
          supplier_id: string | null
          total_price: number | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          product_id: string
          purchase_date: string
          quantity: number
          stock_week_start: string
          supplier_id?: string | null
          total_price?: number | null
          unit_price: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          purchase_date?: string
          quantity?: number
          stock_week_start?: string
          supplier_id?: string | null
          total_price?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "cleaning_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "cleaning_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaning_suppliers: {
        Row: {
          company_name: string
          contact_name: string | null
          created_at: string
          id: string
          phone: string | null
        }
        Insert: {
          company_name: string
          contact_name?: string | null
          created_at?: string
          id?: string
          phone?: string | null
        }
        Update: {
          company_name?: string
          contact_name?: string | null
          created_at?: string
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
      cleaning_weekly_usage: {
        Row: {
          balance_qty: number | null
          created_at: string
          created_by: string | null
          id: string
          initial_qty: number
          product_id: string
          updated_at: string
          used_qty: number
          week_start: string
        }
        Insert: {
          balance_qty?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          initial_qty?: number
          product_id: string
          updated_at?: string
          used_qty?: number
          week_start: string
        }
        Update: {
          balance_qty?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          initial_qty?: number
          product_id?: string
          updated_at?: string
          used_qty?: number
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_weekly_usage_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "cleaning_products"
            referencedColumns: ["id"]
          },
        ]
      }
      client_categories: {
        Row: {
          active: boolean
          cancel_fee_amount: number
          color: string | null
          commission_percent: number
          created_at: string
          default_amount: number
          description: string | null
          id: string
          is_demo: boolean
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cancel_fee_amount?: number
          color?: string | null
          commission_percent?: number
          created_at?: string
          default_amount?: number
          description?: string | null
          id?: string
          is_demo?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cancel_fee_amount?: number
          color?: string | null
          commission_percent?: number
          created_at?: string
          default_amount?: number
          description?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_followups: {
        Row: {
          client_id: string
          followup_date: string | null
          message_sent: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          followup_date?: string | null
          message_sent?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          followup_date?: string | null
          message_sent?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      client_portal_users: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_users_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_schedule_attendance: {
        Row: {
          amount: number | null
          attendance_date: string
          client_schedule_id: string
          created_at: string
          created_by: string | null
          id: string
          is_demo: boolean
          payment_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          attendance_date: string
          client_schedule_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          payment_id?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          attendance_date?: string
          client_schedule_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          payment_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_schedule_attendance_client_schedule_id_fkey"
            columns: ["client_schedule_id"]
            isOneToOne: false
            referencedRelation: "client_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_schedule_attendance_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      client_schedule_boleiro_overrides: {
        Row: {
          boleiro_client_id: string | null
          boleiro_name: string | null
          boleiro_open: boolean
          client_schedule_id: string
          created_at: string
          created_by: string | null
          id: string
          override_date: string
          updated_at: string
        }
        Insert: {
          boleiro_client_id?: string | null
          boleiro_name?: string | null
          boleiro_open?: boolean
          client_schedule_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          override_date: string
          updated_at?: string
        }
        Update: {
          boleiro_client_id?: string | null
          boleiro_name?: string | null
          boleiro_open?: boolean
          client_schedule_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          override_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_schedule_boleiro_overrides_boleiro_client_id_fkey"
            columns: ["boleiro_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_schedule_boleiro_overrides_client_schedule_id_fkey"
            columns: ["client_schedule_id"]
            isOneToOne: false
            referencedRelation: "client_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      client_schedule_day_notes: {
        Row: {
          client_schedule_id: string
          created_at: string
          created_by: string | null
          id: string
          note_date: string
          notes: string
          updated_at: string
        }
        Insert: {
          client_schedule_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note_date: string
          notes: string
          updated_at?: string
        }
        Update: {
          client_schedule_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note_date?: string
          notes?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_schedule_day_notes_client_schedule_id_fkey"
            columns: ["client_schedule_id"]
            isOneToOne: false
            referencedRelation: "client_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      client_schedule_exceptions: {
        Row: {
          client_schedule_id: string
          created_at: string
          created_by: string | null
          end_time: string | null
          exception_date: string
          id: string
          is_demo: boolean
          range_end: string | null
          reason: string | null
          start_time: string | null
        }
        Insert: {
          client_schedule_id: string
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          exception_date: string
          id?: string
          is_demo?: boolean
          range_end?: string | null
          reason?: string | null
          start_time?: string | null
        }
        Update: {
          client_schedule_id?: string
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          exception_date?: string
          id?: string
          is_demo?: boolean
          range_end?: string | null
          reason?: string | null
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_schedule_exceptions_client_schedule_id_fkey"
            columns: ["client_schedule_id"]
            isOneToOne: false
            referencedRelation: "client_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      client_schedules: {
        Row: {
          boleiro_client_id: string | null
          boleiro_name: string | null
          boleiro_open: boolean | null
          client_id: string
          court: number | null
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          is_demo: boolean
          notes: string | null
          start_time: string
          teacher_id: string | null
          updated_at: string
          valid_from: string | null
          valid_until: string | null
          weekday: number
        }
        Insert: {
          boleiro_client_id?: string | null
          boleiro_name?: string | null
          boleiro_open?: boolean | null
          client_id: string
          court?: number | null
          created_at?: string
          created_by?: string | null
          end_time: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          start_time: string
          teacher_id?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
          weekday: number
        }
        Update: {
          boleiro_client_id?: string | null
          boleiro_name?: string | null
          boleiro_open?: boolean | null
          client_id?: string
          court?: number | null
          created_at?: string
          created_by?: string | null
          end_time?: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          start_time?: string
          teacher_id?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_schedules_boleiro_client_id_fkey"
            columns: ["boleiro_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_schedules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_schedules_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      client_teacher_link_requests: {
        Row: {
          action: string
          client_id: string
          created_at: string
          id: string
          requested_by: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          teacher_id: string
        }
        Insert: {
          action: string
          client_id: string
          created_at?: string
          id?: string
          requested_by?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          teacher_id: string
        }
        Update: {
          action?: string
          client_id?: string
          created_at?: string
          id?: string
          requested_by?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_teacher_link_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_teacher_link_requests_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      client_teachers: {
        Row: {
          client_id: string
          created_at: string
          id: string
          teacher_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          teacher_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_teachers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_teachers_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean
          birth_day: number | null
          birth_month: number | null
          category_id: string | null
          club_valid_until: string | null
          created_at: string
          custom_amount: number | null
          default_discount_percent: number
          due_day: number | null
          email: string | null
          financial_responsible: string | null
          full_name: string
          id: string
          is_demo: boolean
          is_gympass: boolean
          linked_teacher_id: string | null
          prepay_exempt: boolean
          notes: string | null
          phone: string | null
          preferred_boleiro: string | null
          profile_photo_consent_at: string | null
          profile_photo_path: string | null
          profile_photo_updated_at: string | null
          profile_photo_updated_by: string | null
          responsible_client_id: string | null
          teacher_id: string | null
          tennis_class: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          birth_day?: number | null
          birth_month?: number | null
          category_id?: string | null
          club_valid_until?: string | null
          created_at?: string
          custom_amount?: number | null
          default_discount_percent?: number
          due_day?: number | null
          email?: string | null
          financial_responsible?: string | null
          full_name: string
          id?: string
          is_demo?: boolean
          is_gympass?: boolean
          linked_teacher_id?: string | null
          prepay_exempt?: boolean
          notes?: string | null
          phone?: string | null
          preferred_boleiro?: string | null
          profile_photo_consent_at?: string | null
          profile_photo_path?: string | null
          profile_photo_updated_at?: string | null
          profile_photo_updated_by?: string | null
          responsible_client_id?: string | null
          teacher_id?: string | null
          tennis_class?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          birth_day?: number | null
          birth_month?: number | null
          category_id?: string | null
          club_valid_until?: string | null
          created_at?: string
          custom_amount?: number | null
          default_discount_percent?: number
          due_day?: number | null
          email?: string | null
          financial_responsible?: string | null
          full_name?: string
          id?: string
          is_demo?: boolean
          is_gympass?: boolean
          linked_teacher_id?: string | null
          prepay_exempt?: boolean
          notes?: string | null
          phone?: string | null
          preferred_boleiro?: string | null
          profile_photo_consent_at?: string | null
          profile_photo_path?: string | null
          profile_photo_updated_at?: string | null
          profile_photo_updated_by?: string | null
          responsible_client_id?: string | null
          teacher_id?: string | null
          tennis_class?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "client_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_responsible_client_id_fkey"
            columns: ["responsible_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      club_renewals: {
        Row: {
          amount: number
          bucket: string
          client_id: string
          created_at: string
          id: string
          processed_at: string | null
          renewal_date: string
          source_payment_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          bucket: string
          client_id: string
          created_at?: string
          id?: string
          processed_at?: string | null
          renewal_date: string
          source_payment_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          bucket?: string
          client_id?: string
          created_at?: string
          id?: string
          processed_at?: string | null
          renewal_date?: string
          source_payment_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_renewals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_renewals_source_payment_id_fkey"
            columns: ["source_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranca_followup_events: {
        Row: {
          actor: string | null
          balance_at_event: number | null
          context: string | null
          created_at: string
          event_type: string
          followup_id: string
          id: string
          note: string | null
        }
        Insert: {
          actor?: string | null
          balance_at_event?: number | null
          context?: string | null
          created_at?: string
          event_type: string
          followup_id: string
          id?: string
          note?: string | null
        }
        Update: {
          actor?: string | null
          balance_at_event?: number | null
          context?: string | null
          created_at?: string
          event_type?: string
          followup_id?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_followup_events_followup_id_fkey"
            columns: ["followup_id"]
            isOneToOne: false
            referencedRelation: "cobranca_followups"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranca_followups: {
        Row: {
          balance_at_last_send: number | null
          client_id: string
          created_at: string
          id: string
          last_context: string | null
          last_sent_at: string
          last_sent_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_note: string | null
          send_count: number
          status: string
          updated_at: string
        }
        Insert: {
          balance_at_last_send?: number | null
          client_id: string
          created_at?: string
          id?: string
          last_context?: string | null
          last_sent_at?: string
          last_sent_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_note?: string | null
          send_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          balance_at_last_send?: number | null
          client_id?: string
          created_at?: string
          id?: string
          last_context?: string | null
          last_sent_at?: string
          last_sent_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_note?: string | null
          send_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_followups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      court_availability_overrides: {
        Row: {
          active: boolean
          availability_date: string
          cancelled_at: string | null
          cancelled_by: string | null
          court: number
          created_at: string
          created_by: string | null
          end_time: string
          hourly_price: number
          id: string
          notes: string | null
          start_time: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          availability_date: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          court: number
          created_at?: string
          created_by?: string | null
          end_time: string
          hourly_price: number
          id?: string
          notes?: string | null
          start_time: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          availability_date?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          court?: number
          created_at?: string
          created_by?: string | null
          end_time?: string
          hourly_price?: number
          id?: string
          notes?: string | null
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      court_booking_boleiro_requests: {
        Row: {
          booking_id: string
          client_id: string
          id: string
          note: string | null
          position: number | null
          requested_at: string
          requested_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          booking_id: string
          client_id: string
          id?: string
          note?: string | null
          position?: number | null
          requested_at?: string
          requested_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          booking_id?: string
          client_id?: string
          id?: string
          note?: string | null
          position?: number | null
          requested_at?: string
          requested_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_booking_boleiro_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_booking_boleiro_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      court_booking_participants: {
        Row: {
          booking_id: string
          client_id: string
          created_at: string
          id: string
        }
        Insert: {
          booking_id: string
          client_id: string
          created_at?: string
          id?: string
        }
        Update: {
          booking_id?: string
          client_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_booking_participants_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_booking_participants_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      court_bookings: {
        Row: {
          boleiro_assigned_at: string | null
          boleiro_client_id: string | null
          boleiro_name: string | null
          boleiro_open: boolean
          booking_date: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category_id: string | null
          charge_applied: boolean
          charge_id: string | null
          client_id: string | null
          companion_type: string | null
          court: number
          created_at: string
          created_by: string | null
          end_time: string
          guest_name: string | null
          guest_type: Database["public"]["Enums"]["booking_guest_type"] | null
          hold_expires_at: string | null
          prepaid_at_booking: boolean
          prepayment_override_by: string | null
          prepayment_override_reason: string | null
          id: string
          is_demo: boolean
          notes: string | null
          source: Database["public"]["Enums"]["booking_source"]
          start_time: string
          teacher_id: string | null
          updated_at: string
        }
        Insert: {
          boleiro_assigned_at?: string | null
          boleiro_client_id?: string | null
          boleiro_name?: string | null
          boleiro_open?: boolean
          booking_date: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category_id?: string | null
          charge_applied?: boolean
          charge_id?: string | null
          client_id?: string | null
          companion_type?: string | null
          court: number
          created_at?: string
          created_by?: string | null
          end_time: string
          guest_name?: string | null
          guest_type?: Database["public"]["Enums"]["booking_guest_type"] | null
          hold_expires_at?: string | null
          prepaid_at_booking?: boolean
          prepayment_override_by?: string | null
          prepayment_override_reason?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          source: Database["public"]["Enums"]["booking_source"]
          start_time: string
          teacher_id?: string | null
          updated_at?: string
        }
        Update: {
          boleiro_assigned_at?: string | null
          boleiro_client_id?: string | null
          boleiro_name?: string | null
          boleiro_open?: boolean
          booking_date?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category_id?: string | null
          charge_applied?: boolean
          charge_id?: string | null
          client_id?: string | null
          companion_type?: string | null
          court?: number
          created_at?: string
          created_by?: string | null
          end_time?: string
          guest_name?: string | null
          guest_type?: Database["public"]["Enums"]["booking_guest_type"] | null
          hold_expires_at?: string | null
          prepaid_at_booking?: boolean
          prepayment_override_by?: string | null
          prepayment_override_reason?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          source?: Database["public"]["Enums"]["booking_source"]
          start_time?: string
          teacher_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_bookings_boleiro_client_id_fkey"
            columns: ["boleiro_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "client_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "monthly_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      court_remote_loans: {
        Row: {
          booking_id: string | null
          client_id: string | null
          court: number
          created_at: string
          holder_name: string
          id: string
          lent_at: string
          lent_by: string | null
          notes: string | null
          return_notes: string | null
          returned_at: string | null
          returned_by: string | null
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          client_id?: string | null
          court: number
          created_at?: string
          holder_name: string
          id?: string
          lent_at?: string
          lent_by?: string | null
          notes?: string | null
          return_notes?: string | null
          returned_at?: string | null
          returned_by?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          client_id?: string | null
          court?: number
          created_at?: string
          holder_name?: string
          id?: string
          lent_at?: string
          lent_by?: string | null
          notes?: string | null
          return_notes?: string | null
          returned_at?: string | null
          returned_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_remote_loans_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_remote_loans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      court_waitlist: {
        Row: {
          availability_plan: Json | null
          booking_id_created: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_id: string | null
          confirmed_at: string | null
          contacted_at: string | null
          court: number | null
          court_continuity: string
          created_at: string
          created_by: string | null
          desired_date: string
          end_time: string
          guest_name: string | null
          id: string
          notes: string | null
          notified_at: string | null
          priority: number
          requested_by_teacher_id: string | null
          resulting_booking_id: string | null
          source: string | null
          source_booking_id: string | null
          start_time: string
          status: Database["public"]["Enums"]["waitlist_status"]
          teacher_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          availability_plan?: Json | null
          booking_id_created?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string | null
          confirmed_at?: string | null
          contacted_at?: string | null
          court?: number | null
          court_continuity?: string
          created_at?: string
          created_by?: string | null
          desired_date: string
          end_time: string
          guest_name?: string | null
          id?: string
          notes?: string | null
          notified_at?: string | null
          priority?: number
          requested_by_teacher_id?: string | null
          resulting_booking_id?: string | null
          source?: string | null
          source_booking_id?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["waitlist_status"]
          teacher_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          availability_plan?: Json | null
          booking_id_created?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string | null
          confirmed_at?: string | null
          contacted_at?: string | null
          court?: number | null
          court_continuity?: string
          created_at?: string
          created_by?: string | null
          desired_date?: string
          end_time?: string
          guest_name?: string | null
          id?: string
          notes?: string | null
          notified_at?: string | null
          priority?: number
          requested_by_teacher_id?: string | null
          resulting_booking_id?: string | null
          source?: string | null
          source_booking_id?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["waitlist_status"]
          teacher_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "court_waitlist_booking_id_created_fkey"
            columns: ["booking_id_created"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_waitlist_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_waitlist_requested_by_teacher_id_fkey"
            columns: ["requested_by_teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_waitlist_resulting_booking_id_fkey"
            columns: ["resulting_booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_waitlist_source_booking_id_fkey"
            columns: ["source_booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_waitlist_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      debt_limit_alert_events: {
        Row: {
          actor: string | null
          alert_id: string
          created_at: string
          debt_at_event: number | null
          event_type: string
          id: string
          note: string | null
        }
        Insert: {
          actor?: string | null
          alert_id: string
          created_at?: string
          debt_at_event?: number | null
          event_type: string
          id?: string
          note?: string | null
        }
        Update: {
          actor?: string | null
          alert_id?: string
          created_at?: string
          debt_at_event?: number | null
          event_type?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "debt_limit_alert_events_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "debt_limit_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      debt_limit_alerts: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          debt_at_creation: number
          id: string
          reached_date: string
          reopened_at: string | null
          reopened_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_note: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          debt_at_creation: number
          id?: string
          reached_date: string
          reopened_at?: string | null
          reopened_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_note?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          debt_at_creation?: number
          id?: string
          reached_date?: string
          reopened_at?: string | null
          reopened_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_note?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "debt_limit_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      debt_limit_exceptions: {
        Row: {
          active: boolean
          client_id: string
          created_at: string
          created_by: string
          deactivated_at: string | null
          deactivated_by: string | null
          id: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          client_id: string
          created_at?: string
          created_by: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          client_id?: string
          created_at?: string
          created_by?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "debt_limit_exceptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      debt_limit_settings: {
        Row: {
          id: boolean
          limit_amount: number
          rule_start_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          limit_amount?: number
          rule_start_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          limit_amount?: number
          rule_start_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      demo_users: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fixed_court_waitlist: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_id: string | null
          confirmed_at: string | null
          contacted_at: string | null
          court: number | null
          created_at: string
          created_by: string | null
          desired_weekday: number
          end_time: string
          guest_name: string | null
          id: string
          notes: string | null
          notified_at: string | null
          priority: number
          requested_by_teacher_id: string | null
          resulting_schedule_id: string | null
          source: string
          start_time: string
          status: Database["public"]["Enums"]["waitlist_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string | null
          confirmed_at?: string | null
          contacted_at?: string | null
          court?: number | null
          created_at?: string
          created_by?: string | null
          desired_weekday: number
          end_time: string
          guest_name?: string | null
          id?: string
          notes?: string | null
          notified_at?: string | null
          priority?: number
          requested_by_teacher_id?: string | null
          resulting_schedule_id?: string | null
          source?: string
          start_time: string
          status?: Database["public"]["Enums"]["waitlist_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string | null
          confirmed_at?: string | null
          contacted_at?: string | null
          court?: number | null
          created_at?: string
          created_by?: string | null
          desired_weekday?: number
          end_time?: string
          guest_name?: string | null
          id?: string
          notes?: string | null
          notified_at?: string | null
          priority?: number
          requested_by_teacher_id?: string | null
          resulting_schedule_id?: string | null
          source?: string
          start_time?: string
          status?: Database["public"]["Enums"]["waitlist_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_court_waitlist_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_court_waitlist_requested_by_teacher_id_fkey"
            columns: ["requested_by_teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_court_waitlist_resulting_schedule_id_fkey"
            columns: ["resulting_schedule_id"]
            isOneToOne: false
            referencedRelation: "client_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_waitlist_court_hours: {
        Row: {
          close_time: string
          court: number
          created_at: string
          id: string
          open_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          close_time: string
          court: number
          created_at?: string
          id?: string
          open_time: string
          updated_at?: string
          weekday: number
        }
        Update: {
          close_time?: string
          court?: number
          created_at?: string
          id?: string
          open_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: []
      }
      fixed_waitlist_court_settings: {
        Row: {
          active: boolean
          closes_on: string
          court: number
          created_at: string
          created_by: string | null
          opens_on: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          closes_on: string
          court: number
          created_at?: string
          created_by?: string | null
          opens_on: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          closes_on?: string
          court?: number
          created_at?: string
          created_by?: string | null
          opens_on?: string
          updated_at?: string
        }
        Relationships: []
      }
      idea_comments: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          idea_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          idea_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          idea_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idea_comments_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      ideas: {
        Row: {
          content: string | null
          created_at: string
          created_by: string
          id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          created_by: string
          id?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          created_by?: string
          id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      meeting_items: {
        Row: {
          assignee_id: string | null
          carried_from: string | null
          created_at: string
          created_by: string | null
          details: string | null
          id: string
          meeting_id: string
          outcome: string | null
          source: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          carried_from?: string | null
          created_at?: string
          created_by?: string | null
          details?: string | null
          id?: string
          meeting_id: string
          outcome?: string | null
          source?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          carried_from?: string | null
          created_at?: string
          created_by?: string | null
          details?: string | null
          id?: string
          meeting_id?: string
          outcome?: string | null
          source?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_items_carried_from_fkey"
            columns: ["carried_from"]
            isOneToOne: false
            referencedRelation: "meeting_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          meeting_date: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          meeting_date: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          meeting_date?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      monthly_charges: {
        Row: {
          amount: number
          client_id: string
          created_at: string
          due_date: string
          id: string
          is_demo: boolean
          paid_at: string | null
          reference_month: string
          status: Database["public"]["Enums"]["charge_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          client_id: string
          created_at?: string
          due_date: string
          id?: string
          is_demo?: boolean
          paid_at?: string | null
          reference_month: string
          status?: Database["public"]["Enums"]["charge_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          client_id?: string
          created_at?: string
          due_date?: string
          id?: string
          is_demo?: boolean
          paid_at?: string | null
          reference_month?: string
          status?: Database["public"]["Enums"]["charge_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_charges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      neurochat_message_logs: {
        Row: {
          booking_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          external_message_id: string | null
          failure_reason: string | null
          id: string
          message_type: string
          phone: string | null
          request_payload: Json | null
          response_payload: Json | null
          session_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          external_message_id?: string | null
          failure_reason?: string | null
          id?: string
          message_type: string
          phone?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          external_message_id?: string | null
          failure_reason?: string | null
          id?: string
          message_type?: string
          phone?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "neurochat_message_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      online_payments: {
        Row: {
          amount: number
          booking_id: string
          client_id: string
          confirmed_at: string | null
          created_at: string
          id: string
          mp_payment_id: string | null
          mp_preference_id: string | null
          mp_status_detail: string | null
          payment_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id: string
          client_id: string
          confirmed_at?: string | null
          created_at?: string
          id?: string
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          mp_status_detail?: string | null
          payment_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          client_id?: string
          confirmed_at?: string | null
          created_at?: string
          id?: string
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          mp_status_detail?: string | null
          payment_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_payments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      open_debt_reminder_actions: {
        Row: {
          acted_at: string
          acted_by: string | null
          action: string
          client_id: string
          id: string
          reminder_date: string
        }
        Insert: {
          acted_at?: string
          acted_by?: string | null
          action: string
          client_id: string
          id?: string
          reminder_date: string
        }
        Update: {
          acted_at?: string
          acted_by?: string | null
          action?: string
          client_id?: string
          id?: string
          reminder_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_debt_reminder_actions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_receipts: {
        Row: {
          client_id: string
          created_at: string
          entry_id: string | null
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          payment_id: string | null
          size_bytes: number | null
          uploaded_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          entry_id?: string | null
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          payment_id?: string | null
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          entry_id?: string | null
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          payment_id?: string | null
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipts_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "account_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          account_direction: string | null
          amount: number
          booking_id: string | null
          category_id: string | null
          charge_id: string | null
          client_id: string | null
          club_charge_kind: string | null
          club_months: number | null
          club_taxa_sub: string | null
          commission_user_id: string | null
          court: number | null
          created_at: string
          end_time: string | null
          id: string
          is_demo: boolean
          is_new_plan_sale: boolean
          is_pending_payment: boolean
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          paid_at: string
          passthrough_amount: number
          quantity: number
          received: boolean
          recorded_by: string | null
          start_time: string | null
          to_account: boolean
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          account_direction?: string | null
          amount: number
          booking_id?: string | null
          category_id?: string | null
          charge_id?: string | null
          client_id?: string | null
          club_charge_kind?: string | null
          club_months?: number | null
          club_taxa_sub?: string | null
          commission_user_id?: string | null
          court?: number | null
          created_at?: string
          end_time?: string | null
          id?: string
          is_demo?: boolean
          is_new_plan_sale?: boolean
          is_pending_payment?: boolean
          method: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          passthrough_amount?: number
          quantity?: number
          received?: boolean
          recorded_by?: string | null
          start_time?: string | null
          to_account?: boolean
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          account_direction?: string | null
          amount?: number
          booking_id?: string | null
          category_id?: string | null
          charge_id?: string | null
          client_id?: string | null
          club_charge_kind?: string | null
          club_months?: number | null
          club_taxa_sub?: string | null
          commission_user_id?: string | null
          court?: number | null
          created_at?: string
          end_time?: string | null
          id?: string
          is_demo?: boolean
          is_new_plan_sale?: boolean
          is_pending_payment?: boolean
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          passthrough_amount?: number
          quantity?: number
          received?: boolean
          recorded_by?: string | null
          start_time?: string | null
          to_account?: boolean
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "client_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "monthly_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_commission_user_id_fkey"
            columns: ["commission_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_client_signups: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_client_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          phone?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_client_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_client_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_client_signups_resolved_client_id_fkey"
            columns: ["resolved_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_signups: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          kind: string
          phone: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          kind: string
          phone?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          kind?: string
          phone?: string | null
          user_id?: string
        }
        Relationships: []
      }
      portal_signup_tokens: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_signup_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      prepay_release_requests: {
        Row: {
          booking_date: string
          booking_id: string | null
          client_id: string
          court: number | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          end_time: string | null
          id: string
          reason: string
          requested_at: string
          requested_by: string | null
          start_time: string | null
          status: string
        }
        Insert: {
          booking_date: string
          booking_id?: string | null
          client_id: string
          court?: number | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          end_time?: string | null
          id?: string
          reason: string
          requested_at?: string
          requested_by?: string | null
          start_time?: string | null
          status?: string
        }
        Update: {
          booking_date?: string
          booking_id?: string | null
          client_id?: string
          court?: number | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          end_time?: string | null
          id?: string
          reason?: string
          requested_at?: string
          requested_by?: string | null
          start_time?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "prepay_release_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      price_table: {
        Row: {
          categories: string[] | null
          courts: number[] | null
          created_at: string
          discount_percent: number | null
          end_time: string
          ends_on: string | null
          id: string
          is_demo: boolean
          price_per_hour: number
          start_time: string
          starts_on: string | null
          updated_at: string
          weekday: number
        }
        Insert: {
          categories?: string[] | null
          courts?: number[] | null
          created_at?: string
          discount_percent?: number | null
          end_time: string
          ends_on?: string | null
          id?: string
          is_demo?: boolean
          price_per_hour: number
          start_time: string
          starts_on?: string | null
          updated_at?: string
          weekday: number
        }
        Update: {
          categories?: string[] | null
          courts?: number[] | null
          created_at?: string
          discount_percent?: number | null
          end_time?: string
          ends_on?: string | null
          id?: string
          is_demo?: boolean
          price_per_hour?: number
          start_time?: string
          starts_on?: string | null
          updated_at?: string
          weekday?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          nav_menu_order: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          nav_menu_order?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          nav_menu_order?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      racket_loans: {
        Row: {
          booking_id: string | null
          client_id: string | null
          racket: number
          created_at: string
          holder_name: string
          id: string
          lent_at: string
          lent_by: string | null
          notes: string | null
          return_notes: string | null
          returned_at: string | null
          returned_by: string | null
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          client_id?: string | null
          racket: number
          created_at?: string
          holder_name: string
          id?: string
          lent_at?: string
          lent_by?: string | null
          notes?: string | null
          return_notes?: string | null
          returned_at?: string | null
          returned_by?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          client_id?: string | null
          racket?: number
          created_at?: string
          holder_name?: string
          id?: string
          lent_at?: string
          lent_by?: string | null
          notes?: string | null
          return_notes?: string | null
          returned_at?: string | null
          returned_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "racket_loans_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "racket_loans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_items: {
        Row: {
          created_at: string
          current_quantity: number
          id: string
          is_demo: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_quantity?: number
          id?: string
          is_demo?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_quantity?: number
          id?: string
          is_demo?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          created_at: string
          id: string
          is_demo: boolean
          item_id: string
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          notes: string | null
          payment_id: string | null
          quantity: number
          recorded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_demo?: boolean
          item_id: string
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          notes?: string | null
          payment_id?: string | null
          quantity: number
          recorded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_demo?: boolean
          item_id?: string
          movement_type?: Database["public"]["Enums"]["stock_movement_type"]
          notes?: string | null
          payment_id?: string | null
          quantity?: number
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      task_updates: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_updates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          next_followup_at: string | null
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          recurrence: Database["public"]["Enums"]["task_recurrence"]
          recurrence_interval: number
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to: string
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          next_followup_at?: string | null
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence?: Database["public"]["Enums"]["task_recurrence"]
          recurrence_interval?: number
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          next_followup_at?: string | null
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence?: Database["public"]["Enums"]["task_recurrence"]
          recurrence_interval?: number
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_client_change_requests: {
        Row: {
          booking_id: string | null
          court: number
          created_at: string
          current_client_id: string | null
          current_client_name: string | null
          end_time: string
          id: string
          new_client_id: string | null
          new_client_name: string
          occurrence_date: string
          requested_by: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          schedule_id: string | null
          start_time: string
          status: string
          teacher_id: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          court: number
          created_at?: string
          current_client_id?: string | null
          current_client_name?: string | null
          end_time: string
          id?: string
          new_client_id?: string | null
          new_client_name: string
          occurrence_date: string
          requested_by: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          schedule_id?: string | null
          start_time: string
          status?: string
          teacher_id: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          court?: number
          created_at?: string
          current_client_id?: string | null
          current_client_name?: string | null
          end_time?: string
          id?: string
          new_client_id?: string | null
          new_client_name?: string
          occurrence_date?: string
          requested_by?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          schedule_id?: string | null
          start_time?: string
          status?: string
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_client_change_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "court_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_client_change_requests_current_client_id_fkey"
            columns: ["current_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_client_change_requests_new_client_id_fkey"
            columns: ["new_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_client_change_requests_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "client_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_client_change_requests_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_signup_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          teacher_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          teacher_id: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          teacher_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teacher_signup_tokens_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_demo: boolean
          name: string
          phone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_demo?: boolean
          name: string
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          is_demo?: boolean
          name?: string
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          created_at: string
          granted: boolean
          id: string
          page_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted?: boolean
          id?: string
          page_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted?: boolean
          id?: string
          page_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waitlist_acknowledgements: {
        Row: {
          acknowledged_at: string
          actor_name: string | null
          id: string
          user_id: string
          waitlist_id: string
        }
        Insert: {
          acknowledged_at?: string
          actor_name?: string | null
          id?: string
          user_id: string
          waitlist_id: string
        }
        Update: {
          acknowledged_at?: string
          actor_name?: string | null
          id?: string
          user_id?: string
          waitlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_acknowledgements_waitlist_id_fkey"
            columns: ["waitlist_id"]
            isOneToOne: false
            referencedRelation: "court_waitlist"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_notifications: {
        Row: {
          client_id: string
          context: string | null
          id: string
          sent_at: string
          sent_by: string | null
        }
        Insert: {
          client_id: string
          context?: string | null
          id?: string
          sent_at?: string
          sent_by?: string | null
        }
        Update: {
          client_id?: string
          context?: string | null
          id?: string
          sent_at?: string
          sent_by?: string | null
        }
        Relationships: []
      }
      work_task_comments: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          task_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          task_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "work_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      work_tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          position: number
          status: string
          title: string
          updated_at: string
          work_id: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          position?: number
          status?: string
          title: string
          updated_at?: string
          work_id: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          position?: number
          status?: string
          title?: string
          updated_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_tasks_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      works: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          expected_end_date: string | null
          id: string
          start_date: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          expected_end_date?: string | null
          id?: string
          start_date?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          expected_end_date?: string | null
          id?: string
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_save_client_schedule: {
        Args: {
          _boleiro_name: string | null
          _boleiro_open: boolean
          _client_id: string
          _court: number | null
          _end_time: string
          _group_ids?: string[] | null
          _id: string | null
          _notes: string | null
          _replace_ids?: string[] | null
          _teacher_id: string | null
          _valid_from: string | null
          _valid_until: string | null
          _weekday: number
          _start_time: string
        }
        Returns: Json
      }
      _client_remaining_sessions_amount: {
        Args: {
          _client_id: string
          _range_end?: string | null
          _range_start?: string | null
        }
        Returns: {
          session_amount: number
          session_count: number
        }[]
      }
      _debt_limit_add_exception_internal: {
        Args: { _actor: string; _client_id: string; _reason: string }
        Returns: string
      }
      _fixed_waitlist_position: {
        Args: { _id: string }
        Returns: {
          queue_position: number
          tied: boolean
          total: number
        }[]
      }
      _notify_fixed_waitlist_position_changed: {
        Args: {
          _cause_id: string
          _court: number
          _end: string
          _exclude_id: string
          _start: string
          _weekday: number
        }
        Returns: undefined
      }
      app_settings_is_public_key: { Args: { _key: string }; Returns: boolean }
      approve_client_change_request: {
        Args: { _request_id: string }
        Returns: Json
      }
      approve_client_teacher_link_request: {
        Args: { _request_id: string }
        Returns: Json
      }
      approve_pending_signup: {
        Args: { target_user: string }
        Returns: undefined
      }
      auth_user_exists: { Args: { _user_id: string }; Returns: boolean }
      boleiro_agenda_range: {
        Args: { _end_date: string; _start_date: string }
        Returns: Json
      }
      boleiro_cancel_my_slot: {
        Args: { _booking_id: string }
        Returns: boolean
      }
      boleiro_leave: { Args: { _booking_id: string }; Returns: boolean }
      boleiro_map_bookings: { Args: { _date: string }; Returns: Json }
      boleiro_map_schedule_exceptions: {
        Args: { _date: string; _weekday: number }
        Returns: Json
      }
      boleiro_map_schedule_overrides: { Args: { _date: string }; Returns: Json }
      boleiro_map_schedules:
        | { Args: { _weekday: number }; Returns: Json }
        | { Args: { _date?: string; _weekday: number }; Returns: Json }
      boleiro_open_slots_range: {
        Args: { _end_date: string; _start_date: string }
        Returns: Json
      }
      boleiro_ranking_admin_dashboard: {
        Args: {
          _client_id?: string
          _date_from?: string
          _date_to?: string
          _status?: string
        }
        Returns: {
          active: boolean
          cancellations: number
          client_id: string
          full_name: string
          interests_registered: number
          last_ranking_at: string
          rankings_range: number
          rankings_specific: number
          rankings_today: number
          rankings_week: number
          suspended: boolean
        }[]
      }
      boleiro_ranking_apply_specific: {
        Args: { _booking_id: string; _client_id: string; _display_name: string }
        Returns: {
          message: string
          ok: boolean
        }[]
      }
      boleiro_ranking_history_list: {
        Args: {
          _booking_id?: string
          _client_id?: string
          _date_from?: string
          _date_to?: string
        }
        Returns: {
          booking_date: string
          booking_id: string
          candidates_snapshot: Json
          court: number
          end_time: string
          id: string
          manual_by: string
          manual_reason: string
          resolved_at: string
          selected_client_id: string
          selected_name: string
          stage: number
          start_time: string
          tiebreak_criterion: string
          was_manual: boolean
          was_specific_request: boolean
          window_id: string
        }[]
      }
      boleiro_ranking_manual_assign: {
        Args: { _booking_id: string; _client_id: string; _reason: string }
        Returns: {
          message: string
          ok: boolean
        }[]
      }
      boleiro_ranking_my_status: { Args: never; Returns: Json }
      boleiro_ranking_open_window: {
        Args: { _booking_id: string }
        Returns: string
      }
      boleiro_ranking_pick_winner: {
        Args: {
          _booking_id: string
          _ignore_daily_limit: boolean
          _window_id: string
        }
        Returns: {
          client_id: string
          daily_count: number
          interest_id: string
          last_assigned_at: string
          registered_at: string
          weekly_count: number
        }[]
      }
      boleiro_ranking_register_interest: {
        Args: { _booking_id: string }
        Returns: string
      }
      boleiro_ranking_resolve_window: {
        Args: { _window_id: string }
        Returns: undefined
      }
      boleiro_ranking_suggest_weekly_limit: {
        Args: never
        Returns: {
          active_boleiro_count: number
          ranking_count_this_week: number
          suggested_weekly_limit: number
        }[]
      }
      boleiro_ranking_withdraw_interest: {
        Args: { _booking_id: string }
        Returns: boolean
      }
      can_access_client_photo: { Args: { _name: string }; Returns: boolean }
      can_boleiro_request_booking: {
        Args: { _booking_id: string; _client_id: string; _requested_by: string }
        Returns: boolean
      }
      cleaning_delete_purchase: { Args: { _id: string }; Returns: boolean }
      cleaning_register_purchase: {
        Args: {
          _notes?: string
          _product_id: string
          _purchase_date?: string
          _quantity: number
          _supplier_id?: string
          _unit_price: number
        }
        Returns: string
      }
      cleaning_update_purchase: {
        Args: {
          _id: string
          _notes?: string
          _purchase_date?: string
          _quantity: number
          _supplier_id?: string
          _unit_price: number
        }
        Returns: boolean
      }
      client_account_balance: { Args: { _client_id: string }; Returns: number }
      client_account_balances: {
        Args: { _client_id: string }
        Returns: {
          balance: number
          bucket: string
        }[]
      }
      client_open_debt_items: {
        Args: { _client_id: string }
        Returns: {
          amount: number
          booking_date: string | null
          court: number | null
          description: string
          entry_date: string
          start_time: string | null
        }[]
      }
      client_family_month_end_projection: {
        Args: { _client_id: string }
        Returns: {
          amount_needed: number
          client_id: string
          current_balance: number
          full_name: string
          is_responsible: boolean
          phone: string
          projected_balance: number
          remaining_sessions: number
          remaining_sessions_amount: number
        }[]
      }
      client_month_end_projection: {
        Args: { _client_id: string }
        Returns: {
          amount_needed: number
          current_balance: number
          projected_balance: number
          remaining_sessions: number
          remaining_sessions_amount: number
        }[]
      }
      client_next_month_projection: {
        Args: { _client_id: string }
        Returns: {
          amount_needed: number
          projected_balance: number
          remaining_sessions: number
          remaining_sessions_amount: number
          starting_balance: number
        }[]
      }
      client_requires_prepayment: {
        Args: { _client_id: string }
        Returns: boolean
      }
      clients_open_debt: {
        Args: { _client_ids?: string[] }
        Returns: {
          client_id: string
          debt_amount: number
          geral_debt: number
        }[]
      }
      club_membership_can_book: {
        Args: { _client_id: string }
        Returns: boolean
      }
      club_membership_notify_due: { Args: never; Returns: undefined }
      club_membership_status_list: {
        Args: never
        Returns: {
          category_id: string
          category_name: string
          client_id: string
          club_valid_until: string
          days_overdue: number
          full_name: string
          is_due: boolean
          mensalidade_amount: number
          open_taxa_total: number
          phone: string
          total_due: number
        }[]
      }
      cobranca_assignees: {
        Args: never
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      cobranca_exceptions_watch: {
        Args: never
        Returns: {
          assigned_name: string | null
          balance: number
          client_id: string
          client_name: string
          client_phone: string | null
          days_without_payment: number
          exception_reason: string | null
          followup_id: string | null
          has_history: boolean
          is_gympass: boolean
          largest_payment: number | null
          last_payment_on: string | null
          out_of_pattern: boolean
          usual_max_gap: number | null
          why: string | null
        }[]
      }
      cobranca_followup_add_note: {
        Args: { _followup_id: string; _note: string }
        Returns: Json
      }
      cobranca_followup_assign: {
        Args: {
          _assignee: string
          _client_id: string
          _context?: string
          _note?: string
        }
        Returns: Json
      }
      cobranca_followup_keep: {
        Args: { _followup_id: string; _note?: string }
        Returns: Json
      }
      cobranca_followup_register_send: {
        Args: { _client_id: string; _context: string }
        Returns: Json
      }
      cobranca_followup_reopen: {
        Args: { _followup_id: string }
        Returns: Json
      }
      cobranca_followup_resolve: {
        Args: { _followup_id: string; _note?: string }
        Returns: Json
      }
      cobranca_followups_list: {
        Args: { _status?: string }
        Returns: {
          balance_at_last_send: number | null
          client_active: boolean
          client_id: string
          client_name: string
          client_phone: string | null
          created_at: string
          current_balance: number
          id: string
          last_context: string | null
          last_sent_at: string
          resolved_at: string | null
          resolved_note: string | null
          send_count: number
          status: string
          assigned_to: string | null
          assigned_name: string | null
          assigned_at: string | null
          last_note: string | null
          last_note_at: string | null
          last_note_by: string | null
          kept_at: string | null
          kept_by_name: string | null
          client_exception: string | null
        }[]
      }
      create_substitute_schedule: {
        Args: {
          p_notes?: string
          p_original_schedule_id: string
          p_substitute_client_id: string
          p_valid_from: string
          p_valid_until: string
        }
        Returns: string
      }
      debt_limit_add_exception: {
        Args: { _client_id: string; _reason?: string }
        Returns: string
      }
      debt_limit_alerts_list: {
        Args: never
        Returns: {
          alert_id: string
          category_name: string
          client_id: string
          created_at: string
          debt_amount: number
          full_name: string
          has_fixed_schedule: boolean
          next_booking_court: number
          next_booking_date: string
          next_booking_end_time: string
          next_booking_id: string
          next_booking_start_time: string
          next_fixed_court: number
          next_fixed_date: string
          next_fixed_end_time: string
          next_fixed_schedule_id: string
          next_fixed_start_time: string
          phone: string
          reached_date: string
        }[]
      }
      debt_limit_cancel_fixed_occurrence: {
        Args: { _client_schedule_id: string; _date: string; _reason?: string }
        Returns: boolean
      }
      debt_limit_check_and_alert: {
        Args: { _client_id: string }
        Returns: boolean
      }
      debt_limit_excepted_client_ids: { Args: never; Returns: string[] }
      debt_limit_is_client_excepted: {
        Args: { _client_id: string }
        Returns: boolean
      }
      debt_limit_notify_tomorrow_bookings: { Args: never; Returns: undefined }
      debt_limit_regularization_breakdown: {
        Args: { _client_id: string }
        Returns: {
          debt_amount: number
          remaining_sessions: number
          remaining_sessions_amount: number
          total_amount: number
        }[]
      }
      debt_limit_remove_exception: {
        Args: { _exception_id: string }
        Returns: boolean
      }
      debt_limit_reopen_alert: { Args: { _alert_id: string }; Returns: boolean }
      debt_limit_resolve_alert: {
        Args: { _alert_id: string; _note?: string }
        Returns: boolean
      }
      debt_limit_slot_price: {
        Args: {
          _category_id: string
          _court: number
          _end: string
          _ref_date: string
          _start: string
          _weekday: number
        }
        Returns: number
      }
      fixed_waitlist_assign: {
        Args: {
          _court?: number
          _entry_id: string
          _notes?: string
          _teacher_id?: string
          _valid_from?: string
          _valid_months?: number
        }
        Returns: Json
      }
      fixed_waitlist_join: {
        Args: {
          _client_id?: string
          _court: number
          _end: string
          _start: string
          _weekday: number
        }
        Returns: Json
      }
      fixed_waitlist_leave: { Args: { _id: string }; Returns: boolean }
      fixed_waitlist_notify_expiring_schedules: {
        Args: never
        Returns: undefined
      }
      fixed_waitlist_position: { Args: { _id: string }; Returns: Json }
      fixed_waitlist_remove: {
        Args: { _entry_id: string; _reason?: string }
        Returns: boolean
      }
      get_client_balances: {
        Args: never
        Returns: {
          balance: number
          client_id: string
        }[]
      }
      get_court_waitlist_counts_for_date: {
        Args: { _date: string }
        Returns: {
          court: number
          end_time: string
          mine: boolean
          start_time: string
          total: number
        }[]
      }
      get_overdue_clients: {
        Args: never
        Returns: {
          active: boolean
          balance: number
          due_day: number
          email: string
          financial_responsible: string
          full_name: string
          id: string
          is_gympass: boolean
          phone: string
        }[]
      }
      get_overdue_weekly_history: {
        Args: never
        Returns: {
          count_negative: number
          month_key: string
          month_start: string
          total_negative: number
          week_end_date: string
          week_num: number
        }[]
      }
      has_page_access: {
        Args: { _page_key: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_boleiro_suspended: {
        Args: { _client_id: string; _on_date?: string }
        Returns: boolean
      }
      is_demo_user: { Args: { _uid: string }; Returns: boolean }
      is_portal_client_of: { Args: { _client_id: string }; Returns: boolean }
      is_ranking_booking: { Args: { _booking_id: string }; Returns: boolean }
      is_ranking_category: { Args: { _category_id: string }; Returns: boolean }
      list_boleiros: {
        Args: never
        Returns: {
          client_id: string
          full_name: string
          suspended_until: string
        }[]
      }
      log_audit_event: {
        Args: {
          _action: string
          _details?: Json
          _entity: string
          _entity_id: string
        }
        Returns: undefined
      }
      meeting_team: {
        Args: never
        Returns: {
          full_name: string
          is_recepcao: boolean
          user_id: string
        }[]
      }
      move_booking_today: {
        Args: {
          _booking_id: string
          _court: number
          _end_time: string
          _start_time: string
        }
        Returns: Json
      }
      move_fixed_today: {
        Args: {
          _booking_id?: string
          _court: number
          _date: string
          _end_time: string
          _schedule_id: string
          _start_time: string
        }
        Returns: Json
      }
      move_or_swap_booking: {
        Args: {
          _booking_id: string
          _court: number
          _end_time: string
          _start_time: string
        }
        Returns: {
          swapped_booking_id: string
          swapped_client_id: string
          swapped_end_time: string
          swapped_start_time: string
        }[]
      }
      next_occurrence_of_day: {
        Args: { _day: number; _from: string }
        Returns: string
      }
      normalize_category: { Args: { _name: string }; Returns: string }
      notify_boleiros_vaga_aberta_booking: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      notify_waitlist_slot_available: {
        Args: { _date: string; _end: string; _start: string }
        Returns: undefined
      }
      prepay_release_decide: {
        Args: { _approve: boolean; _note?: string; _request_id: string }
        Returns: Json
      }
      prepay_release_list: {
        Args: { _status?: string }
        Returns: {
          booking_date: string
          booking_id: string | null
          client_id: string
          client_name: string | null
          court: number | null
          decided_at: string | null
          decided_by_name: string | null
          decision_note: string | null
          end_time: string | null
          id: string
          reason: string
          requested_at: string
          requested_by_name: string | null
          start_time: string | null
          status: string
        }[]
      }
      prepay_release_request: {
        Args: {
          _booking_date: string
          _client_id: string
          _court: number
          _end: string
          _reason: string
          _start: string
        }
        Returns: Json
      }
      open_debt_report: {
        Args: { _from: string; _to: string }
        Returns: Json
      }
      open_boleiro_request_for_booking: {
        Args: { _booking_id: string }
        Returns: string
      }
      payment_stock_item_name: {
        Args: { _category_id: string; _client_id: string }
        Returns: string
      }
      portal_can_view_client: { Args: { _client_id: string }; Returns: boolean }
      portal_cancel_booking: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      portal_cancel_fixed_schedule: {
        Args: { _date: string; _reason?: string; _schedule_id: string }
        Returns: string
      }
      portal_client_club_booking_source: {
        Args: { _client_id: string }
        Returns: Database["public"]["Enums"]["booking_source"]
      }
      portal_create_club_booking: {
        Args: {
          _client_id: string
          _court: number
          _date: string
          _end: string
          _guest_name: string
          _guest_type: Database["public"]["Enums"]["booking_guest_type"]
          _start: string
        }
        Returns: string
      }
      portal_create_paid_booking_hold: {
        Args: {
          _client_id: string
          _court: number
          _date: string
          _end: string
          _start: string
        }
        Returns: Json
      }
      portal_get_category_names: {
        Args: { _ids: string[] }
        Returns: {
          id: string
          name: string
        }[]
      }
      portal_join_court_waitlist: {
        Args: {
          _client_id?: string
          _court?: number
          _court_continuity?: string
          _date: string
          _end: string
          _source_booking_id?: string
          _start: string
        }
        Returns: Json
      }
      portal_leave_court_waitlist: {
        Args: { _waitlist_id: string }
        Returns: Json
      }
      portal_map_bookings: { Args: { _date: string }; Returns: Json }
      portal_map_price_bands: { Args: { _weekday: number }; Returns: Json }
      portal_map_schedule_exceptions: {
        Args: { _date: string; _weekday: number }
        Returns: Json
      }
      portal_map_schedules:
        | { Args: { _weekday: number }; Returns: Json }
        | { Args: { _date?: string; _weekday: number }; Returns: Json }
      portal_owned_client_ids: {
        Args: { _user_id: string }
        Returns: {
          client_id: string
        }[]
      }
      portal_update_profile: {
        Args: {
          _birth_day: number
          _birth_month: number
          _client_id: string
          _tennis_class: string
        }
        Returns: undefined
      }
      portal_waitlist_position: {
        Args: { _date: string; _end: string; _start: string }
        Returns: Json
      }
      portal_waitlist_position_by_id: { Args: { _id: string }; Returns: Json }
      process_court_waitlist_releases: {
        Args: { _changed_end?: string; _changed_start?: string; _date: string }
        Returns: undefined
      }
      staff_search_clients_for_signup_match: {
        Args: { _query: string }
        Returns: {
          active: boolean
          email: string
          full_name: string
          id: string
          phone: string
        }[]
      }
      staff_link_pending_client_signup: {
        Args: { _client_id: string; _pending_id: string }
        Returns: Json
      }
      staff_create_client_for_pending_signup: {
        Args: { _pending_id: string }
        Returns: Json
      }
      professor_reactivate_booking: {
        Args: { _booking_id: string }
        Returns: Json
      }
      professor_reactivate_fixed_occurrence: {
        Args: { _occurrence_date: string; _schedule_id: string }
        Returns: Json
      }
      professor_search_clients_for_link: {
        Args: { _query: string }
        Returns: { full_name: string; id: string }[]
      }
      promote_next_boleiro_waiter: {
        Args: { _booking_id: string }
        Returns: string
      }
      recife_month_end: { Args: { _d?: string }; Returns: string }
      recife_today: { Args: never; Returns: string }
      recife_week_start: { Args: { _d?: string }; Returns: string }
      reject_client_change_request: {
        Args: { _reason?: string; _request_id: string }
        Returns: Json
      }
      reject_client_teacher_link_request: {
        Args: { _reason?: string; _request_id: string }
        Returns: Json
      }
      request_boleiro_for_booking: {
        Args: { _booking_id: string }
        Returns: string
      }
      request_court_booking_hold: {
        Args: {
          _court: number
          _date: string
          _end: string
          _label: string
          _start: string
        }
        Returns: Json
      }
      staff_confirm_waitlist_booking: {
        Args: { _booking_id: string; _waitlist_id: string }
        Returns: undefined
      }
      staff_get_waitlist_counts_for_date: {
        Args: { _date: string }
        Returns: {
          cnt: number
          court: number
          end_time: string
          start_time: string
        }[]
      }
      staff_get_waitlist_for_slot: {
        Args: { _date: string; _end: string; _start: string }
        Returns: Json
      }
      staff_mark_schedule_attendance: {
        Args: {
          _amount?: number
          _attendance_date: string
          _cancel_hours?: number[]
          _cancel_reason?: string
          _court?: number
          _payment_category_id?: string
          _payment_end_time?: string
          _payment_notes?: string
          _payment_start_time?: string
          _schedule_id: string
          _status: string
        }
        Returns: Json
      }
      staff_mark_waitlist_contacted: {
        Args: { _waitlist_id: string }
        Returns: undefined
      }
      staff_skip_waitlist_entry: {
        Args: { _reason?: string; _waitlist_id: string }
        Returns: undefined
      }
      teacher_agenda_range: {
        Args: { _end_date: string; _start_date: string }
        Returns: Json
      }
      teacher_map_bookings: { Args: { _date: string }; Returns: Json }
      teacher_map_schedule_exceptions: {
        Args: { _date: string; _weekday: number }
        Returns: Json
      }
      teacher_map_schedules:
        | { Args: { _weekday: number }; Returns: Json }
        | { Args: { _date?: string; _weekday: number }; Returns: Json }
      waitlist_acknowledge: {
        Args: { _waitlist_id: string }
        Returns: undefined
      }
      waitlist_court_block_is_free: {
        Args: { _court: number; _date: string; _end: string; _start: string }
        Returns: boolean
      }
      waitlist_decline: { Args: { _waitlist_id: string }; Returns: undefined }
      waitlist_fulfill: {
        Args: { _booking_id: string; _waitlist_id: string }
        Returns: undefined
      }
      waitlist_mark_and_book: {
        Args: { _teacher_id?: string; _teacher_set?: boolean; _waitlist_id: string }
        Returns: string
      }
      waitlist_set_awaiting: {
        Args: { _waitlist_id: string }
        Returns: undefined
      }
    }
    Enums: {
      account_entry_type: "debito" | "credito"
      app_role:
        | "admin"
        | "recepcionista"
        | "diretoria"
        | "professor"
        | "boleiro"
        | "limpeza"
      booking_guest_type: "clubista" | "convidado" | "batedor"
      booking_source: "avulsa" | "professor" | "clubista" | "mini_clube"
      charge_status: "aberta" | "paga" | "atrasada" | "cancelada"
      payment_method:
        | "dinheiro"
        | "pix"
        | "debito"
        | "credito"
        | "transferencia"
        | "outro"
        | "conta_corrente"
        | "letzplay_pix"
        | "letzplay_cartao"
        | "mercadopago_pix"
        | "mercadopago_cartao"
        | "rede_itau"
        | "mercadopago"
      stock_movement_type: "entrada" | "saida" | "ajuste"
      task_priority: "baixa" | "media" | "alta"
      task_recurrence: "none" | "daily" | "weekly" | "monthly"
      task_status: "pendente" | "em_andamento" | "concluida" | "cancelada"
      waitlist_status:
        | "waiting"
        | "awaiting_confirmation"
        | "fulfilled"
        | "declined"
        | "cancelled"
        | "notified"
        | "contacted"
        | "confirmed"
        | "expired"
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
    Enums: {
      account_entry_type: ["debito", "credito"],
      app_role: [
        "admin",
        "recepcionista",
        "diretoria",
        "professor",
        "boleiro",
        "limpeza",
      ],
      booking_guest_type: ["clubista", "convidado", "batedor"],
      booking_source: ["avulsa", "professor", "clubista", "mini_clube"],
      charge_status: ["aberta", "paga", "atrasada", "cancelada"],
      payment_method: [
        "dinheiro",
        "pix",
        "debito",
        "credito",
        "transferencia",
        "outro",
        "conta_corrente",
        "letzplay_pix",
        "letzplay_cartao",
        "mercadopago_pix",
        "mercadopago_cartao",
        "rede_itau",
        "mercadopago",
      ],
      stock_movement_type: ["entrada", "saida", "ajuste"],
      task_priority: ["baixa", "media", "alta"],
      task_recurrence: ["none", "daily", "weekly", "monthly"],
      task_status: ["pendente", "em_andamento", "concluida", "cancelada"],
      waitlist_status: [
        "waiting",
        "awaiting_confirmation",
        "fulfilled",
        "declined",
        "cancelled",
        "notified",
        "contacted",
        "confirmed",
        "expired",
      ],
    },
  },
} as const
