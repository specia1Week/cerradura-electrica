// Última modificación: 2026-11-10
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessEventRecord } from '@/lib/types';

const BATCH_SIZE = 1000;
const MAX_EVENTS = 50_000;

/**
 * Supabase limita una respuesta a 1000 filas por defecto. El dashboard necesita
 * todos los eventos del día para que los contadores y el gráfico sean exactos,
 * así que se pagina en lotes.
 */
export async function fetchAccessEventsForRange(
  supabase: SupabaseClient,
  start: string,
  end: string,
) {
  const events: AccessEventRecord[] = [];

  for (let offset = 0; offset < MAX_EVENTS; offset += BATCH_SIZE) {
    const { data, error } = await supabase
      .from('access_events')
      .select(
        'id, device_id, user_id, rfid_uid, fingerprint_template_id, resultado, resultado_esp, motivo, intentos_huella, occurred_at, received_at, event_uuid',
      )
      .gte('occurred_at', start)
      .lte('occurred_at', end)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) throw new Error(error.message);

    const batch = (data ?? []) as AccessEventRecord[];
    events.push(...batch);
    if (batch.length < BATCH_SIZE) break;
  }

  return events;
}
