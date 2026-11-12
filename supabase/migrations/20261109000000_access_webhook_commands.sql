-- Metadatos adicionales de actividad y firmware del ESP32.
alter table public.devices
  add column if not exists last_seen_at timestamptz,
  add column if not exists firmware_version text,
  add column if not exists ip text,
  add column if not exists rssi integer;

create type public.command_tipo as enum (
  'ENROLL_USUARIO',
  'DELETE_HUELLA',
  'SYNC_SLOTS'
);

create type public.command_estado as enum (
  'PENDIENTE',
  'EN_CURSO',
  'COMPLETADO',
  'FALLIDO',
  'EXPIRADO',
  'CANCELADO'
);

create type public.profile_rol as enum ('ADMIN', 'OPERADOR');

-- Guarda de forma separada el resultado informado por el dispositivo y el
-- resultado calculado por el backend en access_events.resultado.
create type public.device_resultado_esp as enum ('PERMITIDO', 'DENEGADO');
alter table public.access_events
  add column resultado_esp public.device_resultado_esp;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  rol public.profile_rol not null,
  created_at timestamptz not null default now()
);

create table public.device_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  tipo public.command_tipo not null,
  user_id uuid references public.users(id) on delete set null,
  fingerprint_slot integer check (fingerprint_slot between 1 and 999),
  estado public.command_estado not null default 'PENDIENTE',
  paso text,
  detalle jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  completed_at timestamptz
);

create unique index device_commands_one_active_per_device_idx
  on public.device_commands (device_id)
  where estado in ('PENDIENTE', 'EN_CURSO');

-- Reemplaza los índices ascendentes previos por los solicitados en orden
-- descendente y conserva un solo índice para cada patrón de consulta.
drop index if exists public.idx_access_events_device_time;
drop index if exists public.access_events_device_occurred_at_idx;
drop index if exists public.access_events_device_occurred_at_desc_idx;
create index access_events_device_occurred_at_desc_idx
  on public.access_events (device_id, occurred_at desc);

drop index if exists public.idx_access_events_user_time;
drop index if exists public.access_events_user_occurred_at_idx;
drop index if exists public.access_events_user_occurred_at_desc_idx;
create index access_events_user_occurred_at_desc_idx
  on public.access_events (user_id, occurred_at desc);

drop index if exists public.idx_attendance_user_date;
drop index if exists public.attendance_user_fecha_idx;
create index attendance_user_fecha_idx
  on public.attendance (user_id, fecha);

-- El helper evita recursión al consultar profiles desde la política de profiles.
-- Está en un esquema no expuesto por PostgREST y usa auth.uid(), no user_metadata.
create schema if not exists access_private;
revoke all on schema access_private from public;
grant usage on schema access_private to authenticated, service_role;

create or replace function access_private.is_admin_or_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles as p
      where p.id = (select auth.uid())
        and p.rol in (
          'ADMIN'::public.profile_rol,
          'OPERADOR'::public.profile_rol
        )
    );
$$;

revoke all on function access_private.is_admin_or_operator() from public, anon;
grant execute on function access_private.is_admin_or_operator() to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.device_commands enable row level security;

grant select, insert, update, delete on public.profiles, public.device_commands to authenticated;
grant select, insert, update, delete on public.profiles, public.device_commands to service_role;

create policy profiles_admin_operator_select on public.profiles
  for select to authenticated
  using ((select access_private.is_admin_or_operator()));
create policy profiles_admin_operator_insert on public.profiles
  for insert to authenticated
  with check ((select access_private.is_admin_or_operator()));
create policy profiles_admin_operator_update on public.profiles
  for update to authenticated
  using ((select access_private.is_admin_or_operator()))
  with check ((select access_private.is_admin_or_operator()));
create policy profiles_admin_operator_delete on public.profiles
  for delete to authenticated
  using ((select access_private.is_admin_or_operator()));

create policy device_commands_admin_operator_select on public.device_commands
  for select to authenticated
  using ((select access_private.is_admin_or_operator()));
create policy device_commands_admin_operator_insert on public.device_commands
  for insert to authenticated
  with check ((select access_private.is_admin_or_operator()));
create policy device_commands_admin_operator_update on public.device_commands
  for update to authenticated
  using ((select access_private.is_admin_or_operator()))
  with check ((select access_private.is_admin_or_operator()));
create policy device_commands_admin_operator_delete on public.device_commands
  for delete to authenticated
  using ((select access_private.is_admin_or_operator()));

-- Solo service_role puede reservar slots; el advisory lock serializa reservas
-- simultáneas por dispositivo. Devuelve NULL cuando no queda ningún slot.
create or replace function public.reserve_fingerprint_slot(p_device_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slot integer;
begin
  if p_device_id is null then
    raise exception using errcode = '22023', message = 'device_id es obligatorio';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_device_id::text, 0)
  );

  select candidate.slot
    into v_slot
  from pg_catalog.generate_series(1, 999) as candidate(slot)
  where not exists (
    select 1
    from public.credentials as c
    where c.device_id = p_device_id
      and c.tipo::text = 'HUELLA'
      and c.activo
      and c.fingerprint_template_id = candidate.slot
  )
    and not exists (
      select 1
      from public.device_commands as dc
      where dc.device_id = p_device_id
        and dc.estado in ('PENDIENTE', 'EN_CURSO')
        and dc.fingerprint_slot = candidate.slot
    )
  order by candidate.slot
  limit 1;

  return v_slot;
