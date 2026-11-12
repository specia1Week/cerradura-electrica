import { Badge } from '@/components/ui/badge';
import type {
  AccessResultado,
  CommandEstado,
  DeviceEstado,
  UserEstado,
} from '@/lib/types';
import { isDeviceOnline } from '@/lib/date';
import { cn } from '@/lib/utils';

export function UserStatusBadge({ estado }: { estado: UserEstado }) {
  return (
    <Badge variant={estado === 'ACTIVO' ? 'success' : 'default'}>
      {estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
    </Badge>
  );
}

export function DeviceStatusBadge({ estado }: { estado: DeviceEstado }) {
  const labels: Record<DeviceEstado, string> = {
    ACTIVO: 'Activo',
    INACTIVO: 'Inactivo',
    MANTENIMIENTO: 'Mantenimiento',
  };
  const variants = {
    ACTIVO: 'success',
    INACTIVO: 'default',
    MANTENIMIENTO: 'warning',
  } as const;

  return <Badge variant={variants[estado]}>{labels[estado]}</Badge>;
}

export function OnlineBadge({ lastSeenAt }: { lastSeenAt: string | null }) {
  const online = isDeviceOnline(lastSeenAt);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
        online
          ? 'border-success/25 bg-success/10 text-success'
          : 'border-border bg-muted/50 text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          online ? 'bg-success' : 'bg-muted-foreground/60',
        )}
      />
      {online ? 'En línea' : 'Sin conexión'}
    </span>
  );
}

export function AccessResultBadge({
  resultado,
}: {
  resultado: AccessResultado;
}) {
  return (
    <Badge variant={resultado === 'PERMITIDO' ? 'success' : 'destructive'}>
      {resultado === 'PERMITIDO' ? 'Permitido' : 'Denegado'}
    </Badge>
  );
}

export function CommandStatusBadge({ estado }: { estado: CommandEstado }) {
  const labels: Record<CommandEstado, string> = {
    PENDIENTE: 'Pendiente',
    EN_CURSO: 'En curso',
    COMPLETADO: 'Completado',
    FALLIDO: 'Fallido',
    EXPIRADO: 'Expirado',
    CANCELADO: 'Cancelado',
  };
  const variants = {
    PENDIENTE: 'warning',
    EN_CURSO: 'primary',
    COMPLETADO: 'success',
    FALLIDO: 'destructive',
    EXPIRADO: 'default',
    CANCELADO: 'default',
  } as const;

  return <Badge variant={variants[estado]}>{labels[estado]}</Badge>;
}
