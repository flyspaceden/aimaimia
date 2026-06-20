declare const describe: any;
declare const it: any;
declare const expect: any;

import { buildDeliveryPath, deliveryAuthPaths, mapDeliveryAuthSession } from '../../repos/delivery/DeliveryAuthRepo';
import { deliveryUnitPaths } from '../../repos/delivery/DeliveryUnitRepo';
import { deliveryCustomerServicePaths } from '../../repos/delivery/DeliveryCustomerServiceRepo';
import { deliveryProductPaths, mapDeliveryCatalogProduct } from '../../repos/delivery/DeliveryProductRepo';
import { deliveryCartPaths, mapDeliveryCartResponse } from '../../repos/delivery/DeliveryCartRepo';
import {
  deliveryOrderPaths,
  mapDeliveryBuyerOrder,
  mapDeliveryCheckoutSession,
} from '../../repos/delivery/DeliveryOrderRepo';
import { deliveryManifestPaths, mapDeliveryManifestRow } from '../../repos/delivery/DeliveryManifestRepo';

describe('delivery repo paths', () => {
  it('builds only /delivery/* prefixed endpoints', () => {
    expect(buildDeliveryPath('auth/phone-login')).toBe('/delivery/auth/phone-login');
    expect(deliveryAuthPaths.smsCode()).toBe('/delivery/auth/sms/code');
    expect(buildDeliveryPath('/delivery/cart')).toBe('/delivery/cart');
    expect(deliveryAuthPaths.me()).toBe('/delivery/me');
    expect(deliveryUnitPaths.select('unit_1')).toBe('/delivery/units/unit_1/select');
    expect(deliveryProductPaths.detail('product_1')).toBe('/delivery/products/product_1');
    expect(deliveryCartPaths.item('cart_1')).toBe('/delivery/cart/items/cart_1');
    expect(deliveryOrderPaths.checkout('checkout_1')).toBe('/delivery/checkout/checkout_1');
    expect(deliveryOrderPaths.payment('checkout_1')).toBe('/delivery/checkout/checkout_1/pay');
    expect(deliveryOrderPaths.activeQuery('checkout_1')).toBe('/delivery/checkout/checkout_1/active-query');
    expect(deliveryOrderPaths.list()).toBe('/delivery/orders');
    expect(deliveryOrderPaths.detail('order_1')).toBe('/delivery/orders/order_1');
    expect(deliveryOrderPaths.shipments('order_1')).toBe('/delivery/orders/order_1/shipments');
    expect(deliveryUnitPaths.fieldConfig()).toBe('/delivery/unit-field-config');
    expect(deliveryCustomerServicePaths.list()).toBe('/delivery/cs');
    expect(deliveryCustomerServicePaths.detail('conv_1')).toBe('/delivery/cs/conv_1');
    expect(deliveryManifestPaths.order('order_1')).toBe('/delivery/orders/order_1/manifest');
  });
});

