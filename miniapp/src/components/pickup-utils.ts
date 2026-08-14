import type {
  FulfillmentInput,
  PickupFulfillmentStatus,
  PickupPointGroup,
} from '@/types';

export type PickupSelectionMap = Record<string, string>;

const MOBILE_PATTERN = /^1[3-9]\d{9}$/;

export function isPickupRecipientValid(name: string, phone: string): boolean {
  return name.trim().length >= 2 && MOBILE_PATTERN.test(phone.trim());
}

export function isFulfillmentInput(value: unknown): value is FulfillmentInput {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  if (raw.mode === 'DELIVERY') return typeof raw.addressId === 'string' && raw.addressId.length > 0;
  if (raw.mode !== 'PICKUP' || typeof raw.recipientName !== 'string'
    || typeof raw.recipientPhone !== 'string' || !Array.isArray(raw.selections)) return false;
  return raw.selections.every((selection) => Boolean(selection)
    && typeof selection === 'object'
    && typeof (selection as Record<string, unknown>).companyId === 'string'
    && typeof (selection as Record<string, unknown>).pickupPointId === 'string');
}

export function pickupSelectionsComplete(
  groups: PickupPointGroup[],
  selections: PickupSelectionMap,
  expectedCompanyIds: string[],
): boolean {
  if (!expectedCompanyIds.length) return false;
  const groupByCompany = new Map(groups.map((group) => [group.companyId, group]));
  return expectedCompanyIds.every((companyId) => {
    const pointId = selections[companyId];
    const group = groupByCompany.get(companyId);
    return Boolean(pointId && group?.points.some((point) => point.id === pointId));
  });
}

export function pickupPointsAvailable(
  groups: PickupPointGroup[],
  expectedCompanyIds: string[],
): boolean {
  if (!expectedCompanyIds.length) return false;
  const groupByCompany = new Map(groups.map((group) => [group.companyId, group]));
  return expectedCompanyIds.every((companyId) => {
    const group = groupByCompany.get(companyId);
    return Boolean(group?.points.length);
  });
}

export function buildPickupFulfillment(
  name: string,
  phone: string,
  selections: PickupSelectionMap,
  companyIds: string[],
): FulfillmentInput {
  return {
    mode: 'PICKUP',
    recipientName: name.trim(),
    recipientPhone: phone.trim(),
    selections: companyIds.map((companyId) => ({
      companyId,
      pickupPointId: selections[companyId] || '',
    })),
  };
}

export function formatPickupBusinessHours(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const lines = value.flatMap((item) => {
      if (typeof item === 'string' && item.trim()) return [item.trim()];
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const day = [row.day, row.label, row.weekday].find((part) => typeof part === 'string');
      const hours = [row.hours, row.time, row.period].find((part) => typeof part === 'string');
      return day || hours ? [`${day || ''}${day && hours ? ' ' : ''}${hours || ''}`] : [];
    });
    if (lines.length) return lines.join(' · ');
  }
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    const summary = [row.summary, row.text, row.label].find((part) => typeof part === 'string');
    if (typeof summary === 'string' && summary.trim()) return summary.trim();
    const lines = Object.entries(row)
      .filter(([, hours]) => typeof hours === 'string' && hours.trim())
      .slice(0, 7)
      .map(([day, hours]) => `${day} ${hours}`);
    if (lines.length) return lines.join(' · ');
  }
  return '营业时间以门店通知为准';
}

export const PICKUP_STATUS_META: Record<
  PickupFulfillmentStatus,
  { label: string; hint: string; tone: string }
> = {
  PREPARING: { label: '备货中', hint: '商家正在备货，备好后会生成取货凭证', tone: 'gold' },
  READY: { label: '待自提', hint: '商品已备好，请出示一次性取货凭证', tone: 'brand' },
  PICKED_UP: { label: '已取货', hint: '取货凭证已核销，本单履约完成', tone: 'success' },
  VOID: { label: '凭证已失效', hint: '该取货凭证已永久失效', tone: 'muted' },
  CANCELED: { label: '自提已取消', hint: '本次自提已取消', tone: 'muted' },
};
