import { createClient } from "@supabase/supabase-js";

type AccessResult = "PERMITIDO" | "DENEGADO";

interface AccessEventPayload {
  event_uuid: string;
  device_id: string;
  rfid_uid: string;
  fingerprint_template_id: number;
  occurred_at: string;
  resultado: AccessResult;
  motivo: string | null;
}

const jsonResponse = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isUuidV4 = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function isAccessEventPayload(value: unknown): value is AccessEventPayload {
  if (!isRecord(value)) return false;
  return isUuidV4(value.event_uuid) &&
    isUuid(value.device_id) &&
    typeof value.rfid_uid === "string" &&
    Number.isInteger(value.fingerprint_template_id) &&
    (value.fingerprint_template_id as number) >= 0 &&
    typeof value.occurred_at === "string" &&
    Number.isFinite(Date.parse(value.occurred_at)) &&
    (value.resultado === "PERMITIDO" || value.resultado === "DENEGADO") &&
    (value.motivo === null || typeof value.motivo === "string");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const contentType = request.headers.get("content-type");
  if (!contentType || !/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    return jsonResponse({ error: "content_type_must_be_application_json" }, 400);
  }

  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey) return jsonResponse({ error: "invalid_api_key" }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (!isAccessEventPayload(payload)) {
    return jsonResponse({ error: "invalid_payload" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse({ error: "server_configuration_error" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const apiKeyHash = await sha256Hex(apiKey);
  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id")
    .eq("api_key_hash", apiKeyHash)
    .eq("estado", "ACTIVO")
    .maybeSingle();

  if (deviceError) {
    console.error("Device lookup failed:", deviceError.message);
    return jsonResponse({ error: "database_error" }, 500);
  }
  if (!device || device.id !== payload.device_id) {
    return jsonResponse({ error: "invalid_api_key" }, 401);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("access_events")
    .insert({
      event_uuid: payload.event_uuid,
      device_id: payload.device_id,
      user_id: null,
      rfid_uid: payload.rfid_uid,
      fingerprint_template_id: payload.fingerprint_template_id,
      resultado: payload.resultado,
      motivo: payload.motivo,
      occurred_at: payload.occurred_at,
    })
    .select("id")
    .single();

  if (insertError?.code === "23505") {
    return jsonResponse({ status: "duplicate" });
  }
  if (insertError || !inserted) {
    console.error("Event insert failed:", insertError?.message ?? "No row returned");
    return jsonResponse({ error: "database_error" }, 500);
  }

  return jsonResponse({ status: "stored", id: inserted.id });
});
