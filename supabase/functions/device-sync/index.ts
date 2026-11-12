import { createClient } from "@supabase/supabase-js";

type CommandState = "EN_CURSO" | "COMPLETADO" | "FALLIDO";

interface DeviceSyncPayload {
  firmware: string;
  rssi: number;
  ip: string;
  command_id?: string;
  estado?: CommandState;
  paso?: string;
  detalle?: Record<string, unknown>;
  rfid_uid?: string;
  fingerprint_slot?: number;
}

interface NextCommand {
  id: string;
  tipo: string;
  fingerprint_slot: number | null;
  expires_at: string;
}

interface RpcErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

const jsonResponse = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.trim().length <= maxLength;

const isIntegerInRange = (
  value: unknown,
  min: number,
  max: number,
): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

const isUuidV4 = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const isCommandState = (value: unknown): value is CommandState =>
  value === "EN_CURSO" || value === "COMPLETADO" || value === "FALLIDO";

function isDeviceSyncPayload(value: unknown): value is DeviceSyncPayload {
  if (!isRecord(value)) return false;

  return isNonEmptyString(value.firmware, 64) &&
    isIntegerInRange(value.rssi, -127, 0) &&
    isNonEmptyString(value.ip, 64) &&
    (value.command_id === undefined || isUuidV4(value.command_id)) &&
    (value.estado === undefined || isCommandState(value.estado)) &&
    (value.paso === undefined || isNonEmptyString(value.paso, 120)) &&
    (value.detalle === undefined || isRecord(value.detalle)) &&
    (value.rfid_uid === undefined || isNonEmptyString(value.rfid_uid, 64)) &&
    (value.fingerprint_slot === undefined ||
      isIntegerInRange(value.fingerprint_slot, 1, 999));
}

