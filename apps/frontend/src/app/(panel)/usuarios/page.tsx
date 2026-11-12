import type { Metadata } from 'next';
import Link from 'next/link';
import { Search, Users, X } from 'lucide-react';
import { requireAuthContext } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import type {
  CredentialRecord,
  UserEstado,
  UserRecord,
  UserRol,
} from '@/lib/types';
import { firstParam } from '@/lib/validation';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { CreateUserButton } from '@/components/users/create-user-button';
import { UserRowActions } from '@/components/users/user-row-actions';
import { UserStatusBadge } from '@/components/status-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Usuarios',
};

const roleLabels: Record<UserRol, string> = {
  ADMIN: 'Administrador',
  DOCENTE: 'Docente',
  ESTUDIANTE: 'Estudiante',
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireAuthContext();
  const params = await searchParams;
  const rawQuery = (firstParam(params.q) ?? '').trim().slice(0, 80);
  const queryText = rawQuery.replace(/[%,()]/g, ' ').trim();
  const rawEstado = firstParam(params.estado);
  const estado =
    rawEstado === 'ACTIVO' || rawEstado === 'INACTIVO'
      ? (rawEstado as UserEstado)
      : undefined;

  let usersQuery = supabase
    .from('users')
    .select('*')
    .order('nombre', { ascending: true });

  if (queryText) {
    usersQuery = usersQuery.or(
      `nombre.ilike.%${queryText}%,documento.ilike.%${queryText}%`,
    );
  }
  if (estado) {
    usersQuery = usersQuery.eq('estado', estado);
  }

  const { data, error } = await usersQuery;
  if (error) throw new Error(error.message);

  const users = (data ?? []) as UserRecord[];
  const userIds = users.map((user) => user.id);

  const { data: credentialsData, error: credentialsError } = userIds.length
    ? await supabase
        .from('credentials')
        .select('user_id, tipo, activo')
        .in('user_id', userIds)
    : { data: [] as Pick<CredentialRecord, 'user_id' | 'tipo' | 'activo'>[], error: null };

  if (credentialsError) throw new Error(credentialsError.message);

  const credentialCounts = new Map<
    string,
    { rfid: number; huellas: number }
  >();

  (
    (credentialsData ?? []) as Pick<
      CredentialRecord,
      'user_id' | 'tipo' | 'activo'
    >[]
  ).forEach((credential) => {
    if (!credential.activo) return;
    const current = credentialCounts.get(credential.user_id) ?? {
      rfid: 0,
      huellas: 0,
    };
    if (credential.tipo === 'RFID') current.rfid += 1;
    if (credential.tipo === 'HUELLA') current.huellas += 1;
    credentialCounts.set(credential.user_id, current);
  });

  const hasFilters = Boolean(queryText || estado);

  return (
    <div>
      <PageHeader
        eyebrow="Personas y credenciales"
        title="Usuarios"
        description="Gestioná estudiantes, docentes y administradores. Al desactivar un usuario se programan los borrados de sus huellas en cada lector."
        actions={<CreateUserButton />}
      />

      <div className="surface mb-4 p-4">
        <form
          method="get"
          className="flex flex-col gap-3 md:flex-row md:items-end"
        >
          <div className="min-w-0 flex-1">
            <label
              htmlFor="q"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Buscar
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="q"
                name="q"
                defaultValue={rawQuery}
                placeholder="Nombre o documento"
                className="pl-9"
              />
            </div>
          </div>

          <div className="w-full md:w-44">
            <label
              htmlFor="estado"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Estado
            </label>
            <select
              id="estado"
              name="estado"
              defaultValue={estado ?? ''}
              className="flex h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm text-foreground shadow-sm focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="">Todos</option>
              <option value="ACTIVO">Activos</option>
              <option value="INACTIVO">Inactivos</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit">Filtrar</Button>
            {hasFilters && (
              <Button asChild variant="ghost">
                <Link href="/usuarios">
                  <X className="h-4 w-4" />
                  Limpiar
                </Link>
              </Button>
            )}
          </div>
        </form>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {users.length} {users.length === 1 ? 'usuario' : 'usuarios'}
          {hasFilters ? ' con los filtros aplicados' : ' registrados'}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success" />
            {users.filter((user) => user.estado === 'ACTIVO').length} activos
          </span>
          <span className="text-border">·</span>
          <span>
            {users.filter((user) => user.estado === 'INACTIVO').length} inactivos
          </span>
        </div>
      </div>

      <div className="table-shell">
        {users.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title={hasFilters ? 'No hay coincidencias' : 'Todavía no hay usuarios'}
            description={
              hasFilters
                ? 'Probá con otro nombre, documento o estado.'
                : 'Creá el primer usuario para habilitar su tarjeta RFID y su huella.'
            }
            action={
              hasFilters ? (
                <Button asChild variant="outline">
                  <Link href="/usuarios">Limpiar filtros</Link>
                </Button>
              ) : (
                <CreateUserButton />
              )
            }
          />
        ) : (
          <div className="scroll-area overflow-x-auto">
            <table className="data-table min-w-[900px]">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Documento</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Credenciales</th>
                  <th>Alta</th>
                  <th className="w-12 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const counts = credentialCounts.get(user.id) ?? {
                    rfid: 0,
                    huellas: 0,
                  };
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-[11px] font-semibold text-muted-foreground">
                            {user.nombre
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((part) => part[0])
                              .join('')
                              .toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">
                              {user.nombre}
                            </p>
                            <Link
                              href={`/usuarios/${user.id}/enrolar`}
                              className="text-[11px] font-medium text-primary hover:underline"
                            >
                              Enrolar credenciales
                            </Link>
                          </div>
                        </div>
                      </td>
                      <td className="font-mono text-xs text-muted-foreground">
                        {user.documento}
                      </td>
                      <td>
                        <Badge variant="outline">{roleLabels[user.rol]}</Badge>
                      </td>
                      <td>
                        <UserStatusBadge estado={user.estado} />
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          <span
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                              counts.rfid > 0
                                ? 'border-primary/20 bg-primary/[0.08] text-primary'
                                : 'border-border text-muted-foreground',
                            )}
                          >
                            RFID {counts.rfid}
                          </span>
                          <span
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                              counts.huellas > 0
                                ? 'border-success/20 bg-success/[0.08] text-success'
                                : 'border-border text-muted-foreground',
                            )}
                          >
                            Huellas {counts.huellas}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(user.created_at)}
                      </td>
                      <td className="text-right">
                        <UserRowActions user={user} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Los usuarios con credenciales activas pueden acceder según la
        autorización del backend. La huella nunca se almacena en el panel.
      </p>
    </div>
  );
}
