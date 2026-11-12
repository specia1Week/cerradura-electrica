import type { NextRequest } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import {
  currentMonthStartInput,
  durationFromTimes,
  durationLabel,
  isValidDateInput,
  todayInputValue,
} from '@/lib/date';
import type {
  AttendanceRecord,
  DeviceRecord,
  UserRecord,
} from '@/lib/types';
import { isUuid } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 1000;
const MAX_ROWS = 20_000;

function csvCell(value: string | number | null | undefined) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  const context = await getAuthContext();
  if (!context) {
    return new Response('No autorizado', { status: 401 });
  }

  const { supabase } = context;
  const params = request.nextUrl.searchParams;
  const fromRaw = params.get('from');
  const toRaw = params.get('to');
  const userRaw = params.get('user');

  const fromDate = isValidDateInput(fromRaw)
    ? fromRaw
    : currentMonthStartInput();
  const toDate = isValidDateInput(toRaw) ? toRaw : todayInputValue();
  const userId = isUuid(userRaw) ? userRaw : undefined;

  const rows: AttendanceRecord[] = [];

  for (let offset = 0; offset < MAX_ROWS; offset += BATCH_SIZE) {
    let query = supabase
      .from('attendance')
      .select('*')
      .gte('fecha', fromDate)
      .lte('fecha', toDate)
      .order('fecha', { ascending: true })
      .order('hora_entrada', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) {
      return new Response(`No se pudo exportar: ${error.message}`, {
        status: 500,
      });
    }

    const batch = (data ?? []) as AttendanceRecord[];
    rows.push(...batch);
    if (batch.length < BATCH_SIZE) break;
  }

  const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
  const deviceIds = Array.from(new Set(rows.map((row) => row.device_id)));

  const [usersResult, devicesResult] = await Promise.all([
    userIds.length
      ? supabase.from('users').select('id, nombre, documento').in('id', userIds)
      : Promise.resolve({
          data: [] as Pick<UserRecord, 'id' | 'nombre' | 'documento'>[],
          error: null,
        }),
    deviceIds.length
      ? supabase.from('devices').select('id, nombre, mac').in('id', deviceIds)
      : Promise.resolve({
          data: [] as Pick<DeviceRecord, 'id' | 'nombre' | 'mac'>[],
          error: null,
        }),
  ]);

  if (usersResult.error || devicesResult.error) {
    return new Response('No se pudieron cargar los datos del reporte.', {
      status: 500,
    });
  }

  const userMap = new Map(
    ((usersResult.data ?? []) as Pick<UserRecord, 'id' | 'nombre' | 'documento'>[]).map(
      (user) => [user.id, user],
    ),
  );
  const deviceMap = new Map(
    ((devicesResult.data ?? []) as Pick<DeviceRecord, 'id' | 'nombre' | 'mac'>[]).map(
      (device) => [device.id, device],
    ),
  );

  const header = [
    'Fecha',
    'Documento',
    'Usuario',
    'Dispositivo',
    'MAC',
    'Entrada',
    'Salida',
    'Duracion',
  ];

  const lines = [header.map(csvCell).join(',')];

  for (const row of rows) {
    const user = userMap.get(row.user_id);
    const device = deviceMap.get(row.device_id);
    const duration = durationFromTimes(row.hora_entrada, row.hora_salida);

    lines.push(
      [
        row.fecha,
        user?.documento ?? '',
        user?.nombre ?? 'Usuario eliminado',
        device?.nombre ?? 'Dispositivo eliminado',
        device?.mac ?? '',
        row.hora_entrada?.slice(0, 5) ?? '',
        row.hora_salida?.slice(0, 5) ?? '',
        durationLabel(duration),
      ]
        .map(csvCell)
        .join(','),
    );
  }

  const csv = `\uFEFF${lines.join('\r\n')}`;
  const filename = `asistencia_${fromDate}_${toDate}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
