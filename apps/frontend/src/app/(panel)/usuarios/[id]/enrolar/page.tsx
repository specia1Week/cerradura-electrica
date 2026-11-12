import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Fingerprint,
  KeyRound,
  UserRound,
} from 'lucide-react';
import { requireAuthContext } from '@/lib/auth';
import { isDeviceOnline } from '@/lib/date';
import type {
  CredentialRecord,
  DeviceCommandRecord,
  DeviceRecord,
  UserRecord,
} from '@/lib/types';
import { firstParam, isUuid } from '@/lib/validation';
import { startEnrollment } from '@/lib/actions/enrollment';
import { EnrollmentProgress } from '@/components/enrollment/enrollment-progress';
import { PageHeader } from '@/components/page-header';
import {
  CommandStatusBadge,
  DeviceStatusBadge,
  OnlineBadge,
  UserStatusBadge,
} from '@/components/status-badges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Enrolar usuario',
};

const roleLabels = {
  ADMIN: 'Administrador',
  DOCENTE: 'Docente',
  ESTUDIANTE: 'Estudiante',
} as const;

export default async function EnrollUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { supabase } = await requireAuthContext();
  const query = await searchParams;

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (userError) throw new Error(userError.message);
  if (!userData) notFound();
  const user = userData as UserRecord;

  const [devicesResult, activeCommandsResult, credentialsResult] =
    await Promise.all([
      supabase
        .from('devices')
        .select(
          'id, mac, nombre, ubicacion, estado, last_seen_at, firmware_version, ip, rssi, created_at, updated_at',
        )
        .order('nombre', { ascending: true }),
      supabase
        .from('device_commands')
        .select('id, device_id, estado, tipo')
        .in('estado', ['PENDIENTE', 'EN_CURSO']),
      supabase
        .from('credentials')
        .select(
          'id, user_id, device_id, tipo, rfid_uid, fingerprint_template_id, activo, created_at, updated_at',
        )
        .eq('user_id', id)
        .eq('activo', true)
        .order('created_at', { ascending: true }),
    ]);

  if (devicesResult.error) throw new Error(devicesResult.error.message);
  if (activeCommandsResult.error) {
    throw new Error(activeCommandsResult.error.message);
  }
  if (credentialsResult.error) throw new Error(credentialsResult.error.message);

  const devices = (devicesResult.data ?? []) as DeviceRecord[];
  const credentials = (credentialsResult.data ?? []) as CredentialRecord[];
  const deviceMap = new Map(devices.map((device) => [device.id, device]));
  const activeDeviceIds = new Set(
    (activeCommandsResult.data ?? []).map((command) => command.device_id),
  );

  const commandId = firstParam(query.command);
  let command: DeviceCommandRecord | null = null;
  if (commandId && isUuid(commandId)) {
    const { data: commandData, error: commandError } = await supabase
      .from('device_commands')
      .select('*')
      .eq('id', commandId)
      .eq('user_id', id)
      .maybeSingle();

    if (commandError) throw new Error(commandError.message);
    command = (commandData as DeviceCommandRecord | null) ?? null;
  }

  const selectableDevices = devices.filter(
    (device) =>
      device.estado === 'ACTIVO' &&
      isDeviceOnline(device.last_seen_at) &&
      !activeDeviceIds.has(device.id),
  );
  const queryError = firstParam(query.error);
  const commandDevice = command
    ? deviceMap.get(command.device_id)
    : null;

  return (
    <div>
      <PageHeader
        eyebrow="Credenciales biométricas"
        title="Enrolamiento biométrico"
        description={`Vinculá una tarjeta RFID y una huella para ${user.nombre} (${user.documento}) en un lector habilitado.`}
        actions={
          <Button asChild variant="outline">
            <Link href="/usuarios">
              <ArrowLeft className="h-4 w-4" />
              Volver a usuarios
            </Link>
          </Button>
        }
      />

      {queryError && (
        <Alert variant="warning" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No se pudo iniciar el registro</AlertTitle>
          <AlertDescription>{queryError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="min-w-0">
          {command ? (
            <EnrollmentProgress
              key={command.id}
              initialCommand={command}
              userName={user.nombre}
              deviceName={commandDevice?.nombre ?? 'Dispositivo'}
              deviceId={command.device_id}
              userId={user.id}
            />
          ) : (
            <Card className="animate-fade-up">
              <CardHeader>
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                    <Fingerprint className="h-4 w-4" />
                  </span>
                  <div>
                    <CardTitle>Iniciar registro</CardTitle>
                    <CardDescription>
                      Elegí un lector en línea para capturar la tarjeta y la
                      huella.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {user.estado !== 'ACTIVO' && (
                  <Alert variant="warning" className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Usuario inactivo</AlertTitle>
                    <AlertDescription>
                      Activá al usuario para poder enrolar nuevas credenciales.
                    </AlertDescription>
                  </Alert>
                )}

                {selectableDevices.length === 0 && (
                  <Alert variant="warning" className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>No hay lectores disponibles</AlertTitle>
                    <AlertDescription>
                      El dispositivo debe estar activo, en línea (heartbeat en los
                      últimos 30 s) y sin otro comando en curso.
                    </AlertDescription>
                  </Alert>
                )}

                <form action={startEnrollment} className="space-y-4">
                  <input type="hidden" name="userId" value={user.id} />
                  <div className="space-y-2">
                    <label
                      htmlFor="deviceId"
                      className="block text-sm font-medium"
                    >
                      Dispositivo
                    </label>
                    <select
                      id="deviceId"
                      name="deviceId"
                      defaultValue={selectableDevices[0]?.id ?? ''}
                      disabled={
                        user.estado !== 'ACTIVO' ||
                        selectableDevices.length === 0
                      }
                      required
                      className="flex h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm text-foreground shadow-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {selectableDevices.length === 0 && (
                        <option value="">Sin dispositivos disponibles</option>
                      )}
                      {devices.map((device) => {
                        const online = isDeviceOnline(device.last_seen_at);
                        const occupied = activeDeviceIds.has(device.id);
                        const disabled =
                          device.estado !== 'ACTIVO' ||
                          !online ||
                          occupied ||
                          user.estado !== 'ACTIVO';
                        const suffix = occupied
                          ? ' · comando activo'
                          : online
                            ? ' · en línea'
                            : ' · sin conexión';
                        return (
                          <option
                            key={device.id}
                            value={device.id}
                            disabled={disabled}
                          >
                            {device.nombre} · {device.ubicacion}
                            {suffix}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <div className="surface-muted p-3">
                      <p className="eyebrow mb-1">Slot</p>
                      <p>Se reserva automáticamente (1–999).</p>
                    </div>
                    <div className="surface-muted p-3">
                      <p className="eyebrow mb-1">Duración</p>
                      <p>El comando expira a los 5 minutos.</p>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    disabled={
                      user.estado !== 'ACTIVO' ||
                      selectableDevices.length === 0
                    }
                  >
                    <Fingerprint className="h-4 w-4" />
                    Iniciar registro
                  </Button>

                  <p className="text-xs leading-5 text-muted-foreground">
                    El lector pedirá la tarjeta, la primera huella, retirar el
                    dedo y repetir la huella. El progreso se actualiza en tiempo
                    real.
                  </p>
                </form>
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card className="animate-fade-up animate-delay-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-primary" />
                Usuario
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-base font-semibold tracking-[-0.02em]">
                  {user.nombre}
                </p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {user.documento}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{roleLabels[user.rol]}</Badge>
                <UserStatusBadge estado={user.estado} />
              </div>
              {command && (
                <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span>Comando</span>
                  <CommandStatusBadge estado={command.estado} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="animate-fade-up animate-delay-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-secondary" />
                Credenciales activas
              </CardTitle>
              <CardDescription>
                Tarjetas y huellas ya vinculadas al usuario.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {credentials.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs leading-5 text-muted-foreground">
                  Este usuario todavía no tiene credenciales activas.
                </p>
              ) : (
                <ul className="space-y-2">
                  {credentials.map((credential) => {
                    const credentialDevice = deviceMap.get(credential.device_id);
                    return (
                      <li
                        key={credential.id}
                        className="rounded-xl border border-border/70 bg-muted/20 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            variant={
                              credential.tipo === 'HUELLA'
                                ? 'success'
                                : 'primary'
                            }
                          >
                            {credential.tipo === 'HUELLA' ? 'Huella' : 'RFID'}
                          </Badge>
                          <span className="truncate text-[11px] text-muted-foreground">
                            {credentialDevice?.nombre ?? 'Dispositivo'}
                          </span>
                        </div>
                        <p className="mt-2 font-mono text-xs text-foreground">
                          {credential.tipo === 'HUELLA'
                            ? `Slot ${credential.fingerprint_template_id ?? '—'}`
                            : credential.rfid_uid ?? '—'}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {command && commandDevice && (
            <Card className="animate-fade-up animate-delay-3">
              <CardHeader>
                <CardTitle>Dispositivo del registro</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm font-medium">{commandDevice.nombre}</p>
                <p className="text-xs text-muted-foreground">
                  {commandDevice.ubicacion}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <OnlineBadge lastSeenAt={commandDevice.last_seen_at} />
                  <DeviceStatusBadge estado={commandDevice.estado} />
                </div>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {commandDevice.mac}
                </p>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
