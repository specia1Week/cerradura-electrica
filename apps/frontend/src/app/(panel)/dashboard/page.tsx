// Última modificación: 2026-11-10
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Activity,
  Ban,
  CalendarDays,
  Cpu,
  Fingerprint,
  Radio,
  ScanLine,
  UsersRound,
} from 'lucide-react';
import { requireAuthContext } from '@/lib/auth';
import {
  dateInputToEnd,
  dateInputToStart,
  formatDateTime,
  formatTime,
  hourInTimeZone,
  isDeviceOnline,
  lastSeenLabel,
  todayInputValue,
} from '@/lib/date';
import { fetchAccessEventsForRange } from '@/lib/queries/access';
import type { DeviceRecord, UserRecord } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { EmptyState } from '@/components/empty-state';
import {
  AccessResultBadge,
  OnlineBadge,
} from '@/components/status-badges';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { HourlyChart, type HourlyPoint } from '@/components/dashboard/hourly-chart';

export const metadata: Metadata = {
  title: 'Dashboard',
};

const BIOMETRIC_DENIAL_MOTIVES = new Set([
  'HUELLA_NO_RECONOCIDA_3_INTENTOS',
  'HUELLA_OTRO_USUARIO',
  'HUELLA_NO_REGISTRADA',
  'CREDENCIALES_NO_COINCIDEN',
  'BLOQUEO_TEMPORAL',
]);

