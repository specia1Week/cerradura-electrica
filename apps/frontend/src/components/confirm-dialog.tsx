'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  initialActionResult,
  type ActionResult,
} from '@/lib/types';

function SubmitButton({
  label,
  variant = 'default',
}: {
  label: string;
  variant?: 'default' | 'destructive';
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {label}
    </Button>
  );
}

function ConfirmForm({
  confirmLabel,
  variant,
  action,
  fields,
  onDone,
}: {
  confirmLabel: string;
  variant: 'default' | 'destructive';
  action: (
    previous: ActionResult,
    formData: FormData,
  ) => Promise<ActionResult>;
  fields: Record<string, string>;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<ActionResult, FormData>(
    action,
    initialActionResult,
  );

  if (state.ok) {
    return (
      <div className="space-y-4">
        <Alert variant="success">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Operación completada</AlertTitle>
          <AlertDescription>
            {state.message ?? 'Los cambios se guardaron correctamente.'}
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button type="button" onClick={onDone}>
            Cerrar
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form action={formAction}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {state.error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <SubmitButton label={confirmLabel} variant={variant} />
      </DialogFooter>
    </form>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  variant = 'default',
  action,
  fields,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: 'default' | 'destructive';
  action: (
    previous: ActionResult,
    formData: FormData,
  ) => Promise<ActionResult>;
  fields: Record<string, string>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open && (
          <ConfirmForm
            confirmLabel={confirmLabel}
            variant={variant}
            action={action}
            fields={fields}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
