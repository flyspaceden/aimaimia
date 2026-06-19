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
  let moduleRef: { get: jest.Mock };
  let service: DeliveryCheckoutService;
  let alipayService: { isAvailable: jest.Mock; createAppPayOrder: jest.Mock };
  let wechatPayService: { isAvailable: jest.Mock; createAppOrder: jest.Mock };

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
    moduleRef = {
      get: jest.fn(),
    };
    alipayService = {
      isAvailable: jest.fn().mockReturnValue(true),
      createAppPayOrder: jest.fn().mockResolvedValue('delivery-order-str'),
    };
    wechatPayService = {
      isAvailable: jest.fn().mockReturnValue(true),
      createAppOrder: jest.fn().mockResolvedValue({
        appId: 'wx-app',
        partnerId: 'mch-1',
        timestamp: '1718798400',
        nonceStr: 'nonce',
        prepayId: 'prepay-1',
        packageVal: 'Sign=WXPay',
        signType: 'RSA',
        paySign: 'signed',
      }),
    };
    moduleRef.get.mockImplementation((token: any) => {
      if (token?.name === 'AlipayService') return alipayService;
      if (token?.name === 'WechatPayService') return wechatPayService;
      return null;
    });
    service = new DeliveryCheckoutService(
      deliveryPrisma as DeliveryPrismaService,
      pricingService as unknown as DeliveryPricingService,
      deliveryIdService as unknown as DeliveryIdService,
      moduleRef as any,
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

  it('requires paymentChannel for a payable delivery checkout session', async () => {
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
      extraFields: null,
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

    await expect(
      service.createCheckout('PSYH0000000000001', {
        cartItemIds: ['cart_1'],
        paymentChannel: undefined as any,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.deliveryCheckoutSession.create).not.toHaveBeenCalled();
  });

  it('creates delivery Alipay app payment params for an active checkout session', async () => {
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
      extraFields: null,
    });
    deliveryPrisma.deliveryCheckoutSession.findFirst.mockResolvedValue({
      id: 'checkout_1',
      userId: 'PSYH0000000000001',
      unitId: 'unit_1',
      merchantOrderNo: 'PSZF0000000000001',
      paymentChannel: 'ALIPAY',
      totalAmountCents: 4900,
      status: 'ACTIVE',
      expiresAt: new Date('2099-06-19T12:00:00.000Z'),
    });
    const result = await service.createPaymentParams('PSYH0000000000001', 'checkout_1');

    expect(alipayService.createAppPayOrder).toHaveBeenCalledWith({
      merchantOrderNo: 'PSZF0000000000001',
      totalAmount: 49,
      subject: '爱买买配送订单-PSZF0000000000001',
    });
    expect(result).toEqual({
      checkoutId: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      totalAmount: 49,
      paymentParams: {
        channel: 'alipay',
        orderStr: 'delivery-order-str',
      },
    });
  });

  it('creates delivery WeChat app payment params for an active checkout session', async () => {
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
      extraFields: null,
    });
    deliveryPrisma.deliveryCheckoutSession.findFirst.mockResolvedValue({
      id: 'checkout_2',
      userId: 'PSYH0000000000001',
      unitId: 'unit_1',
      merchantOrderNo: 'PSZF0000000000002',
      paymentChannel: 'WECHAT_PAY',
      totalAmountCents: 6600,
      status: 'ACTIVE',
      expiresAt: new Date('2099-06-19T12:00:00.000Z'),
    });
    const result = await service.createPaymentParams('PSYH0000000000001', 'checkout_2');

    expect(wechatPayService.createAppOrder).toHaveBeenCalledWith({
      outTradeNo: 'PSZF0000000000002',
      amount: 66,
      description: '爱买买配送订单-PSZF0000000000002',
    });
    expect(result).toEqual({
      checkoutId: 'checkout_2',
      merchantOrderNo: 'PSZF0000000000002',
      totalAmount: 66,
      paymentParams: {
        channel: 'wechat',
        appId: 'wx-app',
        partnerId: 'mch-1',
        timestamp: '1718798400',
        nonceStr: 'nonce',
        prepayId: 'prepay-1',
        packageVal: 'Sign=WXPay',
        signType: 'RSA',
        paySign: 'signed',
      },
    });
  });

  describe('createPaymentParams rejection guards', () => {
    beforeEach(() => {
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
        extraFields: null,
      });
    });

    const expectNoPaymentServiceCall = () => {
      expect(alipayService.createAppPayOrder).not.toHaveBeenCalled();
      expect(wechatPayService.createAppOrder).not.toHaveBeenCalled();
    };

    it('rejects pay params when the checkout session is missing or not owned by the delivery user', async () => {
      deliveryPrisma.deliveryCheckoutSession.findFirst.mockResolvedValue(null);

      await expect(
        service.createPaymentParams('PSYH0000000000001', 'checkout_missing'),
      ).rejects.toThrow(new NotFoundException('配送结算会话不存在'));

      expect(deliveryPrisma.deliveryCheckoutSession.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'checkout_missing',
          userId: 'PSYH0000000000001',
          unitId: 'unit_1',
        },
        select: {
          id: true,
          merchantOrderNo: true,
          paymentChannel: true,
          totalAmountCents: true,
          status: true,
          expiresAt: true,
        },
      });
      expectNoPaymentServiceCall();
    });

    it('rejects pay params when the checkout session belongs to a different current unit', async () => {
      deliveryPrisma.deliveryUser.findUnique.mockResolvedValue({
        id: 'PSYH0000000000001',
        currentUnitId: 'unit_2',
      });
      deliveryPrisma.deliveryUnit.findFirst.mockResolvedValue({
        id: 'unit_2',
        userId: 'PSYH0000000000001',
        status: 'ACTIVE',
        name: '青禾食堂二店',
        contactName: '李四',
        contactPhone: '13900000000',
        provinceCode: '440000',
        provinceName: '广东省',
        cityCode: '440100',
        cityName: '广州市',
        districtCode: '440106',
        districtName: '天河区',
        detailAddress: '体育东路 2 号',
        extraFields: null,
      });
      deliveryPrisma.deliveryCheckoutSession.findFirst.mockResolvedValue(null);

      await expect(
        service.createPaymentParams('PSYH0000000000001', 'checkout_1'),
      ).rejects.toThrow(new NotFoundException('配送结算会话不存在'));

      expect(deliveryPrisma.deliveryCheckoutSession.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'checkout_1',
          userId: 'PSYH0000000000001',
          unitId: 'unit_2',
        },
        select: {
          id: true,
          merchantOrderNo: true,
          paymentChannel: true,
          totalAmountCents: true,
          status: true,
          expiresAt: true,
        },
      });
      expectNoPaymentServiceCall();
    });

    it('rejects pay params when the checkout session is not ACTIVE', async () => {
      deliveryPrisma.deliveryCheckoutSession.findFirst.mockResolvedValue({
        id: 'checkout_1',
        merchantOrderNo: 'PSZF0000000000001',
        paymentChannel: 'ALIPAY',
        totalAmountCents: 4900,
        status: 'PAID',
        expiresAt: new Date('2099-06-19T12:00:00.000Z'),
      });

      await expect(
        service.createPaymentParams('PSYH0000000000001', 'checkout_1'),
      ).rejects.toThrow(new BadRequestException('配送结算会话状态不可支付: PAID'));

      expectNoPaymentServiceCall();
    });

    it('rejects pay params when the checkout session is expired', async () => {
      deliveryPrisma.deliveryCheckoutSession.findFirst.mockResolvedValue({
        id: 'checkout_1',
        merchantOrderNo: 'PSZF0000000000001',
        paymentChannel: 'ALIPAY',
        totalAmountCents: 4900,
        status: 'ACTIVE',
        expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      });

      await expect(
        service.createPaymentParams('PSYH0000000000001', 'checkout_1'),
      ).rejects.toThrow(new BadRequestException('配送结算会话已过期'));

      expectNoPaymentServiceCall();
    });

    it('rejects pay params when merchantOrderNo is missing', async () => {
      deliveryPrisma.deliveryCheckoutSession.findFirst.mockResolvedValue({
        id: 'checkout_1',
        merchantOrderNo: null,
        paymentChannel: 'ALIPAY',
        totalAmountCents: 4900,
        status: 'ACTIVE',
        expiresAt: new Date('2099-06-19T12:00:00.000Z'),
      });

      await expect(
        service.createPaymentParams('PSYH0000000000001', 'checkout_1'),
      ).rejects.toThrow(new BadRequestException('配送结算会话缺少支付单号'));

      expectNoPaymentServiceCall();
    });

    it('rejects pay params when paymentChannel is missing', async () => {
      deliveryPrisma.deliveryCheckoutSession.findFirst.mockResolvedValue({
        id: 'checkout_1',
        merchantOrderNo: 'PSZF0000000000001',
        paymentChannel: null,
        totalAmountCents: 4900,
        status: 'ACTIVE',
        expiresAt: new Date('2099-06-19T12:00:00.000Z'),
      });

      await expect(
        service.createPaymentParams('PSYH0000000000001', 'checkout_1'),
      ).rejects.toThrow(new BadRequestException('配送结算会话缺少支付渠道'));

      expectNoPaymentServiceCall();
    });

    it('rejects pay params when paymentChannel is unsupported', async () => {
      deliveryPrisma.deliveryCheckoutSession.findFirst.mockResolvedValue({
        id: 'checkout_1',
        merchantOrderNo: 'PSZF0000000000001',
        paymentChannel: 'BALANCE_PAY',
        totalAmountCents: 4900,
        status: 'ACTIVE',
        expiresAt: new Date('2099-06-19T12:00:00.000Z'),
      });

      await expect(
        service.createPaymentParams('PSYH0000000000001', 'checkout_1'),
      ).rejects.toThrow(new BadRequestException('配送支付渠道不支持'));

      expectNoPaymentServiceCall();
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
      paymentChannel: 'ALIPAY',
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
        paymentChannel: 'ALIPAY',
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
