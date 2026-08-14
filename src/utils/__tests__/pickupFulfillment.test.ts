declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import type { Order } from '../../types';
import {
  formatPickupBusinessHours,
  isPickupOrder,
  pickupOrderStatusHint,
  pickupOrderStatusLabel,
} from '../pickupFulfillment';

const pickupOrder = {
  fulfillmentMode: 'PICKUP',
  pickupFulfillment: {
    status: 'READY',
    pickupPoint: {
      name: '果园甲自提点',
      regionText: '浙江省杭州市',
      detail: '丰收路 8 号',
      businessHours: '09:00-18:00',
    },
    recipient: { name: '张三', phoneMasked: '138****0000' },
  },
} as Pick<Order, 'fulfillmentMode' | 'pickupFulfillment'>;

describe('buyer app pickup compatibility', () => {
  it('derives pickup state only from explicit backend fulfillment data', () => {
    expect(isPickupOrder(pickupOrder)).toBe(true);
    expect(pickupOrderStatusLabel(pickupOrder)).toBe('待自提');
    expect(pickupOrderStatusHint(pickupOrder)).toContain('出示取货凭证');
    expect(isPickupOrder({ fulfillmentMode: 'DELIVERY' })).toBe(false);
  });

  it('does not invent pickup state for legacy delivery orders', () => {
    expect(pickupOrderStatusLabel({ fulfillmentMode: undefined, pickupFulfillment: undefined }))
      .toBeUndefined();
  });

  it('fails closed when a pickup order is missing its fulfillment relation', () => {
    const incomplete = { fulfillmentMode: 'PICKUP', pickupFulfillment: undefined } as const;
    expect(pickupOrderStatusLabel(incomplete)).toBe('自提信息异常');
    expect(pickupOrderStatusHint(incomplete)).toContain('联系客服');
  });

  it('formats server business-hour snapshots without assuming a schema', () => {
    expect(formatPickupBusinessHours(['周一 09:00-18:00', '周六 10:00-16:00']))
      .toBe('周一 09:00-18:00 · 周六 10:00-16:00');
    expect(formatPickupBusinessHours([{ day: '周一至周五', hours: '10:00-17:00' }]))
      .toBe('周一至周五 10:00-17:00');
    expect(formatPickupBusinessHours({ 周日: '休息' })).toBe('周日 休息');
  });
});
