import Link from 'next/link';
import {
  ChevronRight,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import type { Profile } from '@/lib/types';
import { roleLabel } from '@/lib/auth';
import { initials } from '@/lib/utils';
import { signOut } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { BrandMark, SidebarNav } from '@/components/layout/sidebar-nav';
import { MobileNav } from '@/components/layout/mobile-nav';
import { ThemeToggle } from '@/components/layout/theme-toggle';

export function AppShell({
  children,
  email,
  profile,
}: {
  children: React.ReactNode;
  email: string;
  profile: Profile;
}) {
  const role = roleLabel(profile.rol);

  return (
    <div className="min-h-screen lg:flex">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[272px] flex-col border-r border-border bg-sidebar/95 px-4 py-5 backdrop-blur-xl lg:flex">
        <div className="px-2">
          <BrandMark />
        </div>

        <div className="mt-8 px-2">
          <p className="eyebrow mb-2">Operación</p>
        </div>
        <SidebarNav />

        <div className="mt-auto space-y-3">
          <div className="rounded-xl border border-border bg-card/70 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/[0.12] text-xs font-semibold text-primary ring-1 ring-primary/20">
                {initials(email.split('@')[0] ?? email)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">
                  {email}
                </p>
                <p className="mt-0.5 truncate text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  {role}
                </p>
              </div>
            </div>
          </div>
          <form action={signOut}>
            <Button
              type="submit"
              variant="ghost"
              className="w-full justify-start gap-2 text-muted-foreground"
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </Button>
          </form>
          <p className="px-2 text-[10px] leading-4 text-muted-foreground/70">
            Sesión protegida por Supabase Auth
          </p>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col lg:pl-[272px]">
        <header className="sticky top-0 z-30 border-b border-border/80 bg-background/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-full max-w-[1480px] items-center gap-3 px-4 md:px-8">
            <MobileNav email={email} role={role} />
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <ShieldCheck className="h-4 w-4 text-success" />
              <span>Panel de administración</span>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">Acceso biométrico</span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/usuarios">Registrar usuario</Link>
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 md:px-8 md:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