function isNextCommand(value: unknown): value is NextCommand {
  if (!isRecord(value)) return false;

  return typeof value.id === "string" &&
    typeof value.tipo === "string" &&
    (value.fingerprint_slot === null ||
      (typeof value.fingerprint_slot === "number" &&
        Number.isInteger(value.fingerprint_slot))) &&
    typeof value.expires_at === "string";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function apiKeyError(): Response {
  return jsonResponse({
    error: "api_key_invalida",
    message: "X-API-Key inválida o dispositivo inactivo.",
  }, 401);
}

const RPC_ERRORS: Record<string, { status: number; message: string }> = {
  device_id_requerido: {
    status: 400,
    message: "device_id es obligatorio.",
  },
  device_not_found: {
    status: 404,
    message: "El dispositivo no existe.",
  },
  command_not_found: {
    status: 404,
    message: "El comando no existe o no pertenece a este dispositivo.",
  },
  command_not_active: {
    status: 409,
    message: "El comando ya no está activo.",
  },
  command_already_completed: {
    status: 409,
    message: "El comando ya fue completado.",
  },
  estado_invalido: {
    status: 400,
    message: "El estado debe ser EN_CURSO, COMPLETADO o FALLIDO.",
  },
  fingerprint_slot_invalido: {
    status: 400,
    message: "fingerprint_slot debe estar entre 1 y 999.",
  },
  fingerprint_slot_mismatch: {
    status: 400,
    message: "fingerprint_slot no coincide con el reservado en el comando.",
  },
  fingerprint_slot_requerido: {
    status: 400,
    message: "fingerprint_slot es obligatorio para completar este comando.",
  },
  fingerprint_slot_ya_registrado: {
    status: 409,
    message: "El slot de huella ya está registrado en este dispositivo.",
  },
  rfid_uid_requerido: {
    status: 400,
    message: "rfid_uid es obligatorio para completar ENROLL_USUARIO.",
  },
  rfid_uid_ya_registrado: {
    status: 409,
    message: "El UID RFID ya está registrado en este dispositivo.",
  },
  command_user_required: {
    status: 400,
    message: "El comando ENROLL_USUARIO no tiene user_id.",
  },
};

function rpcErrorResponse(error: RpcErrorLike): Response {
  const rawMessage = error.message ?? "";
  const errorKey = Object.keys(RPC_ERRORS).find(
    (candidate) => rawMessage === candidate || rawMessage.includes(candidate),
  );

  if (errorKey) {
    const mapped = RPC_ERRORS[errorKey];
    console.error(`[device-sync] RPC ${errorKey}`, error.code ?? "sin_codigo");
    return jsonResponse({
      error: errorKey,
      message: mapped.message,
    }, mapped.status);
  }

  if (error.code === "PGRST202") {
    console.error(
      "[device-sync] RPC sync_device_commands no encontrada; falta aplicar la migración",
    );
    return jsonResponse({
      error: "migration_not_applied",
      message: "Falta aplicar la migración que crea sync_device_commands.",
    }, 500);
  }

  if (error.code === "23505") {
    console.error(
      "[device-sync] Conflicto de unicidad no identificado",
      error.message,
    );
    return jsonResponse({
      error: "credential_conflict",
      message: "La credencial entra en conflicto con otra ya registrada.",
    }, 409);
  }

  console.error("[device-sync] Error de base de datos", {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
  return jsonResponse({
    error: "database_error",
    message: "No se pudo procesar la sincronización.",
  }, 500);
}

Deno.serve(async (request: Request): Promise<Response> => {
  console.log(`[device-sync] Solicitud ${request.method}`);

  if (request.method !== "POST") {
    return jsonResponse({
      error: "method_not_allowed",
      message: "Este endpoint solo acepta POST.",
    }, 405);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    return jsonResponse({
      error: "content_type_must_be_application_json",
      message: "Usa Content-Type: application/json.",
    }, 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    console.log("[device-sync] JSON inválido", error);
    return jsonResponse({
      error: "invalid_json",
      message: "El cuerpo no es JSON válido.",
    }, 400);
  }

  if (!isDeviceSyncPayload(body)) {
    return jsonResponse({
      error: "invalid_payload",
      message:
        "Se requiere firmware (texto), rssi (entero -127..0) e ip (texto). " +
        "Los campos de comando deben tener el tipo correcto.",
    }, 400);
  }

  const hasCommandData = body.estado !== undefined ||
    body.paso !== undefined ||
    body.detalle !== undefined ||
    body.rfid_uid !== undefined ||
    body.fingerprint_slot !== undefined;

  if (!body.command_id && hasCommandData) {
    return jsonResponse({
      error: "command_id_requerido",
      message:
        "estado, paso, detalle, rfid_uid y fingerprint_slot requieren command_id.",
    }, 400);
  }

  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey || apiKey.trim().length === 0) {
    console.log("[device-sync] Falta X-API-Key");
    return apiKeyError();
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "[device-sync] Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY",
    );
    return jsonResponse({
      error: "server_configuration_error",
      message:
        "El servidor no tiene configuradas las credenciales de Supabase.",
    }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let apiKeyHash: string;
  try {
    apiKeyHash = await sha256Hex(apiKey);
  } catch (error) {
    console.error("[device-sync] No se pudo calcular SHA-256", error);
    return jsonResponse({
      error: "server_error",
      message: "No se pudo procesar la autenticación.",
    }, 500);
  }

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id")
    .eq("api_key_hash", apiKeyHash)
    .eq("estado", "ACTIVO")
    .maybeSingle();

  if (deviceError) {
    console.error(
      "[device-sync] Error al buscar el dispositivo",
      deviceError.message,
    );
    return jsonResponse({
      error: "database_error",
      message: "No se pudo verificar el dispositivo.",
    }, 500);
  }
  if (!device) {
    console.log("[device-sync] API key sin dispositivo activo");
    return apiKeyError();
  }

  // La actividad del dispositivo se actualiza fuera de la transacción de
  // comandos: si un comando falla (p. ej. UID duplicado), el heartbeat y las
  // métricas del ESP32 igualmente quedan registrados.
  const { error: touchError } = await supabase
    .from("devices")
    .update({
      last_seen_at: new Date().toISOString(),
      firmware_version: body.firmware.trim(),
      rssi: body.rssi,
      ip: body.ip.trim(),
    })
    .eq("id", device.id);

  if (touchError) {
    console.error(
      "[device-sync] No se pudieron actualizar los metadatos del dispositivo",
      touchError.message,
    );
    return jsonResponse({
      error: "database_error",
      message: "No se pudieron actualizar los metadatos del dispositivo.",
    }, 500);
  }

  const { data, error: rpcError } = await supabase.rpc("sync_device_commands", {
    p_device_id: device.id,
    p_command_id: body.command_id ?? null,
    p_estado: body.estado ?? null,
    p_paso: body.paso?.trim() ?? null,
    p_detalle: body.detalle ?? null,
    p_rfid_uid: body.rfid_uid?.trim() ?? null,
    p_fingerprint_slot: body.fingerprint_slot ?? null,
  });

  if (rpcError) {
    return rpcErrorResponse(rpcError);
  }

  if (data !== null && !isNextCommand(data)) {
    console.error(
      "[device-sync] sync_device_commands devolvió un comando inválido",
      data,
    );
    return jsonResponse({
      error: "database_error",
      message: "La base de datos devolvió un comando con formato inválido.",
    }, 500);
  }

  const command = data as NextCommand | null;
  console.log(`[device-sync] Comando siguiente: ${command?.id ?? "ninguno"}`);

  return jsonResponse({
    server_time: new Date().toISOString(),
    command,
  });
});
