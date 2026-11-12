// Última modificación: 2026-11-10
import type { Metadata } from 'next';
import {
  Fingerprint,
  KeyRound,
  Radio,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { LoginForm } from '@/app/login/login-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { firstParam } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Iniciar sesión',
};

const errorMessages: Record<string, string> = {
  config:
    'Faltan variables de entorno de Supabase. Configurá NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY en .env.local.',
  'sin-perfil':
    'Tu cuenta no tiene un perfil autorizado. Pedile a un administrador que cree tu perfil en la tabla profiles.',
  'auth-limite':
    'Supabase limitó temporalmente las solicitudes de autenticación. Esperá un minuto antes de volver a iniciar sesión.',
  'perfil-temporal':
    'No se pudo verificar tu perfil por un problema temporal. Tu sesión se conservó; intentá de nuevo en unos segundos.',
  sesion: 'Tu sesión expiró. Volvé a ingresar.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorKey = firstParam(params.error);
  const redirectTo = firstParam(params.redirectTo) ?? '/dashboard';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const configMissing =
    !supabaseUrl ||
    supabaseUrl === 'https://tu-proyecto.supabase.co' ||
    !anonKey ||
    anonKey === 'tu-anon-key' ||
    !serviceRoleKey ||
    serviceRoleKey === 'tu-service-role-key';
  const notice = configMissing
    ? errorMessages.config
    : errorKey
      ? errorMessages[errorKey]
      : undefined;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_10%,oklch(0.55_0.14_265/0.16),transparent_34rem),radial-gradient(circle_at_86%_80%,oklch(0.62_0.1_190/0.1),transparent_30rem)]" />

      <div className="mx-auto grid min-h-screen w-full max-w-[1280px] items-center gap-10 px-5 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-10">
        <section className="hidden flex-col justify-between self-stretch py-8 lg:flex">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/[0.12] text-primary ring-1 ring-primary/25">
              <Fingerprint className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-[-0.01em]">
                Control de acceso
              </p>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Universidad
              </p>
            </div>
          </div>

          <div className="max-w-xl">
            <p className="eyebrow mb-5">Infraestructura biométrica</p>
            <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.05em] text-foreground">
              Cada acceso,
              <br />
              <span className="text-primary">trazado con precisión.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
              Administrá usuarios, dispositivos y asistencias desde un único
              panel. La validación biométrica ocurre en el lector local; el
              backend solo autoriza y registra.
            </p>

            <div className="mt-10 grid gap-3 sm:grid-cols-2">
              {[
                {
                  icon: Radio,
                  title: 'Dispositivos en línea',
                  text: 'Heartbeat y estado en tiempo real.',
                },
                {
                  icon: KeyRound,
                  title: 'Credenciales seguras',
                  text: 'API keys con hash SHA-256.',
                },
                {
                  icon: Users,
                  title: 'Registro guiado',
                  text: 'Enrolamiento paso a paso.',
                },
                {
                  icon: ShieldCheck,
                  title: 'Acceso protegido',
                  text: 'Auth y perfiles por rol.',
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur-sm"
                  >
                    <Icon className="h-4 w-4 text-primary" />
                    <p className="mt-3 text-sm font-medium text-foreground">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {item.text}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Validación biométrica local · RFID + huella · Sin almacenamiento de
            huellas crudas
          </p>
        </section>

        <section className="mx-auto w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/[0.12] text-primary ring-1 ring-primary/25">
              <Fingerprint className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-[-0.01em]">
                Control de acceso
              </p>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Universidad
              </p>
            </div>
          </div>

          <div className="surface p-6 shadow-float md:p-8">
            <div className="mb-7">
              <p className="eyebrow mb-2">Panel administrativo</p>
              <h2 className="text-2xl font-semibold tracking-[-0.035em]">
                Iniciar sesión
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Ingresá con la cuenta autorizada por la universidad.
              </p>
            </div>

            {notice && (
              <Alert variant="warning" className="mb-5">
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>No se pudo iniciar sesión</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}

            <LoginForm redirectTo={redirectTo} />
          </div>

          <p className="mt-5 text-center text-[11px] leading-5 text-muted-foreground">
            El acceso está restringido a cuentas con perfil ADMIN u OPERADOR.
          </p>
        </section>
      </div>
    </main>
  );
}
