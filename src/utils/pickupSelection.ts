import type {
  FulfillmentInput,
  PickupPointGroup,
} from '../types/domain/Fulfillment';

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

/** Drop removed merchants and revoked points; never silently replace an explicit choice. */
export function reconcilePickupSelections(groups: PickupPointGroup[], selections: PickupSelectionMap, companyIds: string[]): PickupSelectionMap {
  const next: PickupSelectionMap = {};
  for (const companyId of companyIds) {
    const points = groups.find((group) => group.companyId === companyId)?.points ?? [];
    const selected = selections[companyId];
    if (selected && points.some((point) => point.id === selected)) next[companyId] = selected;
  }
  return next;
}
