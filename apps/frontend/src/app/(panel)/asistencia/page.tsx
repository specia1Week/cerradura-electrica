import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CalendarCheck2,
  Clock3,
  Download,
  Users,
  X,
} from 'lucide-react';
import { requireAuthContext } from '@/lib/auth';
import {
  currentMonthStartInput,
  daysAgoInput,
  durationFromTimes,
  durationLabel,
  formatDate,
  formatTime,
  isValidDateInput,
  todayInputValue,
} from '@/lib/date';
import type {
  AttendanceRecord,
  DeviceRecord,
  UserRecord,
} from '@/lib/types';
import {
  buildQueryString,
  firstParam,
  isUuid,
} from '@/lib/validation';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Asistencia',
};

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireAuthContext();
  const params = await searchParams;

  const fromRaw = firstParam(params.from);
  const toRaw = firstParam(params.to);
  let fromDate = isValidDateInput(fromRaw)
    ? fromRaw
    : currentMonthStartInput();
  let toDate = isValidDateInput(toRaw) ? toRaw : todayInputValue();
  if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];

  const userParam = firstParam(params.user);
  const userId = isUuid(userParam) ? userParam : undefined;

  let attendanceQuery = supabase
    .from('attendance')
    .select('*', { count: 'exact' })
    .gte('fecha', fromDate)
    .lte('fecha', toDate)
    .order('fecha', { ascending: false })
    .order('hora_entrada', { ascending: false })
    .limit(1000);

  if (userId) attendanceQuery = attendanceQuery.eq('user_id', userId);

  const [attendanceResult, usersResult, devicesResult] = await Promise.all([
    attendanceQuery,
    supabase
      .from('users')
      .select('id, nombre, documento')
      .order('nombre'),
    supabase.from('devices').select('id, nombre, mac').order('nombre'),
  ]);

  if (attendanceResult.error) throw new Error(attendanceResult.error.message);
  if (usersResult.error) throw new Error(usersResult.error.message);
  if (devicesResult.error) throw new Error(devicesResult.error.message);

  const attendance = (attendanceResult.data ?? []) as AttendanceRecord[];
  const users = (usersResult.data ?? []) as Pick<
    UserRecord,
    'id' | 'nombre' | 'documento'
  >[];
  const devices = (devicesResult.data ?? []) as Pick<
    DeviceRecord,
    'id' | 'nombre' | 'mac'
  >[];
  const userMap = new Map(users.map((user) => [user.id, user]));
  const deviceMap = new Map(devices.map((device) => [device.id, device]));

  const total = attendanceResult.count ?? attendance.length;
  const uniqueUsers = new Set(attendance.map((row) => row.user_id)).size;
  const durations = attendance
    .map((row) => durationFromTimes(row.hora_entrada, row.hora_salida))
    .filter((duration): duration is number => duration !== null);
  const averageDuration = durations.length
    ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length
    : null;

  const exportHref = `/api/asistencia/export${buildQueryString({
    from: fromDate,
    to: toDate,
    user: userId,
  })}`;

  const hasFilters = Boolean(userId || fromRaw || toRaw);

  return (
    <div>
      <PageHeader
        eyebrow="Reporte"
        title="Asistencia"
        description="Consultá entradas y salidas por fecha y usuario. La asistencia se calcula con los accesos permitidos y se puede exportar a CSV."
        actions={
          <Button asChild variant="outline">
            <Link href={exportHref}>
              <Download className="h-4 w-4" />
              Exportar CSV
            </Link>
          </Button>
        }
      />

      <section className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Registros"
          value={total}
          hint={`Mostrando ${attendance.length}`}
          icon={<CalendarCheck2 className="h-5 w-5" />}
          tone="primary"
          delay={1}
        />
        <StatCard
          label="Usuarios únicos"
          value={uniqueUsers}
          hint={userId ? 'Filtrado por usuario' : 'Con asistencia en el rango'}
          icon={<Users className="h-5 w-5" />}
          delay={2}
        />
        <StatCard
          label="Duración promedio"
          value={averageDuration === null ? '—' : durationLabel(Math.round(averageDuration))}
          hint="Solo registros con salida"
          icon={<Clock3 className="h-5 w-5" />}
          delay={3}
        />
      </section>

      <div className="surface mb-4 p-4">
        <form
          method="get"
          className="flex flex-col gap-3 md:flex-row md:items-end"
        >
          <div className="space-y-1.5 md:w-44">
            <label
              htmlFor="from"
              className="block text-xs font-medium text-muted-foreground"
            >
              Desde
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={fromDate}
              className="flex h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm text-foreground shadow-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div className="space-y-1.5 md:w-44">
            <label
              htmlFor="to"
              className="block text-xs font-medium text-muted-foreground"
            >
              Hasta
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={toDate}
              className="flex h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm text-foreground shadow-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <label
              htmlFor="user"
              className="block text-xs font-medium text-muted-foreground"
            >
              Usuario
            </label>
            <select
              id="user"
              name="user"
              defaultValue={userId ?? ''}
              className="flex h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm text-foreground shadow-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="">Todos los usuarios</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.nombre} · {user.documento}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit">Filtrar</Button>
            {hasFilters && (
              <Button asChild variant="ghost">
                <Link href="/asistencia">
                  <X className="h-4 w-4" />
                  Limpiar
                </Link>
              </Button>
            )}
          </div>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
          <span className="text-[11px] font-medium text-muted-foreground">
            Rangos rápidos:
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/asistencia${buildQueryString({
                from: todayInputValue(),
                to: todayInputValue(),
                user: userId,
              })}`}
            >
              Hoy
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/asistencia${buildQueryString({
                from: daysAgoInput(6),
                to: todayInputValue(),
                user: userId,
              })}`}
            >
              Últimos 7 días
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/asistencia${buildQueryString({
                from: currentMonthStartInput(),
                to: todayInputValue(),
                user: userId,
              })}`}
            >
              Este mes
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {total === 0
            ? 'Sin asistencias en el rango'
            : `${attendance.length} de ${total} registros`}
          {attendance.length < total
            ? ' · el panel muestra hasta 1000; el CSV incluye el rango completo'
            : ''}
        </p>
        <Badge variant="outline">
          {formatDate(fromDate)} — {formatDate(toDate)}
        </Badge>
      </div>

      <div className="table-shell">
        {attendance.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck2 className="h-5 w-5" />}
            title="No hay asistencias"
            description="No se encontraron registros de entrada para el rango y usuario seleccionados."
            action={
              <Button asChild variant="outline">
                <Link href="/asistencia">Ver este mes</Link>
              </Button>
            }
          />
        ) : (
          <div className="scroll-area overflow-x-auto">
            <table className="data-table min-w-[980px]">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Usuario</th>
                  <th>Documento</th>
                  <th>Dispositivo</th>
                  <th>Entrada</th>
                  <th>Salida</th>
                  <th>Duración</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((row) => {
                  const user = userMap.get(row.user_id);
                  const device = deviceMap.get(row.device_id);
                  const duration = durationFromTimes(
                    row.hora_entrada,
                    row.hora_salida,
                  );

                  return (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {formatDate(row.fecha)}
                      </td>
                      <td>
                        <p className="font-medium text-foreground">
                          {user?.nombre ?? 'Usuario eliminado'}
                        </p>
                      </td>
                      <td className="font-mono text-xs text-muted-foreground">
                        {user?.documento ?? '—'}
                      </td>
                      <td className="text-muted-foreground">
                        {device?.nombre ?? 'Dispositivo eliminado'}
                      </td>
                      <td className="font-mono text-xs text-foreground">
                        {formatTime(row.hora_entrada)}
                      </td>
                      <td className="font-mono text-xs text-foreground">
                        {formatTime(row.hora_salida)}
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {durationLabel(duration)}
                      </td>
                      <td>
                        <Badge
                          variant={row.hora_salida ? 'success' : 'warning'}
                        >
                          {row.hora_salida ? 'Completa' : 'Abierta'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        La hora de salida se completa cuando el mismo usuario registra un nuevo
        acceso permitido después de al menos 2 minutos. Las asistencias sin
        salida se muestran como abiertas.
      </p>
    </div>
  );
}
