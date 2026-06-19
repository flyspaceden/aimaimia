import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import { DeliveryPricingService } from '../pricing/delivery-pricing.service';
import { DeliveryCheckoutService } from './delivery-checkout.service';

describe('DeliveryCheckoutService', () => {
  let tx: any;
  let deliveryPrisma: any;
  let deliveryIdService: { nextInTransaction: jest.Mock };
  let pricingService: { resolvePrice: jest.Mock };
  let service: DeliveryCheckoutService;

  beforeEach(() => {
    tx = {
      deliveryUser: {
        findUnique: jest.fn(),
      },
      deliveryUnit: {
        findFirst: jest.fn(),
      },
      deliveryAddress: {
        findFirst: jest.fn(),
      },
      deliveryCartItem: {
        findMany: jest.fn(),
      },
      deliveryPriceRule: {
        findMany: jest.fn(),
      },
      deliveryShippingRule: {
        findMany: jest.fn(),
      },
      deliveryCheckoutSession: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    deliveryPrisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      deliveryUser: {
        findUnique: jest.fn(),
      },
      deliveryUnit: {
        findFirst: jest.fn(),
      },
      deliveryCheckoutSession: {
        findFirst: jest.fn(),
      },
    };
    deliveryIdService = {
      nextInTransaction: jest.fn().mockResolvedValue('PSZF0000000000001'),
    };
    pricingService = {
      resolvePrice: jest
        .fn()
        .mockReturnValueOnce({
          finalPriceCents: 1100,
          matchedSource: 'MERCHANT_DEFAULT_MARKUP',
          matchedRuleId: null,
          appliedMarkupBps: 1000,
        })
        .mockReturnValueOnce({
          finalPriceCents: 2200,
          matchedSource: 'MERCHANT_DEFAULT_MARKUP',
          matchedRuleId: null,
          appliedMarkupBps: 1000,
        }),
    };
    service = new DeliveryCheckoutService(
      deliveryPrisma as DeliveryPrismaService,
      pricingService as unknown as DeliveryPricingService,
      deliveryIdService as unknown as DeliveryIdService,
    );
  });

  it('creates one delivery checkout session with merchant-grouped snapshots and unit-address fallback', async () => {
    tx.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: 'unit_1',
    });
    tx.deliveryUnit.findFirst.mockResolvedValue({
      id: 'unit_1',
      userId: 'PSYH0000000000001',
      status: 'ACTIVE',
      name: '青禾食堂',
      contactName: '张三',
      contactPhone: '13800000000',
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440100',
      cityName: '广州市',
      districtCode: '440106',
      districtName: '天河区',
      detailAddress: '体育西路 1 号',
      extraFields: {
        gateCode: 'A-01',
      },
    });
    tx.deliveryCartItem.findMany.mockResolvedValue([
      {
        id: 'cart_1',
        userId: 'PSYH0000000000001',
        unitId: 'unit_1',
        skuId: 'sku_1',
        quantity: 2,
        isSelected: true,
        sku: {
          id: 'sku_1',
          title: '5kg/箱',
          imageUrl: null,
          basePriceCents: 1000,
          stock: 20,
          minOrderQuantity: 1,
          orderStepQuantity: 1,
          weightGram: 400,
          isActive: true,
          fixedFinalPriceCents: null,
          priceRules: [],
          product: {
            id: 'PSSP0000000000001',
            title: '冷鲜牛腩',
            unitName: '箱',
            minOrderQuantity: 1,
            orderStepQuantity: 1,
            status: 'ACTIVE',
            auditStatus: 'APPROVED',
            priceRules: [],
            merchant: {
              id: 'merchant_1',
              name: '华南仓',
              defaultMarkupBps: 1000,
              status: 'ACTIVE',
            },
          },
        },
      },
      {
        id: 'cart_2',
        userId: 'PSYH0000000000001',
        unitId: 'unit_1',
        skuId: 'sku_2',
        quantity: 1,
        isSelected: true,
        sku: {
          id: 'sku_2',
          title: '10kg/箱',
          imageUrl: null,
          basePriceCents: 2000,
          stock: 10,
          minOrderQuantity: 1,
          orderStepQuantity: 1,
          weightGram: 1000,
          isActive: true,
          fixedFinalPriceCents: null,
          priceRules: [],
          product: {
            id: 'PSSP0000000000002',
            title: '牛霖',
            unitName: '箱',
            minOrderQuantity: 1,
            orderStepQuantity: 1,
            status: 'ACTIVE',
            auditStatus: 'APPROVED',
            priceRules: [],
            merchant: {
              id: 'merchant_2',
              name: '华东仓',
              defaultMarkupBps: 1000,
              status: 'ACTIVE',
            },
          },
        },
      },
    ]);
    tx.deliveryPriceRule.findMany.mockResolvedValue([]);
    tx.deliveryShippingRule.findMany.mockResolvedValue([
      {
        id: 'ship_rule_1',
        merchantId: 'merchant_1',
        status: 'ACTIVE',
        calcType: 'WEIGHT',
        firstWeightGram: 1000,
        firstWeightPriceCents: 500,
        additionalWeightGram: 500,
        additionalWeightPriceCents: 200,
        freeShippingThresholdCents: null,
        minShippingFeeCents: 0,
        sortOrder: 1,
      },
    ]);
    tx.deliveryCheckoutSession.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'checkout_1',
        ...data,
      }),
    );

    const result = await service.createCheckout('PSYH0000000000001', {
      cartItemIds: ['cart_1', 'cart_2'],
      note: '送货前联系',
      paymentChannel: 'ALIPAY',
    });

    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    const createCall = tx.deliveryCheckoutSession.create.mock.calls[0][0];
    expect(createCall.data).toMatchObject({
      userId: 'PSYH0000000000001',
      unitId: 'unit_1',
      addressId: null,
      note: '送货前联系',
      merchantOrderNo: 'PSZF0000000000001',
      paymentChannel: 'ALIPAY',
      goodsAmountCents: 4400,
      shippingFeeCents: 500,
      totalAmountCents: 4900,
    });
    expect(createCall.data.unitSnapshot).toMatchObject({
      id: 'unit_1',
      name: '青禾食堂',
      contactName: '张三',
      detailAddress: '体育西路 1 号',
    });
    expect(createCall.data.addressSnapshot).toMatchObject({
      source: 'UNIT',
      recipientName: '张三',
      phone: '13800000000',
      detailAddress: '体育西路 1 号',
    });
    expect(createCall.data.pricingSnapshot).toMatchObject({
      merchantGroups: [
        {
          merchantId: 'merchant_1',
          goodsAmountCents: 2200,
          shippingFeeCents: 500,
        },
        {
          merchantId: 'merchant_2',
          goodsAmountCents: 2200,
          shippingFeeCents: 0,
          shippingRuleSnapshot: {
            fallbackReason: 'NO_DELIVERY_SHIPPING_RULE',
          },
        },
      ],
    });
    expect(createCall.data).not.toHaveProperty('rewardId');
    expect(createCall.data).not.toHaveProperty('couponInstanceIds');
    expect(result).toMatchObject({
      id: 'checkout_1',
      goodsAmountCents: 4400,
      shippingFeeCents: 500,
      totalAmountCents: 4900,
    });
  });

  it('uses a provided delivery address only when it belongs to the current user and unit', async () => {
    tx.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: 'unit_1',
    });
    tx.deliveryUnit.findFirst.mockResolvedValue({
      id: 'unit_1',
      userId: 'PSYH0000000000001',
      status: 'ACTIVE',
      name: '青禾食堂',
      contactName: '张三',
      contactPhone: '13800000000',
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440100',
      cityName: '广州市',
      districtCode: '440106',
      districtName: '天河区',
      detailAddress: '体育西路 1 号',
      extraFields: {},
    });
    tx.deliveryAddress.findFirst.mockResolvedValue({
      id: 'addr_1',
      userId: 'PSYH0000000000001',
      unitId: 'unit_1',
      recipientName: '李四',
      phone: '13900000000',
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440300',
      cityName: '深圳市',
      districtCode: '440305',
      districtName: '南山区',
      detailAddress: '科技园 8 号',
      regionText: '广东省深圳市南山区',
      label: '后厨',
    });
    tx.deliveryCartItem.findMany.mockResolvedValue([
      {
        id: 'cart_1',
        userId: 'PSYH0000000000001',
        unitId: 'unit_1',
        skuId: 'sku_1',
        quantity: 1,
        isSelected: true,
        sku: {
          id: 'sku_1',
          title: '5kg/箱',
          imageUrl: null,
          basePriceCents: 1000,
          stock: 20,
          minOrderQuantity: 1,
          orderStepQuantity: 1,
          weightGram: 400,
          isActive: true,
          fixedFinalPriceCents: null,
          priceRules: [],
          product: {
            id: 'PSSP0000000000001',
            title: '冷鲜牛腩',
            unitName: '箱',
            minOrderQuantity: 1,
            orderStepQuantity: 1,
            status: 'ACTIVE',
            auditStatus: 'APPROVED',
            priceRules: [],
            merchant: {
              id: 'merchant_1',
              name: '华南仓',
              defaultMarkupBps: 1000,
              status: 'ACTIVE',
            },
          },
        },
      },
    ]);
    tx.deliveryPriceRule.findMany.mockResolvedValue([]);
    tx.deliveryShippingRule.findMany.mockResolvedValue([]);
    tx.deliveryCheckoutSession.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'checkout_2',
        ...data,
      }),
    );

    await service.createCheckout('PSYH0000000000001', {
      cartItemIds: ['cart_1'],
      addressId: 'addr_1',
    });

    expect(tx.deliveryAddress.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'addr_1',
        userId: 'PSYH0000000000001',
        unitId: 'unit_1',
      },
    });
    expect(tx.deliveryCheckoutSession.create.mock.calls[0][0].data).toMatchObject({
      addressId: 'addr_1',
      addressSnapshot: {
        source: 'ADDRESS',
        id: 'addr_1',
        recipientName: '李四',
        detailAddress: '科技园 8 号',
      },
    });
  });

  it('rejects checkout when selected cart items are missing from the current delivery unit scope', async () => {
    tx.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: 'unit_1',
    });
    tx.deliveryUnit.findFirst.mockResolvedValue({
      id: 'unit_1',
      userId: 'PSYH0000000000001',
      status: 'ACTIVE',
      name: '青禾食堂',
      contactName: '张三',
      contactPhone: '13800000000',
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440100',
      cityName: '广州市',
      districtCode: '440106',
      districtName: '天河区',
      detailAddress: '体育西路 1 号',
      extraFields: {},
    });
    tx.deliveryCartItem.findMany.mockResolvedValue([
      {
        id: 'cart_1',
      },
    ]);

    await expect(
      service.createCheckout('PSYH0000000000001', {
        cartItemIds: ['cart_1', 'cart_2'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.deliveryCheckoutSession.create).not.toHaveBeenCalled();
  });

  it('returns only the authenticated delivery user checkout session in the current unit', async () => {
    deliveryPrisma.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: 'unit_1',
    });
    deliveryPrisma.deliveryUnit.findFirst.mockResolvedValue({
      id: 'unit_1',
      userId: 'PSYH0000000000001',
      status: 'ACTIVE',
      name: '青禾食堂',
      contactName: '张三',
      contactPhone: '13800000000',
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440100',
      cityName: '广州市',
      districtCode: '440106',
      districtName: '天河区',
      detailAddress: '体育西路 1 号',
      extraFields: {},
    });
    deliveryPrisma.deliveryCheckoutSession.findFirst
      .mockResolvedValueOnce({
        id: 'checkout_1',
        userId: 'PSYH0000000000001',
        unitId: 'unit_1',
        totalAmountCents: 4900,
      })
      .mockResolvedValueOnce(null);

    await expect(service.getCheckout('PSYH0000000000001', 'checkout_1')).resolves.toMatchObject({
      id: 'checkout_1',
      totalAmountCents: 4900,
    });
    await expect(service.getCheckout('PSYH0000000000001', 'checkout_2')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(deliveryPrisma.deliveryCheckoutSession.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'checkout_1',
        userId: 'PSYH0000000000001',
        unitId: 'unit_1',
      },
    });
  });

  it('rejects checkout reads when currentUnitId does not resolve to an active owned unit', async () => {
    deliveryPrisma.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: 'unit_9',
    });
    deliveryPrisma.deliveryUnit.findFirst.mockResolvedValue(null);

    await expect(service.getCheckout('PSYH0000000000001', 'checkout_1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(deliveryPrisma.deliveryUnit.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'unit_9',
        userId: 'PSYH0000000000001',
      },
      select: {
        id: true,
        userId: true,
        status: true,
        name: true,
        contactName: true,
        contactPhone: true,
        provinceCode: true,
        provinceName: true,
        cityCode: true,
        cityName: true,
        districtCode: true,
        districtName: true,
        detailAddress: true,
        extraFields: true,
      },
    });
    expect(deliveryPrisma.deliveryCheckoutSession.findFirst).not.toHaveBeenCalled();
  });
});
