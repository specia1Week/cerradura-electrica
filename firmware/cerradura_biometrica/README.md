# Cerradura biométrica ESP32

Firmware en un único `.ino` para la cerradura universitaria con doble factor:

1. Tarjeta RFID MFRC522.
2. Huella dactilar R307 (búsqueda y enrolamiento locales).
3. Autorización final en Supabase (`access-webhook`).
4. Latido y comandos remotos en Supabase (`device-sync`).

La huella nunca se envía al backend: solo se envía el `fingerprint_template_id`
del slot que coincidió localmente.

---

## 1. Hardware y cableado

### MFRC522 (RFID)

| MFRC522 | ESP32-WROOM-32 |
| --- | --- |
| SDA / SS | GPIO5 |
| SCK | GPIO18 |
| MOSI | GPIO23 |
| MISO | GPIO19 |
| RST | GPIO21 |
| 3.3V | 3.3V |
| GND | GND |

> **Importante:** el RC522 funciona a **3.3 V**. No alimentarlo con 5 V.
> Comparte el bus SPI con otros dispositivos; el pin SS es exclusivo del RC522.

### R307 (huella)

| R307 | ESP32-WROOM-32 |
| --- | --- |
| VCC | 5V |
| GND | GND |
| TXD | GPIO16 (RX2) |
| RXD | GPIO17 (TX2) |
| TOUCH (opcional) | GPIO4 |

La comunicación es UART a **57600 baudios**. El pin TOUCH no es necesario para
el flujo actual.

### Relé

| Relé | ESP32 |
| --- | --- |
| IN | GPIO25 |
| VCC | 5V (según el módulo) |
| GND | GND |

El relé es **activo en LOW**: el firmware pone el pin en HIGH antes de
configurarlo como salida para que arranque cerrado. Para una cerradura real,
usa un módulo con optoacoplador/transistor y un diodo de rueda libre si la
bobina lo requiere. Añade una resistencia pull-up de 10 kΩ en `IN` a 3.3 V si
el módulo no la incorpora.

### LED RGB

| LED | ESP32 |
| --- | --- |
| R | GPIO26 |
| G | GPIO27 |
| B | GPIO14 |
| Cátodo común | GND |

Usa resistencias limitadoras (por ejemplo 220–330 Ω por canal).

---

## 2. Arduino IDE

### Core y librerías

- Placa: **ESP32 Dev Module** o **ESP32-WROOM-32**.
- Core ESP32: **3.3.12 probado**. El código conserva la rama de compatibilidad
  para core 2.0.17+, pero se recomienda 3.x.
- Librerías (versiones con las que se compiló):
  - `MFRC522` **1.4.12** (GithubCommunity).
  - `Adafruit Fingerprint Sensor Library` **2.1.4**.
  - `ArduinoJson` **7.x** (se compiló con 7.4.3; el código usa `JsonDocument`).
- El resto (`WiFi`, `WiFiClientSecure`, `HTTPClient`, `HTTPUpdate`, `LittleFS`,
  `Preferences`, `WebServer`, `DNSServer`, `SPI`) viene con el core ESP32.

### Particiones

Para usar OTA y LittleFS a la vez, selecciona un esquema con **OTA + SPIFFS**:

- **Recomendado para la cola completa de hasta 100 eventos:**
  `Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)`. El sketch compilado ocupa
  ~1.21 MB (92 % de esa partición de app), así que funciona pero con poco margen
  para futuras ampliaciones.
- **Recomendado si prefieres margen para el binario:**
  `Minimal SPIFFS (1.9MB APP with OTA/128KB SPIFFS)`. El sketch compila al 61 %,
  pero LittleFS de 128 KB solo alcanza para ~20–30 eventos, porque cada archivo
  ocupa al menos un bloque de 4 KB. La cola se detiene al llenarse y lo avisa
  por serial.

LittleFS usa la partición de datos `spiffs`. Con `Huge APP (3MB No OTA...)` la
actualización OTA no funcionará.

### Compilar y subir

Abre `cerradura_biometrica.ino` en Arduino IDE, selecciona la placa, el puerto
y sube el sketch.

Compilación verificada con:

```text
arduino-cli 1.5.1
esp32:esp32 3.3.12
PartitionScheme=min_spiffs
```

También compila con `PartitionScheme=default`. Falta la prueba en hardware real
(RC522, R307, relé y LED).

---

## 3. Primer arranque: portal cautivo

Si no hay configuración guardada en NVS, el equipo **no** se conecta a la red
universitaria: levanta un punto de acceso abierto:

- SSID: `Cerradura-XXXX` (últimos 4 caracteres de la MAC).
- Dirección: `http://192.168.4.1/`.

Conéctate desde el móvil o el portátil y completa:

