# Edge Function `device-sync`

Sincronización del ESP32 con Supabase. Sustituye la necesidad de MQTT: el
dispositivo hace `POST` HTTPS con su `X-API-Key`, actualiza su estado y recibe
el siguiente comando pendiente.

## Autenticación

- Header obligatorio: `X-API-Key: <api_key_en_texto_plano>`.
- La función calcula `SHA-256` en minúsculas y lo compara con
  `devices.api_key_hash` (mismo método que `access-webhook`).
- Solo se aceptan dispositivos con `estado = 'ACTIVO'`.
- El ESP32 **nunca** usa la `service_role` key.

## Contrato

### Request

```json
{
  "firmware": "1.0.0",
  "rssi": -62,
  "ip": "192.168.1.50",
  "command_id": "uuid-opcional",
  "estado": "EN_CURSO | COMPLETADO | FALLIDO",
  "paso": "texto-opcional",
  "detalle": { "clave": "valor" },
  "rfid_uid": "E2001234",
  "fingerprint_slot": 20
}
```

- `firmware`, `rssi` e `ip` son obligatorios.
- `command_id` y los campos de comando son opcionales.
- Si se envía `estado`, `paso`, `detalle`, `rfid_uid` o `fingerprint_slot`,
  también debe enviarse `command_id`.
- `firmware` máx. 64 caracteres, `ip` máx. 64, `paso` máx. 120,
  `rfid_uid` máx. 64.
- `detalle` debe ser un objeto JSON (`Record<string, unknown>`).
- `rssi` entero entre `-127` y `0`.
- `fingerprint_slot` entero entre `1` y `999`.

### Response 200

```json
{
  "server_time": "2026-11-09T12:34:56.789Z",
  "command": {
    "id": "uuid",
    "tipo": "ENROLL_USUARIO",
    "fingerprint_slot": 20,
    "expires_at": "2026-11-09T12:39:56.789Z"
  }
}
```

Si no hay comandos pendientes:

```json
{
  "server_time": "2026-11-09T12:34:56.789Z",
  "command": null
}
```

El comando `PENDIENTE` más antiguo se devuelve y se marca como `EN_CURSO` en la
misma transacción.

### Errores

| HTTP | `error` | Causa |
|---|---|---|
| 400 | `invalid_payload` | Tipos o campos obligatorios incorrectos |
| 400 | `command_id_requerido` | Campos de comando sin `command_id` |
| 400 | `rfid_uid_requerido` | `ENROLL_USUARIO` completado sin UID |
| 400 | `fingerprint_slot_requerido` | Comando completado sin slot |
| 400 | `fingerprint_slot_mismatch` | Slot distinto al reservado por el comando |
| 401 | `api_key_invalida` | API key incorrecta o dispositivo inactivo |
| 404 | `command_not_found` | Comando inexistente o de otro dispositivo |
| 409 | `rfid_uid_ya_registrado` | `UNIQUE(device_id, rfid_uid)` |
| 409 | `fingerprint_slot_ya_registrado` | `UNIQUE(device_id, fingerprint_template_id)` |
| 409 | `command_not_active` | Intento de reactivar un comando terminal |
| 409 | `command_already_completed` | Intento de degradar un comando ya completado |
| 500 | `database_error` | Error de base de datos |

## Despliegue

```bash
# 1. Aplicar la migración que crea sync_device_commands
supabase db push

# 2. Desplegar sin JWT de Supabase: la autenticación es X-API-Key
supabase functions deploy device-sync --no-verify-jwt
```

> Si se despliega desde el dashboard, desactivar "Enforce JWT Verification"
> para esta función, igual que en `access-webhook`.

## Pruebas curl

### Variables

Bash / Git Bash / WSL:

```bash
export SUPABASE_URL="https://fotujrqdappkspsygngt.supabase.co"
export DEVICE_API_KEY="test"
```

PowerShell:

```powershell
$env:SUPABASE_URL = "https://fotujrqdappkspsygngt.supabase.co"
$env:DEVICE_API_KEY = "test"
```

En PowerShell usa `curl.exe` (no el alias `curl`) y las variables `$env:...`.
Ejemplo de una sola línea:

```powershell
curl.exe -sS -i -X POST "$env:SUPABASE_URL/functions/v1/device-sync" -H "Content-Type: application/json" -H "X-API-Key: $env:DEVICE_API_KEY" -d '{"firmware":"1.0.0","rssi":-62,"ip":"192.168.1.50"}'
```

En los ejemplos siguientes, para PowerShell sustituye `$SUPABASE_URL` por
`$env:SUPABASE_URL` y `$DEVICE_API_KEY` por `$env:DEVICE_API_KEY`. La
continuación de línea de Bash (`\`) se cambia por un backtick (`` ` ``) o se
deja todo en una sola línea.

### 1. Heartbeat sin comando pendiente

```bash
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/device-sync" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DEVICE_API_KEY" \
  -d '{"firmware":"1.0.0","rssi":-62,"ip":"192.168.1.50"}'
```

Respuesta esperada:

```json
{
  "server_time": "2026-11-09T12:34:56.789Z",
  "command": null
}
```

