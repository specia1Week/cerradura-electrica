# AGENTS.md — Sistema de Control de Acceso Biométrico

## Contexto del proyecto
Sistema de control de acceso y asistencia para universidad con doble factor:
tarjeta RFID + huella dactilar. Validación biométrica LOCAL en el sensor R307.
El backend solo autoriza y registra. NUNCA se almacenan huellas crudas, solo
el fingerprint_template_id.

## Stack (DEFINITIVO — no proponer alternativas)
- DB: Supabase PostgreSQL (Producción)
- Backend: Supabase Edge Functions (Deno + TypeScript)
- Frontend: Next.js 15 + TypeScript + Tailwind + shadcn/ui + Recharts
- Comunicación ESP32: HTTPS JSON con POST a Edge Function (sin MQTT)
- Auth dispositivos: El ESP32 envía el API Key en texto plano por HTTPS. El backend calcula el hash SHA-256 y lo compara con la DB.
- Auth panel: Supabase Auth (JWT)

## PROHIBIDO (fases descartadas por tiempo)
No proponer ni generar: Docker, docker-compose, MQTT, Mosquitto, Redis,
NestJS, Prisma, Render, Railway.

## Estado Actual del Desarrollo (Fase Actual)
- ✅ Base de datos creada en Supabase (tablas y relaciones listas).
- ✅ Edge Function `access-webhook` aun en prueba (no responde 200 OK).
- ✅ Configuración de Supabase: "Enforce JWT Verification" desactivado para esta función.
- 🔄 ESP32: Código base de conexión WiFi probado. Integrando sensores RFID y R307.
- ⏳ Frontend Next.js: Pendiente.

## Hardware ESP32-WROOM-32 (pinout fijo)
- RC522 (SPI): SDA=5, SCK=18, MOSI=23, MISO=19, RST=21, 3.3V, GND
- R307 (UART2): TXD->GPIO16, RXD->GPIO17, TOUCH->GPIO4 (opcional)
- Relé SRD-05VDC: IN=GPIO25, VCC=5V, GND (Activa en LOW)
- LED RGB cátodo común: R=GPIO26, G=GPIO27, B=GPIO14 (PWM, 220-330Ω cada uno)
- Chapa 12V: Fuente externa 12V >=2A + diodo flyback. Relé conmuta el positivo al NO (Normalmente Abierto).

## Lógica de Operación (ESP32)
1. Reposo: LED Rojo.
2. Acercan tarjeta RFID: Lee UID.
3. Validación: LED Amarillo, pide huella dactilar en R307 (espera máx 10 seg).
4. Acceso Concedido: LED Verde, activa Relé 3 segundos, envía JSON a Supabase.
5. Acceso Denegado: LED Rojo intermitente, envía JSON con resultado DENEGADO.

## Modelo de datos (PostgreSQL / Supabase)
- users: id uuid PK, nombre, documento unique, rol enum(DOCENTE,ESTUDIANTE,ADMIN), estado enum(ACTIVO,INACTIVO), created_at, updated_at
- devices: id uuid PK, mac unique, nombre, ubicacion, api_key_hash text, estado enum(ACTIVO,INACTIVO,MANTENIMIENTO), created_at, updated_at
- credentials: id uuid PK, user_id FK, device_id FK, tipo enum(RFID,HUELLA), rfid_uid text null, fingerprint_template_id int null, activo bool, created_at, updated_at
  - UNIQUE (device_id, rfid_uid)
  - UNIQUE (device_id, fingerprint_template_id)
- access_events: id uuid PK, event_uuid text UNIQUE (idempotencia), device_id FK, user_id FK null, rfid_uid null, fingerprint_template_id null, resultado enum(PERMITIDO,DENEGADO), motivo text null, occurred_at timestamptz, received_at timestamptz default now()
- attendance: id uuid PK, user_id FK, device_id FK, access_event_id FK UNIQUE, fecha date, hora_entrada time, hora_salida time null, created_at, updated_at

## Contrato del evento (ESP32 -> Edge Function)
POST https://fotujrqdappkspsygngt.supabase.co/functions/v1/access-webhook
Headers: 
  - Content-Type: application/json
  - X-API-Key: <device_key_en_texto_plano> (Ej: "test")

Body:
{
  "event_uuid": "uuid-v4", 
  "rfid_uid": "A1B2C3D4",
  "fingerprint_template_id": 12,
  "occurred_at": "2026-11-06T08:15:30Z",
  "resultado": "PERMITIDO",
  "motivo": null
}
*Nota: El `device_id` NO se envía desde el ESP32. La Edge Function lo deduce a partir del `X-API-Key`.*

Respuesta esperada: 200 OK (también si event_uuid duplicado).

## Reglas de trabajo
- Responder en español.
- No generar código fuera del alcance de la tarea pedida.
- Preferir soluciones mínimas y funcionales (Arduino IDE estándar).
- En el ESP32, usar HTTPS con NTP (sincronización de hora) para evitar errores -1 de conexión.

## Esquema de conecciones

Componente	Pin del Componente	Pin del ESP32	Notas
RC522 (RFID)	SDA / SS	GPIO 5	
SCK	GPIO 18	
MOSI	GPIO 23	
MISO	GPIO 19	
RST	GPIO 21	
3.3V	3.3V	⚠️ ¡Solo 3.3V, 5V lo quema!
GND	GND	
R307 (Huella)	TXD	GPIO 16 (RX2)	
RXD	GPIO 17 (TX2)	
VCC	5V (VIN)	Mejor 5V para el LED óptico
GND	GND	
Relé	IN	GPIO 25	
VCC	5V (VIN)	
GND	GND	
LED RGB	Rojo (R)	GPIO 26	Con resistencia 220Ω a GND
Verde (G)	GPIO 27	Con resistencia 220Ω a GND
Azul (B)	GPIO 14	Con resistencia 220Ω a GND
Cátodo (más largo)	GND
