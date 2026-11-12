'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Fingerprint,
  MoreHorizontal,
  Pencil,
  Power,
  Trash2,
} from 'lucide-react';
import type { UserRecord } from '@/lib/types';
import { setUserEstado, deleteUser } from '@/lib/actions/users';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserDialog } from '@/components/users/user-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';

export function UserRowActions({ user }: { user: UserRecord }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<'edit' | 'status' | 'delete' | null>(
    null,
  );
  const deactivating = user.estado === 'ACTIVO';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Acciones para ${user.nombre}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog('edit')}>
            <Pencil className="h-4 w-4" />
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => router.push(`/usuarios/${user.id}/enrolar`)}
          >
            <Fingerprint className="h-4 w-4" />
            Enrolar huella
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setDialog('status')}
            className={deactivating ? 'text-warning' : 'text-success'}
          >
            <Power className="h-4 w-4" />
            {deactivating ? 'Desactivar' : 'Activar'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setDialog('delete')}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <UserDialog
        open={dialog === 'edit'}
        onOpenChange={(open) => setDialog(open ? 'edit' : null)}
        user={user}
      />

      <ConfirmDialog
        open={dialog === 'status'}
        onOpenChange={(open) => setDialog(open ? 'status' : null)}
        title={deactivating ? 'Desactivar usuario' : 'Activar usuario'}
        description={
          deactivating
            ? 'El usuario dejará de tener acceso. Si tiene huellas activas, se crearán comandos DELETE_HUELLA para los dispositivos correspondientes.'
            : 'El usuario volverá a estar habilitado para acceder con las credenciales que conserve.'
        }
        confirmLabel={deactivating ? 'Desactivar' : 'Activar'}
        variant={deactivating ? 'destructive' : 'default'}
        action={setUserEstado}
        fields={{ id: user.id, estado: deactivating ? 'INACTIVO' : 'ACTIVO' }}
      />

      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        title="Eliminar usuario"
        description="Esta acción elimina al usuario y sus credenciales. No se puede deshacer. Si tiene asistencias, la base de datos impedirá la eliminación."
        confirmLabel="Eliminar usuario"
        variant="destructive"
        action={deleteUser}
        fields={{ id: user.id }}
      />
    </>
  );
}
