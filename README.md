# Sistema de Control de Acceso y Asistencia Biométrico

Monorepo del sistema de control de acceso para universidad, basado en **RFID + huella dactilar** con validación biométrica local en el lector R307 y backend centralizado para autorización, registro y asistencia.

> **Estado actual: Fase 0 — infraestructura base.**
> Solo existen esqueletos compilables de backend/frontend y la infraestructura Docker de desarrollo. No hay lógica de negocio, MQTT funcional, modelos Prisma, endpoints ni panel implementado.

---

## 1. Requisitos previos

| Herramienta | Versión recomendada |
|---|---|
| Docker Engine / Docker Desktop | 24+ |
| Docker Compose | v2 (`docker compose`) |
| Git | 2.40+ |
| Node.js (solo desarrollo local sin Docker) | 22 LTS |
| OpenSSL (generar secretos) | 3.x |

Verificar:

```bash
docker --version
docker compose version
node --version
```

> En Windows se recomienda Docker Desktop con WSL 2 habilitado.

---

## 2. Estructura del monorepo

```text
.
├── apps/
│   ├── backend/                 # NestJS + TypeScript (esqueleto Fase 0)
│   │   ├── prisma/              # Reservado para schema/migraciones (Fase 1+)
│   │   ├── src/
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── Dockerfile           # Build multi-stage
│   │   ├── nest-cli.json
│   │   ├── package-lock.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsconfig.build.json
│   └── frontend/                # Next.js 15 + TypeScript + Tailwind (esqueleto)
│       ├── public/
│       ├── src/app/
│       │   ├── globals.css
│       │   ├── layout.tsx
│       │   └── page.tsx
│       ├── Dockerfile           # Build multi-stage, output standalone
│       ├── next.config.ts
│       ├── package-lock.json
│       ├── package.json
│       ├── postcss.config.mjs
│       ├── tailwind.config.ts
│       └── tsconfig.json
├── docs/                        # Documentación técnica
│   ├── README.md
│   └── mqtt-topics.md
├── firmware/                    # Reservado para ESP32 (Fase 2+)
├── infra/
│   ├── mosquitto/
│   │   └── passwd               # Generado localmente, NO versionado
│   ├── Caddyfile                # Referencia TLS para producción (futuro)
│   ├── docker-compose.yml       # Entorno de desarrollo
│   └── mosquitto.conf           # Broker MQTT de desarrollo
├── .env.example
├── .gitignore
└── README.md
```

Los archivos `package-lock.json` de cada app se versionan para builds reproducibles.

---

## 3. Cómo levantar el entorno

### 3.1 Crear y configurar `.env`

Linux/macOS:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Editar `.env` y **reemplazar todos los valores `change_me_*`**. Mantener sincronizadas las credenciales con sus URLs internas:

- `POSTGRES_*` ↔ `DATABASE_URL`
- `REDIS_PASSWORD` ↔ `REDIS_URL`
- `MQTT_URL` es la única fuente de configuración MQTT del backend.
- `MQTT_USERNAME` / `MQTT_PASSWORD` se usan para Mosquitto y para generar `passwd`.

Generar un `JWT_SECRET` seguro:

```bash
openssl rand -hex 32
```

Usar contraseñas de desarrollo con caracteres URL-safe (letras, números, `-` y `_`) para evitar problemas de escape en las URLs.

### 3.2 Crear el usuario de Mosquitto (obligatorio antes del primer arranque)

El broker tiene `allow_anonymous false` y requiere un archivo `infra/mosquitto/passwd`. Ese archivo **no se versiona**. Créalo con las mismas credenciales `MQTT_USERNAME` / `MQTT_PASSWORD` definidas en `.env`.

Desde la **raíz del repositorio**, Windows PowerShell:

```powershell
docker run --rm -v "${PWD}/infra/mosquitto:/mosquitto/config" eclipse-mosquitto:2.0.20 sh -c "mosquitto_passwd -c -b /mosquitto/config/passwd access_backend 'change_me_mqtt' && chmod 644 /mosquitto/config/passwd"
```

El directorio `infra/mosquitto/` debe existir antes de ejecutar el comando; el
archivo `.gitkeep` incluido lo mantiene en el repositorio. Si `passwd` no
existe al levantar el entorno, Mosquitto fallará con `Error: Unable to open
password file`.

Linux/macOS:

```bash
docker run --rm -v "$PWD/infra/mosquitto:/mosquitto/config" eclipse-mosquitto:2.0.20 sh -c "mosquitto_passwd -c -b /mosquitto/config/passwd access_backend 'change_me_mqtt' && chmod 644 /mosquitto/config/passwd"
```

Sustituir `access_backend` y `change_me_mqtt` por los valores reales de `.env`.

- `-c` crea/sobrescribe el archivo.
- Para añadir otro usuario sin borrar los existentes, omitir `-c`.
- `chmod 644` permite que el usuario `mosquitto` del contenedor lea el archivo.

### 3.3 Construir y arrancar

Desde la raíz del repositorio:

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

Ver estado y salud de los servicios:

```bash
docker compose --env-file .env -f infra/docker-compose.yml ps
```

Ver logs:

```bash
docker compose --env-file .env -f infra/docker-compose.yml logs -f
```

Servicios y puertos de desarrollo:

