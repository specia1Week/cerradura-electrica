-- Evita reservar de nuevo los slots que el sensor confirmó ocupados.
-- La base en producción usa credential_type, mientras que instalaciones
-- locales antiguas usan credential_tipo. Los literales sin cast adoptan el
-- enum declarado por la columna en ambos casos.
do $migration$
declare
  function_sql text;
begin
  function_sql := pg_catalog.pg_get_functiondef(
    'public.sync_device_commands(uuid,uuid,text,text,jsonb,text,integer)'::pg_catalog.regprocedure
  );
  function_sql := pg_catalog.replace(
    function_sql,
    '''RFID''::public.credential_tipo',
    '''RFID'''
  );
  function_sql := pg_catalog.replace(
    function_sql,
    '''HUELLA''::public.credential_tipo',
    '''HUELLA'''
  );
  function_sql := pg_catalog.replace(
    function_sql,
    'tipo = ''HUELLA''',
    'tipo::text = ''HUELLA'''
  );
  execute function_sql;
end;
$migration$;

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
    and not exists (
      select 1
      from public.device_commands as dc
      where dc.device_id = p_device_id
        and dc.tipo = 'ENROLL_USUARIO'::public.command_tipo
        and dc.estado = 'FALLIDO'::public.command_estado
        and dc.paso = 'SLOT_OCUPADO_LOCAL'
        and dc.fingerprint_slot = candidate.slot
    )
  order by candidate.slot
  limit 1;

  return v_slot;
end;
$$;

revoke all on function public.reserve_fingerprint_slot(uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_fingerprint_slot(uuid)
  to service_role;

-- Tras borrar una plantilla local, sus reportes históricos dejan de bloquear
-- la reserva de ese slot en futuros enrolamientos.
create or replace function public.release_occupied_slots_after_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.tipo = 'DELETE_HUELLA'::public.command_tipo
     and new.estado = 'COMPLETADO'::public.command_estado
     and old.estado is distinct from new.estado then
    update public.device_commands
    set paso = 'SLOT_LIBERADO_LOCAL',
        detalle = coalesce(detalle, '{}'::jsonb) ||
          pg_catalog.jsonb_build_object('slot_liberado_por_comando', new.id)
    where device_id = new.device_id
      and tipo = 'ENROLL_USUARIO'::public.command_tipo
      and estado = 'FALLIDO'::public.command_estado
      and paso = 'SLOT_OCUPADO_LOCAL'
      and fingerprint_slot = new.fingerprint_slot;
  end if;

  return new;
end;
$$;

drop trigger if exists release_occupied_slots_after_delete
  on public.device_commands;
create trigger release_occupied_slots_after_delete
after update of estado on public.device_commands
for each row
execute function public.release_occupied_slots_after_delete();
