<!-- Última modificación: 2026-11-10 -->

# CHANGELOG

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
