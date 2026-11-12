'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { createDevice, updateDevice } from '@/lib/actions/devices';
import {
  initialActionResult,
  type ActionResult,
  type DeviceRecord,
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
import { ApiKeyPanel } from '@/components/api-key-panel';
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
      {editing ? 'Guardar cambios' : 'Crear dispositivo'}
    </Button>
  );
}

function DeviceForm({
  device,
  onDone,
}: {
  device?: DeviceRecord;
  onDone: () => void;
}) {
  const action = device ? updateDevice : createDevice;
  const [state, formAction] = useActionState<ActionResult, FormData>(
    action,
    initialActionResult,
  );

  useEffect(() => {
    if (state.ok && !state.apiKey) onDone();
  }, [state.ok, state.apiKey, onDone]);

  if (state.apiKey) {
    return (
      <div className="space-y-5">
        <ApiKeyPanel apiKey={state.apiKey} />
        <DialogFooter>
          <Button type="button" onClick={onDone}>
            He guardado la clave
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {device && <input type="hidden" name="id" value={device.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mac">Dirección MAC</Label>
          <Input
            id="mac"
            name="mac"
            defaultValue={device?.mac}
            placeholder="AA:BB:CC:DD:EE:FF"
            pattern="([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}"
            className="font-mono uppercase"
            required
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="estado">Estado</Label>
          <Select name="estado" defaultValue={device?.estado ?? 'ACTIVO'}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVO">Activo</SelectItem>
              <SelectItem value="INACTIVO">Inactivo</SelectItem>
              <SelectItem value="MANTENIMIENTO">Mantenimiento</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nombre">Nombre</Label>
        <Input
          id="nombre"
          name="nombre"
          defaultValue={device?.nombre}
          placeholder="Ej. Lector entrada principal"
          maxLength={120}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ubicacion">Ubicación</Label>
        <Input
          id="ubicacion"
          name="ubicacion"
          defaultValue={device?.ubicacion}
          placeholder="Ej. Edificio A, planta baja"
          maxLength={160}
          required
        />
      </div>

      {!device && (
        <p className="text-xs leading-5 text-muted-foreground">
          Se generará una API key aleatoria. Por seguridad, se mostrará una sola
          vez y solo se guardará su hash. El dispositivo la usa para autenticarse
          en `access-webhook` y `device-sync`.
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
        <SubmitButton editing={Boolean(device)} />
      </DialogFooter>
    </form>
  );
}

export function DeviceDialog({
  open,
  onOpenChange,
  device,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device?: DeviceRecord;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {device ? 'Editar dispositivo' : 'Nuevo dispositivo'}
          </DialogTitle>
          <DialogDescription>
            {device
              ? 'Actualizá la identificación y el estado del lector.'
              : 'Registrá un lector ESP32 y generá su credencial de API.'}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <DeviceForm device={device} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
