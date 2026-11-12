'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center">
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>No se pudo cargar la información</AlertTitle>
        <AlertDescription>
          {error.message ||
            'Ocurrió un error al consultar Supabase. Verificá la conexión e intentá de nuevo.'}
        </AlertDescription>
      </Alert>
      <Button onClick={reset} className="mt-5 self-start">
        <RotateCcw className="h-4 w-4" />
        Reintentar
      </Button>
    </div>
  );
}