- SSID y contraseña WiFi.
- API Key del dispositivo (en el seed de desarrollo es `test`).
- URL de `access-webhook`.
- URL de `device-sync`.
- URL OTA (opcional).

Al guardar, el dispositivo se reinicia y arranca en modo estación.

> El portal es un AP abierto para simplificar el primer despliegue. Configura
> el equipo en un entorno de confianza. Para volver a configurarlo, borra la
> flash y vuelve a subir el firmware: en Arduino IDE activa **Erase All Flash
> Before Sketch Upload** antes de subir, o usa
> `python -m esptool --chip esp32 erase_flash`. También puedes usar una
> herramienta que borre solo la partición NVS.

Las URLs y la API Key se guardan en NVS; **no están hardcodeadas en el
firmware**. Estos son los valores de ejemplo para este proyecto (cópialos en el
portal):

```text
https://fotujrqdappkspsygngt.supabase.co/functions/v1/access-webhook
https://fotujrqdappkspsygngt.supabase.co/functions/v1/device-sync
```

---

## 4. Funcionamiento normal

| Estado | LED | Comportamiento |
| --- | --- | --- |
| `REPOSO` | Rojo | Espera tarjeta. |
| `TARJETA` | Amarillo | UID leído; solicita huella. |
| `ESPERA_HUELLA` | Amarillo | Máximo 10 s para que el R307 encuentre una coincidencia local. |
| `CONSULTA_BACKEND` | Amarillo | POST a `access-webhook` con timeout de 4 s. |
| `CONCEDIDO` | Verde | Relé activo 3 s; luego vuelve a reposo. |
| `DENEGADO` | Rojo intermitente | 2.5 s; muestra el motivo por serial. |

Flujo:

1. Se lee el UID RFID.
2. Se pide huella y se ejecuta `fingerFastSearch()` localmente.
3. Si hay coincidencia, se envía al backend:

```json
{
  "event_uuid": "uuid-v4",
  "rfid_uid": "A1B2C3D4",
  "fingerprint_template_id": 7,
  "occurred_at": "2026-11-09T12:34:56Z",
  "resultado": "PERMITIDO",
  "motivo": null,
  "firmware_version": "1.0.0",
  "rssi": -61
}
```

4. El relé solo se abre si la respuesta HTTP 200 trae `autorizado: true`.
5. Si hay timeout/error de red, se deniega localmente y el evento se guarda en
   LittleFS para reenviarlo cuando vuelva la conexión.
6. Para volver a leer, la tarjeta debe retirarse del lector durante al menos
   500 ms (evita releer la misma tarjeta apoyada).

El `occurred_at` se genera con hora NTP real en UTC. Si la hora NTP aún no es
válida, el acceso y el heartbeat esperan; el log lo indica.

### Cola offline

- Directorio: `/pending` en LittleFS.
- Un archivo JSON por evento, nombrado con el `event_uuid`.
- Se reintentan hasta 2 eventos cada 10 s, solo en reposo y con hora válida.
- El mismo `event_uuid` hace que el reenvío sea idempotente en el backend.
- Límite lógico: 100 eventos. También se detiene si LittleFS se llena: cada
  archivo consume al menos un bloque de 4 KB, así que la capacidad real depende
  de la partición (con `Minimal SPIFFS` son ~20–30 eventos; con la partición de
  1.5 MB caben los 100). Si se llena, se descarta el evento nuevo y se avisa por
  serial.
- En HTTP 400/422 el evento se descarta (payload inválido); en 401/403/404/429/
  5xx o error de red se conserva para el siguiente intento.

---

## 5. Comandos remotos (`device-sync`)

El dispositivo envía un heartbeat cada **3 s** (cuando hay WiFi y NTP) con:

```json
{
  "firmware": "1.0.0",
  "rssi": -61,
  "ip": "192.168.1.50"
}
```

Si hay un reporte de comando pendiente, añade `command_id`, `estado`, `paso`,
`rfid_uid`, `fingerprint_slot` y `detalle`. Cada paso del enrolamiento se
intenta reportar inmediatamente; si el envío falla, el último paso queda
pendiente y se reintenta en los heartbeats. El estado final también se intenta
enviar al terminar.

Los comandos se ejecutan solo cuando el acceso está en `REPOSO`, no hay una
tarjeta pendiente de retirar y no hay un reporte anterior pendiente. Así no se
interrumpe una validación en curso ni se confunde una tarjeta de acceso con una
tarjeta de enrolamiento.

### `ENROLL_USUARIO`

Secuencia implementada:

```text
getImage()
image2Tz(1)
getImage()  (esperando NOFINGER)
image2Tz(2)
createModel()
storeModel(slot)
```

