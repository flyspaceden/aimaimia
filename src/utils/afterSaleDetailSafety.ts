type TrackingEvent = {
  time: string;
  message: string;
  location?: string;
  opCode?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(num) ? num : fallback;
}

export function formatMoneyValue(value: unknown, fallback = 0): string {
  return toFiniteNumber(value, fallback).toFixed(2);
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function getTrackingEvents(tracking: unknown): TrackingEvent[] {
  if (!isRecord(tracking) || !Array.isArray(tracking.events)) return [];
  return tracking.events.filter((event): event is TrackingEvent => {
    if (!isRecord(event)) return false;
    return typeof event.time === 'string' && typeof event.message === 'string';
  });
}
