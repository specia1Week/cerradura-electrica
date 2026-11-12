'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth';
import { isDeviceOnline } from '@/lib/date';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ActionResult, DeviceCommandRecord } from '@/lib/types';
import { isUuid, text } from '@/lib/validation';

function enrollmentPath(userId: string) {
  return `/usuarios/${userId}/enrolar`;
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function startEnrollment(formData: FormData): Promise<void> {
  const context = await requireAuthContext();
  const userId = text(formData, 'userId');
  const deviceId = text(formData, 'deviceId');

  if (!isUuid(userId)) {
    redirect('/usuarios');
  }

  const path = enrollmentPath(userId);

  if (!isUuid(deviceId)) {
    fail(path, 'Seleccioná un dispositivo válido.');
  }

  const admin = createSupabaseAdminClient();

  const { data: user } = await admin
    .from('users')
    .select('id, nombre, estado')
    .eq('id', userId)
    .maybeSingle();

  if (!user) fail(path, 'No se encontró el usuario.');
  if (user.estado !== 'ACTIVO') {
    fail(path, 'El usuario debe estar activo para iniciar un enrolamiento.');
  }

  const { data: device } = await admin
    .from('devices')
    .select('id, nombre, estado, last_seen_at')
    .eq('id', deviceId)
    .maybeSingle();

  if (!device) fail(path, 'No se encontró el dispositivo.');
  if (device.estado !== 'ACTIVO') {
    fail(path, 'El dispositivo no está activo.');
  }
  if (!isDeviceOnline(device.last_seen_at)) {
    fail(
      path,
      'El dispositivo no está en línea. Esperá el próximo heartbeat (máximo 30 s) e intentá de nuevo.',
    );
  }

  const { data: activeCommand } = await admin
    .from('device_commands')
    .select('id')
    .eq('device_id', deviceId)
    .in('estado', ['PENDIENTE', 'EN_CURSO'])
    .maybeSingle();

  if (activeCommand) {
    fail(
      path,
      'El dispositivo ya tiene un comando activo. Esperá a que termine o cancelalo antes de iniciar otro registro.',
    );
  }

  const { data: slot, error: slotError } = await admin.rpc(
    'reserve_fingerprint_slot',
    { p_device_id: deviceId },
  );

  if (slotError) {
    fail(path, `No se pudo reservar un slot: ${slotError.message}`);
  }
  if (slot === null || slot === undefined) {
    fail(path, 'No hay slots de huella disponibles en este dispositivo.');
  }

  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const { data: command, error: commandError } = await admin
    .from('device_commands')
    .insert({
      device_id: deviceId,
      tipo: 'ENROLL_USUARIO',
      user_id: userId,
      fingerprint_slot: slot,
      estado: 'PENDIENTE',
      created_by: context.user.id,
      expires_at: expiresAt,
      detalle: {
        origen: 'panel',
        usuario: user.nombre,
        dispositivo: device.nombre,
      },
    })
    .select('id')
    .single();

  if (commandError) {
    if (commandError.code === '23505') {
      fail(
        path,
        'El dispositivo acaba de recibir otro comando activo. Intentá nuevamente en unos segundos.',
      );
    }
    fail(path, `No se pudo crear el comando: ${commandError.message}`);
  }

  revalidatePath(path);
  revalidatePath('/usuarios');
  revalidatePath('/dispositivos');

  redirect(`${path}?command=${command.id}`);
}

export async function cancelEnrollment(
  commandId: string,
): Promise<ActionResult> {
  await requireAuthContext();

  if (!isUuid(commandId)) {
    return { ok: false, error: 'El comando no es válido.' };
  }

  const admin = createSupabaseAdminClient();
  const { data: command } = await admin
    .from('device_commands')
    .select('id, user_id, estado, expires_at')
    .eq('id', commandId)
    .maybeSingle();

  if (!command) {
    return { ok: false, error: 'No se encontró el comando.' };
  }
  if (!['PENDIENTE', 'EN_CURSO'].includes(command.estado)) {
    return { ok: false, error: 'El comando ya finalizó y no se puede cancelar.' };
  }

  const { data: updated, error } = await admin
    .from('device_commands')
    .update({
      estado: 'CANCELADO',
      completed_at: new Date().toISOString(),
    })
    .eq('id', commandId)
    .in('estado', ['PENDIENTE', 'EN_CURSO'])
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!updated) {
    return {
      ok: false,
      error: 'El comando cambió de estado mientras se cancelaba. Actualizá la página.',
    };
  }

  if (command.user_id) {
    revalidatePath(enrollmentPath(command.user_id));
  }
  revalidatePath('/usuarios');
  revalidatePath('/dispositivos');

  return { ok: true, message: 'Registro cancelado.' };
}

export async function expireEnrollment(
  commandId: string,
): Promise<ActionResult> {
  await requireAuthContext();

  if (!isUuid(commandId)) {
    return { ok: false, error: 'El comando no es válido.' };
  }

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data: command } = await admin
    .from('device_commands')
    .select('id, user_id, estado, expires_at')
    .eq('id', commandId)
    .maybeSingle();

  if (!command) {
    return { ok: false, error: 'No se encontró el comando.' };
  }
  if (!['PENDIENTE', 'EN_CURSO'].includes(command.estado)) {
    return { ok: true };
  }
  if (new Date(command.expires_at).getTime() > Date.now()) {
    return { ok: true };
  }

  const { error } = await admin
    .from('device_commands')
    .update({
      estado: 'EXPIRADO',
      completed_at: now,
    })
    .eq('id', commandId)
    .in('estado', ['PENDIENTE', 'EN_CURSO'])
    .lte('expires_at', now);

  if (error) {
    return { ok: false, error: error.message };
  }

  if (command.user_id) {
    revalidatePath(enrollmentPath(command.user_id));
  }
  revalidatePath('/dispositivos');

  return { ok: true };
}

export async function fetchEnrollmentStatus(
  commandId: string,
): Promise<DeviceCommandRecord | null> {
  await requireAuthContext();

  if (!isUuid(commandId)) return null;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('device_commands')
    .select('*')
    .eq('id', commandId)
    .maybeSingle();

  return (data as DeviceCommandRecord | null) ?? null;
}
