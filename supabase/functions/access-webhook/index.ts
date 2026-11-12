import { createClient } from "@supabase/supabase-js";

type AccessResult = "PERMITIDO" | "DENEGADO";

interface DeviceEventPayload {
  event_uuid: string;
  rfid_uid: string;
  fingerprint_template_id: number;
  occurred_at: string;
  resultado: AccessResult;
  motivo: string | null;
  firmware_version?: string;
  rssi?: number;
}

interface StoredAccessEvent {
  event_id: string;
  duplicate: boolean;
  device_id: string;
  user_id: string | null;
  resultado: string;
  motivo: string | null;
  attendance_action: string;
}

type CredentialState =
  | { kind: "found"; userId: string }
  | { kind: "missing" }
  | { kind: "ambiguous" };

const jsonResponse = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUuidV4 = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function isDeviceEventPayload(value: unknown): value is DeviceEventPayload {
  if (!isRecord(value)) return false;

  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(value, key);
  const hasTimezone = typeof value.occurred_at === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value.occurred_at);

  return isUuidV4(value.event_uuid) &&
    typeof value.rfid_uid === "string" &&
    value.rfid_uid.trim().length > 0 &&
    value.rfid_uid.trim().length <= 64 &&
    Number.isInteger(value.fingerprint_template_id) &&
    (value.fingerprint_template_id as number) >= 1 &&
    (value.fingerprint_template_id as number) <= 999 &&
    hasTimezone &&
    Number.isFinite(Date.parse(value.occurred_at as string)) &&
    (value.resultado === "PERMITIDO" || value.resultado === "DENEGADO") &&
    hasOwn("motivo") &&
    (value.motivo === null || typeof value.motivo === "string") &&
    (value.firmware_version === undefined ||
      (typeof value.firmware_version === "string" && value.firmware_version.length <= 64)) &&
    (value.rssi === undefined ||
      (Number.isInteger(value.rssi) && (value.rssi as number) >= -127 && (value.rssi as number) <= 0));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseStoredEvent(value: unknown): StoredAccessEvent | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!isRecord(candidate)) return null;
  if (typeof candidate.event_id !== "string" ||
    typeof candidate.device_id !== "string" ||
    typeof candidate.duplicate !== "boolean" ||
    typeof candidate.resultado !== "string" ||
    typeof candidate.attendance_action !== "string") return null;

  return {
    event_id: candidate.event_id,
    duplicate: candidate.duplicate,
    device_id: candidate.device_id,
    user_id: typeof candidate.user_id === "string" ? candidate.user_id : null,
    resultado: candidate.resultado,
    motivo: typeof candidate.motivo === "string" ? candidate.motivo : null,
    attendance_action: candidate.attendance_action,
  };
}

function apiKeyError(): Response {
  return jsonResponse({ error: "api_key_invalida" }, 401);
}

