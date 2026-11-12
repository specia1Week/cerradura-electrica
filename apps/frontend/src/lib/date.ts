import { format, parseISO, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const TIME_ZONE = 'America/La_Paz';

export function todayInputValue() {
  return formatInTimeZone(new Date(), TIME_ZONE, 'yyyy-MM-dd');
}

export function currentMonthStartInput() {
  return formatInTimeZone(new Date(), TIME_ZONE, 'yyyy-MM-01');
}

export function daysAgoInput(days: number) {
  const today = parseISO(`${todayInputValue()}T12:00:00`);
  return format(subDays(today, days), 'yyyy-MM-dd');
}

export function dateInputToStart(value: string) {
  return fromZonedTime(`${value}T00:00:00`, TIME_ZONE);
}

export function dateInputToEnd(value: string) {
  return fromZonedTime(`${value}T23:59:59.999`, TIME_ZONE);
}

export function isValidDateInput(value: string | null | undefined): value is string {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseISO(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime());
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = value.includes('T') ? new Date(value) : parseISO(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  if (value.includes('T') && value.length > 10) {
    return formatInTimeZone(date, TIME_ZONE, 'd MMM yyyy', { locale: es });
  }
  return format(date, 'd MMM yyyy', { locale: es });
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return formatInTimeZone(date, TIME_ZONE, 'd MMM yyyy, HH:mm', { locale: es });
}

export function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  if (value.includes('T')) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return formatInTimeZone(date, TIME_ZONE, 'HH:mm');
  }
  return value.slice(0, 5);
}

export function hourInTimeZone(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Number(formatInTimeZone(date, TIME_ZONE, 'H'));
}

export function isDeviceOnline(lastSeenAt: string | null | undefined) {
  if (!lastSeenAt) return false;
  const time = new Date(lastSeenAt).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time < 30_000;
}

export function lastSeenLabel(value: string | null | undefined) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `Hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return formatDateTime(value);
}

export function durationFromTimes(
  entrada: string | null | undefined,
  salida: string | null | undefined,
) {
  if (!entrada || !salida) return null;
  const [entryHour = 0, entryMinute = 0, entrySecond = 0] = entrada
    .split(':')
    .map(Number);
  const [exitHour = 0, exitMinute = 0, exitSecond = 0] = salida
    .split(':')
    .map(Number);
  const entry = entryHour * 3600 + entryMinute * 60 + entrySecond;
  const exit = exitHour * 3600 + exitMinute * 60 + exitSecond;
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit < entry) return null;
  return exit - entry;
}

export function durationLabel(seconds: number | null) {
  if (seconds === null) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}
