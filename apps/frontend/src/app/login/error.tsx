'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function LoginError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5">
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>No se pudo cargar el inicio de sesión</AlertTitle>
        <AlertDescription>
          {error.message ||
            'Ocurrió un error inesperado. Verificá la configuración e intentá de nuevo.'}
        </AlertDescription>
      </Alert>
      <Button onClick={reset} className="mt-5 self-start">
        <RotateCcw className="h-4 w-4" />
        Reintentar
      </Button>
    </main>
  );
}
