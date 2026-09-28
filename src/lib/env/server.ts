import { getPublicSupabaseConfig } from './public';

export function getServerSupabaseConfig() {
  if (typeof window !== 'undefined') {
    throw new Error('Server environment cannot be read in the browser');
  }

  const publicConfig = getPublicSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      'Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  return { ...publicConfig, serviceRoleKey };
}
