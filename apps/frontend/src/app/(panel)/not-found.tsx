import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';

export default function PanelNotFound() {
  return (
    <div className="surface mx-auto mt-10 max-w-xl">
      <EmptyState
        icon={<FileQuestion className="h-5 w-5" />}
        title="No encontramos esa página"
        description="El recurso solicitado no existe o fue eliminado. Volvé al dashboard para continuar."
        action={
          <Button asChild>
            <Link href="/dashboard">Ir al dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
