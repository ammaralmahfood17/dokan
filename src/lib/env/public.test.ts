import { afterEach, describe, expect, it } from 'vitest';
import { getPublicSupabaseConfig } from './public';

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;

  if (originalAnonKey === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  }
});

describe('getPublicSupabaseConfig', () => {
  it('returns a complete public configuration', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    expect(getPublicSupabaseConfig()).toEqual({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
    });
  });

  it('names a missing variable without exposing another value', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'do-not-print-this-key';

    expect(() => getPublicSupabaseConfig()).toThrow(
      'Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL'
    );
  });

  it('rejects an invalid Supabase URL', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'not a URL';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    expect(() => getPublicSupabaseConfig()).toThrow(
      'Invalid environment variable: NEXT_PUBLIC_SUPABASE_URL'
    );
  });
});
