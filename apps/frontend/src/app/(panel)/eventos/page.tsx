// Última modificación: 2026-11-10
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  History,
  X,
} from 'lucide-react';
import { requireAuthContext } from '@/lib/auth';
import {
  dateInputToEnd,
  dateInputToStart,
  daysAgoInput,
  formatDateTime,
  isValidDateInput,
  todayInputValue,
} from '@/lib/date';
import type {
  AccessEventRecord,
  AccessResultado,
  DeviceRecord,
  UserRecord,
} from '@/lib/types';
import {
  buildQueryString,
  firstParam,
  isUuid,
  parsePositiveInt,
} from '@/lib/validation';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { AccessResultBadge } from '@/components/status-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Eventos',
};

const PAGE_SIZE = 20;

const resultLabels: Record<AccessResultado, string> = {
  PERMITIDO: 'Permitido',
  DENEGADO: 'Denegado',
};

const MOTIVOS = [
  {
    value: 'HUELLA_NO_RECONOCIDA_3_INTENTOS',
    label: 'Huella no reconocida (3 intentos)',
  },
  { value: 'HUELLA_OTRO_USUARIO', label: 'Huella de otro usuario' },
  { value: 'TARJETA_NO_REGISTRADA', label: 'Tarjeta no registrada' },
  { value: 'USUARIO_INACTIVO', label: 'Usuario inactivo' },
  { value: 'TIMEOUT_BACKEND', label: 'Timeout del backend' },
  { value: 'BLOQUEO_TEMPORAL', label: 'Bloqueo temporal' },
] as const;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireAuthContext();
  const params = await searchParams;

  const fromRaw = firstParam(params.from);
  const toRaw = firstParam(params.to);
  let fromDate = isValidDateInput(fromRaw) ? fromRaw : daysAgoInput(6);
  let toDate = isValidDateInput(toRaw) ? toRaw : todayInputValue();
  if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];

  const deviceParam = firstParam(params.device);
  const userParam = firstParam(params.user);
  const deviceId = isUuid(deviceParam) ? deviceParam : undefined;
  const userId = isUuid(userParam) ? userParam : undefined;
  const resultRaw = firstParam(params.resultado);
  const resultado =
    resultRaw === 'PERMITIDO' || resultRaw === 'DENEGADO'
      ? (resultRaw as AccessResultado)
      : undefined;
  const motivoRaw = firstParam(params.motivo);
  const motivo = MOTIVOS.find((item) => item.value === motivoRaw)?.value;
  const requestedPage = parsePositiveInt(firstParam(params.page), 1);

  const start = dateInputToStart(fromDate).toISOString();
  const end = dateInputToEnd(toDate).toISOString();

  let countQuery = supabase
    .from('access_events')
    .select('id', { count: 'exact', head: true })
    .gte('occurred_at', start)
    .lte('occurred_at', end);

  if (deviceId) countQuery = countQuery.eq('device_id', deviceId);
  if (userId) countQuery = countQuery.eq('user_id', userId);
  if (resultado) countQuery = countQuery.eq('resultado', resultado);
  if (motivo) countQuery = countQuery.eq('motivo', motivo);

  const { count, error: countError } = await countQuery;
  if (countError) throw new Error(countError.message);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  let dataQuery = supabase
    .from('access_events')
    .select('*')
    .gte('occurred_at', start)
    .lte('occurred_at', end)
    .order('occurred_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (deviceId) dataQuery = dataQuery.eq('device_id', deviceId);
  if (userId) dataQuery = dataQuery.eq('user_id', userId);
  if (resultado) dataQuery = dataQuery.eq('resultado', resultado);
  if (motivo) dataQuery = dataQuery.eq('motivo', motivo);

  const [eventsResult, devicesResult, usersResult] = await Promise.all([
    dataQuery,
    supabase.from('devices').select('id, nombre, mac').order('nombre'),
    supabase
      .from('users')
      .select('id, nombre, documento')
      .order('nombre'),
  ]);

  if (eventsResult.error) throw new Error(eventsResult.error.message);
  if (devicesResult.error) throw new Error(devicesResult.error.message);
  if (usersResult.error) throw new Error(usersResult.error.message);

  const events = (eventsResult.data ?? []) as AccessEventRecord[];
  const devices = (devicesResult.data ?? []) as Pick<
    DeviceRecord,
    'id' | 'nombre' | 'mac'
  >[];
  const users = (usersResult.data ?? []) as Pick<
    UserRecord,
    'id' | 'nombre' | 'documento'
  >[];
  const deviceMap = new Map(devices.map((device) => [device.id, device]));
  const userMap = new Map(users.map((user) => [user.id, user]));

  const hasFilters = Boolean(
    deviceId || userId || resultado || motivo || fromRaw || toRaw,
  );
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  function hrefForPage(targetPage: number) {
    return `/eventos${buildQueryString({
      from: fromDate,
      to: toDate,
      device: deviceId,
      user: userId,
      resultado,
      motivo,
      page: targetPage > 1 ? targetPage : undefined,
    })}`;
  }

  function quickRange(days: number) {
    return `/eventos${buildQueryString({
      from: daysAgoInput(days - 1),
      to: todayInputValue(),
      device: deviceId,
      user: userId,
      resultado,
      motivo,
    })}`;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Auditoría"
        title="Eventos de acceso"
        description="Consultá cada intento registrado por los lectores, con el resultado calculado por el backend y el reportado por el dispositivo."
        actions={
          <Button asChild variant="outline">
            <Link href="/eventos">
              <CalendarRange className="h-4 w-4" />
              Restablecer rango
            </Link>
          </Button>
        }
      />

      <div className="surface mb-4 p-4">
        <form
          method="get"
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-7"
        >
          <div className="space-y-1.5">
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
          <div className="space-y-1.5">
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
          <div className="space-y-1.5">
            <label
              htmlFor="device"
              className="block text-xs font-medium text-muted-foreground"
            >
              Dispositivo
            </label>
            <select
              id="device"
              name="device"
              defaultValue={deviceId ?? ''}
              className="flex h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm text-foreground shadow-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="">Todos</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
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
              <option value="">Todos</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.nombre} · {user.documento}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="resultado"
              className="block text-xs font-medium text-muted-foreground"
            >
              Resultado
            </label>
            <select
              id="resultado"
              name="resultado"
              defaultValue={resultado ?? ''}
              className="flex h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm text-foreground shadow-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="">Todos</option>
              <option value="PERMITIDO">Permitidos</option>
              <option value="DENEGADO">Denegados</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="motivo"
              className="block text-xs font-medium text-muted-foreground"
            >
              Motivo
            </label>
            <select
              id="motivo"
              name="motivo"
              defaultValue={motivo ?? ''}
              className="flex h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm text-foreground shadow-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="">Todos</option>
              {MOTIVOS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" className="flex-1">
              Filtrar
            </Button>
            {hasFilters && (
              <Button asChild variant="ghost" size="icon">
                <Link href="/eventos" aria-label="Limpiar filtros">
                  <X className="h-4 w-4" />
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
            <Link href={quickRange(1)}>Hoy</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={quickRange(7)}>Últimos 7 días</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={quickRange(30)}>Últimos 30 días</Link>
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {total === 0
            ? 'Sin eventos en el rango'
            : `Mostrando ${firstRow}–${lastRow} de ${total} eventos`}
        </p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success" />
            {resultLabels.PERMITIDO}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-destructive" />
            {resultLabels.DENEGADO}
          </span>
        </div>
      </div>

      <div className="table-shell">
        {events.length === 0 ? (
          <EmptyState
            icon={<History className="h-5 w-5" />}
            title="No hay eventos"
            description="No se encontraron accesos para el rango y filtros seleccionados."
            action={
              hasFilters ? (
                <Button asChild variant="outline">
                  <Link href="/eventos">Limpiar filtros</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="scroll-area overflow-x-auto">
            <table className="data-table min-w-[1000px]">
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Usuario</th>
                  <th>Dispositivo</th>
                  <th>Resultado</th>
                  <th>Intentos de huella</th>
                  <th>Credencial</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => {
                  const user = event.user_id
                    ? userMap.get(event.user_id)
                    : null;
                  const device = deviceMap.get(event.device_id);
                  const deviceResultDiffers =
                    event.resultado_esp &&
                    event.resultado_esp !== event.resultado;

                  return (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {formatDateTime(event.occurred_at)}
                      </td>
                      <td>
                        <p className="font-medium text-foreground">
                          {user?.nombre ?? 'No identificado'}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {user?.documento ?? event.rfid_uid ?? '—'}
                        </p>
                      </td>
                      <td className="text-muted-foreground">
                        {device?.nombre ?? 'Dispositivo eliminado'}
                        <p className="font-mono text-[10px] opacity-70">
                          {device?.mac}
                        </p>
                      </td>
                      <td>
                        <div className="space-y-1">
                          <AccessResultBadge resultado={event.resultado} />
                          {deviceResultDiffers && (
                            <p className="text-[10px] text-warning">
                              Equipo: {event.resultado_esp}
                            </p>
                          )}
                        </div>
                      </td>
                      <td>
                        <span
                          className={
                            (event.intentos_huella ?? 0) >= 3
                              ? 'font-mono text-sm font-semibold text-destructive'
                              : 'font-mono text-sm text-muted-foreground'
                          }
                        >
                          {event.intentos_huella ?? '—'}
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          {event.rfid_uid && (
                            <Badge variant="outline" className="font-mono">
                              RFID {event.rfid_uid}
                            </Badge>
                          )}
                          {event.fingerprint_template_id !== null && (
                            <Badge variant="success">
                              Slot {event.fingerprint_template_id}
                            </Badge>
                          )}
                          {!event.rfid_uid &&
                            event.fingerprint_template_id === null && (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                        </div>
                      </td>
                      <td className="max-w-64 truncate text-xs text-muted-foreground">
                        {event.motivo ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Página {page} de {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              asChild={page > 1}
              variant="outline"
              size="sm"
              disabled={page === 1}
            >
              {page > 1 ? (
                <Link href={hrefForPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Link>
              ) : (
                <span>
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </span>
              )}
            </Button>
            <Button
              asChild={page < totalPages}
              variant="outline"
              size="sm"
              disabled={page === totalPages}
            >
              {page < totalPages ? (
                <Link href={hrefForPage(page + 1)}>
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span>
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        El evento se registra incluso cuando el dispositivo deniega localmente.
        “Intentos de huella” muestra los intentos biométricos informados por el
        equipo; 3 intentos se resaltan en rojo. La columna “Equipo” aparece si el
        resultado reportado difiere del backend.
      </p>
    </div>
  );
}
