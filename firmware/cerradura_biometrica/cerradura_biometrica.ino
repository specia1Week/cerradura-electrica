/*
 * ============================================================================
 *  CERRADURA BIOMÉTRICA UNIVERSITARIA - ESP32-WROOM-32
 * ============================================================================
 *  Doble factor: tarjeta RFID (RC522) + huella dactilar (R307).
 *  La validación biométrica es LOCAL; el backend solo autoriza y registra.
 *
 *  PINOUT FIJO (AGENTS.md):
 *    RC522  : SDA/SS=5, SCK=18, MOSI=23, MISO=19, RST=21, 3.3V (¡NO 5V!)
 *    R307   : TXD->GPIO16 (RX2), RXD->GPIO17 (TX2), VCC=5V
 *    Relé   : IN=GPIO25 (activo en LOW)
 *    LED RGB: R=GPIO26, G=GPIO27, B=GPIO14 (cátodo común)
 *
 *  LIBRERÍAS (Arduino IDE):
 *    - MFRC522
 *    - Adafruit Fingerprint Sensor Library
 *    - ArduinoJson 7.x
 *    - HTTPClient, LittleFS, HTTPUpdate (incluidas en el core ESP32)
 *    - WiFi, WiFiClientSecure, Preferences, WebServer, DNSServer (core ESP32)
 *
 *  NOTAS IMPORTANTES:
 *    - No se usan delay() bloqueantes en la máquina de estados.
 *    - Las credenciales WiFi y la API Key se guardan en Preferences (NVS).
 *    - Si no hay configuración, se levanta un portal cautivo simple.
 *    - HTTPS usa setInsecure() para simplificar el despliegue. En producción
 *      se debe sustituir por setCACert() con la CA correspondiente.
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_Fingerprint.h>
#include <ArduinoJson.h>
#include <esp_random.h>
#include <esp_task_wdt.h>
#include <time.h>
#include <stdlib.h>

#if __has_include(<esp_arduino_version.h>)
#include <esp_arduino_version.h>
#endif

// ---------------------------------------------------------------------------
// Pinout fijo
// ---------------------------------------------------------------------------
constexpr uint8_t PIN_RFID_SS   = 5;
constexpr uint8_t PIN_RFID_SCK  = 18;
constexpr uint8_t PIN_RFID_MOSI = 23;
constexpr uint8_t PIN_RFID_MISO = 19;
constexpr uint8_t PIN_RFID_RST  = 21;

constexpr uint8_t PIN_R307_RX = 16;  // TXD del R307 -> RX2 del ESP32
constexpr uint8_t PIN_R307_TX = 17;  // RXD del R307 -> TX2 del ESP32
constexpr uint8_t PIN_R307_TOUCH = 4; // TOUCH opcional (no imprescindible)

constexpr uint8_t PIN_RELE = 25;     // Activo en LOW
constexpr uint8_t PIN_LED_R = 26;
constexpr uint8_t PIN_LED_G = 27;
constexpr uint8_t PIN_LED_B = 14;

// ---------------------------------------------------------------------------
// Constantes de tiempo y version
// ---------------------------------------------------------------------------
constexpr char FW_VERSION[] = "1.0.0";

constexpr uint32_t MS_ESPERA_HUELLA   = 10000;  // 10 s máximo para huella
constexpr uint32_t MS_TIMEOUT_HTTP    = 4000;   // 4 s para access-webhook
constexpr uint32_t MS_TIMEOUT_SYNC    = 4000;   // 4 s para device-sync
constexpr uint32_t MS_RELE_ACTIVO     = 3000;   // 3 s de apertura
constexpr uint32_t MS_HEARTBEAT       = 3000;   // cada 3 s
constexpr uint32_t MS_REENVIO_COLA    = 10000;  // reintento de cola offline
constexpr uint32_t MS_RECONEXION_WIFI = 10000;
constexpr uint32_t MS_REINTENTO_NTP   = 15000;
constexpr uint32_t MS_POLL_RFID       = 120;
constexpr uint32_t MS_POLL_HUELLA     = 150;
constexpr uint32_t MS_RETIRO_TARJETA  = 500;
constexpr uint32_t MS_DENEGADO        = 2500;
constexpr uint32_t MS_CONCEDIDO       = 4000;   // 3 s relé + 1 s verde
constexpr uint32_t MS_OTA_INICIAL     = 30000;
constexpr uint32_t MS_OTA_REINTENTO   = 30UL * 60UL * 1000UL;
constexpr uint32_t MS_OTA_PERIODICO   = 6UL * 60UL * 60UL * 1000UL;
constexpr uint32_t MS_COMANDO_MAX     = 5UL * 60UL * 1000UL; // fallback si no hay NTP

constexpr uint16_t MAX_EVENTOS_COLA = 100;
constexpr uint8_t  MAX_ENVIOS_COLA  = 2;

// ---------------------------------------------------------------------------
// Tipos y estructuras
// ---------------------------------------------------------------------------
enum EstadoAcceso : uint8_t {
  ST_REPOSO = 0,
  ST_TARJETA,
  ST_ESPERA_HUELLA,
  ST_CONSULTA_BACKEND,
  ST_CONCEDIDO,
  ST_DENEGADO
};

enum EstadoComando : uint8_t {
  CMD_NINGUNO = 0,
  CMD_RETIRAR_TARJETA_PREVIA,
  CMD_ESPERA_TARJETA,
  CMD_HUELLA_1,
  CMD_RETIRAR_DEDO,
  CMD_HUELLA_2,
  CMD_CREAR_MODELO,
  CMD_GUARDAR,
  CMD_BORRAR_HUELLA,
  CMD_REINICIAR,
  CMD_SYNC_SLOTS,
  CMD_DESCONOCIDO
};

struct Configuracion {
  String ssid;
  String wifiPass;
  String apiKey;
  String accessUrl;
  String syncUrl;
  String otaUrl;
};

struct ComandoRemoto {
  bool activo = false;
  String id;
  String tipo;
  int slot = -1;
  time_t expiraEn = 0;
  unsigned long recibidoMs = 0;
  EstadoComando estado = CMD_NINGUNO;
  String uid;
  unsigned long ultimoPoll = 0;
  bool slotVerificado = false;
};

struct ReporteComando {
  bool valido = false;
  String id;
  String tipo;
  String estado;
  String paso;
  String motivo;
  String rfid;
  int slot = -1;
  bool incluirRfid = false;
  bool incluirSlot = false;
};

struct RespuestaHttp {
  int codigo = 0;
  String cuerpo;
};

// ---------------------------------------------------------------------------
// Objetos globales
// ---------------------------------------------------------------------------
MFRC522 mfrc522(PIN_RFID_SS, PIN_RFID_RST);
Adafruit_Fingerprint finger(&Serial2);

Preferences prefs;
WebServer servidorWeb(80);
DNSServer dnsPortal;
WiFiClientSecure clienteHttps;

Configuracion config;
bool modoPortal = false;
unsigned long portalReiniciarEn = 0;

bool rfidDisponible = false;
bool fingerprintDisponible = false;

EstadoAcceso estadoAcceso = ST_REPOSO;
unsigned long tiempoEstado = 0;
unsigned long ultimoPollRfid = 0;
unsigned long ultimoPollHuella = 0;
unsigned long inicioEsperaHuella = 0;
unsigned long inicioDenegado = 0;
unsigned long inicioConcedido = 0;
String uidActual;
int slotActual = -1;
bool consultaPendiente = false;
bool requiereRetiroTarjeta = false;
unsigned long tarjetaAusenteDesde = 0;
String ultimoMotivo = "";

bool releActivo = false;
unsigned long releApagarEn = 0;

ComandoRemoto comando;
ComandoRemoto comandoPendiente;
bool hayComandoPendiente = false;
ReporteComando reporteComando;

bool enHeartbeat = false;
unsigned long ultimoHeartbeat = 0;
unsigned long ultimoReenvioCola = 0;
unsigned long ultimoLogSync = 0;

bool reinicioSolicitado = false;
unsigned long reiniciarEn = 0;

bool otaEnCurso = false;
unsigned long proximoChequeoOTA = 0;
bool ntpSincronizado = false;
unsigned long ultimoIntentoNTP = 0;

// ---------------------------------------------------------------------------
// Prototipos
// ---------------------------------------------------------------------------
void configurarWatchdog();
void feedWatchdog();

bool cargarConfig();
void guardarConfig();
void iniciarPortal();
void loopPortal();
void manejarRaiz();
void manejarGuardar();
void manejarRedireccion();
void manejarNoEncontrado();

void mantenerWiFi();
void mantenerNTP();
void configurarTiempoUTC();
bool horaValida();
String ahoraIso8601();
String iso8601UTC(time_t t);
time_t parseIso8601(const String& iso);

void mantenerRFID();
void mantenerSensorHuella();
bool leerTarjetaUID(String& uid);
bool tarjetaPresente();

void setLed(uint8_t r, uint8_t g, uint8_t b);
void actualizarLeds();
void actualizarRele();
void activarRele();

void cambiarEstadoAcceso(EstadoAcceso nuevo);
void loopAcceso();
void iniciarAcceso(const String& uid);
void denegarAcceso(const String& motivo);
void concederAcceso();
void finalizarAcceso();
void procesarConsultaBackend();
String construirEventoAcceso(const String& uuid, const String& uid, int slot,
                             const String& occurred, const String& resultado,
                             const String& motivo);
String generarUuidV4();

int contarEventosOffline();
bool guardarEventoOffline(const String& uuid, const String& payload);
void reenviarColaOffline(uint8_t maxEnvios);
void tareaReenvioCola();

RespuestaHttp postJson(const String& url, const String& payload, uint32_t timeoutMs);
String hostDeUrl(const String& url);

void tareaHeartbeat();
void enviarHeartbeat();
void procesarComandoJson(JsonVariant cmd);
void iniciarComandoPendiente();
void loopComando();
bool comandoVencido();
bool validarSlotComando();
void prepararReporte(const String& estado, const String& paso, const String& motivo);
void finalizarComando(const String& estado, const String& paso, const String& motivo);
void borrarPlantillaLocalReportada();
void manejarConflictoSync(const String& error);

void tareaOTA();
void realizarOTA();

// ---------------------------------------------------------------------------
// SETUP
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  // El relé debe quedar apagado ANTES de configurar el pin como salida.
  digitalWrite(PIN_RELE, HIGH);
  pinMode(PIN_RELE, OUTPUT);

  pinMode(PIN_LED_R, OUTPUT);
  pinMode(PIN_LED_G, OUTPUT);
  pinMode(PIN_LED_B, OUTPUT);
  setLed(255, 0, 0); // Rojo en reposo / arranque

  configurarWatchdog();

  Serial.println();
  Serial.println("==============================================");
  Serial.println(" Cerradura biometrica ESP32 - inicio");
  Serial.printf(" Firmware: %s\n", FW_VERSION);
  Serial.println("==============================================");

  // Configuración persistente
  bool configOk = cargarConfig();

  // Sistema de archivos para la cola offline
  if (!LittleFS.begin(true)) {
    Serial.println("[FS] ERROR: no se pudo montar LittleFS");
  } else {
    if (!LittleFS.exists("/pending")) {
      LittleFS.mkdir("/pending");
    }
    Serial.printf("[FS] LittleFS OK. Eventos pendientes: %d\n", contarEventosOffline());
  }

  // RC522
  SPI.begin(PIN_RFID_SCK, PIN_RFID_MISO, PIN_RFID_MOSI, PIN_RFID_SS);
  mfrc522.PCD_Init();
  byte version = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
  if (version != 0x00 && version != 0xFF) {
    rfidDisponible = true;
    Serial.printf("[RFID] RC522 listo (version 0x%02X)\n", version);
    mfrc522.PCD_DumpVersionToSerial();
  } else {
    Serial.printf("[RFID] RC522 no detectado (version 0x%02X)\n", version);
  }

  // R307. Se inicializa Serial2 directamente (en lugar de finger.begin())
  // porque la librería Adafruit incluye un delay(1000) interno de arranque.
  Serial2.begin(57600, SERIAL_8N1, PIN_R307_RX, PIN_R307_TX);
  if (finger.verifyPassword()) {
    fingerprintDisponible = true;
    finger.getParameters();
    Serial.printf("[HUELLA] R307 listo. Capacidad: %u plantillas\n",
                  (unsigned)finger.capacity);
  } else {
    Serial.println("[HUELLA] R307 no detectado. Se reintentara en segundo plano.");
  }

  // Si no hay datos guardados, se arranca el portal de configuración.
  if (!configOk) {
    Serial.println("[CONFIG] Faltan datos. Iniciando portal cautivo.");
    iniciarPortal();
    return;
  }

  // WiFi en modo estación
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  WiFi.begin(config.ssid.c_str(), config.wifiPass.c_str());

  configurarTiempoUTC();
  clienteHttps.setInsecure(); // Ver nota de seguridad al inicio del archivo.

  proximoChequeoOTA = millis() + MS_OTA_INICIAL;

  Serial.printf("[CONFIG] SSID: %s\n", config.ssid.c_str());
  Serial.printf("[CONFIG] access-webhook: %s\n", config.accessUrl.c_str());
  Serial.printf("[CONFIG] device-sync   : %s\n", config.syncUrl.c_str());
  Serial.printf("[CONFIG] OTA           : %s\n",
                config.otaUrl.length() ? config.otaUrl.c_str() : "(deshabilitada)");

  cambiarEstadoAcceso(ST_REPOSO);
  Serial.println("[SISTEMA] Inicializacion completa.");
}

// ---------------------------------------------------------------------------
// LOOP PRINCIPAL
// ---------------------------------------------------------------------------
void loop() {
  feedWatchdog();

  if (modoPortal) {
    loopPortal();
    return;
  }

  // Un reinicio remoto espera a que no haya un acceso ni un comando en curso.
  // Así no se corta una validación a medias; el reporte del comando ya fue
  // aceptado (o descartado de forma terminal) antes de fijar reiniciarEn.
  if (reiniciarEn != 0 && !comando.activo && estadoAcceso == ST_REPOSO &&
      (int32_t)(millis() - reiniciarEn) >= 0) {
    Serial.println("[SISTEMA] Reinicio solicitado por comando. Reiniciando...");
    ESP.restart();
  }

  mantenerWiFi();
  mantenerNTP();
  mantenerRFID();
  mantenerSensorHuella();

  actualizarRele();

  // El heartbeat también transporta el último reporte de comando pendiente.
  tareaHeartbeat();

  if (comando.activo) {
    loopComando();
  } else if (reiniciarEn == 0) {
    // Mientras solo se espera confirmar un reinicio (reiniciarEn==0 pero
    // reinicioSolicitado=true), el acceso normal sigue disponible.
    loopAcceso();
  }

  // Un comando pendiente se inicia después de atender el acceso. Así una
  // tarjeta que ya está frente al lector se procesa como acceso y no como
  // enrolamiento. Tampoco se inicia hasta que el reporte del comando anterior
  // se haya enviado ni mientras se espera que retiren la tarjeta.
  if (!comando.activo && hayComandoPendiente &&
      estadoAcceso == ST_REPOSO && !requiereRetiroTarjeta &&
      !reporteComando.valido && !reinicioSolicitado) {
    iniciarComandoPendiente();
  }

  // Se reenvía la cola después de atender el acceso, para no retrasar la
  // lectura de una tarjeta que acaba de llegar. Si el acceso quedó en un
  // estado distinto de REPOSO, tareaReenvioCola() no hace nada.
  tareaReenvioCola();

  tareaOTA();

  actualizarLeds();
}

// ---------------------------------------------------------------------------
// WATCHDOG
// ---------------------------------------------------------------------------
void configurarWatchdog() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cfg = {};
  cfg.timeout_ms = 30000;
  cfg.idle_core_mask = 0;
  cfg.trigger_panic = true;

  esp_err_t err = esp_task_wdt_reconfigure(&cfg);
  if (err != ESP_OK) {
    esp_task_wdt_init(&cfg);
  }
#else
  esp_task_wdt_init(30, true);
#endif
  enableLoopWDT();
  feedLoopWDT();
  Serial.println("[WDT] Watchdog del loop activado (30 s).");
}

void feedWatchdog() {
  feedLoopWDT();
}

// ---------------------------------------------------------------------------
// LEDs Y RELÉ (todo no bloqueante)
// ---------------------------------------------------------------------------
void setLed(uint8_t r, uint8_t g, uint8_t b) {
  static uint8_t lr = 255, lg = 255, lb = 255;
  if (r == lr && g == lg && b == lb) return;
  analogWrite(PIN_LED_R, r);
  analogWrite(PIN_LED_G, g);
  analogWrite(PIN_LED_B, b);
  lr = r;
  lg = g;
  lb = b;
}

void actualizarLeds() {
  if (modoPortal || otaEnCurso) {
    setLed(0, 0, 255); // Azul: configuración / OTA
    return;
  }

  if (comando.activo) {
    setLed(0, 0, 255); // Azul: enrolamiento o comando remoto
    return;
  }

  switch (estadoAcceso) {
    case ST_REPOSO:
      setLed(255, 0, 0);
      break;
    case ST_TARJETA:
    case ST_ESPERA_HUELLA:
    case ST_CONSULTA_BACKEND:
      setLed(255, 180, 0); // Amarillo
      break;
    case ST_CONCEDIDO:
      setLed(0, 255, 0);
      break;
    case ST_DENEGADO: {
      bool encendido = (((millis() - inicioDenegado) / 250UL) % 2UL) == 0;
      setLed(encendido ? 255 : 0, 0, 0);
      break;
    }
    default:
      setLed(255, 0, 0);
      break;
  }
}

void activarRele() {
  digitalWrite(PIN_RELE, LOW);
  releActivo = true;
  releApagarEn = millis() + MS_RELE_ACTIVO;
  Serial.println("[RELE] Activado por 3 s.");
}

void actualizarRele() {
  if (!releActivo) return;
  if ((int32_t)(millis() - releApagarEn) >= 0) {
    digitalWrite(PIN_RELE, HIGH);
    releActivo = false;
    Serial.println("[RELE] Apagado.");
  }
}

// ---------------------------------------------------------------------------
// SENSORES: reintentos en caliente
// ---------------------------------------------------------------------------
void mantenerRFID() {
  if (rfidDisponible) return;

  static unsigned long ultimoIntento = 0;
  if (millis() - ultimoIntento < 5000) return;
  ultimoIntento = millis();

  SPI.begin(PIN_RFID_SCK, PIN_RFID_MISO, PIN_RFID_MOSI, PIN_RFID_SS);
  mfrc522.PCD_Init();
  byte version = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
  if (version != 0x00 && version != 0xFF) {
    rfidDisponible = true;
    Serial.printf("[RFID] RC522 detectado (version 0x%02X)\n", version);
  } else {
    Serial.println("[RFID] RC522 sigue sin responder.");
  }
}

void mantenerSensorHuella() {
  if (fingerprintDisponible) return;

  static unsigned long ultimoIntento = 0;
  if (millis() - ultimoIntento < 5000) return;
  ultimoIntento = millis();

  if (finger.verifyPassword()) {
    fingerprintDisponible = true;
    finger.getParameters();
    Serial.printf("[HUELLA] R307 detectado. Capacidad: %u\n",
                  (unsigned)finger.capacity);
  } else {
    Serial.println("[HUELLA] R307 sigue sin responder.");
  }
}

// ---------------------------------------------------------------------------
// CONFIGURACIÓN PERSISTENTE Y PORTAL CAUTIVO
// ---------------------------------------------------------------------------
bool cargarConfig() {
  if (!prefs.begin("cerradura", false)) {
    Serial.println("[CONFIG] ERROR: no se pudo abrir Preferences.");
    return false;
  }

  config.ssid     = prefs.getString("ssid", "");
  config.wifiPass = prefs.getString("pass", "");
  config.apiKey   = prefs.getString("apikey", "");
  config.accessUrl = prefs.getString("accessUrl", "");
  config.syncUrl   = prefs.getString("syncUrl", "");
  config.otaUrl    = prefs.getString("otaUrl", "");

  config.ssid.trim();
  config.apiKey.trim();
  config.accessUrl.trim();
  config.syncUrl.trim();
  config.otaUrl.trim();

  // Las URLs se capturan en el portal y se guardan en NVS. No hay URLs
  // hardcodeadas en el firmware.
  bool ok = config.ssid.length() > 0 &&
            config.apiKey.length() > 0 &&
            (config.accessUrl.startsWith("http://") ||
             config.accessUrl.startsWith("https://")) &&
            (config.syncUrl.startsWith("http://") ||
             config.syncUrl.startsWith("https://")) &&
            (config.otaUrl.length() == 0 ||
             config.otaUrl.startsWith("http://") ||
             config.otaUrl.startsWith("https://"));

  Serial.printf("[CONFIG] Cargada: %s\n", ok ? "OK" : "INCOMPLETA");
  return ok;
}

void guardarConfig() {
  prefs.putString("ssid", config.ssid);
  prefs.putString("pass", config.wifiPass);
  prefs.putString("apikey", config.apiKey);
  prefs.putString("accessUrl", config.accessUrl);
  prefs.putString("syncUrl", config.syncUrl);
  prefs.putString("otaUrl", config.otaUrl);
  Serial.println("[CONFIG] Guardada en NVS.");
}

const char PAGINA_CONFIG[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cerradura - Configuracion</title>
<style>
  :root{color-scheme:light}
  body{font-family:system-ui,-apple-system,sans-serif;background:#f4f5f7;margin:0;color:#111}
  .wrap{max-width:520px;margin:0 auto;padding:24px 16px 40px}
  .card{background:#fff;border:1px solid #e3e5e8;border-radius:14px;padding:22px;box-shadow:0 8px 24px rgba(0,0,0,.06)}
  h1{font-size:21px;margin:0 0 4px}
  p{color:#555;font-size:14px;line-height:1.45}
  label{display:block;font-size:13px;font-weight:600;margin:14px 0 5px}
  input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #cfd3d8;border-radius:9px;font-size:14px}
  input:focus{outline:2px solid #2563eb33;border-color:#2563eb}
  button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:9px;background:#2563eb;color:#fff;font-size:15px;font-weight:700}
  .hint{font-size:12px;color:#777;margin-top:4px}
  .note{background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12;padding:10px 12px;border-radius:9px;font-size:13px;margin-top:16px}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>Configurar cerradura</h1>
    <p>Conectate a la red <b>Cerradura-XXXX</b> y completa los datos. La API Key y la contraseña WiFi se guardan en la memoria interna del ESP32.</p>
    <form method="POST" action="/guardar" autocomplete="off">
      <label>WiFi SSID</label>
      <input name="ssid" required maxlength="64" placeholder="Nombre de la red WiFi">
      <label>WiFi contraseña</label>
      <input name="pass" type="password" maxlength="64" placeholder="Dejar vacio si es red abierta">
      <label>API Key del dispositivo</label>
      <input name="apikey" type="password" required maxlength="128" placeholder="Ej: test">
      <label>URL access-webhook</label>
      <input name="access" required maxlength="256" placeholder="https://TU-PROYECTO.supabase.co/functions/v1/access-webhook">
      <label>URL device-sync</label>
      <input name="sync" required maxlength="256" placeholder="https://TU-PROYECTO.supabase.co/functions/v1/device-sync">
      <label>URL OTA (opcional)</label>
      <input name="ota" maxlength="256" placeholder="https://.../firmware.bin">
      <div class="hint">La URL OTA se consulta automáticamente si está configurada.</div>
      <button type="submit">Guardar y reiniciar</button>
    </form>
    <div class="note">Este portal solo aparece cuando no hay configuración guardada. El dispositivo se reinicia al guardar.</div>
  </div>
</div>
</body>
</html>
)rawliteral";

const char PAGINA_GUARDADO[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cerradura - Guardado</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#f4f5f7;margin:0;color:#111;text-align:center}
  .box{max-width:420px;margin:15vh auto;background:#fff;border:1px solid #e3e5e8;border-radius:14px;padding:28px}
  h1{font-size:20px;margin:0 0 8px;color:#166534}
  p{color:#555;font-size:14px}
</style>
</head>
<body>
<div class="box">
  <h1>Configuración guardada</h1>
  <p>El dispositivo se está reiniciando para conectarse a la red WiFi.</p>
</div>
</body>
</html>
)rawliteral";

void manejarRaiz() {
  servidorWeb.send_P(200, "text/html", PAGINA_CONFIG);
}

void manejarGuardar() {
  String ssid = servidorWeb.arg("ssid");
  String pass = servidorWeb.arg("pass");
  String apiKey = servidorWeb.arg("apikey");
  String access = servidorWeb.arg("access");
  String sync = servidorWeb.arg("sync");
  String ota = servidorWeb.arg("ota");

  ssid.trim();
  apiKey.trim();
  access.trim();
  sync.trim();
  ota.trim();

  bool valido = ssid.length() > 0 &&
                apiKey.length() > 0 &&
                (access.startsWith("http://") || access.startsWith("https://")) &&
                (sync.startsWith("http://") || sync.startsWith("https://")) &&
                (ota.length() == 0 ||
                 ota.startsWith("http://") ||
                 ota.startsWith("https://"));

  if (!valido) {
    servidorWeb.send(400, "text/html; charset=utf-8",
      "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<body style='font-family:system-ui;padding:24px'>"
      "<h2>Datos invalidos</h2>"
      "<p>SSID, API Key y las URLs de access-webhook/device-sync son obligatorios. "
      "Las URLs deben comenzar con http:// o https://.</p>"
      "<p><a href='/'>Volver</a></p></body>");
    return;
  }

  config.ssid = ssid;
  config.wifiPass = pass;
  config.apiKey = apiKey;
  config.accessUrl = access;
  config.syncUrl = sync;
  config.otaUrl = ota;
  guardarConfig();

  servidorWeb.send_P(200, "text/html", PAGINA_GUARDADO);
  portalReiniciarEn = millis() + 1500;
  Serial.println("[CONFIG] Portal guardado. Reinicio en 1.5 s.");
}

void manejarRedireccion() {
  servidorWeb.sendHeader("Location", "http://192.168.4.1/", true);
  servidorWeb.send(302, "text/plain", "");
}

void manejarNoEncontrado() {
  manejarRedireccion();
}

void iniciarPortal() {
  WiFi.mode(WIFI_AP);

  IPAddress apIP(192, 168, 4, 1);
  IPAddress mascara(255, 255, 255, 0);
  WiFi.softAPConfig(apIP, apIP, mascara);

  String mac = WiFi.macAddress();
  mac.replace(":", "");
  if (mac.length() < 4) mac = "0000";
  String apSsid = "Cerradura-" + mac.substring(mac.length() - 4);

  if (!WiFi.softAP(apSsid.c_str())) {
    Serial.println("[PORTAL] ERROR: no se pudo crear el punto de acceso.");
  }

  dnsPortal.start(53, "*", apIP);

  servidorWeb.on("/", HTTP_GET, manejarRaiz);
  servidorWeb.on("/guardar", HTTP_POST, manejarGuardar);
  servidorWeb.on("/generate_204", HTTP_GET, manejarRedireccion);
  servidorWeb.on("/gen_204", HTTP_GET, manejarRedireccion);
  servidorWeb.on("/hotspot-detect.html", HTTP_GET, manejarRedireccion);
  servidorWeb.on("/ncsi.txt", HTTP_GET, manejarRedireccion);
  servidorWeb.on("/connecttest.txt", HTTP_GET, manejarRedireccion);
  servidorWeb.on("/canonical.html", HTTP_GET, manejarRedireccion);
  servidorWeb.on("/success.txt", HTTP_GET, manejarRedireccion);
  servidorWeb.onNotFound(manejarNoEncontrado);
  servidorWeb.begin();

  modoPortal = true;
  setLed(0, 0, 255);
  Serial.printf("[PORTAL] AP abierto: %s  ->  http://192.168.4.1/\n", apSsid.c_str());
}

void loopPortal() {
  dnsPortal.processNextRequest();
  servidorWeb.handleClient();
  feedWatchdog();

  if (portalReiniciarEn != 0 && (int32_t)(millis() - portalReiniciarEn) >= 0) {
    Serial.println("[PORTAL] Reiniciando para aplicar configuración...");
    ESP.restart();
  }
}

// ---------------------------------------------------------------------------
// WiFi Y NTP
// ---------------------------------------------------------------------------
void mantenerWiFi() {
  static bool conectadoAntes = false;
  static unsigned long ultimoIntento = 0;

  if (WiFi.status() == WL_CONNECTED) {
    if (!conectadoAntes) {
      conectadoAntes = true;
      Serial.printf("[WiFi] Conectado. IP: %s  RSSI: %d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
      configurarTiempoUTC();
    }
    return;
  }

  if (conectadoAntes) {
    conectadoAntes = false;
    clienteHttps.stop();
    Serial.println("[WiFi] Conexion perdida. Se reintentara automaticamente.");
  }

  if (millis() - ultimoIntento < MS_RECONEXION_WIFI) return;
  ultimoIntento = millis();
  Serial.println("[WiFi] Reconectando...");
  if (!WiFi.reconnect()) {
    WiFi.begin(config.ssid.c_str(), config.wifiPass.c_str());
  }
}

void configurarTiempoUTC() {
  setenv("TZ", "UTC0", 1);
  tzset();
  configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
  ultimoIntentoNTP = millis();
  Serial.println("[NTP] Sincronizacion iniciada (UTC).");
}

void mantenerNTP() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (!horaValida()) {
    if (millis() - ultimoIntentoNTP >= MS_REINTENTO_NTP) {
      Serial.println("[NTP] Reintentando sincronizacion...");
      configurarTiempoUTC();
    }
    return;
  }

  if (!ntpSincronizado) {
    ntpSincronizado = true;
    Serial.printf("[NTP] Hora valida: %s\n", ahoraIso8601().c_str());
  }
}

bool horaValida() {
  return time(nullptr) > 1700000000; // > 2023-11-14, evita la hora 1970
}

String iso8601UTC(time_t t) {
  struct tm tmUtc;
  if (!gmtime_r(&t, &tmUtc)) return "";
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &tmUtc);
  return String(buffer);
}

String ahoraIso8601() {
  return iso8601UTC(time(nullptr));
}

time_t parseIso8601(const String& iso) {
  int anio = 0, mes = 0, dia = 0, hora = 0, minuto = 0, segundo = 0;
  if (sscanf(iso.c_str(), "%d-%d-%dT%d:%d:%d",
             &anio, &mes, &dia, &hora, &minuto, &segundo) != 6) {
    return 0;
  }

  struct tm tmUtc = {};
  tmUtc.tm_year = anio - 1900;
  tmUtc.tm_mon = mes - 1;
  tmUtc.tm_mday = dia;
  tmUtc.tm_hour = hora;
  tmUtc.tm_min = minuto;
  tmUtc.tm_sec = segundo;
  tmUtc.tm_isdst = 0;

  // El TZ del sistema se fija en UTC0, por lo que mktime interpreta UTC.
  time_t t = mktime(&tmUtc);
  if (t == (time_t)-1) return 0;

  const char* pT = strchr(iso.c_str(), 'T');
  if (pT != nullptr && strchr(pT, 'Z') == nullptr) {
    const char* signo = strrchr(pT, '+');
    if (signo == nullptr) signo = strrchr(pT, '-');
    if (signo != nullptr) {
      int offH = 0, offM = 0;
      if (sscanf(signo + 1, "%d:%d", &offH, &offM) != 2) {
        sscanf(signo + 1, "%2d%2d", &offH, &offM);
      }
      int offset = offH * 3600 + offM * 60;
      if (*signo == '+') t -= offset;
      else t += offset;
    }
  }
  return t;
}

// ---------------------------------------------------------------------------
// UUID v4 REAL (esp_random)
// ---------------------------------------------------------------------------
String generarUuidV4() {
  uint8_t b[16];
  for (int i = 0; i < 4; i++) {
    uint32_t r = esp_random();
    memcpy(&b[i * 4], &r, 4);
  }
  b[6] = (b[6] & 0x0F) | 0x40; // version 4
  b[8] = (b[8] & 0x3F) | 0x80; // variant 10xx

  char out[37];
  snprintf(out, sizeof(out),
           "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-"
           "%02x%02x%02x%02x%02x%02x",
           b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
           b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
  return String(out);
}

// ---------------------------------------------------------------------------
// HTTP JSON (HTTPS con cliente persistente)
// ---------------------------------------------------------------------------
String hostDeUrl(const String& url) {
  int inicio = url.indexOf("://");
  if (inicio < 0) return "";
  inicio += 3;
  int fin = url.indexOf('/', inicio);
  if (fin < 0) return url.substring(inicio);
  return url.substring(inicio, fin);
}

RespuestaHttp postJson(const String& url, const String& payload, uint32_t timeoutMs) {
  RespuestaHttp r;
  if (WiFi.status() != WL_CONNECTED) {
    r.codigo = -1;
    return r;
  }
  if (url.length() == 0) {
    r.codigo = -2;
    return r;
  }

  static String hostActual = "";
  String host = hostDeUrl(url);
  if (hostActual.length() > 0 && host != hostActual) {
    clienteHttps.stop();
  }
  hostActual = host;

  HTTPClient http;
  http.setReuse(true);
  http.setTimeout((uint16_t)timeoutMs);
  http.setConnectTimeout((int32_t)timeoutMs);

  if (!http.begin(clienteHttps, url)) {
    http.end();
    clienteHttps.stop();
    r.codigo = -3;
    return r;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", config.apiKey);

  r.codigo = http.POST(payload);
  if (r.codigo > 0) {
    r.cuerpo = http.getString();
  }
  http.end();

  // Si hubo error de red, se cierra la conexión para forzar un handshake
  // limpio en el siguiente intento.
  if (r.codigo <= 0) {
    clienteHttps.stop();
  }
  return r;
}

// ---------------------------------------------------------------------------
// LECTURA RFID
// ---------------------------------------------------------------------------
bool leerTarjetaUID(String& uid) {
  if (!rfidDisponible) return false;
  if (!mfrc522.PICC_IsNewCardPresent()) return false;
  if (!mfrc522.PICC_ReadCardSerial()) return false;

  uid = "";
  uid.reserve(24);
  char hex[3];
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    snprintf(hex, sizeof(hex), "%02X", mfrc522.uid.uidByte[i]);
    uid += hex;
  }

  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  return uid.length() > 0;
}

bool tarjetaPresente() {
  if (!rfidDisponible) return false;
  if (mfrc522.PICC_IsNewCardPresent()) {
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// MÁQUINA DE ESTADOS DE ACCESO
// ---------------------------------------------------------------------------
void cambiarEstadoAcceso(EstadoAcceso nuevo) {
  if (estadoAcceso == nuevo) return;
  estadoAcceso = nuevo;
  tiempoEstado = millis();

  const char* nombre = "?";
  switch (nuevo) {
    case ST_REPOSO:           nombre = "REPOSO"; break;
    case ST_TARJETA:          nombre = "TARJETA"; break;
    case ST_ESPERA_HUELLA:    nombre = "ESPERA_HUELLA"; break;
    case ST_CONSULTA_BACKEND: nombre = "CONSULTA_BACKEND"; break;
    case ST_CONCEDIDO:        nombre = "CONCEDIDO"; break;
    case ST_DENEGADO:         nombre = "DENEGADO"; break;
  }
  Serial.printf("[ESTADO] -> %s\n", nombre);
}

void iniciarAcceso(const String& uid) {
  uidActual = uid;
  slotActual = -1;
  consultaPendiente = false;
  ultimoMotivo = "";
  cambiarEstadoAcceso(ST_TARJETA);
  Serial.printf("[ACCESO] Tarjeta leida: %s. Solicite huella.\n", uidActual.c_str());
}

void concederAcceso() {
  inicioConcedido = millis();
  requiereRetiroTarjeta = true;
  tarjetaAusenteDesde = 0;
  activarRele();
  cambiarEstadoAcceso(ST_CONCEDIDO);
  Serial.println("[ACCESO] AUTORIZADO. Rele abierto 3 s.");
}

void denegarAcceso(const String& motivo) {
  ultimoMotivo = motivo;
  inicioDenegado = millis();
  requiereRetiroTarjeta = true;
  tarjetaAusenteDesde = 0;
  cambiarEstadoAcceso(ST_DENEGADO);
  Serial.printf("[ACCESO] DENEGADO: %s\n", motivo.c_str());
}

void finalizarAcceso() {
  uidActual = "";
  slotActual = -1;
  consultaPendiente = false;
  requiereRetiroTarjeta = true;
  tarjetaAusenteDesde = 0;
  cambiarEstadoAcceso(ST_REPOSO);
}

void loopAcceso() {
  switch (estadoAcceso) {

    case ST_REPOSO: {
      // Evita re-leer la misma tarjeta que quedó apoyada sobre el lector.
      if (requiereRetiroTarjeta) {
        if (!tarjetaPresente()) {
          if (tarjetaAusenteDesde == 0) {
            tarjetaAusenteDesde = millis();
          } else if (millis() - tarjetaAusenteDesde >= MS_RETIRO_TARJETA) {
            requiereRetiroTarjeta = false;
            tarjetaAusenteDesde = 0;
            Serial.println("[RFID] Tarjeta retirada. Lector habilitado.");
          }
        } else {
          tarjetaAusenteDesde = 0;
        }
        return;
      }

      if (!rfidDisponible) return;

      if (!horaValida()) {
        static unsigned long ultimoAviso = 0;
        if (millis() - ultimoAviso > 5000) {
          ultimoAviso = millis();
          Serial.println("[ACCESO] Esperando hora NTP valida para operar.");
        }
        return;
      }

      if (millis() - ultimoPollRfid < MS_POLL_RFID) return;
      ultimoPollRfid = millis();

      String uid;
      if (leerTarjetaUID(uid)) {
        iniciarAcceso(uid);
      }
      break;
    }

    case ST_TARJETA: {
      if (millis() - tiempoEstado < 250) return;

      if (!fingerprintDisponible) {
        denegarAcceso("SENSOR_HUELLA_NO_DISPONIBLE");
        return;
      }

      inicioEsperaHuella = millis();
      ultimoPollHuella = 0;
      cambiarEstadoAcceso(ST_ESPERA_HUELLA);
      Serial.println("[ACCESO] Coloque el dedo en el R307 (max 10 s).");
      break;
    }

    case ST_ESPERA_HUELLA: {
      if (millis() - inicioEsperaHuella >= MS_ESPERA_HUELLA) {
        denegarAcceso("TIMEOUT_HUELLA");
        return;
      }
      if (!fingerprintDisponible) {
        denegarAcceso("SENSOR_HUELLA_NO_DISPONIBLE");
        return;
      }
      if (millis() - ultimoPollHuella < MS_POLL_HUELLA) return;
      ultimoPollHuella = millis();

      uint8_t p = finger.getImage();
      if (p == FINGERPRINT_NOFINGER) return;
      if (p != FINGERPRINT_OK) {
        Serial.printf("[HUELLA] getImage error 0x%02X\n", p);
        return;
      }

      p = finger.image2Tz(1);
      if (p != FINGERPRINT_OK) {
        Serial.printf("[HUELLA] image2Tz error 0x%02X\n", p);
        return;
      }

      p = finger.fingerFastSearch();
      if (p == FINGERPRINT_OK) {
        slotActual = (int)finger.fingerID;
        Serial.printf("[HUELLA] Coincidencia local. Slot=%d confianza=%u\n",
                      slotActual, (unsigned)finger.confidence);
        consultaPendiente = true;
        cambiarEstadoAcceso(ST_CONSULTA_BACKEND);
        return;
      }

      if (p == FINGERPRINT_NOTFOUND) {
        Serial.println("[HUELLA] Sin coincidencia. Reintente hasta 10 s.");
      } else {
        Serial.printf("[HUELLA] fingerFastSearch error 0x%02X\n", p);
      }
      break;
    }

    case ST_CONSULTA_BACKEND:
      if (consultaPendiente) {
        consultaPendiente = false;
        procesarConsultaBackend();
      }
      break;

    case ST_CONCEDIDO:
      if (millis() - inicioConcedido >= MS_CONCEDIDO) {
        finalizarAcceso();
      }
      break;

    case ST_DENEGADO:
      if (millis() - inicioDenegado >= MS_DENEGADO) {
        finalizarAcceso();
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// EVENTO DE ACCESO Y CONSULTA AL BACKEND
// ---------------------------------------------------------------------------
String construirEventoAcceso(const String& uuid, const String& uid, int slot,
                             const String& occurred, const String& resultado,
                             const String& motivo) {
  JsonDocument doc;
  doc["event_uuid"] = uuid;
  doc["rfid_uid"] = uid;
  doc["fingerprint_template_id"] = slot;
  doc["occurred_at"] = occurred;
  doc["resultado"] = resultado;
  if (motivo.length() == 0) doc["motivo"] = nullptr;
  else doc["motivo"] = motivo;
  doc["firmware_version"] = FW_VERSION;

  if (WiFi.status() == WL_CONNECTED) {
    doc["rssi"] = WiFi.RSSI();
  }

  String salida;
  serializeJson(doc, salida);
  return salida;
}

void procesarConsultaBackend() {
  if (uidActual.length() == 0 || slotActual <= 0) {
    denegarAcceso("DATOS_ACCESO_INVALIDOS");
    return;
  }
  if (!horaValida()) {
    denegarAcceso("SIN_NTP");
    return;
  }

  String uuid = generarUuidV4();
  String occurred = ahoraIso8601();
  String url = config.accessUrl;

  if (WiFi.status() != WL_CONNECTED) {
    String body = construirEventoAcceso(uuid, uidActual, slotActual, occurred,
                                        "DENEGADO", "SIN_WIFI");
    guardarEventoOffline(uuid, body);
    denegarAcceso("SIN_WIFI");
    return;
  }

  String body = construirEventoAcceso(uuid, uidActual, slotActual, occurred,
                                      "PERMITIDO", "");
  Serial.printf("[HTTP] POST access-webhook (uuid=%s)\n", uuid.c_str());
  RespuestaHttp r = postJson(url, body, MS_TIMEOUT_HTTP);

  if (r.codigo == 200) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, r.cuerpo);
    if (err) {
      Serial.printf("[HTTP] Respuesta JSON invalida: %s\n", err.c_str());
      denegarAcceso("RESPUESTA_INVALIDA");
      return;
    }

    bool autorizado = doc["autorizado"] | false;
    String motivo;
    String nombre;
    if (doc["motivo"].is<const char*>()) {
      motivo = doc["motivo"].as<const char*>();
    }
    if (doc["nombre"].is<const char*>()) {
      nombre = doc["nombre"].as<const char*>();
    }

    if (autorizado) {
      if (nombre.length() > 0) {
        Serial.printf("[HTTP] Autorizado. Usuario: %s\n", nombre.c_str());
      } else {
        Serial.println("[HTTP] Autorizado.");
      }
      concederAcceso();
    } else {
      if (motivo.length() == 0) motivo = "DENEGADO";
      Serial.printf("[HTTP] Denegado por backend: %s\n", motivo.c_str());
      denegarAcceso(motivo);
    }
    return;
  }

  if (r.codigo <= 0) {
    Serial.printf("[HTTP] Error de red/timeout (%d). Evento a cola offline.\n", r.codigo);
    String bodyOff = construirEventoAcceso(uuid, uidActual, slotActual, occurred,
                                           "DENEGADO", "TIMEOUT_CONSULTA");
    guardarEventoOffline(uuid, bodyOff);
    denegarAcceso("TIMEOUT_CONSULTA");
    return;
  }

  String motivoHttp = "ERROR_HTTP_" + String(r.codigo);
  Serial.printf("[HTTP] access-webhook respondio %d. %s\n",
                r.codigo, r.cuerpo.c_str());

  // 400/422 indican payload invalido: reintentar no sirve.
  if (r.codigo == 400 || r.codigo == 422) {
    denegarAcceso(motivoHttp);
    return;
  }

  // 401/403/404/429/5xx: se conserva para reintentar cuando se corrija la red
  // o la configuración.
  String bodyOff = construirEventoAcceso(uuid, uidActual, slotActual, occurred,
                                         "DENEGADO", motivoHttp);
  guardarEventoOffline(uuid, bodyOff);
  denegarAcceso(motivoHttp);
}

// ---------------------------------------------------------------------------
// COLA OFFLINE EN LITTLEFS
// ---------------------------------------------------------------------------
int contarEventosOffline() {
  if (!LittleFS.exists("/pending")) return 0;

  File dir = LittleFS.open("/pending");
  if (!dir) return 0;

  int total = 0;
  File f = dir.openNextFile();
  while (f) {
    if (!f.isDirectory()) total++;
    f.close();
    f = dir.openNextFile();
  }
  dir.close();
  return total;
}

bool guardarEventoOffline(const String& uuid, const String& payload) {
  if (!LittleFS.exists("/pending")) {
    LittleFS.mkdir("/pending");
  }

  int total = contarEventosOffline();
  if (total >= MAX_EVENTOS_COLA) {
    Serial.printf("[COLA] Llena (%d). Se descarta evento %s\n",
                  total, uuid.c_str());
    return false;
  }

  // LittleFS asigna bloques completos (4 KB) por archivo. No basta con mirar
  // el tamaño del JSON: hay que reservar al menos un bloque adicional.
  size_t totalBytes = LittleFS.totalBytes();
  size_t usedBytes = LittleFS.usedBytes();
  size_t libre = (totalBytes > usedBytes) ? (totalBytes - usedBytes) : 0;
  size_t necesario = payload.length() + 4096;
  if (libre < necesario) {
    Serial.printf("[COLA] Sin espacio LittleFS (libre=%u, necesita=%u). "
                  "Se descarta evento %s\n",
                  (unsigned)libre, (unsigned)necesario, uuid.c_str());
    return false;
  }

  String path = "/pending/" + uuid + ".json";
  File f = LittleFS.open(path, "w");
  if (!f) {
    Serial.printf("[COLA] ERROR: no se pudo crear %s\n", path.c_str());
    return false;
  }
  size_t escritos = f.print(payload);
  f.close();

  if (escritos != payload.length()) {
    Serial.printf("[COLA] ERROR: escritura incompleta en %s (%u/%u)\n",
                  path.c_str(), (unsigned)escritos, (unsigned)payload.length());
    LittleFS.remove(path);
    return false;
  }

  Serial.printf("[COLA] Evento guardado (%d en cola): %s\n",
                total + 1, path.c_str());
  return true;
}

void reenviarColaOffline(uint8_t maxEnvios) {
  if (!LittleFS.exists("/pending")) return;

  uint8_t enviados = 0;
  while (enviados < maxEnvios) {
    // Se reabre el directorio en cada iteración para que eliminar el archivo
    // actual no invalide el iterador de LittleFS.
    File dir = LittleFS.open("/pending");
    if (!dir) return;

    File f = dir.openNextFile();
    while (f && f.isDirectory()) {
      f.close();
      f = dir.openNextFile();
    }

    if (!f) {
      dir.close();
      return;
    }

    String nombre = f.name();
    String path = nombre.startsWith("/") ? nombre : (String("/pending/") + nombre);
    String payload = f.readString();
    f.close();
    dir.close();

    if (payload.length() == 0) {
      if (!LittleFS.remove(path)) {
        Serial.printf("[COLA] No se pudo eliminar archivo vacio %s\n", path.c_str());
        return;
      }
      enviados++;
      continue;
    }

    Serial.printf("[COLA] Reenviando %s\n", path.c_str());
    RespuestaHttp r = postJson(config.accessUrl, payload, MS_TIMEOUT_HTTP);

    bool eliminar = (r.codigo == 200 || r.codigo == 400 || r.codigo == 422);
    if (eliminar) {
      if (!LittleFS.remove(path)) {
        Serial.printf("[COLA] No se pudo eliminar %s\n", path.c_str());
        return;
      }
      enviados++;
      if (r.codigo == 200) {
        Serial.printf("[COLA] Enviado y eliminado: %s\n", path.c_str());
      } else {
        Serial.printf("[COLA] Descartado por HTTP %d: %s\n", r.codigo, path.c_str());
      }
    } else {
      Serial.printf("[COLA] Se conserva %s (HTTP %d)\n", path.c_str(), r.codigo);
      return;
    }
  }
}

void tareaReenvioCola() {
  if (reinicioSolicitado) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (!horaValida()) return;
  if (comando.activo || hayComandoPendiente || reporteComando.valido) return;
  if (estadoAcceso != ST_REPOSO) return;
  if (millis() - ultimoReenvioCola < MS_REENVIO_COLA) return;

  ultimoReenvioCola = millis();
  if (contarEventosOffline() == 0) return;

  Serial.println("[COLA] Reintentando eventos offline...");
  reenviarColaOffline(MAX_ENVIOS_COLA);
}

// ---------------------------------------------------------------------------
// DEVICE-SYNC: HEARTBEAT, COMANDOS Y REPORTE DE PASOS
// ---------------------------------------------------------------------------
bool comandoVencido() {
  if (!comando.activo) return false;
  if (comando.expiraEn > 0 && horaValida()) {
    return time(nullptr) >= comando.expiraEn;
  }
  return (millis() - comando.recibidoMs) > MS_COMANDO_MAX;
}

bool validarSlotComando() {
  bool requiereSlot = (comando.tipo == "ENROLL_USUARIO" ||
                       comando.tipo == "DELETE_HUELLA");
  if (!requiereSlot) return true;

  // El backend valida el rango 1..999. La capacidad real del R307 se
  // comprueba al hacer loadModel/storeModel; no se usa finger.capacity aquí
  // porque el valor por defecto de la librería (64) puede no coincidir con
  // el sensor real (habitualmente 127).
  const int maxSlot = 999;
  if (comando.slot < 1 || comando.slot > maxSlot) {
    Serial.printf("[CMD] Slot invalido: %d (rango 1..%d)\n", comando.slot, maxSlot);
    finalizarComando("FALLIDO", "SLOT_INVALIDO", "SLOT_FUERA_DE_RANGO");
    return false;
  }
  return true;
}

void prepararReporte(const String& estado, const String& paso,
                     const String& motivo) {
  if (!comando.activo) return;

  reporteComando.valido = true;
  reporteComando.id = comando.id;
  reporteComando.tipo = comando.tipo;
  reporteComando.estado = estado;
  reporteComando.paso = paso;
  reporteComando.motivo = motivo;
  reporteComando.rfid = comando.uid;
  reporteComando.slot = comando.slot;
  reporteComando.incluirRfid =
      (comando.tipo == "ENROLL_USUARIO" && comando.uid.length() > 0);
  reporteComando.incluirSlot =
      (comando.slot >= 1 && comando.slot <= 999 &&
       (comando.tipo == "ENROLL_USUARIO" ||
        comando.tipo == "DELETE_HUELLA"));

  Serial.printf("[CMD] Reporte: id=%s estado=%s paso=%s motivo=%s\n",
                reporteComando.id.c_str(), estado.c_str(), paso.c_str(),
                motivo.c_str());
}

void finalizarComando(const String& estado, const String& paso,
                      const String& motivo) {
  if (!comando.activo) return;

  String estadoFinal = estado;
  String pasoFinal = paso;
  String motivoFinal = motivo;

  // Protección: un ENROLL no puede completarse sin tarjeta y slot.
  if (estadoFinal == "COMPLETADO" && comando.tipo == "ENROLL_USUARIO" &&
      (comando.uid.length() == 0 || comando.slot <= 0)) {
    estadoFinal = "FALLIDO";
    pasoFinal = "DATOS_INCOMPLETOS";
    motivoFinal = "TARJETA_O_SLOT_FALTANTE";
  }

  bool esReinicio = (comando.tipo == "REINICIAR" ||
                     comando.tipo == "RESTART" ||
                     comando.tipo == "REBOOT");
  String tipoComando = comando.tipo;

  prepararReporte(estadoFinal, pasoFinal, motivoFinal);

  comando.activo = false;
  comando.estado = CMD_NINGUNO;

  estadoAcceso = ST_REPOSO;
  consultaPendiente = false;
  requiereRetiroTarjeta = true;
  tarjetaAusenteDesde = 0;

  Serial.printf("[CMD] Finalizado %s: %s / %s\n",
                tipoComando.c_str(), estadoFinal.c_str(), motivoFinal.c_str());

  // Se intenta reportar de inmediato; si falla, queda pendiente para el
  // siguiente heartbeat.
  if (WiFi.status() == WL_CONNECTED && horaValida()) {
    enviarHeartbeat();
  }

  if (esReinicio && estadoFinal == "COMPLETADO") {
    reinicioSolicitado = true;
    if (!reporteComando.valido) {
      reiniciarEn = millis() + 1000;
    }
  }
}

void borrarPlantillaLocalReportada() {
  if (!reporteComando.valido) return;
  if (reporteComando.tipo != "ENROLL_USUARIO") return;
  if (reporteComando.estado != "COMPLETADO") return;
  if (reporteComando.slot < 1 || reporteComando.slot > 999) return;

  uint8_t p = finger.deleteModel(reporteComando.slot);
  Serial.printf("[SYNC] Plantilla local eliminada. deleteModel(%d)=0x%02X\n",
                reporteComando.slot, p);
}

void manejarConflictoSync(const String& error) {
  if (!reporteComando.valido) {
    Serial.printf("[SYNC] 409 sin reporte pendiente: %s\n", error.c_str());
    return;
  }

  if (error == "rfid_uid_ya_registrado" ||
      error == "fingerprint_slot_ya_registrado") {
    // El servidor rechazó la creación de credenciales. La huella ya se
    // almacenó localmente; se elimina para no dejar datos huérfanos.
    borrarPlantillaLocalReportada();
    reporteComando.estado = "FALLIDO";
    reporteComando.paso = "CONFLICTO_CREDENCIAL";
    reporteComando.motivo = error;
    Serial.printf("[SYNC] Reporte convertido a FALLIDO: %s\n", error.c_str());
    return;
  }

  if (error == "command_already_completed") {
    // El servidor ya había completado el comando; la plantilla local es
    // válida y no debe borrarse.
    reporteComando.valido = false;
    Serial.println("[SYNC] Comando ya completado. Reporte descartado.");
    return;
  }

  if (error == "command_not_active") {
    // El comando expiró o fue cancelado, pero la huella local ya se guardó.
    borrarPlantillaLocalReportada();
    reporteComando.valido = false;
    Serial.println("[SYNC] Comando no activo. Plantilla local eliminada.");
    return;
  }

  // Otro 409 (por ejemplo credential_conflict): no tiene sentido reintentar
  // indefinidamente. Si la huella ya se había guardado, se elimina.
  borrarPlantillaLocalReportada();
  reporteComando.valido = false;
  Serial.printf("[SYNC] 409 no manejado: %s. Reporte descartado.\n",
                error.c_str());
}

void procesarComandoJson(JsonVariant cmd) {
  if (cmd.isNull()) return;

  String id = cmd["id"].as<String>();
  String tipo = cmd["tipo"].as<String>();
  if (id.length() == 0 || tipo.length() == 0) {
    Serial.println("[SYNC] Comando sin id/tipo. Ignorado.");
    return;
  }

  if (comando.activo && id == comando.id) return;
  if (hayComandoPendiente && id == comandoPendiente.id) return;

  ComandoRemoto nuevo;
  nuevo.id = id;
  nuevo.tipo = tipo;
  nuevo.slot = cmd["fingerprint_slot"] | -1;
  nuevo.recibidoMs = millis();

  String expira = cmd["expires_at"].as<String>();
  nuevo.expiraEn = parseIso8601(expira);
  if (nuevo.expiraEn == 0) {
    nuevo.expiraEn = horaValida() ? (time(nullptr) + 300) : 0;
  }

  if (hayComandoPendiente) {
    Serial.printf("[SYNC] Ya hay comando pendiente (%s). Se ignora %s.\n",
                  comandoPendiente.tipo.c_str(), tipo.c_str());
    return;
  }

  comandoPendiente = nuevo;
  hayComandoPendiente = true;
  Serial.printf("[SYNC] Comando recibido: %s id=%s slot=%d\n",
                tipo.c_str(), id.c_str(), nuevo.slot);
}

void iniciarComandoPendiente() {
  if (!hayComandoPendiente || comando.activo) return;

  comando = comandoPendiente;
  hayComandoPendiente = false;
  comando.activo = true;
  comando.uid = "";
  comando.ultimoPoll = 0;
  comando.slotVerificado = false;

  consultaPendiente = false;
  estadoAcceso = ST_REPOSO;
  tarjetaAusenteDesde = 0;

  if (comando.tipo == "ENROLL_USUARIO") {
    comando.estado = CMD_RETIRAR_TARJETA_PREVIA;
  } else if (comando.tipo == "DELETE_HUELLA") {
    comando.estado = CMD_BORRAR_HUELLA;
  } else if (comando.tipo == "REINICIAR" ||
             comando.tipo == "RESTART" ||
             comando.tipo == "REBOOT") {
    comando.estado = CMD_REINICIAR;
  } else if (comando.tipo == "SYNC_SLOTS") {
    comando.estado = CMD_SYNC_SLOTS;
  } else {
    comando.estado = CMD_DESCONOCIDO;
  }

  Serial.printf("[CMD] Iniciando %s (id=%s, slot=%d)\n",
                comando.tipo.c_str(), comando.id.c_str(), comando.slot);
}

void loopComando() {
  if (!comando.activo) return;
  if (comando.estado == CMD_NINGUNO) {
    comando.activo = false;
    return;
  }

  if (comandoVencido()) {
    finalizarComando("FALLIDO", "EXPIRADO", "EXPIRADO");
    return;
  }

  bool necesitaSensor = (comando.tipo == "ENROLL_USUARIO" ||
                         comando.tipo == "DELETE_HUELLA");
  if (necesitaSensor && !fingerprintDisponible) {
    finalizarComando("FALLIDO", "SENSOR_NO_DISPONIBLE",
                     "R307_NO_DISPONIBLE");
    return;
  }

  if (!validarSlotComando()) return;

  // Antes de sobreescribir una plantilla local, verificar si el slot ya
  // contiene una huella. Solo se considera ocupado si loadModel devuelve OK.
  // Cualquier otro código (slot vacío, error de lectura puntual) se trata
  // como "no confirmado ocupado" para no bloquear el enrolamiento.
  if (comando.tipo == "ENROLL_USUARIO" && !comando.slotVerificado) {
    uint8_t p = finger.loadModel(comando.slot);
    if (p == FINGERPRINT_OK) {
      finalizarComando("FALLIDO", "SLOT_OCUPADO_LOCAL",
                       "SLOT_YA_TIENE_HUELLA");
      return;
    }
    comando.slotVerificado = true;
  }

  switch (comando.estado) {

    case CMD_RETIRAR_TARJETA_PREVIA: {
      if (!requiereRetiroTarjeta) {
        comando.estado = CMD_ESPERA_TARJETA;
        comando.ultimoPoll = 0;
        Serial.println("[CMD] Acerca la tarjeta RFID para el enrolamiento.");
        return;
      }

      if (!tarjetaPresente()) {
        if (tarjetaAusenteDesde == 0) {
          tarjetaAusenteDesde = millis();
        } else if (millis() - tarjetaAusenteDesde >= MS_RETIRO_TARJETA) {
          requiereRetiroTarjeta = false;
          tarjetaAusenteDesde = 0;
          comando.estado = CMD_ESPERA_TARJETA;
          comando.ultimoPoll = 0;
          Serial.println("[CMD] Tarjeta previa retirada. Acerca la nueva tarjeta.");
        }
      } else {
        tarjetaAusenteDesde = 0;
      }
      break;
    }

    case CMD_ESPERA_TARJETA: {
      if (millis() - comando.ultimoPoll < MS_POLL_RFID) return;
      comando.ultimoPoll = millis();

      String uid;
      if (leerTarjetaUID(uid)) {
        comando.uid = uid;
        requiereRetiroTarjeta = true;
        tarjetaAusenteDesde = 0;
        prepararReporte("EN_CURSO", "TARJETA_LEIDA", "");
        enviarHeartbeat();
        comando.estado = CMD_HUELLA_1;
        comando.ultimoPoll = 0;
        Serial.printf("[CMD] Tarjeta leida: %s. Coloca el dedo (1/2).\n",
                      uid.c_str());
      }
      break;
    }

    case CMD_HUELLA_1: {
      if (millis() - comando.ultimoPoll < MS_POLL_HUELLA) return;
      comando.ultimoPoll = millis();

      uint8_t p = finger.getImage();
      if (p == FINGERPRINT_NOFINGER) return;
      if (p != FINGERPRINT_OK) {
        Serial.printf("[CMD] getImage(1) error 0x%02X\n", p);
        return;
      }

      p = finger.image2Tz(1);
      if (p != FINGERPRINT_OK) {
        Serial.printf("[CMD] image2Tz(1) error 0x%02X\n", p);
        return;
      }

      prepararReporte("EN_CURSO", "HUELLA_1_OK", "");
      enviarHeartbeat();
      comando.estado = CMD_RETIRAR_DEDO;
      comando.ultimoPoll = 0;
      Serial.println("[CMD] Primera huella capturada. Retira el dedo.");
      break;
    }

    case CMD_RETIRAR_DEDO: {
      if (millis() - comando.ultimoPoll < MS_POLL_HUELLA) return;
      comando.ultimoPoll = millis();

      uint8_t p = finger.getImage();
      if (p == FINGERPRINT_NOFINGER) {
        prepararReporte("EN_CURSO", "DEDO_RETIRADO", "");
        enviarHeartbeat();
        comando.estado = CMD_HUELLA_2;
        comando.ultimoPoll = 0;
        Serial.println("[CMD] Dedo retirado. Coloca el mismo dedo (2/2).");
      } else if (p != FINGERPRINT_OK) {
        Serial.printf("[CMD] getImage(retiro) error 0x%02X\n", p);
      }
      break;
    }

    case CMD_HUELLA_2: {
      if (millis() - comando.ultimoPoll < MS_POLL_HUELLA) return;
      comando.ultimoPoll = millis();

      uint8_t p = finger.getImage();
      if (p == FINGERPRINT_NOFINGER) return;
      if (p != FINGERPRINT_OK) {
        Serial.printf("[CMD] getImage(2) error 0x%02X\n", p);
        return;
      }

      p = finger.image2Tz(2);
      if (p != FINGERPRINT_OK) {
        Serial.printf("[CMD] image2Tz(2) error 0x%02X\n", p);
        return;
      }

      prepararReporte("EN_CURSO", "HUELLA_2_OK", "");
      enviarHeartbeat();
      comando.estado = CMD_CREAR_MODELO;
      Serial.println("[CMD] Segunda huella capturada. Creando modelo...");
      break;
    }

    case CMD_CREAR_MODELO: {
      uint8_t p = finger.createModel();
      if (p == FINGERPRINT_OK) {
        prepararReporte("EN_CURSO", "MODELO_CREADO", "");
        enviarHeartbeat();
        comando.estado = CMD_GUARDAR;
        Serial.println("[CMD] Modelo creado. Guardando en slot...");
      } else if (p == FINGERPRINT_ENROLLMISMATCH) {
        finalizarComando("FALLIDO", "HUELLAS_NO_COINCIDEN",
                         "ENROLLMISMATCH");
      } else {
        finalizarComando("FALLIDO", "ERROR_CREAR_MODELO",
                         String("ERROR_0x") + String((unsigned)p, HEX));
      }
      break;
    }

    case CMD_GUARDAR: {
      uint8_t p = finger.storeModel(comando.slot);
      if (p == FINGERPRINT_OK) {
        finalizarComando("COMPLETADO", "HUELLA_GUARDADA", "OK");
      } else {
        finalizarComando("FALLIDO", "ERROR_GUARDAR_HUELLA",
                         String("ERROR_0x") + String((unsigned)p, HEX));
      }
      break;
    }

    case CMD_BORRAR_HUELLA: {
      uint8_t p = finger.deleteModel(comando.slot);
      if (p == FINGERPRINT_OK) {
        finalizarComando("COMPLETADO", "HUELLA_ELIMINADA", "OK");
      } else {
        finalizarComando("FALLIDO", "ERROR_BORRAR_HUELLA",
                         String("ERROR_0x") + String((unsigned)p, HEX));
      }
      break;
    }

    case CMD_REINICIAR:
      finalizarComando("COMPLETADO", "REINICIANDO", "OK");
      break;

    case CMD_SYNC_SLOTS:
      finalizarComando("COMPLETADO", "SIN_CAMBIOS", "OK");
      break;

    case CMD_DESCONOCIDO:
      finalizarComando("FALLIDO", "COMANDO_NO_SOPORTADO", comando.tipo);
      break;

    case CMD_NINGUNO:
    default:
      break;
  }
}

void enviarHeartbeat() {
  if (enHeartbeat) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (!horaValida()) return;
  if (config.syncUrl.length() == 0) return;

  enHeartbeat = true;

  JsonDocument doc;
  doc["firmware"] = FW_VERSION;
  doc["rssi"] = WiFi.RSSI();
  doc["ip"] = WiFi.localIP().toString();

  bool llevabaReporte = reporteComando.valido;
  if (llevabaReporte) {
    doc["command_id"] = reporteComando.id;
    doc["estado"] = reporteComando.estado;
    doc["paso"] = reporteComando.paso;
    if (reporteComando.incluirRfid) {
      doc["rfid_uid"] = reporteComando.rfid;
    }
    if (reporteComando.incluirSlot) {
      doc["fingerprint_slot"] = reporteComando.slot;
    }
    JsonObject detalle = doc["detalle"].to<JsonObject>();
    detalle["origen"] = "esp32";
    if (reporteComando.motivo.length() > 0) {
      detalle["motivo"] = reporteComando.motivo;
    }
  }

  String payload;
  serializeJson(doc, payload);

  if (llevabaReporte) {
    Serial.printf("[SYNC] Reportando comando %s: %s / %s\n",
                  reporteComando.id.c_str(), reporteComando.estado.c_str(),
                  reporteComando.paso.c_str());
  }

  RespuestaHttp r = postJson(config.syncUrl, payload, MS_TIMEOUT_SYNC);

  if (r.codigo == 200) {
    if (llevabaReporte) {
      reporteComando.valido = false;
    }

    JsonDocument respuesta;
    DeserializationError err = deserializeJson(respuesta, r.cuerpo);
    if (err) {
      Serial.printf("[SYNC] Respuesta JSON invalida: %s\n", err.c_str());
    } else {
      JsonVariant cmd = respuesta["command"];
      procesarComandoJson(cmd);
    }

    if (reinicioSolicitado && reiniciarEn == 0) {
      reiniciarEn = millis() + 1000;
    }
    ultimoHeartbeat = millis();
    enHeartbeat = false;
    return;
  }

  String error = "";
  JsonDocument errDoc;
  if (r.cuerpo.length() > 0 && !deserializeJson(errDoc, r.cuerpo)) {
    error = errDoc["error"].as<String>();
  }

  if (r.codigo == 409) {
    manejarConflictoSync(error);
  } else if (r.codigo == 400 || r.codigo == 422) {
    Serial.printf("[SYNC] Payload rechazado (%d): %s\n", r.codigo, error.c_str());
    borrarPlantillaLocalReportada();
    reporteComando.valido = false;
  } else if (r.codigo == 404 && error == "command_not_found") {
    Serial.println("[SYNC] El comando ya no existe. Reporte descartado.");
    borrarPlantillaLocalReportada();
    reporteComando.valido = false;
  } else {
    if (millis() - ultimoLogSync > 15000) {
      ultimoLogSync = millis();
      Serial.printf("[SYNC] Heartbeat falló (HTTP %d). Se reintentará.\n",
                    r.codigo);
    }
  }

  ultimoHeartbeat = millis();
  enHeartbeat = false;
}

void tareaHeartbeat() {
  if (config.syncUrl.length() == 0) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (!horaValida()) return;
  if (millis() - ultimoHeartbeat < MS_HEARTBEAT) return;
  enviarHeartbeat();
}

// ---------------------------------------------------------------------------
// OTA CON HTTPUPDATE (URL CONFIGURABLE)
// ---------------------------------------------------------------------------
void tareaOTA() {
  if (reinicioSolicitado) return;
  if (config.otaUrl.length() == 0) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (!horaValida()) return;
  if (otaEnCurso) return;
  if (comando.activo || hayComandoPendiente || reporteComando.valido) return;
  if (estadoAcceso != ST_REPOSO) return;
  if ((int32_t)(millis() - proximoChequeoOTA) < 0) return;

  realizarOTA();
}

void realizarOTA() {
  otaEnCurso = true;
  setLed(0, 0, 255);
  Serial.printf("[OTA] Comprobando actualizacion: %s\n", config.otaUrl.c_str());

  clienteHttps.stop();
  disableLoopWDT();

  httpUpdate.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  httpUpdate.rebootOnUpdate(true);

  t_httpUpdate_return ret;
  if (config.otaUrl.startsWith("https://")) {
    WiFiClientSecure clienteOta;
    clienteOta.setInsecure(); // Ver nota de seguridad al inicio del archivo.
    ret = httpUpdate.update(clienteOta, config.otaUrl, FW_VERSION);
  } else {
    WiFiClient clienteOta;
    ret = httpUpdate.update(clienteOta, config.otaUrl, FW_VERSION);
  }

  enableLoopWDT();
  feedLoopWDT();
  otaEnCurso = false;

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("[OTA] Falló (%d): %s\n",
                    httpUpdate.getLastError(),
                    httpUpdate.getLastErrorString().c_str());
      proximoChequeoOTA = millis() + MS_OTA_REINTENTO;
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[OTA] No hay actualizaciones disponibles.");
      proximoChequeoOTA = millis() + MS_OTA_PERIODICO;
      break;
    case HTTP_UPDATE_OK:
      Serial.println("[OTA] Actualización aplicada. Reiniciando...");
      ESP.restart();
      break;
  }
}