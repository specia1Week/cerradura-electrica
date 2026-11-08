create extension if not exists pgcrypto;

create type public.user_rol as enum ('DOCENTE', 'ESTUDIANTE', 'ADMIN');
create type public.user_estado as enum ('ACTIVO', 'INACTIVO');
create type public.device_estado as enum ('ACTIVO', 'INACTIVO', 'MANTENIMIENTO');
create type public.credential_tipo as enum ('RFID', 'HUELLA');
create type public.access_resultado as enum ('PERMITIDO', 'DENEGADO');

create table public.users (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  documento text not null unique,
  rol public.user_rol not null,
  estado public.user_estado not null default 'ACTIVO',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  mac text not null unique,
  nombre text not null,
  ubicacion text not null,
  api_key_hash text not null,
  estado public.device_estado not null default 'ACTIVO',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  tipo public.credential_tipo not null,
  rfid_uid text,
  fingerprint_template_id integer,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credentials_device_rfid_uid_key unique (device_id, rfid_uid),
  constraint credentials_device_fingerprint_template_id_key unique (device_id, fingerprint_template_id)
);

create table public.access_events (
  id uuid primary key default gen_random_uuid(),
  event_uuid text not null unique,
  device_id uuid not null references public.devices(id) on delete restrict,
  user_id uuid references public.users(id) on delete set null,
  rfid_uid text,
  fingerprint_template_id integer,
  resultado public.access_resultado not null,
  motivo text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index access_events_device_occurred_at_idx on public.access_events (device_id, occurred_at);
create index access_events_user_occurred_at_idx on public.access_events (user_id, occurred_at);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  access_event_id uuid not null unique references public.access_events(id) on delete restrict,
  fecha date not null,
  hora_entrada time not null,
  hora_salida time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index attendance_user_fecha_idx on public.attendance (user_id, fecha);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at before update on public.users
for each row execute function public.set_updated_at();
create trigger devices_set_updated_at before update on public.devices
for each row execute function public.set_updated_at();
create trigger credentials_set_updated_at before update on public.credentials
for each row execute function public.set_updated_at();
create trigger attendance_set_updated_at before update on public.attendance
for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.devices enable row level security;
alter table public.credentials enable row level security;
alter table public.access_events enable row level security;
alter table public.attendance enable row level security;

create policy users_service_role_all on public.users
for all to service_role using (true) with check (true);
create policy users_authenticated_read on public.users
for select to authenticated using (true);

create policy devices_service_role_all on public.devices
for all to service_role using (true) with check (true);
create policy devices_authenticated_read on public.devices
for select to authenticated using (true);

create policy credentials_service_role_all on public.credentials
for all to service_role using (true) with check (true);
create policy credentials_authenticated_read on public.credentials
for select to authenticated using (true);

create policy access_events_service_role_all on public.access_events
for all to service_role using (true) with check (true);
create policy access_events_authenticated_read on public.access_events
for select to authenticated using (true);

create policy attendance_service_role_all on public.attendance
for all to service_role using (true) with check (true);
create policy attendance_authenticated_read on public.attendance
for select to authenticated using (true);