describe('delivery repo mappers', () => {
  it('maps delivery auth session and nested current unit', () => {
    const mapped = mapDeliveryAuthSession({
      accessToken: 'delivery-token',
      requiresUnit: false,
      currentUnitId: 'unit_1',
      currentUnit: {
        id: 'unit_1',
        name: '华南餐饮部',
        contactName: '张三',
        contactPhone: '13800000000',
        provinceCode: '440000',
        provinceName: '广东省',
        cityCode: '440100',
        cityName: '广州市',
        districtCode: '440106',
        districtName: '天河区',
        detailAddress: '体育西路 1 号',
        extraFields: { canteenFloor: '3F' },
        status: 'ACTIVE',
      },
      user: {
        id: 'PSYH0001',
        phone: '13800000000',
        nickname: '配送员',
        avatarUrl: null,
        status: 'ACTIVE',
      },
    });

    expect(mapped.currentUnit?.detailAddress).toBe('体育西路 1 号');
    expect(mapped.user.nickname).toBe('配送员');
    expect(mapped.requiresUnit).toBe(false);
  });

  it('maps delivery catalog products from cents to yuan with sku-derived defaults', () => {
    const mapped = mapDeliveryCatalogProduct({
      id: 'product_1',
      title: '冷鲜牛腩',
      subtitle: '冷链直达',
      description: '描述',
      detailRich: null,
      media: [{ url: 'https://img.example.com/a.png' }],
      attributes: { 规格: '箱' },
      unitName: '箱',
      minOrderQuantity: 2,
      orderStepQuantity: 2,
      merchant: { id: 'merchant_1', name: '华南仓' },
      category: { id: 'cat_1', name: '牛肉', status: 'ACTIVE' },
      minFinalPriceCents: 1234,
      skus: [
        {
          id: 'sku_1',
          title: '5kg/箱',
          imageUrl: 'https://img.example.com/a.png',
          stock: 9,
          minOrderQuantity: 2,
          orderStepQuantity: 2,
          finalPriceCents: 1234,
        },
        {
          id: 'sku_2',
          title: '10kg/箱',
          imageUrl: null,
          stock: 3,
          minOrderQuantity: 2,
          orderStepQuantity: 2,
          finalPriceCents: 1888,
        },
      ],
    });

    expect(mapped.price).toBe(12.34);
    expect(mapped.priceFrom).toBe(true);
    expect(mapped.defaultSkuId).toBe('sku_1');
    expect(mapped.stock).toBe(12);
  });

  it('maps delivery cart summary and line amounts from cents to yuan', () => {
    const mapped = mapDeliveryCartResponse({
      currentUnitId: 'unit_1',
      items: [
        {
          id: 'cart_1',
          skuId: 'sku_1',
          quantity: 3,
          isSelected: true,
          productId: 'product_1',
          productTitle: '冷鲜牛腩',
          skuTitle: '5kg/箱',
          imageUrl: 'https://img.example.com/a.png',
          unitName: '箱',
          merchant: { id: 'merchant_1', name: '华南仓', status: 'ACTIVE' },
          stock: 20,
          minOrderQuantity: 2,
          orderStepQuantity: 1,
          finalPriceCents: 1275,
          lineAmountCents: 3825,
        },
      ],
      summary: {
        selectedGoodsAmountCents: 3825,
      },
    });

    expect(mapped.items[0].finalPrice).toBe(12.75);
    expect(mapped.items[0].lineAmount).toBe(38.25);
    expect(mapped.summary.selectedGoodsAmount).toBe(38.25);
  });

  it('maps delivery checkout session amounts from cents to yuan', () => {
    const mapped = mapDeliveryCheckoutSession({
      id: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      status: 'ACTIVE',
      goodsAmountCents: 5200,
      shippingFeeCents: 800,
      totalAmountCents: 6000,
      paymentChannel: 'ALIPAY',
      note: '尽快送达',
      expiresAt: '2026-06-19T12:00:00.000Z',
      createdAt: '2026-06-19T11:30:00.000Z',
      addressId: 'addr_1',
      unitId: 'unit_1',
      pricingSnapshot: { totals: { totalAmountCents: 6000 } },
      addressSnapshot: { recipientName: '李四' },
      unitSnapshot: { name: '华南餐饮部' },
      itemsSnapshot: [],
    } as any);

    expect(mapped.totalAmount).toBe(60);
    expect(mapped.shippingFee).toBe(8);
    expect(mapped.merchantOrderNo).toBe('PSZF0000000000001');
    expect(mapped).not.toHaveProperty('pricingSnapshot');
    expect(mapped).not.toHaveProperty('itemsSnapshot');
    expect(mapped).not.toHaveProperty('addressSnapshot');
    expect(mapped).not.toHaveProperty('unitSnapshot');
  });

  it('maps delivery manifest rows with template version metadata', () => {
    const mapped = mapDeliveryManifestRow({
      id: 'manifest_1',
      type: 'BUYER_FULL',
      format: 'PDF',
      title: 'Buyer Full Manifest',
      fileUrl: 'https://oss.example.com/delivery/manifests/a.pdf',
      storageKey: 'delivery/manifests/a.pdf',
      status: 'GENERATED',
      generatedAt: '2026-06-19T12:00:00.000Z',
      payloadSnapshot: { versionNo: 3 },
      templateVersion: {
        id: 'version_3',
        versionNo: 3,
      },
    });

    expect(mapped.storageKey.startsWith('delivery/')).toBe(true);
    expect(mapped.templateVersion.versionNo).toBe(3);
    expect(mapped.type).toBe('BUYER_FULL');
  });

  it('maps delivery buyer orders with nested cents snapshots and shipment rows', () => {
    const mapped = mapDeliveryBuyerOrder({
      id: 'PSDD0000000000001',
      status: 'PENDING_SHIPMENT',
      note: '下班前送达',
      merchantOrderNo: 'PSZF0000000000001',
      paymentChannel: 'ALIPAY',
      goodsAmountCents: 5200,
      shippingFeeCents: 800,
      totalAmountCents: 6000,
      createdAt: '2026-06-19T12:00:00.000Z',
      paidAt: '2026-06-19T12:10:00.000Z',
      unit: {
        id: 'unit_1',
        name: '华南餐饮部',
        contactName: '张三',
        contactPhone: '13800000000',
      },
      address: {
        recipientName: '李四',
        phone: '13900000000',
        regionText: '广东省 广州市 天河区',
        detailAddress: '体育西路 1 号',
      },
      subOrders: [
        {
          id: 'PSZDD000000000001',
          merchantId: 'merchant_1',
          merchantName: '华南仓',
          status: 'PENDING_SHIPMENT',
          totalAmountCents: 6000,
          shippingFeeShareCents: 800,
        },
      ],
      items: [
        {
          id: 'item_1',
          subOrderId: 'PSZDD000000000001',
          merchantId: 'merchant_1',
          merchantName: '华南仓',
          productId: 'product_1',
          skuId: 'sku_1',
          productTitle: '冷鲜牛腩',
          skuTitle: '5kg/箱',
          imageUrl: 'https://img.example.com/a.png',
          unitName: '箱',
          quantity: 2,
          unitPriceCents: 2600,
          lineAmountCents: 5200,
        },
      ],
      shipments: [
        {
          id: 'shipment_1',
          status: 'SHIPPED',
          carrierCode: 'SF',
          carrierName: '顺丰速运',
          waybillNo: 'SF123',
          waybillUrl: 'https://oss.example.com/waybill.pdf',
          shippedAt: '2026-06-19T13:00:00.000Z',
          deliveredAt: null,
        },
      ],
    });

    expect(mapped.totalAmount).toBe(60);
    expect(mapped.items[0].unitPrice).toBe(26);
    expect(mapped.subOrders[0].shippingFeeShare).toBe(8);
    expect(mapped.address.regionText).toContain('天河区');
    expect(mapped.shipments[0].waybillNo).toBe('SF123');
  });
});
