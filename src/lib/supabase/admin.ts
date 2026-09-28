import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { getServerSupabaseConfig } from '@/lib/env/server';

/**
 * Service-role Supabase client (bypasses ALL RLS).
 *
 * === PHASE 1 SECURITY HARDENING ===
 * - ONLY call this after full server-side validation (project active, table belongs to project, products exist & belong).
 * - Used exclusively in:
 *   - /api/public/order, waiter, bill (customer facing, validated)
 *   - /api/pos/order (authenticated staff)
 *   - /api/onboarding/project (with rollback)
 * - Never import in client components.
 * - For normal staff operations, prefer createClient() (respects RLS).
 */
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() is server-only — the service role key must never reach the browser');
  }
  const { url, serviceRoleKey } = getServerSupabaseConfig();

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