export default async function DashboardPage() {
  const { supabase } = await requireAuthContext();
  const today = todayInputValue();
  const start = dateInputToStart(today);
  const end = dateInputToEnd(today);

  const [events, devicesResult, usersCountResult] = await Promise.all([
    fetchAccessEventsForRange(
      supabase,
      start.toISOString(),
      end.toISOString(),
    ),
    supabase
      .from('devices')
      .select('id, mac, nombre, ubicacion, estado, last_seen_at, firmware_version, ip, rssi')
      .order('nombre', { ascending: true }),
    supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'ACTIVO'),
  ]);

  if (devicesResult.error) throw new Error(devicesResult.error.message);
  if (usersCountResult.error) throw new Error(usersCountResult.error.message);

  const devices = (devicesResult.data ?? []) as DeviceRecord[];
  const onlineDevices = devices.filter((device) => isDeviceOnline(device.last_seen_at));
  const denied = events.filter((event) => event.resultado === 'DENEGADO').length;
  const permitted = events.length - denied;
  const deniedByFingerprint = events.filter(
    (event) =>
      event.resultado === 'DENEGADO' &&
      ((event.intentos_huella ?? 0) > 0 ||
        (event.motivo !== null && BIOMETRIC_DENIAL_MOTIVES.has(event.motivo))),
  ).length;

  const hourMap: HourlyPoint[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    permitidos: 0,
    denegados: 0,
  }));

  events.forEach((event) => {
    const hour = hourInTimeZone(event.occurred_at);
    if (event.resultado === 'PERMITIDO') {
      hourMap[hour].permitidos += 1;
    } else {
      hourMap[hour].denegados += 1;
    }
  });

  const recentEvents = events.slice(0, 8);
  const userIds = Array.from(
    new Set(recentEvents.map((event) => event.user_id).filter(Boolean)),
  ) as string[];

  const { data: eventUsers } = userIds.length
    ? await supabase
        .from('users')
        .select('id, nombre, documento')
        .in('id', userIds)
    : { data: [] as Pick<UserRecord, 'id' | 'nombre' | 'documento'>[] };

  const userMap = new Map(
    ((eventUsers ?? []) as Pick<UserRecord, 'id' | 'nombre' | 'documento'>[]).map(
      (user) => [user.id, user],
    ),
  );
  const deviceMap = new Map(devices.map((device) => [device.id, device]));

  return (
    <div>
      <PageHeader
        eyebrow="Resumen operativo"
        title="Dashboard"
        description={`Actividad de acceso y estado de la infraestructura para hoy, ${today.split('-').reverse().join('/')}.`}
        actions={
          <Button asChild variant="outline">
            <Link href="/eventos">
              <CalendarDays className="h-4 w-4" />
              Ver todos los eventos
            </Link>
          </Button>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Accesos hoy"
          value={events.length}
          hint={`${permitted} permitidos`}
          icon={<ScanLine className="h-5 w-5" />}
          tone="primary"
          delay={1}
        />
        <StatCard
          label="Accesos denegados"
          value={denied}
          hint={
            events.length
              ? `${Math.round((denied / events.length) * 100)}% del total`
              : 'Sin actividad'
          }
          icon={<Ban className="h-5 w-5" />}
          tone="destructive"
          delay={2}
        />
        <StatCard
          label="Denegados por huella (hoy)"
          value={deniedByFingerprint}
          hint={
            deniedByFingerprint
              ? '3 intentos o bloqueo biométrico'
              : 'Sin denegaciones biométricas'
          }
          icon={<Fingerprint className="h-5 w-5" />}
          tone="destructive"
          delay={2}
        />
        <StatCard
          label="Dispositivos en línea"
          value={onlineDevices.length}
          hint={`de ${devices.length} registrados`}
          icon={<Radio className="h-5 w-5" />}
          tone="success"
          delay={3}
        />
        <StatCard
          label="Usuarios activos"
          value={usersCountResult.count ?? 0}
          hint="Habilitados para acceder"
          icon={<UsersRound className="h-5 w-5" />}
          delay={1}
        />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Card className="animate-fade-up">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Accesos por hora</CardTitle>
              <CardDescription>
                Permitidos y denegados · zona horaria America/La_Paz
              </CardDescription>
            </div>
            <div className="hidden items-center gap-4 text-[11px] text-muted-foreground sm:flex">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-primary" />
                Permitidos
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-destructive" />
                Denegados
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <HourlyChart data={hourMap} />
          </CardContent>
        </Card>

        <Card className="animate-fade-up animate-delay-1">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Estado de dispositivos</CardTitle>
              <CardDescription>Heartbeat de los últimos 30 segundos.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dispositivos">Ver todos</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {devices.length === 0 && (
              <EmptyState
                icon={<Cpu className="h-5 w-5" />}
                title="Sin dispositivos"
                description="Registrá el primer lector para empezar a operar."
                className="py-8"
              />
            )}
            {devices.slice(0, 5).map((device) => (
              <div
                key={device.id}
                className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/20 p-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                  <Cpu className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {device.nombre}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {device.ubicacion}
                  </p>
                </div>
                <div className="text-right">
                  <OnlineBadge lastSeenAt={device.last_seen_at} />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {lastSeenLabel(device.last_seen_at)}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <Card className="mt-4 animate-fade-up animate-delay-2">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Actividad reciente</CardTitle>
            <CardDescription>
              Últimos eventos registrados por los dispositivos.
            </CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/eventos">Historial completo</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0 md:p-0">
          {recentEvents.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-5 w-5" />}
              title="Todavía no hay accesos hoy"
              description="Cuando un lector registre una tarjeta o huella, el evento aparecerá acá."
              className="border-t border-border"
            />
          ) : (
            <div className="scroll-area overflow-x-auto">
              <table className="data-table min-w-[680px]">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Usuario</th>
                    <th>Dispositivo</th>
                    <th>Resultado</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.map((event) => {
                    const user = event.user_id ? userMap.get(event.user_id) : null;
                    const device = deviceMap.get(event.device_id);
                    return (
                      <tr key={event.id}>
                        <td className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {formatTime(event.occurred_at)}
                        </td>
                        <td>
                          <p className="font-medium text-foreground">
                            {user?.nombre ?? 'No identificado'}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {user?.documento ?? event.rfid_uid ?? '—'}
                          </p>
                        </td>
                        <td className="text-muted-foreground">
                          {device?.nombre ?? 'Dispositivo eliminado'}
                        </td>
                        <td>
                          <AccessResultBadge resultado={event.resultado} />
                        </td>
                        <td className="max-w-56 truncate text-xs text-muted-foreground">
                          {event.motivo ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Última actualización: {formatDateTime(new Date().toISOString())}
      </p>
    </div>
  );
}
