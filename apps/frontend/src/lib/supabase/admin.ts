import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicEnv } from '@/lib/env';
import { getSupabaseServiceRoleKey } from '@/lib/env.server';

/**
 * Cliente con service role. Solo puede importarse desde Server Actions o
 * Route Handlers. Nunca debe llegar al bundle del navegador.
 */
export function createSupabaseAdminClient() {
  const { url } = getSupabasePublicEnv();

  return createClient(url, getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
