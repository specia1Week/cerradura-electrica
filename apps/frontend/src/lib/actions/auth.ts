'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ActionResult, Profile } from '@/lib/types';

function safeRedirect(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') return '/dashboard';
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

export async function signIn(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const redirectTo = safeRedirect(formData.get('redirectTo'));

  if (!email || !password) {
    return { ok: false, error: 'Ingresá tu correo y contraseña.' };
  }

  const supabase = await createSupabaseServerClient().catch(() => null);

  if (!supabase) {
    return {
      ok: false,
      error:
        'El panel no está configurado. Verificá NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return {
      ok: false,
      error: 'Correo o contraseña incorrectos. Verificá tus datos.',
    };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, rol')
    .eq('id', data.user.id)
    .maybeSingle<Profile>();

  if (!profile) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error:
        'Tu cuenta no tiene un perfil autorizado. Solicitá acceso a un administrador.',
    };
  }

  redirect(redirectTo);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