### 2. Polling con un comando pendiente

Al existir un `device_commands` en `PENDIENTE`, la misma llamada devuelve y
reserva el comando:

```json
{
  "server_time": "2026-11-09T12:34:56.789Z",
  "command": {
    "id": "11111111-1111-4111-8111-111111111111",
    "tipo": "ENROLL_USUARIO",
    "fingerprint_slot": 20,
    "expires_at": "2026-11-09T12:39:56.789Z"
  }
}
```

### 3. Reportar progreso

Sustituir `<COMMAND_ID>` por el `id` recibido:

```bash
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/device-sync" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DEVICE_API_KEY" \
  -d '{"firmware":"1.0.0","rssi":-61,"ip":"192.168.1.50","command_id":"<COMMAND_ID>","estado":"EN_CURSO","paso":"ESPERANDO_HUELLA"}'
```

### 4. Completar `ENROLL_USUARIO`

Crea atómicamente la credencial RFID y la credencial HUELLA para el `user_id`
del comando:

```bash
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/device-sync" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DEVICE_API_KEY" \
  -d '{"firmware":"1.0.0","rssi":-61,"ip":"192.168.1.50","command_id":"<COMMAND_ID>","estado":"COMPLETADO","paso":"OK","detalle":{"intentos":2},"rfid_uid":"E2001234","fingerprint_slot":20}'
```

Respuesta esperada: `200` con `command` igual a `null` o al siguiente comando
pendiente.

### 5. Completar `DELETE_HUELLA`

Desactiva (`activo = false`) la credencial HUELLA del usuario/slot del comando:

```bash
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/device-sync" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DEVICE_API_KEY" \
  -d '{"firmware":"1.0.0","rssi":-60,"ip":"192.168.1.50","command_id":"<DELETE_COMMAND_ID>","estado":"COMPLETADO","paso":"OK","fingerprint_slot":13}'
```

### 6. UID RFID ya registrado

Con el seed de pruebas, `A1B2C3D4` ya pertenece al usuario uno. Si se intenta
completar un `ENROLL_USUARIO` para otro usuario con ese UID:

```bash
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/device-sync" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DEVICE_API_KEY" \
  -d '{"firmware":"1.0.0","rssi":-60,"ip":"192.168.1.50","command_id":"<COMMAND_ID_OTRO_USUARIO>","estado":"COMPLETADO","paso":"OK","rfid_uid":"A1B2C3D4","fingerprint_slot":21}'
```

Respuesta esperada:

```json
{
  "error": "rfid_uid_ya_registrado",
  "message": "El UID RFID ya está registrado en este dispositivo."
}
```

HTTP `409`. Ninguna de las dos credenciales se inserta.

### 7. API key inválida

```bash
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/device-sync" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: incorrecta" \
  -d '{"firmware":"1.0.0","rssi":-62,"ip":"192.168.1.50"}'
```

Respuesta esperada: HTTP `401` con `"error": "api_key_invalida"`.

### 8. Payload inválido

```bash
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/device-sync" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DEVICE_API_KEY" \
  -d '{"firmware":"1.0.0","ip":"192.168.1.50"}'
```

Respuesta esperada: HTTP `400` con `"error": "invalid_payload"` porque falta
`rssi`.

## Crear comandos de prueba (SQL Editor)

Los comandos normalmente los crea el panel. Para probar manualmente, ejecutar
en el SQL Editor de Supabase. `<AUTH_USER_UUID>` debe ser un usuario real de
`auth.users` (admin/operador), porque `created_by` tiene FK a `auth.users`.

Comando `ENROLL_USUARIO` para el usuario de prueba dos, slot libre 20:

```sql
insert into public.device_commands (
  device_id, tipo, user_id, fingerprint_slot, created_by
)
select d.id, 'ENROLL_USUARIO', u.id, 20, '<AUTH_USER_UUID>'
from public.devices d
join public.users u on u.documento = 'TEST-ACCESS-002'
where d.mac = '02:00:00:00:00:01'
returning id;
```

Comando `DELETE_HUELLA` para el slot 13 del usuario de prueba dos:

```sql
insert into public.device_commands (
  device_id, tipo, user_id, fingerprint_slot, created_by
)
select d.id, 'DELETE_HUELLA', u.id, 13, '<AUTH_USER_UUID>'
from public.devices d
join public.users u on u.documento = 'TEST-ACCESS-002'
where d.mac = '02:00:00:00:00:01'
returning id;
```

> Solo puede existir un comando activo (`PENDIENTE`/`EN_CURSO`) por dispositivo.
> Completa o cancela el anterior antes de insertar otro.

## Verificación en base de datos

```sql
-- Tras completar ENROLL_USUARIO
select user_id, tipo, rfid_uid, fingerprint_template_id, activo
from public.credentials
where device_id = (
  select id from public.devices where mac = '02:00:00:00:00:01'
)
order by created_at desc;

-- Estado de los comandos
select id, tipo, estado, paso, detalle, fingerprint_slot, completed_at
from public.device_commands
order by created_at desc;
```
