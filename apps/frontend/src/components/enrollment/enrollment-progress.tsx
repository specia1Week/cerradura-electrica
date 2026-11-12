'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock3,
  Fingerprint,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  cancelEnrollment,
  expireEnrollment,
  fetchEnrollmentStatus,
} from '@/lib/actions/enrollment';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { CommandEstado, DeviceCommandRecord } from '@/lib/types';
import { formatDateTime } from '@/lib/date';
import { cn } from '@/lib/utils';
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
import { CommandStatusBadge } from '@/components/status-badges';

const steps = [
  {
    key: 'PENDIENTE',
    title: 'Dispositivo listo',
    description: 'El lector tomará el comando en el próximo heartbeat.',
  },
  {
    key: 'TARJETA_LEIDA',
    title: 'Tarjeta leída',
    description: 'Acercá la tarjeta RFID al lector.',
  },
  {
    key: 'HUELLA_1_OK',
    title: 'Primera huella',
    description: 'Colocá el dedo en el sensor para la primera captura.',
  },
  {
    key: 'DEDO_RETIRADO',
    title: 'Retirá el dedo',
    description: 'Levantá el dedo y esperá la indicación para repetir.',
  },
  {
    key: 'HUELLA_2_OK',
    title: 'Segunda huella',
    description: 'Colocá el mismo dedo para confirmar el modelo.',
  },
  {
    key: 'MODELO_CREADO',
    title: 'Guardando huella',
    description: 'El lector crea y almacena el template localmente.',
  },
  {
    key: 'COMPLETADO',
    title: 'Registro completado',
    description: 'La credencial quedó registrada en el backend.',
  },
];

const stepIndexByPaso: Record<string, number> = {
  PENDIENTE: 0,
  TARJETA_LEIDA: 1,
  HUELLA_1_OK: 2,
  DEDO_RETIRADO: 3,
  HUELLA_2_OK: 4,
  MODELO_CREADO: 5,
  HUELLA_GUARDADA: 6,
  COMPLETADO: 6,
};

function isActive(estado: CommandEstado) {
  return estado === 'PENDIENTE' || estado === 'EN_CURSO';
}

function isTerminal(estado: CommandEstado) {
  return !isActive(estado);
}

function detailText(detalle: Record<string, unknown> | null) {
  if (!detalle) return null;
  const motivo = detalle.motivo;
  if (typeof motivo === 'string' && motivo.trim()) return motivo;
  const mensaje = detalle.mensaje;
  if (typeof mensaje === 'string' && mensaje.trim()) return mensaje;
  return null;
}

