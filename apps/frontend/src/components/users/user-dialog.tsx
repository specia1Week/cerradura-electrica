'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { createUser, updateUser } from '@/lib/actions/users';
import {
  initialActionResult,
  type ActionResult,
  type UserRecord,
} from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {editing ? 'Guardar cambios' : 'Crear usuario'}
    </Button>
  );
}

function UserForm({
  user,
  onDone,
}: {
  user?: UserRecord;
  onDone: () => void;
}) {
  const action = user ? updateUser : createUser;
  const [state, formAction] = useActionState<ActionResult, FormData>(
    action,
    initialActionResult,
  );

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      {user && <input type="hidden" name="id" value={user.id} />}

      <div className="space-y-2">
        <Label htmlFor="nombre">Nombre completo</Label>
        <Input
          id="nombre"
          name="nombre"
          defaultValue={user?.nombre}
          placeholder="Ej. Ana Martínez"
          maxLength={120}
          required
          autoFocus
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="documento">Documento</Label>
          <Input
            id="documento"
            name="documento"
            defaultValue={user?.documento}
            placeholder="Ej. 12345678"
            maxLength={40}
            required
          />
        </div>

        <div className="space-y-2">
          <Label>Rol</Label>
          <Select name="rol" defaultValue={user?.rol ?? 'ESTUDIANTE'}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar rol" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ESTUDIANTE">Estudiante</SelectItem>
              <SelectItem value="DOCENTE">Docente</SelectItem>
              <SelectItem value="ADMIN">Administrador</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!user && (
        <p className="text-xs leading-5 text-muted-foreground">
          El usuario se crea en estado activo. Luego podés enrolar su tarjeta y
          huella desde la tabla.
        </p>
      )}

      {state.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <SubmitButton editing={Boolean(user)} />
      </DialogFooter>
    </form>
  );
}

export function UserDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: UserRecord;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? 'Editar usuario' : 'Nuevo usuario'}</DialogTitle>
          <DialogDescription>
            {user
              ? 'Actualizá los datos académicos del usuario.'
              : 'Registrá a la persona que podrá acceder con RFID y huella.'}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <UserForm user={user} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
