import { AppShell } from '@/components/layout/app-shell';
import { requireAuthContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await requireAuthContext();

  return (
    <AppShell
      email={user.email ?? 'usuario sin correo'}
      profile={profile}
    >
      {children}
    </AppShell>
  );
}
