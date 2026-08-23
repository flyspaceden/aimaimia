import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { EligibilityItem, EligibilityOption } from '@/packages/after-sales/types';
import {
  eligibilityItemDisabledReason,
  eligibilityShippingDisplay,
} from '@/packages/after-sales/utils';

const option = (overrides: Partial<EligibilityOption> = {}): EligibilityOption => ({
  afterSaleType: 'NO_REASON_RETURN',
  enabled: true,
  requiresReturn: true,
  returnShippingPayer: 'BUYER',
  estimatedReturnShippingFee: 10,
  requiresBuyerShippingPayment: false,
  ...overrides,
});

const item = (options: EligibilityOption[]): EligibilityItem => ({
  orderItemId: 'order-item-1',
  productTitle: '有机苹果',
  quantity: 1,
  unitPrice: 29.9,
  itemAmount: 29.9,
  options,
});

describe('售后申请消费者展示', () => {
  it('无需寄回时不展示无关的运费信息', () => {
    expect(eligibilityShippingDisplay(option({
      requiresReturn: false,
      estimatedReturnShippingFee: 19.8,
      requiresBuyerShippingPayment: true,
    }))).toEqual({
      returnRequirement: '无需寄回',
      summary: '无需寄回',
    });
  });

  it('清楚区分买家需先支付与从退款中扣除的运费', () => {
    expect(eligibilityShippingDisplay(option({
      estimatedReturnShippingFee: 12.35,
      requiresBuyerShippingPayment: true,
    }))).toEqual({
      returnRequirement: '需要寄回',
      payer: '由你承担',
      estimatedFee: '¥12.35',
      paymentHandling: '审核通过后需先支付',
      summary: '需要寄回 · 退货运费由你承担 · 预计 ¥12.35 · 审核通过后需先支付',
    });

    expect(eligibilityShippingDisplay(option())).toMatchObject({
      payer: '由你承担',
      estimatedFee: '¥10.00',
      paymentHandling: '已从预计退款中扣除',
    });
  });

  it('展示商家或平台承担退货运费', () => {
    expect(eligibilityShippingDisplay(option({
      returnShippingPayer: 'SELLER',
      estimatedReturnShippingFee: 0,
    }))).toMatchObject({
      payer: '由商家承担',
      paymentHandling: undefined,
    });
    expect(eligibilityShippingDisplay(option({
      returnShippingPayer: 'PLATFORM',
      estimatedReturnShippingFee: 0,
    }))).toMatchObject({
      payer: '由平台承担',
      paymentHandling: undefined,
    });
  });

  it('将资格接口已返回的不可申请原因去重展示', () => {
    expect(eligibilityItemDisabledReason(item([
      option({ enabled: false, disabledReason: '已超过退货时间' }),
      option({ afterSaleType: 'QUALITY_RETURN', enabled: false, disabledReason: '已超过退货时间' }),
      option({ afterSaleType: 'QUALITY_EXCHANGE', enabled: false, disabledReason: '该商品不支持换货' }),
    ]))).toBe('已超过退货时间；该商品不支持换货');

    expect(eligibilityItemDisabledReason(item([
      option({ enabled: true }),
      option({ afterSaleType: 'QUALITY_RETURN', enabled: false, disabledReason: '当前不可申请' }),
    ]))).toBeUndefined();
  });

  it('申请页有运费确认项，售后页面不再展示工程文案', () => {
    const afterSalesRoot = path.resolve(process.cwd(), 'src/packages/after-sales');
    const applySource = fs.readFileSync(path.join(afterSalesRoot, 'after-sale-apply/index.tsx'), 'utf8');
    const uiSources = [
      applySource,
      fs.readFileSync(path.join(afterSalesRoot, 'after-sale-detail/index.tsx'), 'utf8'),
      fs.readFileSync(path.join(afterSalesRoot, 'after-sale-list/index.tsx'), 'utf8'),
      fs.readFileSync(path.join(afterSalesRoot, '_components/auth-gate.tsx'), 'utf8'),
    ].join('\n');

    expect(applySource).toContain('确认申请信息');
    expect(applySource).toContain('运费承担');
    expect(applySource).toContain('预计退货运费');
    expect(applySource).toContain('运费处理');
    expect(applySource).toContain('不可申请');
    expect(uiSources).not.toMatch(/以后端实时返回|其他端支付参数|App 实时同步|条已加载/);
  });
});