Pasos reportados: `TARJETA_LEIDA`, `HUELLA_1_OK`, `DEDO_RETIRADO`,
`HUELLA_2_OK`, `MODELO_CREADO`, `HUELLA_GUARDADA` y el estado final
`COMPLETADO` o `FALLIDO` con motivo.

Antes de capturar, se comprueba que el slot no tenga ya una plantilla local
(`loadModel`); si está ocupado, el comando termina en `FALLIDO` con
`SLOT_OCUPADO_LOCAL`. También se respeta `expires_at`; si vence, se reporta
`EXPIRADO`.

Si el backend responde `409 rfid_uid_ya_registrado` o
`409 fingerprint_slot_ya_registrado` al completar, el firmware elimina la
plantilla local recién guardada y convierte el reporte a `FALLIDO` con
`CONFLICTO_CREDENCIAL`. Así no queda una huella local sin credencial en la DB.

### `DELETE_HUELLA`

Ejecuta `deleteModel(slot)` y reporta `COMPLETADO` o `FALLIDO`. No requiere
tarjeta.

### `REINICIAR` / `RESTART` / `REBOOT`

El firmware los soporta si el backend llegara a emitirlos. Primero intenta
reportar `COMPLETADO`; el reinicio se hace cuando el reporte fue aceptado (o
descartado de forma terminal), para no perder el estado del comando. Mientras
solo se espera la confirmación, el acceso normal sigue funcionando; cuando el
reporte se resuelve, se espera a que no haya un acceso en curso y se reinicia.

### `SYNC_SLOTS`

Se reconoce como comando válido y se responde `COMPLETADO` con
`SIN_CAMBIOS`. No hay sincronización masiva de plantillas en esta versión.

---

## 6. OTA con HTTPUpdate

1. Compila y usa **Sketch > Export Compiled Binary** para obtener el `.bin`.
2. Publica el binario en una URL accesible por el ESP32.
3. Configura esa URL en el portal (`URL OTA`).
4. El equipo comprueba OTA:
   - 30 s después de arrancar,
   - cada 6 h si no había actualización,
   - 30 min después de un fallo.

**El servidor OTA debe devolver 304 (o 204) cuando el equipo ya tiene la
versión actual.** Si siempre devuelve 200 con el mismo binario, el equipo se
actualizará y reiniciará en cada comprobación. El firmware envía
`x-ESP32-version: 1.0.0` y `x-ESP32-sketch-md5`; usa un endpoint que compare
esos valores y devuelva 304. Un 404 se trata como fallo y se reintenta cada
30 minutos.

Requisitos:

- Esquema de particiones con OTA.
- URL `http://` o `https://`. En HTTPS se usa `setInsecure()` actualmente
  (ver seguridad).
- El watchdog se desactiva durante la actualización y se reactiva al terminar.

---

## 7. Seguridad y pendientes

- `WiFiClientSecure::setInsecure()` está usado tanto en las llamadas normales
  como en OTA. **En producción** se debe fijar la CA de Supabase/HTTPS con
  `setCACert()` o un certificado pinneado.
- La API Key y la contraseña WiFi se guardan en NVS en texto plano. Protege el
  acceso físico al ESP32.
- El portal cautivo es un AP abierto. Úsalo solo en el primer arranque y en un
  entorno controlado.
- El backend debe mantener la API Key del dispositivo rotada y el dispositivo
  dado de alta como `ACTIVO`.
- El firmware no almacena huellas crudas ni las transmite.

---

## 8. Diagnóstico por serial

A 115200 baudios se imprimen, entre otros:

- Versión del RC522 y reintentos si no responde.
- Detección del R307 y capacidad.
- Conexión WiFi, IP y RSSI; reconexiones.
- Sincronización NTP y hora UTC.
- Cada transición de estado de acceso.
- Resultado del backend (autorizado/denegado/motivo).
- Eventos guardados/reenviados desde LittleFS.
- Heartbeat, comandos recibidos, pasos de enrolamiento y errores 400/409.
- Resultado de OTA.

Problemas típicos:

- **RC522 no detectado:** revisa 3.3 V, GND, SPI y que RST no esté flojo.
- **R307 no detectado:** revisa 5 V, GND, TX/RX cruzados y 57600 baudios.
- **No hay acceso:** el log debe mostrar hora NTP válida; sin NTP el flujo se
  detiene para no registrar `occurred_at` falsos.
- **Relé invertido:** el módulo debe ser activo en LOW; el firmware pone HIGH
  para cerrar.
- **Comando no ejecutado:** el comando espera a que el acceso vuelva a
  `REPOSO`; revisa `expires_at` y el log `[CMD]`.

---

## 9. Archivos

- `cerradura_biometrica.ino`: firmware completo (máquina de estados, portal,
  WiFi/NTP, HTTPS, cola LittleFS, comandos, OTA y watchdog).
- `README.md`: este documento.
