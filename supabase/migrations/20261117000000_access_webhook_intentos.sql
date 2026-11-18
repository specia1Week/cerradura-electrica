-- Última modificación: 2026-11-17
-- Persistencia de intentos_huella desde access-webhook.
--
-- La columna ya se agrega en 20261109000200_panel.sql. Esta migración
-- reemplaza record_access_event para aceptar el contador que envía el ESP32
-- y guardarlo en access_events.intentos_huella.
--
-- Ejecutar después de 20261109000200_panel.sql.

alter table public.access_events
  add column if not exists intentos_huella integer not null default 0;

-- La versión anterior tenía nueve parámetros. Se elimina para evitar
-- sobrecargas ambiguas en PostgREST.
drop function if exists public.record_access_event(
  text,
  uuid,
  uuid,
  text,
  integer,
  text,
  text,
  timestamptz,
  public.device_resultado_esp
);

create or replace function public.record_access_event(
  p_event_uuid text,
  p_device_id uuid,
  p_user_id uuid,
  p_rfid_uid text,
  p_fingerprint_template_id integer,
  p_resultado text,
  p_motivo text,
  p_occurred_at timestamptz,
  p_resultado_esp public.device_resultado_esp,
  p_intentos_huella integer default 0
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
  v_intentos integer := greatest(coalesce(p_intentos_huella, 0), 0);
begin
  if p_resultado not in ('PERMITIDO', 'DENEGADO') then
    raise exception using errcode = '22023', message = 'resultado no válido';
  end if;
  if p_resultado = 'PERMITIDO' and p_user_id is null then
    raise exception using errcode = '22023', message = 'PERMITIDO requiere user_id';
  end if;
  if v_intentos > 99 then
    raise exception using errcode = '22023', message = 'intentos_huella no válido';
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
    || '(event_uuid, device_id, user_id, rfid_uid, fingerprint_template_id, resultado, motivo, occurred_at, resultado_esp, intentos_huella) '
    || 'values ($1, $2, $3, $4, $5, $6::text::%s, $7, $8, $9, $10) '
    || 'on conflict (event_uuid) do nothing returning id',
    v_result_type
  )
  into v_event_id
  using p_event_uuid, p_device_id, p_user_id, p_rfid_uid,
    p_fingerprint_template_id, p_resultado, p_motivo, p_occurred_at,
    p_resultado_esp, v_intentos;

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
  text, uuid, uuid, text, integer, text, text, timestamptz,
  public.device_resultado_esp, integer
) from public, anon, authenticated;
grant execute on function public.record_access_event(
  text, uuid, uuid, text, integer, text, text, timestamptz,
  public.device_resultado_esp, integer
) to service_role;
