import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';
import { getPublicSupabaseConfig } from '@/lib/env/public';

export function isBrowserSupportMode() {
  return (
    typeof document !== 'undefined' &&
    document.cookie.split('; ').some((cookie) => cookie === 'dokan-support-mode=1')
  );
}

/** Browser Supabase client — Client Components only */
export function createClient() {
  const isSupportMode = isBrowserSupportMode();
  const { url, anonKey } = getPublicSupabaseConfig();

  return createBrowserClient<Database>(
    url,
    anonKey,
    {
      auth: {
        // Support sessions deliberately carry no usable refresh token.
        autoRefreshToken: !isSupportMode,
      },
      // Do not reuse the normal admin/user singleton after support mode starts.
      isSingleton: !isSupportMode,
    }
  );
}
