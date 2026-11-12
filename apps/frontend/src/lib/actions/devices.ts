'use server';

import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/auth';
import { generateApiKey } from '@/lib/api-key';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/types';
import { humanizeError, isMac, isUuid, text } from '@/lib/validation';

const DEVICE_STATES = ['ACTIVO', 'INACTIVO', 'MANTENIMIENTO'] as const;

function validDeviceState(value: string) {
  return DEVICE_STATES.includes(value as (typeof DEVICE_STATES)[number]);
}

function validateDeviceFields(nombre: string, ubicacion: string, mac: string) {
  if (!nombre || !ubicacion || !mac) {
    return 'Nombre, MAC y ubicación son obligatorios.';
  }
  if (!isMac(mac)) {
    return 'La MAC debe tener el formato AA:BB:CC:DD:EE:FF.';
  }
  if (nombre.length > 120 || ubicacion.length > 160) {
    return 'El nombre o la ubicación son demasiado largos.';
  }
  return null;
}

export async function createDevice(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireAuthContext();

  const mac = text(formData, 'mac').toUpperCase();
  const nombre = text(formData, 'nombre');
  const ubicacion = text(formData, 'ubicacion');
  const estado = text(formData, 'estado') || 'ACTIVO';

  const validationError = validateDeviceFields(nombre, ubicacion, mac);
  if (validationError) return { ok: false, error: validationError };
  if (!validDeviceState(estado)) {
    return { ok: false, error: 'El estado seleccionado no es válido.' };
  }

  const { plain, hash } = generateApiKey();
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('devices').insert({
    mac,
    nombre,
    ubicacion,
    api_key_hash: hash,
    estado,
  });

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'Ya existe un dispositivo con esa MAC.' };
    }
    return { ok: false, error: humanizeError(error) };
  }

  revalidatePath('/dispositivos');
  revalidatePath('/dashboard');

  return {
    ok: true,
    message: 'Dispositivo creado. Guardá la API key ahora.',
    apiKey: plain,
  };
}

export async function updateDevice(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireAuthContext();

  const id = text(formData, 'id');
  const mac = text(formData, 'mac').toUpperCase();
  const nombre = text(formData, 'nombre');
  const ubicacion = text(formData, 'ubicacion');
  const estado = text(formData, 'estado');

  if (!isUuid(id)) {
    return { ok: false, error: 'El dispositivo no es válido.' };
  }
  const validationError = validateDeviceFields(nombre, ubicacion, mac);
  if (validationError) return { ok: false, error: validationError };
  if (!validDeviceState(estado)) {
    return { ok: false, error: 'El estado seleccionado no es válido.' };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('devices')
    .update({ mac, nombre, ubicacion, estado })
    .eq('id', id);

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        error: 'Ya existe otro dispositivo con esa MAC.',
      };
    }
    return { ok: false, error: humanizeError(error) };
  }

  revalidatePath('/dispositivos');
  revalidatePath('/dashboard');
  revalidatePath('/usuarios');

  return { ok: true, message: 'Dispositivo actualizado correctamente.' };
}

export async function rotateDeviceKey(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireAuthContext();
  const id = text(formData, 'id');

  if (!isUuid(id)) {
    return { ok: false, error: 'El dispositivo no es válido.' };
  }

  const { plain, hash } = generateApiKey();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('devices')
    .update({ api_key_hash: hash })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: humanizeError(error) };
  if (!data) return { ok: false, error: 'No se encontró el dispositivo.' };

  revalidatePath('/dispositivos');

  return {
    ok: true,
    message:
      'API key rotada. La clave anterior dejó de funcionar; configurá el dispositivo con la nueva.',
    apiKey: plain,
  };
}

export async function deleteDevice(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireAuthContext();
  const id = text(formData, 'id');

  if (!isUuid(id)) {
    return { ok: false, error: 'El dispositivo no es válido.' };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('devices').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      return {
        ok: false,
        error:
          'No se puede eliminar: el dispositivo tiene eventos de acceso o asistencias asociadas. Cambialo a INACTIVO.',
      };
    }
    return { ok: false, error: humanizeError(error) };
  }

  revalidatePath('/dispositivos');
  revalidatePath('/dashboard');
  revalidatePath('/eventos');
  revalidatePath('/asistencia');

  return { ok: true, message: 'Dispositivo eliminado.' };
}
