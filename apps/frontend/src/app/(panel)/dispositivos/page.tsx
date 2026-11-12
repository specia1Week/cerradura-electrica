import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Cpu,
  Radio,
  Search,
  Signal,
  WifiOff,
  X,
} from 'lucide-react';
import { requireAuthContext } from '@/lib/auth';
import {
  isDeviceOnline,
  lastSeenLabel,
} from '@/lib/date';
import type { DeviceEstado, DeviceRecord } from '@/lib/types';
import { firstParam } from '@/lib/validation';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { CreateDeviceButton } from '@/components/devices/create-device-button';
import { DeviceRowActions } from '@/components/devices/device-row-actions';
import {
  DeviceStatusBadge,
  OnlineBadge,
} from '@/components/status-badges';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Dispositivos',
};

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireAuthContext();
  const params = await searchParams;
  const rawQuery = (firstParam(params.q) ?? '').trim().slice(0, 80);
  const queryText = rawQuery.replace(/[%,()]/g, ' ').trim();
  const rawEstado = firstParam(params.estado);
  const estado =
    rawEstado === 'ACTIVO' ||
    rawEstado === 'INACTIVO' ||
    rawEstado === 'MANTENIMIENTO'
      ? (rawEstado as DeviceEstado)
      : undefined;

  let devicesQuery = supabase
    .from('devices')
    .select(
      'id, mac, nombre, ubicacion, estado, last_seen_at, firmware_version, ip, rssi, created_at, updated_at',
    )
    .order('nombre', { ascending: true });

  if (queryText) {
    devicesQuery = devicesQuery.or(
      `nombre.ilike.%${queryText}%,mac.ilike.%${queryText}%,ubicacion.ilike.%${queryText}%`,
    );
  }
  if (estado) {
    devicesQuery = devicesQuery.eq('estado', estado);
  }

  const { data, error } = await devicesQuery;
  if (error) throw new Error(error.message);

  const devices = (data ?? []) as DeviceRecord[];
  const online = devices.filter((device) => isDeviceOnline(device.last_seen_at));
  const offline = devices.length - online.length;
  const inMaintenance = devices.filter(
    (device) => device.estado === 'MANTENIMIENTO',
  ).length;
  const hasFilters = Boolean(queryText || estado);

  return (
    <div>
      <PageHeader
        eyebrow="Infraestructura"
        title="Dispositivos"
        description="Administrá los lectores ESP32, sus credenciales de API y el estado de conexión reportado por heartbeat."
        actions={<CreateDeviceButton />}
      />

      <section className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="surface flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 text-success ring-1 ring-success/20">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">En línea</p>
            <p className="text-xl font-semibold tracking-[-0.03em]">{online.length}</p>
          </div>
        </div>
        <div className="surface flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground ring-1 ring-border">
            <WifiOff className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Sin conexión</p>
            <p className="text-xl font-semibold tracking-[-0.03em]">{offline}</p>
          </div>
        </div>
        <div className="surface flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10 text-warning ring-1 ring-warning/20">
            <Signal className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">En mantenimiento</p>
            <p className="text-xl font-semibold tracking-[-0.03em]">{inMaintenance}</p>
          </div>
        </div>
      </section>

      <div className="surface mb-4 p-4">
        <form
          method="get"
          className="flex flex-col gap-3 md:flex-row md:items-end"
        >
          <div className="min-w-0 flex-1">
            <label
              htmlFor="q"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Buscar
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="q"
                name="q"
                defaultValue={rawQuery}
                placeholder="Nombre, MAC o ubicación"
                className="pl-9"
              />
            </div>
          </div>

          <div className="w-full md:w-48">
            <label
              htmlFor="estado"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Estado
            </label>
            <select
              id="estado"
              name="estado"
              defaultValue={estado ?? ''}
              className="flex h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm text-foreground shadow-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="">Todos</option>
              <option value="ACTIVO">Activos</option>
              <option value="INACTIVO">Inactivos</option>
              <option value="MANTENIMIENTO">Mantenimiento</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit">Filtrar</Button>
            {hasFilters && (
              <Button asChild variant="ghost">
                <Link href="/dispositivos">
                  <X className="h-4 w-4" />
                  Limpiar
                </Link>
              </Button>
            )}
          </div>
        </form>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {devices.length}{' '}
          {devices.length === 1 ? 'dispositivo' : 'dispositivos'}
          {hasFilters ? ' con los filtros aplicados' : ' registrados'}
        </p>
        <p className="text-[11px] text-muted-foreground">
          En línea = heartbeat en los últimos 30 s
        </p>
      </div>

      <div className="table-shell">
        {devices.length === 0 ? (
          <EmptyState
            icon={<Cpu className="h-5 w-5" />}
            title={
              hasFilters
                ? 'No hay coincidencias'
                : 'Todavía no hay dispositivos'
            }
            description={
              hasFilters
                ? 'Probá con otro nombre, MAC o estado.'
                : 'Registrá un lector ESP32 para generar su API key y empezar a recibir heartbeats.'
            }
            action={
              hasFilters ? (
                <Button asChild variant="outline">
                  <Link href="/dispositivos">Limpiar filtros</Link>
                </Button>
              ) : (
                <CreateDeviceButton />
              )
            }
          />
        ) : (
          <div className="scroll-area overflow-x-auto">
            <table className="data-table min-w-[980px]">
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>Ubicación</th>
                  <th>Estado</th>
                  <th>Conectividad</th>
                  <th>Firmware</th>
                  <th>Señal / Red</th>
                  <th className="w-12 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => {
                  const deviceOnline = isDeviceOnline(device.last_seen_at);
                  return (
                    <tr key={device.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                              deviceOnline
                                ? 'border-success/20 bg-success/[0.08] text-success'
                                : 'border-border bg-muted/40 text-muted-foreground',
                            )}
                          >
                            <Cpu className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">
                              {device.nombre}
                            </p>
                            <p className="font-mono text-[11px] text-muted-foreground">
                              {device.mac}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-48 truncate text-muted-foreground">
                        {device.ubicacion}
                      </td>
                      <td>
                        <DeviceStatusBadge estado={device.estado} />
                      </td>
                      <td>
                        <div className="space-y-1">
                          <OnlineBadge lastSeenAt={device.last_seen_at} />
                          <p className="text-[11px] text-muted-foreground">
                            {lastSeenLabel(device.last_seen_at)}
                          </p>
                        </div>
                      </td>
                      <td className="font-mono text-xs text-muted-foreground">
                        {device.firmware_version ?? '—'}
                      </td>
                      <td>
                        <p className="font-mono text-xs text-muted-foreground">
                          {device.rssi !== null ? `${device.rssi} dBm` : 'RSSI —'}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground/80">
                          {device.ip ?? 'IP —'}
                        </p>
                      </td>
                      <td className="text-right">
                        <DeviceRowActions device={device} />
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
        Las API keys se muestran una sola vez y solo se almacena su hash
        SHA-256. Si se pierde una clave, usá “Rotar API key”.
      </p>
    </div>
  );
}