Deno.serve(async (request: Request): Promise<Response> => {
  console.log(`[access-webhook] Solicitud ${request.method}`);

  if (request.method !== "POST") {
    console.log("[access-webhook] Método rechazado");
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    console.log("[access-webhook] Content-Type rechazado");
    return jsonResponse({ error: "content_type_must_be_application_json" }, 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    console.log("[access-webhook] JSON inválido", error);
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  if (!isDeviceEventPayload(body)) {
    console.log("[access-webhook] Payload inválido o event_uuid ausente/no v4");
    return jsonResponse({ error: "invalid_payload" }, 400);
  }

  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey || apiKey.trim().length === 0) {
    console.log("[access-webhook] Falta X-API-Key");
    return apiKeyError();
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[access-webhook] Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse({ error: "server_configuration_error" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let apiKeyHash: string;
  try {
    apiKeyHash = await sha256Hex(apiKey);
  } catch (error) {
    console.error("[access-webhook] No se pudo calcular SHA-256", error);
    return jsonResponse({ error: "server_error" }, 500);
  }

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id")
    .eq("api_key_hash", apiKeyHash)
    .eq("estado", "ACTIVO")
    .maybeSingle();

  if (deviceError) {
    console.error("[access-webhook] Error al buscar el dispositivo", deviceError.message);
    return jsonResponse({ error: "database_error" }, 500);
  }
  if (!device) {
    console.log("[access-webhook] API key sin dispositivo activo");
    return apiKeyError();
  }

  const deviceUpdate: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
  if (ip && ip.length <= 64) deviceUpdate.ip = ip;
  if (body.firmware_version !== undefined) deviceUpdate.firmware_version = body.firmware_version;
  if (body.rssi !== undefined) deviceUpdate.rssi = body.rssi;

  const { error: updateDeviceError } = await supabase
    .from("devices")
    .update(deviceUpdate)
    .eq("id", device.id);
  if (updateDeviceError) {
    // El registro del evento es más importante que las métricas no esenciales del dispositivo.
    console.error("[access-webhook] No se pudieron actualizar metadatos del dispositivo", updateDeviceError.message);
  }

  const eventUuid = body.event_uuid.toLowerCase();

  async function duplicateResponse(event: {
    device_id: string;
    user_id: string | null;
    resultado: string;
    motivo: string | null;
  }): Promise<Response> {
    if (event.device_id !== device.id) {
      console.log(`[access-webhook] UUID duplicado en otro dispositivo: ${eventUuid}`);
      return jsonResponse({ autorizado: false, motivo: "EVENTO_DUPLICADO", nombre: null });
    }

    let nombre: string | null = null;
    if (event.user_id) {
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("nombre")
        .eq("id", event.user_id)
        .maybeSingle();
      if (userError) {
        console.error("[access-webhook] No se pudo leer el nombre del evento duplicado", userError.message);
      } else if (user && typeof user.nombre === "string") {
        nombre = user.nombre;
      }
    }

    console.log(`[access-webhook] Evento duplicado ${eventUuid}; se devuelve el resultado almacenado`);
    return jsonResponse({
      autorizado: event.resultado === "PERMITIDO",
      motivo: event.motivo ?? "EVENTO_DUPLICADO",
      nombre,
    });
  }

  // Idempotencia temprana: una repetición devuelve el resultado original aun si
  // las credenciales cambiaron después del primer intento.
  const { data: existingEvent, error: existingEventError } = await supabase
    .from("access_events")
    .select("device_id,user_id,resultado,motivo")
    .eq("event_uuid", eventUuid)
    .maybeSingle();

  if (existingEventError) {
    console.error("[access-webhook] Error al comprobar idempotencia", existingEventError.message);
    return jsonResponse({ error: "database_error" }, 500);
  }
  if (existingEvent) return await duplicateResponse(existingEvent);

  async function findCredential(tipo: "RFID" | "HUELLA", column: "rfid_uid" | "fingerprint_template_id", value: string | number): Promise<CredentialState> {
    const { data, error } = await supabase
      .from("credentials")
      .select("user_id")
      .eq("device_id", device.id)
      .eq("tipo", tipo)
      .eq("activo", true)
      .eq(column, value)
      .limit(2);

    if (error) {
      throw new Error(`consulta credential ${tipo}: ${error.message}`);
    }
    if (!data || data.length === 0) return { kind: "missing" };
    if (data.length > 1) return { kind: "ambiguous" };
    if (typeof data[0].user_id !== "string") return { kind: "missing" };
    return { kind: "found", userId: data[0].user_id };
  }

  let rfidCredential: CredentialState;
  let fingerprintCredential: CredentialState;
  try {
    [rfidCredential, fingerprintCredential] = await Promise.all([
      findCredential("RFID", "rfid_uid", body.rfid_uid.trim()),
      findCredential("HUELLA", "fingerprint_template_id", body.fingerprint_template_id),
    ]);
  } catch (error) {
    console.error("[access-webhook] Error al resolver credenciales", error);
    return jsonResponse({ error: "database_error" }, 500);
  }

  let autorizado = false;
  let motivo = "CREDENCIALES_NO_VALIDAS";
  let userId: string | null = null;
  let nombre: string | null = null;

  if (rfidCredential.kind === "ambiguous" || fingerprintCredential.kind === "ambiguous") {
    motivo = "CREDENCIAL_AMBIGUA";
    console.error("[access-webhook] Hay credenciales duplicadas para el dispositivo");
  } else if (rfidCredential.kind === "missing") {
    motivo = "RFID_NO_REGISTRADO";
    console.log(`[access-webhook] RFID no registrado: ${body.rfid_uid}`);
  } else if (fingerprintCredential.kind === "missing") {
    motivo = "HUELLA_NO_REGISTRADA";
    console.log(`[access-webhook] Huella no registrada: ${body.fingerprint_template_id}`);
  } else if (rfidCredential.userId !== fingerprintCredential.userId) {
    motivo = "CREDENCIALES_NO_COINCIDEN";
    console.log("[access-webhook] RFID y huella pertenecen a usuarios distintos");
  } else {
    userId = rfidCredential.userId;
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id,nombre,estado")
      .eq("id", userId)
      .maybeSingle();

    if (userError) {
      console.error("[access-webhook] Error al consultar el usuario", userError.message);
      return jsonResponse({ error: "database_error" }, 500);
    }
    if (!user) {
      userId = null;
      motivo = "USUARIO_NO_ENCONTRADO";
      console.log("[access-webhook] El usuario de las credenciales no existe");
    } else if (user.estado !== "ACTIVO") {
      nombre = typeof user.nombre === "string" ? user.nombre : null;
      motivo = "USUARIO_INACTIVO";
      console.log(`[access-webhook] Usuario inactivo: ${user.id}`);
    } else {
      autorizado = true;
      motivo = "ACCESO_PERMITIDO";
      nombre = typeof user.nombre === "string" ? user.nombre : null;
      console.log(`[access-webhook] Acceso autorizado para ${user.id}`);
    }
  }

  const resultadoBackend: AccessResult = autorizado ? "PERMITIDO" : "DENEGADO";
  if (body.resultado !== resultadoBackend) {
    console.log(`[access-webhook] Resultado ESP ${body.resultado}; backend ${resultadoBackend}`);
  }
  console.log(`[access-webhook] Motivo ESP: ${body.motivo ?? "(sin motivo)"}`);

  const { data: recordData, error: recordError } = await supabase.rpc("record_access_event", {
    p_event_uuid: eventUuid,
    p_device_id: device.id,
    p_user_id: userId,
    p_rfid_uid: body.rfid_uid.trim(),
    p_fingerprint_template_id: body.fingerprint_template_id,
    p_resultado: resultadoBackend,
    p_motivo: motivo,
    p_occurred_at: new Date(body.occurred_at).toISOString(),
    p_resultado_esp: body.resultado,
  });

  if (recordError?.code === "23505") {
    const { data: duplicate, error: duplicateError } = await supabase
      .from("access_events")
      .select("device_id,user_id,resultado,motivo")
      .eq("event_uuid", eventUuid)
      .maybeSingle();
    if (duplicateError || !duplicate) {
      console.error("[access-webhook] UNIQUE(event_uuid) y no se pudo leer el duplicado", duplicateError?.message);
      return jsonResponse({ error: "database_error" }, 500);
    }
    return await duplicateResponse(duplicate);
  }
  if (recordError) {
    console.error("[access-webhook] No se pudo insertar el evento", recordError.message);
    return jsonResponse({ error: "database_error" }, 500);
  }

  const storedEvent = parseStoredEvent(recordData);
  if (!storedEvent) {
    console.error("[access-webhook] record_access_event no devolvió un evento válido", recordData);
    return jsonResponse({ error: "database_error" }, 500);
  }

  if (storedEvent.duplicate) {
    return await duplicateResponse(storedEvent);
  }

  console.log(`[access-webhook] Evento ${eventUuid} guardado; asistencia=${storedEvent.attendance_action}`);
  return jsonResponse({ autorizado, motivo, nombre });
});
