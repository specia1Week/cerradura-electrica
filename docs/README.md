# Documentación técnica

Índice de documentación del sistema de control de acceso y asistencia biométrico.

## Fase 0 — Infraestructura base

- [`../README.md`](../README.md): requisitos, arranque, estructura y operación.
- [`mqtt-topics.md`](mqtt-topics.md): convención de topics y QoS del broker.

## Fases posteriores (pendiente)

- Modelo de datos y migraciones Prisma.
- Contrato de eventos MQTT (`access-events`, `heartbeat`).
- Autenticación de dispositivos (API key + HMAC / mTLS).
- API del panel y roles JWT.
- Diseño del panel web.
- Firmware ESP32 y estrategia store-and-forward.
