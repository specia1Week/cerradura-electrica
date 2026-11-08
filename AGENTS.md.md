# AGENTS.md — Sistema de Control de Acceso Biométrico

## Contexto del proyecto
Sistema de control de acceso y asistencia para universidad con doble factor:
tarjeta RFID + huella dactilar. Validación biométrica LOCAL en el sensor R307.
El backend solo autoriza y registra. NUNCA se almacenan huellas crudas, solo
el fingerprint_template_id.

## Stack (DEFINITIVO — no proponer alternativas)
- DB: Supabase PostgreSQL
- Backend: Supabase Edge Functions (Deno + TypeScript)
- Frontend: Next.js 15 + TypeScript + Tailwind + shadcn/ui + Recharts
- Comunicación ESP32: HTTPS JSON con POST a Edge Function
- Auth dispositivos: header X-API-Key (hash SHA-256 guardado en DB)
- Auth panel: Supabase Auth (JWT)

## PROHIBIDO (pivote ya decidido)
No proponer ni generar: Docker, docker-compose, MQTT, Mosquitto, Redis,
NestJS, Prisma, Render, Railway. Esas fases fueron descartadas por tiempo.

## Hardware ESP32-WROOM-32 (pinout fijo)
- RC522 (SPI): SDA=5, SCK=18, MOSI=23, MISO=19, RST=21, 3.3V, GND
- R307 (UART2): TXD->GPIO16, RXD->GPIO17, TOUCH->GPIO4 (opcional)
- Relé SRD-05VDC: IN=GPIO25, VCC=5V, GND
- LED RGB cátodo común: R=GPIO26, G=GPIO27, B=GPIO14 (220-330Ω cada uno)
- Chapa 12V vía relé NO/COM con fuente 12V >=2A + diodo flyback

## Modelo de datos (PostgreSQL / Supabase)
- users: id uuid PK, nombre, documento unique, rol enum(DOCENTE,ESTUDIANTE,ADMIN),
  estado enum(ACTIVO,INACTIVO), created_at, updated_at
- devices: id uuid PK, mac unique, nombre, ubicacion, api_key_hash text,
  estado enum(ACTIVO,INACTIVO,MANTENIMIENTO), created_at, updated_at
- credentials: id uuid PK, user_id FK, device_id FK, tipo enum(RFID,HUELLA),
  rfid_uid text null, fingerprint_template_id int null, activo bool,
  created_at, updated_at
  - UNIQUE (device_id, rfid_uid)
  - UNIQUE (device_id, fingerprint_template_id)
- access_events: id uuid PK, event_uuid text UNIQUE (idempotencia),
  device_id FK, user_id FK null, rfid_uid null, fingerprint_template_id null,
  resultado enum(PERMITIDO,DENEGADO), motivo text null,
  occurred_at timestamptz, received_at timestamptz default now()
  - INDEX (device_id, occurred_at), (user_id, occurred_at)
- attendance: id uuid PK, user_id FK, device_id FK, access_event_id FK UNIQUE,
  fecha date, hora_entrada time, hora_salida time null, created_at, updated_at
  - INDEX (user_id, fecha)

## Contrato del evento (ESP32 -> Edge Function)
POST https://<proj>.supabase.co/functions/v1/access-webhook
Headers: Content-Type: application/json, X-API-Key: <device_key>
Body:
{
  "event_uuid": "uuid-v4",
  "device_id": "uuid",
  "rfid_uid": "A1B2C3D4",
  "fingerprint_template_id": 12,
  "occurred_at": "2026-11-06T08:15:30Z",
  "resultado": "PERMITIDO" | "DENEGADO",
  "motivo": null | "string"
}
Respuesta esperada: 200 OK (también si event_uuid duplicado).

## Reglas de trabajo
- Responder en español.
- No generar código fuera del alcance de la tarea pedida.
- No añadir dependencias sin justificar.
- Preferir soluciones mínimas y funcionales.
- SQL en snake_case; TypeScript en camelCase.
- Al terminar una tarea, listar archivos creados/modificados.