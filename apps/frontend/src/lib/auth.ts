import { cache } from 'react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

export const getAuthContext = cache(async () => {
  const requestHeaders = await headers();
  const verifiedUserId = requestHeaders.get('x-verified-user-id');
  if (!verifiedUserId) return null;

  const supabase = await createSupabaseServerClient();
  // El middleware ya verificó el JWT con getUser() en esta solicitud.
  // Leer la sesión aquí evita repetir una llamada a Supabase Auth por página,
  // reduciendo renovaciones concurrentes y respuestas 429.
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  const user = session?.user;

  if (error || !user || user.id !== verifiedUserId) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, rol, created_at')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return null;

  return { supabase, user, profile: profile as Profile };
});

export async function requireAuthContext() {
  const context = await getAuthContext();

  if (!context) {
    redirect('/login');
  }

  return context;
}

export function roleLabel(role: Profile['rol']) {
  return role === 'ADMIN' ? 'Administrador' : 'Operador';
}