| Servicio | URL / puerto host | Acceso |
|---|---|---|
| Frontend Next.js | http://localhost:3001 | Solo loopback |
| Backend NestJS | http://localhost:3000 | Solo loopback (sin endpoints aún) |
| PostgreSQL 16 | `localhost:5432` | Solo loopback |
| Redis 7 | `localhost:6379` | Solo loopback |
| Mosquitto 2 | `localhost:1883` | LAN (configurable con `MQTT_BIND_IP`) |

> El backend arranca sin endpoints: en Fase 0 solo se valida que el proceso Nest escucha correctamente. El frontend muestra una página placeholder.

---

## 4. Topics MQTT preparados

El broker queda preparado para la convención de topics del sistema. El **QoS 1** se aplica en publicadores y suscriptores (el broker no impone QoS por topic).

| Topic | Dirección | QoS |
|---|---|---|
| `devices/{device_id}/access-events` | ESP32 → backend | 1 |
| `devices/{device_id}/heartbeat` | ESP32 → backend | 1 |

Suscripciones previstas del backend:

- `devices/+/access-events`
- `devices/+/heartbeat`

Contrato detallado en [`docs/mqtt-topics.md`](docs/mqtt-topics.md). Los payloads y su validación se definirán en fases posteriores.

---

## 5. Detener y limpiar

Detener servicios conservando datos:

```bash
docker compose --env-file .env -f infra/docker-compose.yml down
```

Detener y **eliminar volúmenes** (borra PostgreSQL, Redis y datos de Mosquitto):

```bash
docker compose --env-file .env -f infra/docker-compose.yml down -v
```

Eliminar también las imágenes construidas localmente:

```bash
docker compose --env-file .env -f infra/docker-compose.yml down -v --rmi local
```

> `down -v` es destructivo. Úsalo solo cuando quieras reiniciar el entorno desde cero.

---

## 6. Variables de entorno

Todas las variables están documentadas en [`.env.example`](.env.example). Resumen:

| Grupo | Variables |
|---|---|
| Proyecto | `COMPOSE_PROJECT_NAME`, `NODE_ENV`, `TZ` |
| PostgreSQL | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `DATABASE_URL` |
| Redis | `REDIS_PASSWORD`, `REDIS_PORT`, `REDIS_URL` |
| MQTT | `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_PORT`, `MQTT_BIND_IP`, `MQTT_URL`, `MQTT_TOPIC_*`, `MQTT_QOS` |
| Backend | `BACKEND_PORT`, `BACKEND_HOST`, `BACKEND_INTERNAL_URL`, `CORS_ORIGIN` |
| JWT | `JWT_SECRET`, `JWT_EXPIRES_IN` |
| Frontend | `FRONTEND_PORT`, `FRONTEND_INTERNAL_URL`, `NEXT_PUBLIC_API_URL` |
| TLS futuro | `DOMAIN`, `ACME_EMAIL` |

**Nunca** se versiona `.env` ni `infra/mosquitto/passwd`.

---

## 7. Decisiones de la Fase 0

- **Versiones de imágenes fijadas**, sin `:latest`:
  - `postgres:16.4-alpine`
  - `redis:7.4.1-alpine`
  - `eclipse-mosquitto:2.0.20`
  - `node:22.11.0-alpine`
  - `caddy:2.8.4-alpine` (referencia futura)
- **Healthchecks reales** y arranque ordenado con `condition: service_healthy`:
  - PostgreSQL: `pg_isready`
  - Redis: `redis-cli ping`
  - Mosquitto: publicación autenticada QoS 0, sin retención ni acumulación
  - Backend/Frontend: comprobación TCP del puerto
- **Red interna dedicada** `access_control_net`.
- **Volúmenes nombrados** persistentes para PostgreSQL, Redis y Mosquitto (datos).
- **Backend y frontend multi-stage**, ejecutados como usuario no root.
- **Caddyfile** incluido como referencia de TLS para producción; no se levanta en Fase 0.
- **Sin Prisma, sin MQTT en el backend, sin endpoints, sin JWT y sin componentes de negocio.** Se incorporarán en fases posteriores.

---

## 8. Seguridad (consideraciones)

- El ESP32 **nunca** se conecta directamente a PostgreSQL; solo publica eventos por MQTT.
- MQTT exige autenticación usuario/password; `allow_anonymous false`.
- En producción se migrará a EMQX y se evaluará **mTLS + API key/HMAC** para dispositivos.
- El panel usará **JWT con roles** (`admin`, `guardia`, `docente`).
- Los timestamps del ESP32 se sincronizarán por **NTP**.
- Los puertos de PostgreSQL, Redis, backend y frontend se publican solo en loopback durante desarrollo.
- La validación de huella es **local en el R307**; el backend solo almacenará `fingerprint_template_id`, nunca plantillas crudas.
- `access_events.event_uuid` será `UNIQUE` para idempotencia (Fase 1).

---

## 9. Fuera del alcance de la Fase 0

- Modelos Prisma, migraciones y seeds.
- Microservicio MQTT con `@EventPattern`.
- Autenticación JWT, roles, guards y rate limiting con Redis.
- Endpoints REST/GraphQL.
- Panel Next.js funcional, shadcn/ui y Recharts.
- Firmware ESP32, cola offline NVS/SPIFFS y store-and-forward.
- TLS productivo con Caddy/Nginx, EMQX y despliegue en servidor.

Estos puntos se implementarán en fases posteriores sobre esta base.
