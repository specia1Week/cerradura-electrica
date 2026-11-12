// Última modificación: 2026-11-10
export type UserRol = 'DOCENTE' | 'ESTUDIANTE' | 'ADMIN';
export type UserEstado = 'ACTIVO' | 'INACTIVO';
export type DeviceEstado = 'ACTIVO' | 'INACTIVO' | 'MANTENIMIENTO';
export type CredentialTipo = 'RFID' | 'HUELLA';
export type AccessResultado = 'PERMITIDO' | 'DENEGADO';
export type ProfileRol = 'ADMIN' | 'OPERADOR';
export type CommandTipo = 'ENROLL_USUARIO' | 'DELETE_HUELLA' | 'SYNC_SLOTS';
export type CommandEstado =
  | 'PENDIENTE'
  | 'EN_CURSO'
  | 'COMPLETADO'
  | 'FALLIDO'
  | 'EXPIRADO'
  | 'CANCELADO';

export type Profile = {
  id: string;
  rol: ProfileRol;
  created_at?: string;
};

export type UserRecord = {
  id: string;
  nombre: string;
  documento: string;
  rol: UserRol;
  estado: UserEstado;
  created_at: string;
  updated_at: string;
};

export type DeviceRecord = {
  id: string;
  mac: string;
  nombre: string;
  ubicacion: string;
  estado: DeviceEstado;
  last_seen_at: string | null;
  firmware_version: string | null;
  ip: string | null;
  rssi: number | null;
  created_at: string;
  updated_at: string;
};

export type CredentialRecord = {
  id: string;
  user_id: string;
  device_id: string;
  tipo: CredentialTipo;
  rfid_uid: string | null;
  fingerprint_template_id: number | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

export type AccessEventRecord = {
  id: string;
  event_uuid: string;
  device_id: string;
  user_id: string | null;
  rfid_uid: string | null;
  fingerprint_template_id: number | null;
  resultado: AccessResultado;
  resultado_esp: AccessResultado | null;
  motivo: string | null;
  intentos_huella: number | null;
  occurred_at: string;
  received_at: string;
};

export type AttendanceRecord = {
  id: string;
  user_id: string;
  device_id: string;
  access_event_id: string;
  fecha: string;
  hora_entrada: string;
  hora_salida: string | null;
  created_at: string;
  updated_at: string;
};

export type DeviceCommandRecord = {
  id: string;
  device_id: string;
  tipo: CommandTipo;
  user_id: string | null;
  fingerprint_slot: number | null;
  estado: CommandEstado;
  paso: string | null;
  detalle: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
};

export type ActionResult = {
  ok: boolean;
  error?: string;
  message?: string;
  apiKey?: string;
};

export const initialActionResult: ActionResult = { ok: false };

export type Option = {
  value: string;
  label: string;
};
