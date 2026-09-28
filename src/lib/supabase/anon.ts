import { createClient } from '@supabase/supabase-js';
import { getPublicSupabaseConfig } from '@/lib/env/public';

/**
 * Public, session-less Supabase client for server components that render
 * PUBLIC data (e.g. the customer menu). Unlike `createClient()` from
 * `@/lib/supabase/server`, this client NEVER attaches the user's cookies,
 * so RLS resolves as the `anon` role — public menu rows stay readable for
 * signed-in users too (see 0061: role-scoped policies).
 */
export function createAnonClient() {
  const { url, anonKey } = getPublicSupabaseConfig();
  return createClient(
    url,
    anonKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
