import { describe, expect, it } from 'vitest';

import type { PickupPointGroup } from '@/types';
import {
  buildPickupFulfillment,
  formatPickupBusinessHours,
  isFulfillmentInput,
  isPickupRecipientValid,
  pickupPointsAvailable,
  pickupSelectionsComplete,
} from './pickup-utils';

const groups: PickupPointGroup[] = [
  {
    companyId: 'company-a',
    companyName: '果园甲',
    points: [{
      id: 'point-a',
      companyId: 'company-a',
      name: '果园甲自提点',
      contactName: '王师傅',
      contactPhoneMasked: '138****0000',
      regionText: '浙江省杭州市',
      detail: '丰收路 8 号',
      businessHours: '09:00-18:00',
    }],
  },
  {
    companyId: 'company-b',
    companyName: '农场乙',
    points: [{
      id: 'point-b',
      companyId: 'company-b',
      name: '农场乙自提点',
      contactName: '李师傅',
      contactPhoneMasked: '139****0000',
      regionText: '江苏省南京市',
      detail: '稻香路 6 号',
      businessHours: [{ day: '周一至周五', hours: '10:00-17:00' }],
    }],
  },
];

describe('pickup fulfillment utilities', () => {
  it('requires a real recipient name and a mainland mobile number', () => {
    expect(isPickupRecipientValid('张三', '13800000000')).toBe(true);
    expect(isPickupRecipientValid('张', '13800000000')).toBe(false);
    expect(isPickupRecipientValid('张三', '1380000000')).toBe(false);
    expect(isPickupRecipientValid('张三', '12800000000')).toBe(false);
  });

  it('requires one valid point per expected merchant', () => {
    expect(pickupPointsAvailable(groups, ['company-a', 'company-b'])).toBe(true);
    expect(pickupPointsAvailable(groups, ['company-a', 'company-c'])).toBe(false);
    expect(pickupSelectionsComplete(groups, {
      'company-a': 'point-a',
      'company-b': 'point-b',
    }, ['company-a', 'company-b'])).toBe(true);
    expect(pickupSelectionsComplete(groups, { 'company-a': 'point-a' }, [
      'company-a',
      'company-b',
    ])).toBe(false);
    expect(pickupSelectionsComplete(groups, { 'company-a': 'point-b' }, ['company-a']))
      .toBe(false);
  });

  it('builds a trimmed pickup contract without an address', () => {
    const fulfillment = buildPickupFulfillment(
      '  张三  ',
      ' 13800000000 ',
      { 'company-a': 'point-a', 'company-b': 'point-b' },
      ['company-a', 'company-b'],
    );

    expect(fulfillment).toEqual({
      mode: 'PICKUP',
      recipientName: '张三',
      recipientPhone: '13800000000',
      selections: [
        { companyId: 'company-a', pickupPointId: 'point-a' },
        { companyId: 'company-b', pickupPointId: 'point-b' },
      ],
    });
    expect(isFulfillmentInput(fulfillment)).toBe(true);
    expect(fulfillment).not.toHaveProperty('addressId');
  });

  it('keeps the legacy delivery contract readable and rejects incomplete pickup input', () => {
    expect(isFulfillmentInput({ mode: 'DELIVERY', addressId: 'address-1' })).toBe(true);
    expect(isFulfillmentInput({
      mode: 'PICKUP',
      recipientName: '张三',
      recipientPhone: '13800000000',
      selections: [{ companyId: 'company-a' }],
    })).toBe(false);
  });

  it('formats structured business hours and keeps a safe fallback', () => {
    expect(formatPickupBusinessHours([{ day: '周一至周五', hours: '10:00-17:00' }]))
      .toBe('周一至周五 10:00-17:00');
    expect(formatPickupBusinessHours({ 周六: '09:00-12:00' })).toBe('周六 09:00-12:00');
    expect(formatPickupBusinessHours(null)).toBe('营业时间以门店通知为准');
  });
});
