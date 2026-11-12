'use client';

import { useState } from 'react';
import { Check, Copy, KeyRound, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function ApiKeyPanel({ apiKey }: { apiKey: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <Alert variant="warning">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Esta clave se muestra una sola vez</AlertTitle>
        <AlertDescription>
          Guardala en un lugar seguro. El panel solo conserva su hash SHA-256;
          si la perdés, deberás rotarla.
        </AlertDescription>
      </Alert>

      <div className="rounded-2xl border border-border bg-muted/40 p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" />
          API key del dispositivo
        </div>
        <code className="block break-all rounded-xl border border-border bg-background px-3 py-3 font-mono text-xs leading-6 text-foreground">
          {apiKey}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={copy}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-success" />
              Copiada
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copiar clave
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
