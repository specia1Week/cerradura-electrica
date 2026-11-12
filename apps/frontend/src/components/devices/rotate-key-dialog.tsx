'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { rotateDeviceKey } from '@/lib/actions/devices';
import {
  initialActionResult,
  type ActionResult,
} from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiKeyPanel } from '@/components/api-key-panel';
import { Button } from '@/components/ui/button';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      Rotar API key
    </Button>
  );
}

function RotateForm({
  deviceId,
  onDone,
}: {
  deviceId: string;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<ActionResult, FormData>(
    rotateDeviceKey,
    initialActionResult,
  );

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
      <input type="hidden" name="id" value={deviceId} />
      <Alert variant="warning">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>La clave anterior dejará de funcionar</AlertTitle>
        <AlertDescription>
          El dispositivo perderá acceso hasta que actualices su configuración
          con la nueva API key. La nueva clave se mostrará una sola vez.
        </AlertDescription>
      </Alert>

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
        <SubmitButton />
      </DialogFooter>
    </form>
  );
}

export function RotateKeyDialog({
  open,
  onOpenChange,
  deviceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotar API key</DialogTitle>
          <DialogDescription>
            Generá una credencial nueva para este dispositivo.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <RotateForm
            deviceId={deviceId}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
