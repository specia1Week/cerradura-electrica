// Última modificación: 2026-11-10
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

function copyCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  return target;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isLoginRoute = pathname === '/login';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !url ||
    url === 'https://tu-proyecto.supabase.co' ||
    !anonKey ||
    anonKey === 'tu-anon-key' ||
    !serviceRoleKey ||
    serviceRoleKey === 'tu-service-role-key'
  ) {
    if (isLoginRoute) return NextResponse.next();
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'config');
    return NextResponse.redirect(loginUrl);
  }

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.delete('x-verified-user-id');
  let response = NextResponse.next({ request: { headers: forwardedHeaders } });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        forwardedHeaders.set('cookie', request.cookies.toString());
        response = NextResponse.next({ request: { headers: forwardedHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (!user) {
    // Server Actions gestionan su propia respuesta de sesión. Redirigir su
    // POST desde middleware rompe el protocolo RSC y produce una respuesta
    // inesperada en useActionState.
    if (isLoginRoute || (request.method === 'POST' && request.headers.has('next-action'))) {
      return response;
    }

    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirectTo', `${pathname}${search}`);
    if (authError?.status === 429) {
      loginUrl.searchParams.set('error', 'auth-limite');
    }
    return copyCookies(response, NextResponse.redirect(loginUrl));
  }

  forwardedHeaders.set('x-verified-user-id', user.id);
  response = copyCookies(
    response,
    NextResponse.next({ request: { headers: forwardedHeaders } }),
  );

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('rol')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'perfil-temporal');
    return copyCookies(response, NextResponse.redirect(loginUrl));
  }

  const profileRol = (profile as { rol?: string } | null)?.rol;

  if (!profile || (profileRol !== 'ADMIN' && profileRol !== 'OPERADOR')) {
    // Una sesión sin perfil autorizado no tiene acceso al panel. Se cierra
    // para que el usuario pueda volver a ingresar después de que un
    // administrador lo cree o corrija su rol.
    await supabase.auth.signOut();
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'sin-perfil');
    return copyCookies(response, NextResponse.redirect(loginUrl));
  }

  if (isLoginRoute) {
    return copyCookies(
      response,
      NextResponse.redirect(new URL('/dashboard', request.url)),
    );
  }

  return response;
}

export const config = {
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
      // Evita que las precargas de Next compitan con la navegación por el
      // refresh token de Supabase, que solo puede utilizarse una vez.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
