<!-- Última modificación: 2026-11-17 -->

# CHANGELOG

## 2026-11-17 — Verificación contra Supabase y Vercel

**Estado real:** el panel desplegado en `https://cerradura-electrica.vercel.app` autentica, protege rutas y permite crear, editar, desactivar y eliminar usuarios y dispositivos. También se probaron el enrolamiento (inicio, cancelación y finalización), los eventos con filtros y la exportación CSV. El proyecto Supabase ya tiene las migraciones del panel, `profiles`, `access_events.intentos_huella` y el webhook operativo. Quedan dos bloqueos de infraestructura: la Edge Function `device-sync` no está desplegada (HTTP 404) y la migración `20261109000100_device_sync.sql` no está aplicada (`sync_device_commands` no existe), por lo que el ESP32 todavía no puede sincronizar ni completar comandos reales.

### Cambios

- Se agregó `prefetch={false}` al enlace de exportación CSV para evitar el `401` del prefetch RSC; la descarga real responde `200` con `text/csv`.
- El progreso de enrolamiento refresca la página al pasar a un estado terminal para actualizar la lista de credenciales activas.
- Las pruebas E2E se hicieron con una cuenta administrativa temporal, eliminada al finalizar, y datos de prueba también eliminados.

### Verificación

- Login en Vercel: OK; `/dashboard` sin sesión redirige a `/login`.
- `/usuarios`: crear, editar, desactivar, activar y eliminar: OK.
- `/dispositivos`: crear, rotar API key y eliminar: OK; la clave se muestra una sola vez.
- `/usuarios/[id]/enrolar`: inicio, cancelación y finalización simulada: OK; el comando y las credenciales se reflejan en la UI.
- `/eventos`: columna **Intentos de huella**, filtro por motivo y paginación: OK con evento de prueba.
- `/dashboard`: tarjeta **Denegados por huella (hoy)**: OK con evento de prueba.
- `/asistencia` y `/api/asistencia/export`: página y CSV autenticado: OK.
- `access-webhook`: responde `400 invalid_payload` con payload inválido y `200` con un evento válido; guarda el evento y actualiza el dispositivo.
- `device-sync`: `404 Requested function was not found`; bloquea la finalización real de comandos.
- `sync_device_commands`: `PGRST202`; falta aplicar `supabase/migrations/20261109000100_device_sync.sql`.
- `intentos_huella`: el webhook no lo recibe ni lo persiste; los eventos reales quedan en `0` y los motivos biométricos solicitados no se generan todavía desde el firmware.
- `npm.cmd run typecheck`, `npm.cmd run lint` y `npm.cmd run build`: OK.

### Integración de `intentos_huella` (código local)

- `supabase/functions/access-webhook` acepta `intentos_huella`, lo envía a `record_access_event`, conserva las denegaciones locales del ESP32 y acepta `fingerprint_template_id: null` cuando la denegación ocurre sin una huella identificada.
- Se normalizaron los motivos del panel (`TARJETA_NO_REGISTRADA`, `HUELLA_OTRO_USUARIO`, `TIMEOUT_BACKEND`, `HUELLA_NO_RECONOCIDA_3_INTENTOS`) y se mantienen alias para el historial anterior.
- Se agregó compatibilidad temporal en el webhook: si la migración nueva aún no está aplicada, registra el evento con la función anterior y actualiza `intentos_huella` después.
- El firmware cuenta los intentos fallidos, envía un evento `DENEGADO` al llegar a 3 y agrega `intentos_huella` a todos los eventos. En denegaciones sin huella identificada envía `fingerprint_template_id: null`.
- Se corrigieron los placeholders del portal de configuración del ESP32 con la URL real del proyecto.
- `supabase/migrations/20261117000000_access_webhook_intentos.sql`: pendiente de aplicar en Supabase.
- Verificación local: `deno check` del webhook, `npm.cmd run typecheck` y `npm.cmd run lint`: OK.
- Pendiente de despliegue: aplicar la migración, redesplegar `access-webhook`, flashear el firmware y repetir el flujo físico.

## 2026-11-10 — Integración del panel con Supabase

**Estado real:** el panel compila con `npm.cmd run build`, pasa `npm.cmd run typecheck` y `npm.cmd run lint`. La protección de rutas y el aviso de configuración quedaron implementados; la validación contra un proyecto Supabase real, las migraciones y las pruebas de acceso quedan pendientes de que se completen las credenciales y se ejecute el SQL.

### Cambios

- Se creó `apps/frontend/.env.local` con marcadores (sin valores reales) y se confirmó que está ignorado por Git mediante `.gitignore` → regla `.env.*`.
- Se revisó el orden de las cuatro migraciones y se agregó `access_events.intentos_huella` a `supabase/migrations/20261109000200_panel.sql`.
- Se agregó `supabase/setup_admin.sql` para crear/actualizar el perfil `ADMIN` de un usuario de Authentication.
- El middleware ahora exige las tres variables de Supabase, valida que `profiles.rol` sea `ADMIN` u `OPERADOR` y redirige a `/login` cuando no hay sesión.
- El aviso de configuración del login solo se oculta cuando las tres variables tienen valores reales (los marcadores de `.env.example` no cuentan).
- `/eventos` muestra la columna **Intentos de huella** y el filtro por los seis motivos solicitados.
- `/dashboard` muestra la tarjeta **Denegados por huella (hoy)**.
- Se agregó ESLint y el script `npm.cmd run lint`.

### Verificación

- `npm.cmd run typecheck`: OK.
- `npm.cmd run lint`: OK, sin warnings.
- `npm.cmd run build`: OK con Next.js 15.5.29.
- Búsqueda de `SUPABASE_SERVICE_ROLE_KEY` en archivos `use client` y en `.next/static`: sin referencias.
- No se ejecutaron migraciones ni pruebas contra Supabase porque no hay credenciales reales en el entorno.
