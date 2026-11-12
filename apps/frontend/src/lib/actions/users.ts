'use server';

import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/types';
import { humanizeError, isUuid, text } from '@/lib/validation';

const USER_ROLES = ['DOCENTE', 'ESTUDIANTE', 'ADMIN'] as const;
const USER_STATES = ['ACTIVO', 'INACTIVO'] as const;

function validRole(value: string) {
  return USER_ROLES.includes(value as (typeof USER_ROLES)[number]);
}

function validState(value: string) {
  return USER_STATES.includes(value as (typeof USER_STATES)[number]);
}

export async function createUser(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireAuthContext();

  const nombre = text(formData, 'nombre');
  const documento = text(formData, 'documento');
  const rol = text(formData, 'rol');

  if (!nombre || !documento || !rol) {
    return { ok: false, error: 'Nombre, documento y rol son obligatorios.' };
  }
  if (nombre.length > 120 || documento.length > 40) {
    return { ok: false, error: 'El nombre o el documento son demasiado largos.' };
  }
  if (!validRole(rol)) {
    return { ok: false, error: 'El rol seleccionado no es válido.' };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('users').insert({
    nombre,
    documento,
    rol,
    estado: 'ACTIVO',
  });

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        error: 'Ya existe un usuario con ese documento.',
      };
    }
    return { ok: false, error: humanizeError(error) };
  }

  revalidatePath('/usuarios');
  revalidatePath('/dashboard');
  revalidatePath('/asistencia');

  return { ok: true, message: 'Usuario creado correctamente.' };
}

export async function updateUser(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireAuthContext();

  const id = text(formData, 'id');
  const nombre = text(formData, 'nombre');
  const documento = text(formData, 'documento');
  const rol = text(formData, 'rol');

  if (!isUuid(id)) {
    return { ok: false, error: 'El usuario no es válido.' };
  }
  if (!nombre || !documento || !rol) {
    return { ok: false, error: 'Nombre, documento y rol son obligatorios.' };
  }
  if (!validRole(rol)) {
    return { ok: false, error: 'El rol seleccionado no es válido.' };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('users')
    .update({ nombre, documento, rol })
    .eq('id', id);

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        error: 'Ya existe otro usuario con ese documento.',
      };
    }
    return { ok: false, error: humanizeError(error) };
  }

  revalidatePath('/usuarios');
  revalidatePath('/dashboard');
  revalidatePath('/asistencia');

  return { ok: true, message: 'Usuario actualizado correctamente.' };
}

export async function setUserEstado(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireAuthContext();
  const id = text(formData, 'id');
  const estado = text(formData, 'estado');

  if (!isUuid(id) || !validState(estado)) {
    return { ok: false, error: 'Los datos del usuario no son válidos.' };
  }

  const admin = createSupabaseAdminClient();
  const { data: user, error: userError } = await admin
    .from('users')
    .select('id, nombre, estado')
    .eq('id', id)
    .maybeSingle();

  if (userError || !user) {
    return { ok: false, error: 'No se encontró el usuario.' };
  }

  const { error } = await admin
    .from('users')
    .update({ estado })
    .eq('id', id);

  if (error) {
    return { ok: false, error: humanizeError(error) };
  }

  let message =
    estado === 'ACTIVO'
      ? 'Usuario activado. Ya puede volver a acceder con sus credenciales existentes.'
      : 'Usuario desactivado.';

  if (estado === 'ACTIVO') {
    const { data: cancelled, error: cancelError } = await admin
      .from('device_commands')
      .update({
        estado: 'CANCELADO',
        completed_at: new Date().toISOString(),
      })
      .eq('user_id', id)
      .eq('tipo', 'DELETE_HUELLA')
      .eq('estado', 'PENDIENTE')
      .select('id');

    if (cancelError) {
      message += ` No se pudieron cancelar los borrados pendientes: ${humanizeError(cancelError)}`;
    } else if ((cancelled ?? []).length > 0) {
      message += ` Se cancelaron ${(cancelled ?? []).length} borrado(s) de huella pendiente(s).`;
    }
  }

  if (estado === 'INACTIVO') {
    const { data: fingerprints, error: fingerprintError } = await admin
      .from('credentials')
      .select('id, device_id, fingerprint_template_id')
      .eq('user_id', id)
      .eq('tipo', 'HUELLA')
      .eq('activo', true)
      .not('fingerprint_template_id', 'is', null);

    if (fingerprintError) {
      revalidatePath('/usuarios');
      revalidatePath(`/usuarios/${id}/enrolar`);
      revalidatePath('/dashboard');
      return {
        ok: true,
        message: `Usuario desactivado. No se pudieron consultar sus huellas: ${humanizeError(fingerprintError)}`,
      };
    }

    let created = 0;
    let skipped = 0;
    const failures: string[] = [];

    for (const fingerprint of fingerprints ?? []) {
      if (fingerprint.fingerprint_template_id === null) continue;

      const { error: commandError } = await admin
        .from('device_commands')
        .insert({
          device_id: fingerprint.device_id,
          tipo: 'DELETE_HUELLA',
          user_id: id,
          fingerprint_slot: fingerprint.fingerprint_template_id,
          estado: 'PENDIENTE',
          created_by: context.user.id,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
          detalle: {
            origen: 'panel',
            motivo: 'usuario_desactivado',
          },
        });

      if (!commandError) {
        created += 1;
      } else if (commandError.code === '23505') {
        skipped += 1;
      } else {
        failures.push(humanizeError(commandError));
      }
    }

    message = [
      'Usuario desactivado.',
      created > 0
        ? `${created} comando(s) DELETE_HUELLA creado(s).`
        : 'No se crearon comandos de borrado.',
      skipped > 0
        ? `${skipped} huella(s) no se pudieron encolar porque el dispositivo ya tenía un comando activo.`
        : '',
      failures.length > 0
        ? `Algunos comandos fallaron: ${failures.join(' ')}`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  revalidatePath('/usuarios');
  revalidatePath(`/usuarios/${id}/enrolar`);
  revalidatePath('/dashboard');
  revalidatePath('/dispositivos');
  revalidatePath('/eventos');

  return { ok: true, message };
}

export async function deleteUser(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireAuthContext();
  const id = text(formData, 'id');

  if (!isUuid(id)) {
    return { ok: false, error: 'El usuario no es válido.' };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('users').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      return {
        ok: false,
        error:
          'No se puede eliminar: el usuario tiene asistencias registradas. Desactivalo para conservar el historial.',
      };
    }
    return { ok: false, error: humanizeError(error) };
  }

  revalidatePath('/usuarios');
  revalidatePath('/dashboard');
  revalidatePath('/eventos');
  revalidatePath('/asistencia');

  return { ok: true, message: 'Usuario eliminado.' };
}