end;
$$;

revoke all on function public.reserve_fingerprint_slot(uuid) from public, anon, authenticated;
grant execute on function public.reserve_fingerprint_slot(uuid) to service_role;

-- Inserta el evento y actualiza asistencia de forma atómica. El nombre del
-- enum de access_events.resultado se detecta para convivir con el esquema
-- desplegado y con la migración inicial del repositorio.
create or replace function public.record_access_event(
  p_event_uuid text,
  p_device_id uuid,
  p_user_id uuid,
  p_rfid_uid text,
  p_fingerprint_template_id integer,
  p_resultado text,
  p_motivo text,
  p_occurred_at timestamptz,
  p_resultado_esp public.device_resultado_esp
)
returns table (
  event_id uuid,
  duplicate boolean,
  device_id uuid,
  user_id uuid,
  resultado text,
  motivo text,
  attendance_action text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_result_type text;
  v_local_occurred_at timestamp without time zone;
  v_local_date date;
  v_attendance_id uuid;
  v_entry_time time without time zone;
  v_exit_time time without time zone;
  v_attendance_action text := 'no_aplica';
begin
  if p_resultado not in ('PERMITIDO', 'DENEGADO') then
    raise exception using errcode = '22023', message = 'resultado no válido';
  end if;
  if p_resultado = 'PERMITIDO' and p_user_id is null then
    raise exception using errcode = '22023', message = 'PERMITIDO requiere user_id';
  end if;

  select pg_catalog.format('%I.%I', type_ns.nspname, result_type.typname)
    into v_result_type
  from pg_catalog.pg_attribute as a
  join pg_catalog.pg_class as c on c.oid = a.attrelid
  join pg_catalog.pg_namespace as table_ns on table_ns.oid = c.relnamespace
  join pg_catalog.pg_type as result_type on result_type.oid = a.atttypid
  join pg_catalog.pg_namespace as type_ns on type_ns.oid = result_type.typnamespace
  where table_ns.nspname = 'public'
    and c.relname = 'access_events'
    and a.attname = 'resultado'
    and a.attnum > 0
    and not a.attisdropped;

  if v_result_type is null then
    raise exception using errcode = '42704', message = 'No se encontró el tipo de access_events.resultado';
  end if;

  execute pg_catalog.format(
    'insert into public.access_events '
    || '(event_uuid, device_id, user_id, rfid_uid, fingerprint_template_id, resultado, motivo, occurred_at, resultado_esp) '
    || 'values ($1, $2, $3, $4, $5, $6::text::%s, $7, $8, $9) '
    || 'on conflict (event_uuid) do nothing returning id',
    v_result_type
  )
  into v_event_id
  using p_event_uuid, p_device_id, p_user_id, p_rfid_uid,
    p_fingerprint_template_id, p_resultado, p_motivo, p_occurred_at, p_resultado_esp;

  if v_event_id is null then
    return query
    select e.id, true, e.device_id, e.user_id, e.resultado::text, e.motivo, 'duplicado'::text
    from public.access_events as e
    where e.event_uuid = p_event_uuid;
    return;
  end if;

  if p_resultado = 'PERMITIDO' then
    v_local_occurred_at := p_occurred_at at time zone 'America/La_Paz';
    v_local_date := v_local_occurred_at::date;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_user_id::text || ':' || v_local_date::text, 1)
    );

    select a.id, a.hora_entrada, a.hora_salida
      into v_attendance_id, v_entry_time, v_exit_time
    from public.attendance as a
    where a.user_id = p_user_id
      and a.fecha = v_local_date
    order by a.hora_entrada, a.created_at
    limit 1
    for update;

    if not found then
      insert into public.attendance (
        user_id, device_id, access_event_id, fecha, hora_entrada
      ) values (
        p_user_id, p_device_id, v_event_id, v_local_date, v_local_occurred_at::time
      );
      v_attendance_action := 'entrada';
    elsif v_exit_time is not null then
      v_attendance_action := 'salida_ya_marcada';
    elsif v_local_occurred_at >= (v_local_date + v_entry_time) + interval '2 minutes' then
      update public.attendance
        set hora_salida = v_local_occurred_at::time
      where id = v_attendance_id;
      v_attendance_action := 'salida';
    else
      v_attendance_action := 'intervalo_minimo';
    end if;
  end if;

  return query
  select v_event_id, false, p_device_id, p_user_id, p_resultado, p_motivo, v_attendance_action;
end;
$$;

revoke all on function public.record_access_event(
  text, uuid, uuid, text, integer, text, text, timestamptz, public.device_resultado_esp
) from public, anon, authenticated;
grant execute on function public.record_access_event(
  text, uuid, uuid, text, integer, text, text, timestamptz, public.device_resultado_esp
) to service_role;
