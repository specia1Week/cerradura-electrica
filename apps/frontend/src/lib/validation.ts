export function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

export function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value ? value : null;
}

export function isUuid(value: string | null | undefined) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

export function isMac(value: string) {
  return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(value);
}

export function parsePositiveInt(value: string | null | undefined, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

export function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function buildQueryString(
  params: Record<string, string | number | null | undefined>,
) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value) !== '') {
      search.set(key, String(value));
    }
  });
  const value = search.toString();
  return value ? `?${value}` : '';
}

export function humanizeError(error: {
  code?: string;
  message?: string;
  details?: string | null;
} | null) {
  if (!error) return 'Ocurrió un error inesperado. Intentá de nuevo.';

  switch (error.code) {
    case '23505':
      return 'Ya existe un registro con esos datos.';
    case '23503':
      return 'No se puede completar la operación porque el registro está en uso.';
    case '23514':
      return 'Los datos no cumplen una restricción de la base de datos.';
    case '42501':
      return 'No tenés permisos para realizar esta acción.';
    case 'PGRST116':
      return 'No se encontró el registro solicitado.';
    default:
      return error.message ?? 'Ocurrió un error inesperado. Intentá de nuevo.';
  }
}
