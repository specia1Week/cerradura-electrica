'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { BrandMark, SidebarNav } from '@/components/layout/sidebar-nav';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/actions/auth';

export function MobileNav({ email, role }: { email: string; role: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setOpen(true)}
        aria-label="Abrir navegación"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[60] lg:hidden" aria-hidden={!open}>
            <button
              type="button"
              aria-label="Cerrar navegación"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            />
            <aside
              className="absolute left-0 top-0 z-[51] flex h-full w-[min(86vw,320px)] flex-col border-r border-border bg-card p-4 text-card-foreground shadow-float"
              style={{ backgroundColor: 'oklch(var(--card))' }}
            >
              <div className="mb-6 flex items-center justify-between">
                <BrandMark onNavigate={() => setOpen(false)} />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpen(false)}
                  aria-label="Cerrar navegación"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <SidebarNav onNavigate={() => setOpen(false)} />
              <div className="mt-auto rounded-xl border border-border bg-card/70 p-3">
                <p className="truncate text-xs font-medium text-foreground">{email}</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  {role}
                </p>
              </div>
              <form action={signOut} className="mt-2">
                <Button
                  type="submit"
                  variant="ghost"
                  className="w-full justify-start gap-2 text-muted-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  Cerrar sesión
                </Button>
              </form>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}
