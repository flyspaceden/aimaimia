import type { PickupBusinessHours, PickupFulfillmentStatus } from '@/types';

export const pickupStatusMap: Record<
  PickupFulfillmentStatus,
  { text: string; color: string }
> = {
  PREPARING: { text: '备货中', color: 'processing' },
  READY: { text: '待自提', color: 'warning' },
  PICKED_UP: { text: '已取货', color: 'success' },
  VOID: { text: '凭证已作废', color: 'default' },
  CANCELED: { text: '已取消', color: 'default' },
};

export function formatPickupBusinessHours(
  businessHours: PickupBusinessHours | Record<string, unknown> | null | undefined,
): string {
  if (!businessHours) return '-';
  const summary = businessHours.summary;
  return typeof summary === 'string' && summary.trim() ? summary : '-';
}

export function pickupFullAddress(point: {
  regionText?: string | null;
  detail?: string | null;
}): string {
  return [point.regionText, point.detail].filter(Boolean).join(' ') || '-';
}
