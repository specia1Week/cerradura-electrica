-- Datos de prueba para access-webhook. La API key en texto plano es "test".
-- Ejecuta este seed únicamente en un proyecto de pruebas.
do $$
declare
  v_device_id uuid;
  v_user_one_id uuid;
  v_user_two_id uuid;
begin
  insert into public.devices (
    id, mac, nombre, ubicacion, api_key_hash, estado
  ) values (
    '10000000-0000-4000-8000-000000000001',
    '02:00:00:00:00:01',
    'ESP32 de prueba',
    'Laboratorio de pruebas',
    encode(digest(convert_to('test', 'UTF8'), 'sha256'), 'hex'),
    'ACTIVO'
  )
  on conflict (mac) do update set
    nombre = excluded.nombre,
    ubicacion = excluded.ubicacion,
    api_key_hash = excluded.api_key_hash,
    estado = excluded.estado
  returning id into v_device_id;

  insert into public.users (id, nombre, documento, rol, estado)
  values (
    '20000000-0000-4000-8000-000000000001',
    'Test Usuario Uno',
    'TEST-ACCESS-001',
    'ESTUDIANTE',
    'ACTIVO'
  )
  on conflict (documento) do update set
    nombre = excluded.nombre,
    rol = excluded.rol,
    estado = excluded.estado
  returning id into v_user_one_id;

  insert into public.users (id, nombre, documento, rol, estado)
  values (
    '20000000-0000-4000-8000-000000000002',
    'Test Usuario Dos',
    'TEST-ACCESS-002',
    'ESTUDIANTE',
    'ACTIVO'
  )
  on conflict (documento) do update set
    nombre = excluded.nombre,
    rol = excluded.rol,
    estado = excluded.estado
  returning id into v_user_two_id;

  insert into public.credentials (
    id, user_id, device_id, tipo, rfid_uid, fingerprint_template_id, activo
  ) values
    (
      '30000000-0000-4000-8000-000000000001', v_user_one_id, v_device_id,
      'RFID', 'A1B2C3D4', null, true
    ),
    (
      '30000000-0000-4000-8000-000000000002', v_user_one_id, v_device_id,
      'HUELLA', null, 12, true
    ),
    (
      '30000000-0000-4000-8000-000000000003', v_user_two_id, v_device_id,
      'HUELLA', null, 13, true
    )
  on conflict (id) do update set
    user_id = excluded.user_id,
    device_id = excluded.device_id,
    tipo = excluded.tipo,
    rfid_uid = excluded.rfid_uid,
    fingerprint_template_id = excluded.fingerprint_template_id,
    activo = excluded.activo;
end;
$$;
