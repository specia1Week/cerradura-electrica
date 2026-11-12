'use client';

import { useState } from 'react';
import {
  KeyRound,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { DeviceRecord } from '@/lib/types';
import { deleteDevice } from '@/lib/actions/devices';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DeviceDialog } from '@/components/devices/device-dialog';
import { RotateKeyDialog } from '@/components/devices/rotate-key-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';

export function DeviceRowActions({ device }: { device: DeviceRecord }) {
  const [dialog, setDialog] = useState<'edit' | 'rotate' | 'delete' | null>(
    null,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Acciones para ${device.nombre}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog('edit')}>
            <Pencil className="h-4 w-4" />
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('rotate')}>
            <KeyRound className="h-4 w-4" />
            Rotar API key
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setDialog('delete')}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeviceDialog
        open={dialog === 'edit'}
        onOpenChange={(open) => setDialog(open ? 'edit' : null)}
        device={device}
      />

      <RotateKeyDialog
        open={dialog === 'rotate'}
        onOpenChange={(open) => setDialog(open ? 'rotate' : null)}
        deviceId={device.id}
      />

      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        title="Eliminar dispositivo"
        description="Se eliminarán también sus credenciales y comandos. Si tiene eventos de acceso o asistencias, la base de datos impedirá la eliminación; en ese caso cambialo a INACTIVO."
        confirmLabel="Eliminar dispositivo"
        variant="destructive"
        action={deleteDevice}
        fields={{ id: device.id }}
      />
    </>
  );
}
