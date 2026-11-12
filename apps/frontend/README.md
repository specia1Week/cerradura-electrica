# Panel de control de acceso

Panel web del sistema de control de acceso y asistencia biométrico. Está construido con el stack definido en `AGENTS.md`:

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS + componentes estilo shadcn/ui sobre Radix
- Recharts
- Supabase Auth con `@supabase/ssr`
- Supabase PostgreSQL + Edge Functions existentes (`access-webhook`, `device-sync`)

## 1. Configuración

### Variables de entorno

```powershell
Copy-Item .env.example .env.local
```

Completar:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

`SUPABASE_SERVICE_ROLE_KEY` se usa **únicamente** en Server Actions y Route Handlers (`src/lib/supabase/admin.ts`). Nunca debe tener el prefijo `NEXT_PUBLIC` ni importarse desde un componente cliente.

### Migraciones

Aplicar las migraciones existentes y la nueva migración del panel:

```text
supabase/migrations/0001_init.sql
supabase/migrations/20261109000000_access_webhook_commands.sql
supabase/migrations/20261109000100_device_sync.sql
supabase/migrations/20261109000200_panel.sql
```

La última migración:

- agrega índices para dashboard, eventos y asistencia;
- publica `device_commands` en `supabase_realtime`;
- configura `replica identity full` para que el panel reciba `paso`, `estado` y `detalle` en los UPDATE.

Sin la publicación de Realtime el seguimiento funciona igual mediante polling cada 5 segundos, pero el progreso no será instantáneo.

### Crear el primer acceso al panel

1. Crear el usuario en **Supabase Dashboard → Authentication → Users** (email + password, email confirmado).
2. Crear su perfil con rol `ADMIN` u `OPERADOR`:

```sql
insert into public.profiles (id, rol)
select id, 'ADMIN'::public.profile_rol
from auth.users
where email = 'admin@universidad.edu'
on conflict (id) do update set rol = excluded.rol;
```

Cada persona que ingrese al panel necesita una fila en `profiles`. El middleware cierra la sesión de cualquier usuario autenticado que no tenga perfil autorizado.

## 2. Ejecutar

```powershell
npm.cmd install
npm.cmd run dev
```

Abrir [http://localhost:3000](http://localhost:3000). El acceso redirige a `/login`.

Comandos de verificación:

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run start
```

No se usa Docker para el panel.

## 3. Páginas

| Ruta | Descripción |
|---|---|
| `/login` | Supabase Auth con email/contraseña. |
| `/dashboard` | Accesos de hoy, denegados, dispositivos online y gráfico por hora. |
| `/usuarios` | CRUD de usuarios, activación/desactivación y borrado programado de huellas. |
| `/dispositivos` | CRUD de lectores, API key aleatoria mostrada una vez, rotación y telemetría. |
| `/usuarios/[id]/enrolar` | Reserva de slot, comando `ENROLL_USUARIO` y progreso en tiempo real. |
| `/eventos` | Historial paginado con filtros por fecha, dispositivo, usuario y resultado. |
| `/asistencia` | Reporte por rango de fechas/usuario y exportación CSV. |

## 4. Reglas de operación

- **Dispositivo en línea:** `last_seen_at` menor a 30 segundos.
- **Enrolamiento:** solo se puede iniciar en un dispositivo activo, en línea y sin otro comando `PENDIENTE`/`EN_CURSO`.
- **Slot:** se reserva con `reserve_fingerprint_slot(p_device_id)` usando service role; el rango es 1–999.
- **Expiración:** el comando vence a los 5 minutos. El panel muestra la cuenta regresiva y llama a `expireEnrollment` si corresponde; `device-sync` también lo expira en el siguiente heartbeat.
- **Cancelación:** cambia el comando a `CANCELADO`. Si el dispositivo ya guardó la huella, debe eliminarla al recibir el rechazo del backend.
- **Desactivar usuario:** crea un comando `DELETE_HUELLA` por cada credencial de huella activa, con una ventana de 7 días para que el lector lo reciba aunque esté temporalmente offline. Al reactivar, se cancelan los borrados que todavía estén `PENDIENTE`. Si el dispositivo ya tiene un comando activo, ese borrado se omite y se informa en el resultado.
- **API keys:** se generan con 32 bytes aleatorios y se guarda solo el SHA-256. La clave en texto plano se muestra una única vez al crear o rotar.
- **Asistencia:** el backend calcula entrada/salida; el panel solo consulta y exporta. Zona horaria: `America/La_Paz`.

## 5. Seguridad

- El middleware protege todas las rutas del panel, refresca la sesión de Supabase y verifica `profiles.rol`.
- El login valida que el usuario tenga perfil antes de redirigir.
- Los reads usan el cliente autenticado y respetan RLS.
- Las mutaciones que requieren permisos elevados usan service role solo dentro de Server Actions (`src/lib/actions/*`).
- El Route Handler de CSV valida la sesión y el perfil antes de exportar.
- No se almacenan huellas crudas ni templates biométricos en el panel; solo se muestran los slots reportados por el dispositivo.
- `apps/frontend/Dockerfile` es un remanente de la fase inicial y no forma parte del flujo de este panel.

## 6. Problemas frecuentes

**El login redirige con “sin perfil”.**  
Falta la fila en `profiles` o el middleware no pudo leerla. Ejecutar el SQL de la sección 1 y volver a ingresar.

**El enrolamiento dice “dispositivo sin conexión”.**  
El ESP32 debe estar enviando `device-sync` cada 3 segundos. Verificar WiFi, URL, API key y que `last_seen_at` se actualice.

**El progreso no cambia en tiempo real.**  
Comprobar que se aplicó `20261109000200_panel.sql` y que Realtime está habilitado para `device_commands`. El panel igualmente consulta el estado cada 5 segundos.

**El CSV no descarga.**  
La ruta `/api/asistencia/export` exige sesión y perfil válidos. Revisar la consola del servidor y las variables de entorno.

**La API key se perdió.**  
Rotarla desde `/dispositivos`. La clave anterior deja de funcionar inmediatamente; actualizar el ESP32 por el portal cautivo.
