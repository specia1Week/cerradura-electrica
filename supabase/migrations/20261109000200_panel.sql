-- Última modificación: 2026-11-10
-- Soporte del panel Next.js:
--   * índices para las consultas de dashboard/eventos/asistencia;
--   * intentos biométricos para la regla de 3 intentos;
--   * publicación Realtime de device_commands para el progreso de enrolamiento.
--
-- Ejecutar después de 20261109000100_device_sync.sql.

alter table public.access_events
  add column if not exists intentos_huella integer not null default 0;

create index if not exists access_events_occurred_at_idx
  on public.access_events (occurred_at desc);

create index if not exists attendance_fecha_hora_idx
  on public.attendance (fecha desc, hora_entrada desc);

create index if not exists devices_last_seen_at_idx
  on public.devices (last_seen_at desc);

-- El panel se suscribe a los UPDATE de device_commands. Si la publicación
-- supabase_realtime no existe (por ejemplo en un Postgres local) se omite.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  )
  and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'device_commands'
  ) then
    execute 'alter publication supabase_realtime add table public.device_commands';
  end if;
end
$$;

-- Realtime necesita la fila completa en el payload de UPDATE para que el
-- panel reciba paso/estado/detalle sin una segunda consulta.
alter table public.device_commands replica identity full;
