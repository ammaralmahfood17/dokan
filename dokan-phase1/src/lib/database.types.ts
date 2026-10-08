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
      categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          name_en: string | null
          project_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          name_en?: string | null
          project_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          name_en?: string | null
          project_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_order_counters: {
        Row: {
          counter: number
          date: string
          project_id: string
        }
        Insert: {
          counter?: number
          date?: string
          project_id: string
        }
        Update: {
          counter?: number
          date?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_order_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      impersonation_sessions: {
        Row: {
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          super_admin_session: Json
          super_admin_user_id: string
          target_project_id: string | null
          target_session: Json
          target_user_id: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          expires_at: string
          id?: string
          super_admin_session: Json
          super_admin_user_id: string
          target_project_id?: string | null
          target_session: Json
          target_user_id: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          super_admin_session?: Json
          super_admin_user_id?: string
          target_project_id?: string | null
          target_session?: Json
          target_user_id?: string
          used_at?: string | null
        }
        Relationships: []
      }
      ingredients: {
        Row: {
          created_at: string
          id: string
          name: string
          project_id: string
          quantity_on_hand: number
          reorder_point: number
          supplier_id: string | null
          supplier_sku: string | null
          unit: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          project_id: string
          quantity_on_hand?: number
          reorder_point?: number
          supplier_id?: string | null
          supplier_sku?: string | null
          unit: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          quantity_on_hand?: number
          reorder_point?: number
          supplier_id?: string | null
          supplier_sku?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredients_supplier_project_fkey"
            columns: ["supplier_id", "project_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          actor_user_id: string | null
          created_at: string
          id: string
          ingredient_id: string
          movement_type: string
          notes: string | null
          order_id: string | null
          project_id: string
          quantity_delta: number
          stock_after: number
          unit: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          id?: string
          ingredient_id: string
          movement_type: string
          notes?: string | null
          order_id?: string | null
          project_id: string
          quantity_delta: number
          stock_after: number
          unit: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          id?: string
          ingredient_id?: string
          movement_type?: string
          notes?: string | null
          order_id?: string | null
          project_id?: string
          quantity_delta?: number
          stock_after?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_ingredient_project_fkey"
            columns: ["ingredient_id", "project_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "inventory_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_events: {
        Row: {
          created_at: string
          id: number
          project_id: string
          step: string
        }
        Insert: {
          created_at?: string
          id?: never
          project_id: string
          step: string
        }
        Update: {
          created_at?: string
          id?: never
          project_id?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      order_audit_logs: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event: string
          id: string
          metadata: Json | null
          new_status: string | null
          old_status: string | null
          order_id: string
          project_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event: string
          id?: string
          metadata?: Json | null
          new_status?: string | null
          old_status?: string | null
          order_id: string
          project_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event?: string
          id?: string
          metadata?: Json | null
          new_status?: string | null
          old_status?: string | null
          order_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_audit_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          addons: Json
          id: string
          notes: string | null
          order_id: string
          portion_stock_deducted: boolean
          product_id: string | null
          product_name: string
          quantity: number
          status: string
          unit_price: number
        }
        Insert: {
          addons?: Json
          id?: string
          notes?: string | null
          order_id: string
          portion_stock_deducted?: boolean
          product_id?: string | null
          product_name: string
          quantity?: number
          status?: string
          unit_price: number
        }
        Update: {
          addons?: Json
          id?: string
          notes?: string | null
          order_id?: string
          portion_stock_deducted?: boolean
          product_id?: string | null
          product_name?: string
          quantity?: number
          status?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey1"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey1"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          client_request_id: string | null
          created_at: string
          id: string
          notes: string | null
          order_number: number
          project_id: string
          service_type: string | null
          status: Database["public"]["Enums"]["order_status"]
          table_id: string | null
          total_amount: number
          type: Database["public"]["Enums"]["order_type"]
        }
        Insert: {
          client_request_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          order_number?: number
          project_id: string
          service_type?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_id?: string | null
          total_amount?: number
          type?: Database["public"]["Enums"]["order_type"]
        }
        Update: {
          client_request_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          order_number?: number
          project_id?: string
          service_type?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_id?: string | null
          total_amount?: number
          type?: Database["public"]["Enums"]["order_type"]
        }
        Relationships: [
          {
            foreignKeyName: "orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      option_groups: {
        Row: {
          created_at: string
          id: string
          max_select: number
          min_select: number
          name: string
          name_en: string | null
          product_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          max_select?: number
          min_select?: number
          name: string
          name_en?: string | null
          product_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          max_select?: number
          min_select?: number
          name?: string
          name_en?: string | null
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "option_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      option_choices: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_available: boolean
          name: string
          name_en: string | null
          price: number
          sort_order: number
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_available?: boolean
          name: string
          name_en?: string | null
          price?: number
          sort_order?: number
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_available?: boolean
          name?: string
          name_en?: string | null
          price?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "option_choices_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "option_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      product_ingredients: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string
          product_id: string
          project_id: string
          quantity_per_product: number
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id: string
          product_id: string
          project_id: string
          quantity_per_product: number
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string
          product_id?: string
          project_id?: string
          quantity_per_product?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_ingredients_ingredient_project_fkey"
            columns: ["ingredient_id", "project_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "product_ingredients_product_project_fkey"
            columns: ["product_id", "project_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      products: {
        Row: {
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_available: boolean
          name: string
          name_en: string | null
          price: number
          project_id: string
          sort_order: number
          stock: number | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name: string
          name_en?: string | null
          price: number
          project_id: string
          sort_order?: number
          stock?: number | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name?: string
          name_en?: string | null
          price?: number
          project_id?: string
          sort_order?: number
          stock?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey1"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          primary_color: string
          // Hand-added 2026-10-06 with 20261006094000_qr_reprint_flag.sql (gen types needs Docker).
          qr_reprinted_at: string | null
          slug: string
          subscription_expires_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          primary_color?: string
          qr_reprinted_at?: string | null
          slug: string
          subscription_expires_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          primary_color?: string
          qr_reprinted_at?: string | null
          slug?: string
          subscription_expires_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          project_id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          project_id: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          project_id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          reset_at: string
        }
        Insert: {
          count?: number
          key: string
          reset_at: string
        }
        Update: {
          count?: number
          key?: string
          reset_at?: string
        }
        Relationships: []
      }
      service_requests: {
        Row: {
          created_at: string
          id: string
          is_resolved: boolean
          project_id: string
          table_id: string
          type: Database["public"]["Enums"]["service_request_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          is_resolved?: boolean
          project_id: string
          table_id: string
          type: Database["public"]["Enums"]["service_request_type"]
        }
        Update: {
          created_at?: string
          id?: string
          is_resolved?: boolean
          project_id?: string
          table_id?: string
          type?: Database["public"]["Enums"]["service_request_type"]
        }
        Relationships: [
          {
            foreignKeyName: "service_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_members: {
        Row: {
          created_at: string
          id: string
          notify_push: boolean
          notify_telegram: boolean
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notify_push?: boolean
          notify_telegram?: boolean
          project_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notify_push?: boolean
          notify_telegram?: boolean
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          project_id: string
        }
        Insert: {
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          project_id: string
        }
        Update: {
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admin_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          target_project_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target_project_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target_project_id?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      super_admins: {
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
      tables: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          is_active: boolean
          number: number
          project_id: string
          qrcode: string
          slug: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          number: number
          project_id: string
          qrcode?: string
          slug: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          number?: number
          project_id?: string
          qrcode?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "tables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_link_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          project_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          project_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_link_codes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_links: {
        Row: {
          chat_id: string
          created_at: string
          id: string
          kind: string
          label: string | null
          project_id: string
          user_id: string | null
        }
        Insert: {
          chat_id: string
          created_at?: string
          id?: string
          kind?: string
          label?: string | null
          project_id: string
          user_id?: string | null
        }
        Update: {
          chat_id?: string
          created_at?: string
          id?: string
          kind?: string
          label?: string | null
          project_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
            web_vitals: {
        Row: {
          bucket_at: string
          created_at: string
          id: number
          metric: string
          path: string
          value_ms: number
        }
        Insert: {
          bucket_at?: string
          created_at?: string
          id?: never
          metric: string
          path: string
          value_ms: number
        }
        Update: {
          bucket_at?: string
          created_at?: string
          id?: never
          metric?: string
          path?: string
          value_ms?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_order_status: {
        Args: {
          p_caller_user_id?: string
          p_expected_status: string
          p_new_status: string
          p_order_id: string
        }
        Returns: Json
      }
      adjust_ingredient_stock: {
        Args: {
          p_ingredient_id: string
          p_movement_type: string
          p_notes?: string | null
          p_quantity: number
        }
        Returns: Json
      }
      create_order_transactional: {
        Args: {
          p_caller_user_id?: string
          p_items: Json
          p_notes?: string | null
          p_order_number: number
          p_project_id: string
          p_status: string
          p_table_id?: string
          p_total_amount: number
          p_type: string
        }
        Returns: Json
      }
      replace_product_recipe: {
        Args: { p_lines: Json; p_product_id: string }
        Returns: Json
      }
      expire_subscriptions: { Args: never; Returns: number }
      generate_basic_slug: { Args: { input: string }; Returns: string }
      has_project_role: {
        Args: { p_project_id: string; p_roles: string[] }
        Returns: boolean
      }
      has_project_role_for: {
        Args: { p_project_id: string; p_roles: string[]; p_user_id: string }
        Returns: boolean
      }
      is_project_member: { Args: { p_project_id: string }; Returns: boolean }
      is_project_member_for: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: boolean
      }
      is_project_owner: { Args: { p_project_id: string }; Returns: boolean }
      is_project_publicly_available: {
        Args: { p_slug: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      next_order_number: {
        Args: { p_caller_user_id?: string; p_project_id: string }
        Returns: number
      }
      onboard_project_transactional: {
        Args: {
          p_created_by: string
          p_currency: string
          p_name: string
          p_primary_color: string
          p_slug: string
        }
        Returns: Json
      }
      project_has_no_members: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      rate_limit_check: {
        Args: {
          p_caller_user_id?: string
          p_key: string
          p_limit: number
          p_project_id?: string
          p_window_ms: number
        }
        Returns: Json
      }
      record_payment_and_renew: {
        Args: {
          p_amount: number
          p_caller_id?: string
          p_days?: number
          p_method: string
          p_notes?: string | null
          p_project_id: string
          p_receipt?: string | null
        }
        Returns: string
      }
      renew_subscription: {
        Args: {
          p_caller_user_id?: string
          p_days?: number
          p_project_id: string
        }
        Returns: string
      }
      // Hand-added 2026-10-06 (audit remediation): `supabase gen types --db-url` also needs
      // Docker, which is unavailable on this host, and the migration that created this
      // function (20261006090000_table_scan_token.sql) post-dates the last generation.
      // A `npm run db:types` run from a machine with Docker emits this same entry.
      resolve_table_by_token: {
        Args: { p_project_slug: string; p_table_token: string }
        Returns: Json
      }
      super_admin_archive_project: {
        Args: { p_caller_user_id?: string; p_project_id: string }
        Returns: boolean
      }
      super_admin_deactivate_project: {
        Args: { p_caller_user_id?: string; p_project_id: string }
        Returns: boolean
      }
      super_admin_hard_delete_project: {
        Args: {
          p_caller_user_id?: string
          p_confirm_name: string
          p_project_id: string
          p_reason: string
        }
        Returns: boolean
      }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      app_role: "super_admin" | "owner" | "manager" | "staff"
      notification_type: "call_staff" | "bill_request" | "new_order" | "system"
      order_status:
        | "pending"
        | "preparing"
        | "ready"
        | "delivered"
        | "cancelled"
      order_type: "dinein" | "walkin" | "drivethru"
      service_request_type: "waiter" | "bill"
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
      app_role: ["super_admin", "owner", "manager", "staff"],
      notification_type: ["call_staff", "bill_request", "new_order", "system"],
      order_status: ["pending", "preparing", "ready", "delivered", "cancelled"],
      order_type: ["dinein", "walkin", "drivethru"],
      service_request_type: ["waiter", "bill"],
    },
  },
} as const
