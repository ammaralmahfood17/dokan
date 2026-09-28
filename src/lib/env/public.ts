export type PublicSupabaseConfig = {
  url: string;
  anonKey: string;
};

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getPublicSupabaseConfig(): PublicSupabaseConfig {
  const url = required(
    'NEXT_PUBLIC_SUPABASE_URL',
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const anonKey = required(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  try {
    new URL(url);
  } catch {
    throw new Error('Invalid environment variable: NEXT_PUBLIC_SUPABASE_URL');
  }

  return { url, anonKey };
}
