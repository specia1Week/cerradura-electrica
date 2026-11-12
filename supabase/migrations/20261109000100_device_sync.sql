-- Sincronización de comandos para el ESP32.
--
-- La Edge Function device-sync autentica el dispositivo con X-API-Key y llama
-- a esta RPC con service_role. Toda la parte de comandos es atómica:
--   * completar ENROLL_USUARIO inserta RFID + HUELLA o no inserta ninguna;
--   * completar DELETE_HUELLA desactiva la huella y actualiza el comando;
--   * el siguiente comando PENDIENTE se reserva como EN_CURSO.
--
-- La actualización de last_seen_at/firmware/rssi/ip se hace desde la Edge
-- Function antes de llamar a esta función.

create or replace function public.sync_device_commands(
  p_device_id uuid,
  p_command_id uuid default null,
  p_estado text default null,
  p_paso text default null,
  p_detalle jsonb default null,
  p_rfid_uid text default null,
  p_fingerprint_slot integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_command public.device_commands%rowtype;
  v_next public.device_commands%rowtype;
  v_rfid text;
  v_slot integer;
  v_constraint text;
  v_result jsonb;
begin
  if p_device_id is null then
    raise exception using errcode = '22023', message = 'device_id_requerido';
  end if;

  if p_estado is not null
     and p_estado not in ('EN_CURSO', 'COMPLETADO', 'FALLIDO') then
    raise exception using errcode = '22023', message = 'estado_invalido';
  end if;

  if p_fingerprint_slot is not null
     and (p_fingerprint_slot < 1 or p_fingerprint_slot > 999) then
    raise exception using errcode = '22023', message = 'fingerprint_slot_invalido';
  end if;

  perform 1
  from public.devices
  where id = p_device_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'device_not_found';
  end if;

  -- Todo comando activo cuya ventana ya venció queda EXPIRADO antes de
  -- seleccionar el siguiente trabajo para el dispositivo.
  update public.device_commands
  set estado = 'EXPIRADO'::public.command_estado
  where device_id = p_device_id
    and estado in (
      'PENDIENTE'::public.command_estado,
      'EN_CURSO'::public.command_estado
    )
    and expires_at <= now();

  if p_command_id is not null then
    select *
      into v_command
    from public.device_commands
    where id = p_command_id
      and device_id = p_device_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'command_not_found';
    end if;

    -- Un comando terminal no puede volver a EN_CURSO.
    if p_estado = 'EN_CURSO'
       and v_command.estado not in (
         'PENDIENTE'::public.command_estado,
         'EN_CURSO'::public.command_estado
       ) then
      raise exception using errcode = 'P0001', message = 'command_not_active';
    end if;

    -- Un comando ya completado no debe degradarse a FALLIDO/EN_CURSO.
    if v_command.estado = 'COMPLETADO'::public.command_estado
       and p_estado is not null
       and p_estado <> 'COMPLETADO' then
      raise exception using errcode = 'P0001', message = 'command_already_completed';
    end if;

    v_rfid := nullif(btrim(coalesce(p_rfid_uid, '')), '');
    v_slot := coalesce(v_command.fingerprint_slot, p_fingerprint_slot);

    if v_command.fingerprint_slot is not null
       and p_fingerprint_slot is not null
       and v_command.fingerprint_slot <> p_fingerprint_slot then
      raise exception using errcode = '22023', message = 'fingerprint_slot_mismatch';
    end if;

    -- Los efectos secundarios solo se aplican la primera vez que el comando
    -- pasa a COMPLETADO. Un reintento del ESP32 es idempotente.
    if p_estado = 'COMPLETADO'
       and v_command.estado is distinct from 'COMPLETADO'::public.command_estado then
      if v_command.tipo = 'ENROLL_USUARIO'::public.command_tipo then
        if v_command.user_id is null then
          raise exception using errcode = '22023', message = 'command_user_required';
        end if;
        if v_rfid is null then
          raise exception using errcode = '22023', message = 'rfid_uid_requerido';
        end if;
        if v_slot is null then
          raise exception using errcode = '22023', message = 'fingerprint_slot_requerido';
        end if;

        -- El bloque interno revierte ambos INSERT si cualquiera viola un
        -- UNIQUE; luego se traduce el error a un código claro para la API.
        begin
          insert into public.credentials (
            user_id, device_id, tipo, rfid_uid, fingerprint_template_id, activo
          ) values (
            v_command.user_id,
            p_device_id,
            'RFID'::public.credential_tipo,
            v_rfid,
            null,
            true
          );

          insert into public.credentials (
            user_id, device_id, tipo, rfid_uid, fingerprint_template_id, activo
          ) values (
            v_command.user_id,
            p_device_id,
            'HUELLA'::public.credential_tipo,
            null,
            v_slot,
            true
          );
        exception
          when unique_violation then
            get stacked diagnostics v_constraint = constraint_name;
            if v_constraint = 'credentials_device_rfid_uid_key' then
              raise exception using errcode = '23505', message = 'rfid_uid_ya_registrado';
            elsif v_constraint = 'credentials_device_fingerprint_template_id_key' then
              raise exception using errcode = '23505', message = 'fingerprint_slot_ya_registrado';
            else
              raise;
            end if;
        end;
      elsif v_command.tipo = 'DELETE_HUELLA'::public.command_tipo then
        if v_slot is null then
          raise exception using errcode = '22023', message = 'fingerprint_slot_requerido';
        end if;

        update public.credentials
        set activo = false
        where device_id = p_device_id
          and tipo = 'HUELLA'::public.credential_tipo
          and fingerprint_template_id = v_slot
          and (v_command.user_id is null or user_id = v_command.user_id);
      end if;
    end if;

    update public.device_commands
    set estado = case
          when p_estado is null then estado
          else p_estado::public.command_estado
        end,
        paso = case when p_paso is null then paso else p_paso end,
        detalle = case when p_detalle is null then detalle else p_detalle end,
        completed_at = case
          when p_estado in ('COMPLETADO', 'FALLIDO')
            then coalesce(completed_at, now())
          else completed_at
        end
    where id = p_command_id
    returning * into v_command;
  end if;

  -- Solo hay un comando activo por dispositivo (índice parcial UNIQUE), pero
  -- se usa SKIP LOCKED para tolerar llamadas concurrentes del mismo equipo.
  select *
    into v_next
  from public.device_commands
  where device_id = p_device_id
    and estado = 'PENDIENTE'::public.command_estado
    and expires_at > now()
  order by created_at asc, id asc
  limit 1
  for update skip locked;

  if found then
    update public.device_commands
    set estado = 'EN_CURSO'::public.command_estado
    where id = v_next.id
    returning * into v_next;

    v_result := jsonb_build_object(
      'id', v_next.id,
      'tipo', v_next.tipo,
      'fingerprint_slot', v_next.fingerprint_slot,
      'expires_at', v_next.expires_at
    );
  else
    v_result := null;
  end if;

  return v_result;
end;
$$;

revoke all on function public.sync_device_commands(
  uuid, uuid, text, text, jsonb, text, integer
) from public, anon, authenticated;

grant execute on function public.sync_device_commands(
  uuid, uuid, text, text, jsonb, text, integer
) to service_role;
