# Topics MQTT — Fase 0

Convención acordada para el broker de desarrollo (Mosquitto 2). Los payloads y su
validación se definirán en la Fase 1 junto con el modelo de datos.

## Topics

| Topic | Publica | Consume | QoS |
|---|---|---|---|
| `devices/{device_id}/access-events` | ESP32 | Backend | 1 |
| `devices/{device_id}/heartbeat` | ESP32 | Backend | 1 |

- `{device_id}` es el identificador único del dispositivo (no la MAC en texto libre).
- El backend se suscribe con comodín de un nivel: `devices/+/access-events` y
  `devices/+/heartbeat`.
- **QoS 1** (at-least-once) en publicación y suscripción. La idempotencia se
  garantizará en el backend mediante `event_uuid` único en `access_events`.

## Reglas

1. El ESP32 nunca publica en topics fuera de su prefijo `devices/{device_id}/`.
2. El broker no permite conexiones anónimas.
3. En producción (EMQX) se añadirá ACL por dispositivo y mTLS.
4. La cola offline del dispositivo (NVS/SPIFFS) reenviará eventos con reintentos
   exponenciales; el backend debe tolerar duplicados (QoS 1 + idempotencia).

## Temas reservados (futuro)

- Comandos backend → dispositivo (por definir).
- Estado de configuración/sincronización (por definir).
- No inventar ni publicar en estos topics hasta documentarlos.
