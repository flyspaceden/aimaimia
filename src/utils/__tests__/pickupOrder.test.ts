import type { Order } from '../../types';
import {
  canCancelPickupOrder,
  formatPickupBusinessHours,
  isPickupOrder,
  pickupOrderPresentation,
} from '../pickupOrder';

const pickupOrder = (status: NonNullable<Order['pickupFulfillment']>['status']): Order => ({
  id: 'order-pickup-1',
  status: status === 'PICKED_UP' ? 'RECEIVED' : 'PAID',
  bizType: 'NORMAL_GOODS',
  fulfillmentMode: 'PICKUP',
  pickupFulfillment: {
    status,
    pickupPoint: {
      name: '南山自提点',
      regionText: '广东省深圳市南山区',
      detail: '农业路 1 号',
      businessHours: [{ day: '周一至周五', hours: '09:00-18:00' }],
    },
    recipient: { name: '李*', phoneMasked: '138****0360' },
  },
  totalPrice: 18,
  createdAt: '2026-08-24T12:00:00.000Z',
  items: [],
});

describe('App 自提订单展示契约', () => {
  it('配送订单不启用自提展示', () => {
    const order = { ...pickupOrder('PREPARING'), fulfillmentMode: 'DELIVERY' as const };
    expect(isPickupOrder(order)).toBe(false);
    expect(pickupOrderPresentation(order)).toBeNull();
  });

  it.each([
    ['PREPARING', '备货中'],
    ['READY', '待自提'],
    ['PICKED_UP', '已取货'],
    ['VOID', '凭证已失效'],
    ['CANCELED', '自提已取消'],
  ] as const)('将 %s 显示为 %s', (status, label) => {
    expect(pickupOrderPresentation(pickupOrder(status))?.label).toBe(label);
  });

  it('缺少自提关联时明确报异常且不降级为配送', () => {
    const order = { ...pickupOrder('PREPARING'), pickupFulfillment: null };
    expect(pickupOrderPresentation(order)).toEqual(expect.objectContaining({
      label: '自提信息异常',
      tone: 'muted',
    }));
  });

  it('只有普通商品备货中自提单允许取消', () => {
    expect(canCancelPickupOrder(pickupOrder('PREPARING'))).toBe(true);
    expect(canCancelPickupOrder(pickupOrder('READY'))).toBe(false);
    expect(canCancelPickupOrder({ ...pickupOrder('PREPARING'), bizType: 'GROUP_BUY' })).toBe(false);
    expect(canCancelPickupOrder({ ...pickupOrder('PREPARING'), bizType: 'VIP_PACKAGE' })).toBe(false);
  });

  it('兼容字符串、数组和对象格式的营业时间', () => {
    expect(formatPickupBusinessHours('每天 09:00-18:00')).toBe('每天 09:00-18:00');
    expect(formatPickupBusinessHours([{ day: '周一至周五', hours: '09:00-18:00' }]))
      .toBe('周一至周五 09:00-18:00');
    expect(formatPickupBusinessHours({ 周六: '09:00-12:00' })).toBe('周六 09:00-12:00');
    expect(formatPickupBusinessHours(null)).toBe('营业时间以自提点通知为准');
  });
});