function formatRemaining(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function EnrollmentProgress({
  initialCommand,
  userName,
  deviceName,
  deviceId,
  userId,
}: {
  initialCommand: DeviceCommandRecord;
  userName: string;
  deviceName: string;
  deviceId: string;
  userId: string;
}) {
  const [command, setCommand] = useState(initialCommand);
  const [now, setNow] = useState(() => Date.now());
  const [realtime, setRealtime] = useState<'conectando' | 'activo' | 'error'>(
    'conectando',
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const expireRequested = useRef(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`enrollment-${initialCommand.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'device_commands',
          filter: `id=eq.${initialCommand.id}`,
        },
        (payload) => {
          setCommand((current) => ({
            ...current,
            ...(payload.new as Partial<DeviceCommandRecord>),
          }));
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtime('activo');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtime('error');
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [initialCommand.id]);

  useEffect(() => {
    if (isTerminal(command.estado)) return;

    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [command.estado]);

  useEffect(() => {
    if (isTerminal(command.estado)) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const next = await fetchEnrollmentStatus(initialCommand.id);
        if (!cancelled && next) setCommand(next);
      } catch {
        // El polling es un respaldo de Realtime; un error transitorio no debe
        // interrumpir el seguimiento.
      }
    };

    const interval = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [command.estado, initialCommand.id]);

  const expiresAt = new Date(command.expires_at).getTime();
  const remainingSeconds = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const expiredByTime = isActive(command.estado) && expiresAt <= now;
  const effectiveEstado: CommandEstado = expiredByTime
    ? 'EXPIRADO'
    : command.estado;

  useEffect(() => {
    if (!expiredByTime || expireRequested.current) return;
    expireRequested.current = true;
    void expireEnrollment(initialCommand.id).then((result) => {
      if (!result.ok) setActionError(result.error ?? null);
    });
  }, [expiredByTime, initialCommand.id]);

  const currentStep = stepIndexByPaso[command.paso ?? ''] ?? 0;
  const isComplete = effectiveEstado === 'COMPLETADO';
  const isFailed = effectiveEstado === 'FALLIDO';
  const isExpired = effectiveEstado === 'EXPIRADO';
  const isCancelled = effectiveEstado === 'CANCELADO';
  const isRunning = isActive(effectiveEstado) && !expiredByTime;
  const failureDetail = detailText(command.detalle);

  function cancel() {
    setActionError(null);
    startTransition(async () => {
      const result = await cancelEnrollment(command.id);
      if (result.ok) {
        setCommand((current) => ({
          ...current,
          estado: 'CANCELADO',
          completed_at: new Date().toISOString(),
        }));
      } else {
        setActionError(result.error ?? 'No se pudo cancelar el registro.');
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card className="animate-fade-up overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-primary via-secondary to-primary/20" />
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <CommandStatusBadge estado={effectiveEstado} />
              {isRunning && (
                <Badge variant="outline" className="gap-1">
                  <Clock3 className="h-3 w-3" />
                  {formatRemaining(remainingSeconds)}
                </Badge>
              )}
            </div>
            <CardTitle className="text-xl">
              {isComplete
                ? 'Huella enrolada'
                : isFailed
                  ? 'El registro falló'
                  : isExpired
                    ? 'El comando expiró'
                    : isCancelled
                      ? 'Registro cancelado'
                      : 'Registro en curso'}
            </CardTitle>
            <CardDescription className="mt-1">
              {userName} · {deviceName}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-[11px]',
                realtime === 'activo'
                  ? 'text-success'
                  : realtime === 'error'
                    ? 'text-warning'
                    : 'text-muted-foreground',
              )}
            >
              {realtime === 'activo' ? (
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {realtime === 'activo'
                ? 'Tiempo real'
                : realtime === 'error'
                  ? 'Polling cada 5 s'
                  : 'Conectando'}
            </span>
            {isRunning && (
              <Button
                variant="outline"
                size="sm"
                onClick={cancel}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                Cancelar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
            <div className="surface-muted p-3">
              <p className="eyebrow mb-1">Comando</p>
              <p className="font-mono text-[11px] text-foreground">
                {command.id.slice(0, 8)}…
              </p>
            </div>
            <div className="surface-muted p-3">
              <p className="eyebrow mb-1">Slot asignado</p>
              <p className="font-mono text-[11px] text-foreground">
                {command.fingerprint_slot ?? '—'}
              </p>
            </div>
            <div className="surface-muted p-3">
              <p className="eyebrow mb-1">Expira</p>
              <p className="text-[11px] text-foreground">
                {formatDateTime(command.expires_at)}
              </p>
            </div>
          </div>

          {isComplete && (
            <Alert variant="success" className="mt-4">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Registro completado</AlertTitle>
              <AlertDescription>
                El dispositivo confirmó la tarjeta y la huella. La credencial ya
                está activa en el backend.
              </AlertDescription>
            </Alert>
          )}

          {isFailed && (
            <Alert variant="destructive" className="mt-4">
              <XCircle className="h-4 w-4" />
              <AlertTitle>No se pudo completar el registro</AlertTitle>
              <AlertDescription>
                {failureDetail ??
                  'El dispositivo informó un fallo. Revisá el sensor y volvé a intentarlo.'}
                {command.paso && (
                  <span className="mt-1 block font-mono text-[10px] opacity-70">
                    Paso: {command.paso}
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {(isExpired || isCancelled) && (
            <Alert variant="warning" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>
                {isExpired ? 'El comando expiró' : 'Registro cancelado'}
              </AlertTitle>
              <AlertDescription>
                {isExpired
                  ? 'El dispositivo no completó el registro dentro de los 5 minutos. Podés iniciar uno nuevo.'
                  : 'El comando se canceló desde el panel. Si el dispositivo ya había guardado la huella, debería eliminarla localmente al reportar el estado.'}
              </AlertDescription>
            </Alert>
          )}

          {actionError && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}

          <div className="mt-6 space-y-1">
            {steps.map((step, index) => {
              const done =
                isComplete ||
                (isFailed && index < currentStep) ||
                (!isFailed &&
                  !isExpired &&
                  !isCancelled &&
                  index < currentStep);
              const active =
                !isComplete &&
                !isFailed &&
                !isExpired &&
                !isCancelled &&
                index === currentStep;
              const failed = isFailed && index === currentStep;
              const stopped = (isExpired || isCancelled) && index === currentStep;

              return (
                <div
                  key={step.key}
                  className={cn(
                    'flex gap-3 rounded-xl px-3 py-3 transition-colors',
                    active && 'bg-primary/[0.06]',
                  )}
                >
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
                    {done ? (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    ) : failed ? (
                      <XCircle className="h-5 w-5 text-destructive" />
                    ) : stopped ? (
                      <AlertCircle className="h-5 w-5 text-warning" />
                    ) : active && isRunning ? (
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    ) : active ? (
                      <Circle className="h-5 w-5 text-primary" />
                    ) : (
                      <Circle className="h-5 w-5 text-border" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        'text-sm font-medium',
                        done
                          ? 'text-foreground'
                          : active
                            ? 'text-foreground'
                            : 'text-muted-foreground',
                      )}
                    >
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <Link href="/usuarios">
            <ArrowLeft className="h-4 w-4" />
            Volver a usuarios
          </Link>
        </Button>
        {isTerminal(command.estado) || expiredByTime ? (
          <Button asChild>
            <Link href={`/usuarios/${userId}/enrolar`}>
              <Fingerprint className="h-4 w-4" />
              Nuevo registro
            </Link>
          </Button>
        ) : (
          <Button asChild variant="ghost">
            <Link href={`/dispositivos`}>
              <ShieldCheck className="h-4 w-4" />
              Ver dispositivos
            </Link>
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground">
          Dispositivo: <span className="font-mono">{deviceId.slice(0, 8)}…</span>
        </span>
      </div>
    </div>
  );
}
