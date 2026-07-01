import { BadRequestException } from '@nestjs/common';
import {
  DeliveryCarrierProvider,
  DeliveryPickupMode,
  DeliveryShippingCostLedgerType,
} from '../../../generated/delivery-client';
import { DeliveryIdService } from '../common/delivery-id.service';
import { DeliveryPickupPlanService } from './delivery-pickup-plan.service';

describe('DeliveryPickupPlanService', () => {
  let tx: any;
  let deliveryIdService: { nextInTransaction: jest.Mock };
  let service: DeliveryPickupPlanService;

  beforeEach(() => {
    tx = {
      deliveryOrderItem: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      deliveryPickupBatch: {
        create: jest.fn(),
      },
      deliveryPickupBatchItem: {
        create: jest.fn(),
      },
      deliveryShippingCostLedger: {
        create: jest.fn(),
      },
    };

    deliveryIdService = {
      nextInTransaction: jest
        .fn()
        .mockResolvedValueOnce('PSTH0000000000001')
        .mockResolvedValueOnce('PSTH0000000000002')
        .mockResolvedValueOnce('PSTH0000000000003')
        .mockResolvedValueOnce('PSTH0000000000004'),
    };

    service = new DeliveryPickupPlanService(
      deliveryIdService as unknown as DeliveryIdService,
    );
  });

  it('rejects pickup plans whose item quantities do not equal cart quantities', async () => {
    await expect(
      service.buildCheckoutPickupSnapshot({
        pickupMode: DeliveryPickupMode.MULTI_BATCH,
        plannedPickupCount: 2,
        cartItems: [
          {
            cartItemId: 'cart_1',
            merchantId: 'merchant_1',
            merchantName: '华南仓',
            quantity: 3,
            lineAmountCents: 3300,
          },
        ],
        merchantGroups: [
          {
            merchantId: 'merchant_1',
            merchantName: '华南仓',
            goodsAmountCents: 3300,
          },
        ],
        pickupPlanItems: [
          { cartItemId: 'cart_1', batchNo: 1, quantity: 1 },
          { cartItemId: 'cart_1', batchNo: 2, quantity: 1 },
        ],
        fallbackShippingFeeCents: 500,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('splits quantities across batches by default when no explicit pickup plan is provided', async () => {
    const result = await service.buildCheckoutPickupSnapshot({
      pickupMode: DeliveryPickupMode.MULTI_BATCH,
      plannedPickupCount: 3,
      cartItems: [
        {
          cartItemId: 'cart_1',
          merchantId: 'merchant_1',
          merchantName: '华南仓',
          quantity: 5,
          lineAmountCents: 5500,
        },
      ],
      merchantGroups: [
        {
          merchantId: 'merchant_1',
          merchantName: '华南仓',
          goodsAmountCents: 5500,
        },
      ],
      fallbackShippingFeeCents: 0,
    });

    const snapshot = result.pickupPlanSnapshot as any;
    expect(snapshot.merchantGroups[0].batches).toEqual([
      {
        batchNo: 1,
        estimatedShippingFeeCents: 0,
        items: [{ cartItemId: 'cart_1', quantity: 2 }],
      },
      {
        batchNo: 2,
        estimatedShippingFeeCents: 0,
        items: [{ cartItemId: 'cart_1', quantity: 2 }],
      },
      {
        batchNo: 3,
        estimatedShippingFeeCents: 0,
        items: [{ cartItemId: 'cart_1', quantity: 1 }],
      },
    ]);
  });

  it('re-rates stepped fallback freight per batch instead of copying the full merchant allocation', async () => {
    const result = await service.buildCheckoutPickupSnapshot({
      pickupMode: DeliveryPickupMode.MULTI_BATCH,
      plannedPickupCount: 2,
      cartItems: [
        {
          cartItemId: 'cart_1',
          merchantId: 'merchant_1',
          merchantName: '华南仓',
          quantity: 4,
          lineAmountCents: 4400,
        },
      ],
      merchantGroups: [
        {
          merchantId: 'merchant_1',
          merchantName: '华南仓',
          goodsAmountCents: 4400,
        },
      ],
      fallbackShippingFeeCents: 900,
      shippingRules: [
        {
          id: 'ship_rule_1',
          merchantId: null,
          calcType: 'COUNT',
          firstWeightGram: 2,
          firstWeightPriceCents: 500,
          additionalWeightGram: 1,
          additionalWeightPriceCents: 200,
          freeShippingThresholdCents: null,
          minShippingFeeCents: 0,
          sortOrder: 1,
        },
      ],
    } as any);

    expect(result.perBatchEstimates).toEqual([
      { merchantId: 'merchant_1', batchNo: 1, estimatedShippingFeeCents: 500 },
      { merchantId: 'merchant_1', batchNo: 2, estimatedShippingFeeCents: 500 },
    ]);
    expect(result.prepaidPickupShippingFeeCents).toBe(1000);
  });

  it('preserves per-item batch amount allocations so AMOUNT rules do not overcharge after splitting', async () => {
    const result = await service.buildCheckoutPickupSnapshot({
      pickupMode: DeliveryPickupMode.MULTI_BATCH,
      plannedPickupCount: 3,
      cartItems: [
        {
          cartItemId: 'cart_1',
          merchantId: 'merchant_1',
          merchantName: '华南仓',
          quantity: 3,
          lineAmountCents: 101,
        },
      ],
      merchantGroups: [
        {
          merchantId: 'merchant_1',
          merchantName: '华南仓',
          goodsAmountCents: 101,
        },
      ],
      fallbackShippingFeeCents: 300,
      shippingRules: [
        {
          id: 'ship_rule_amount',
          merchantId: null,
          calcType: 'AMOUNT',
          firstWeightGram: 33,
          firstWeightPriceCents: 100,
          additionalWeightGram: 1,
          additionalWeightPriceCents: 100,
          freeShippingThresholdCents: null,
          minShippingFeeCents: 0,
          sortOrder: 1,
        },
      ],
    } as any);

    expect(result.perBatchEstimates).toEqual([
      { merchantId: 'merchant_1', batchNo: 1, estimatedShippingFeeCents: 200 },
      { merchantId: 'merchant_1', batchNo: 2, estimatedShippingFeeCents: 200 },
      { merchantId: 'merchant_1', batchNo: 3, estimatedShippingFeeCents: 100 },
    ]);
    expect(result.prepaidPickupShippingFeeCents).toBe(500);
  });

  it('splits pickup plans by merchant sub-order and does not cross merchantId boundaries', async () => {
    const checkout = {
      id: 'checkout_1',
      pickupMode: DeliveryPickupMode.MULTI_BATCH,
      plannedPickupCount: 2,
      prepaidPickupShippingFeeCents: 1000,
      pickupPlanSnapshot: {
        pickupMode: DeliveryPickupMode.MULTI_BATCH,
        plannedPickupCount: 2,
        merchantGroups: [
          {
            merchantId: 'merchant_1',
            merchantName: '华南仓',
            goodsAmountCents: 2200,
            batches: [
              {
                batchNo: 1,
                estimatedShippingFeeCents: 500,
                items: [{ cartItemId: 'cart_1', quantity: 1 }],
              },
              {
                batchNo: 2,
                estimatedShippingFeeCents: 500,
                items: [{ cartItemId: 'cart_1', quantity: 1 }],
              },
            ],
          },
          {
            merchantId: 'merchant_2',
            merchantName: '华东仓',
            goodsAmountCents: 2200,
            batches: [
              {
                batchNo: 1,
                estimatedShippingFeeCents: 500,
                items: [{ cartItemId: 'cart_2', quantity: 1 }],
              },
              {
                batchNo: 2,
                estimatedShippingFeeCents: 500,
                items: [{ cartItemId: 'cart_2', quantity: 1 }],
              },
            ],
          },
        ],
        perBatchEstimates: [
          { merchantId: 'merchant_1', batchNo: 1, estimatedShippingFeeCents: 500 },
          { merchantId: 'merchant_1', batchNo: 2, estimatedShippingFeeCents: 500 },
          { merchantId: 'merchant_2', batchNo: 1, estimatedShippingFeeCents: 500 },
          { merchantId: 'merchant_2', batchNo: 2, estimatedShippingFeeCents: 500 },
        ],
      },
      itemsSnapshot: [
        {
          cartItemId: 'cart_1',
          merchantId: 'merchant_1',
          merchantName: '华南仓',
          productId: 'product_1',
          skuId: 'sku_1',
          productTitle: '冷鲜牛腩',
          skuTitle: '5kg/箱',
          quantity: 2,
          basePriceCents: 1000,
          finalPriceCents: 1100,
          lineAmountCents: 2200,
        },
        {
          cartItemId: 'cart_2',
          merchantId: 'merchant_2',
          merchantName: '华东仓',
          productId: 'product_2',
          skuId: 'sku_2',
          productTitle: '牛霖',
          skuTitle: '10kg/箱',
          quantity: 2,
          basePriceCents: 1000,
          finalPriceCents: 1100,
          lineAmountCents: 2200,
        },
      ],
      pricingSnapshot: {
        merchantGroups: [
          {
            merchantId: 'merchant_1',
            merchantName: '华南仓',
            goodsAmountCents: 2200,
            shippingFeeCents: 500,
          },
          {
            merchantId: 'merchant_2',
            merchantName: '华东仓',
            goodsAmountCents: 2200,
            shippingFeeCents: 500,
          },
        ],
      },
    };
    tx.deliveryOrderItem.findMany.mockResolvedValue([
      {
        id: 'order_item_1',
        orderId: 'order_1',
        subOrderId: 'sub_1',
        quantity: 2,
        reservedPickupQuantity: 0,
        productSnapshot: { cartItemId: 'cart_1', skuId: 'sku_1' },
      },
      {
        id: 'order_item_2',
        orderId: 'order_1',
        subOrderId: 'sub_2',
        quantity: 2,
        reservedPickupQuantity: 0,
        productSnapshot: { cartItemId: 'cart_2', skuId: 'sku_2' },
      },
    ]);
    tx.deliveryOrderItem.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryPickupBatch.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    tx.deliveryPickupBatchItem.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    tx.deliveryShippingCostLedger.create.mockResolvedValue({});

    await service.createBatchesForPaidOrder(tx, {
      orderId: 'order_1',
      checkout: checkout as any,
      subOrderIdsByMerchantId: new Map([
        ['merchant_1', 'sub_1'],
        ['merchant_2', 'sub_2'],
      ]),
      createdByProviderTxnId: 'ALI_TXN_1',
    });

    expect(tx.deliveryPickupBatch.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'PSTH0000000000001',
          orderId: 'order_1',
          subOrderId: 'sub_1',
          merchantId: 'merchant_1',
          batchNo: 1,
        }),
      }),
    );
    expect(tx.deliveryPickupBatch.create).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'PSTH0000000000003',
          orderId: 'order_1',
          subOrderId: 'sub_2',
          merchantId: 'merchant_2',
          batchNo: 1,
        }),
      }),
    );
  });

  it('creates batch items and reserves quantities inside a serializable transaction', async () => {
    tx.deliveryOrderItem.findMany.mockResolvedValue([
      {
        id: 'order_item_1',
        orderId: 'order_1',
        subOrderId: 'sub_1',
        quantity: 3,
        reservedPickupQuantity: 0,
        productSnapshot: {
          cartItemId: 'cart_1',
          productTitle: '冷鲜牛腩',
          skuTitle: '5kg/箱',
        },
      },
    ]);
    tx.deliveryOrderItem.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryPickupBatch.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    tx.deliveryPickupBatchItem.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    tx.deliveryShippingCostLedger.create.mockResolvedValue({});

    await service.createBatchesForPaidOrder(tx, {
      orderId: 'order_1',
      checkout: {
        id: 'checkout_1',
        pickupMode: DeliveryPickupMode.MULTI_BATCH,
        plannedPickupCount: 2,
        prepaidPickupShippingFeeCents: 600,
        pickupPlanSnapshot: {
          pickupMode: DeliveryPickupMode.MULTI_BATCH,
          plannedPickupCount: 2,
          merchantGroups: [
            {
              merchantId: 'merchant_1',
              merchantName: '华南仓',
              goodsAmountCents: 3300,
              batches: [
                {
                  batchNo: 1,
                  estimatedShippingFeeCents: 300,
                  items: [{ cartItemId: 'cart_1', quantity: 2 }],
                },
                {
                  batchNo: 2,
                  estimatedShippingFeeCents: 300,
                  items: [{ cartItemId: 'cart_1', quantity: 1 }],
                },
              ],
            },
          ],
          perBatchEstimates: [
            { merchantId: 'merchant_1', batchNo: 1, estimatedShippingFeeCents: 300 },
            { merchantId: 'merchant_1', batchNo: 2, estimatedShippingFeeCents: 300 },
          ],
        },
        itemsSnapshot: [
          {
            cartItemId: 'cart_1',
            merchantId: 'merchant_1',
            productId: 'product_1',
            skuId: 'sku_1',
            quantity: 3,
            basePriceCents: 1000,
            finalPriceCents: 1100,
            lineAmountCents: 3300,
          },
        ],
        pricingSnapshot: {
          merchantGroups: [
            { merchantId: 'merchant_1', goodsAmountCents: 3300, shippingFeeCents: 300 },
          ],
        },
      } as any,
      subOrderIdsByMerchantId: new Map([['merchant_1', 'sub_1']]),
      createdByProviderTxnId: 'ALI_TXN_1',
    });

    expect(tx.deliveryPickupBatchItem.create).toHaveBeenCalledTimes(2);
    expect(tx.deliveryOrderItem.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'order_item_1',
        subOrderId: 'sub_1',
        reservedPickupQuantity: 0,
      },
      data: {
        reservedPickupQuantity: { increment: 2 },
      },
    });
    expect(tx.deliveryOrderItem.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'order_item_1',
        subOrderId: 'sub_1',
        reservedPickupQuantity: 2,
      },
      data: {
        reservedPickupQuantity: { increment: 1 },
      },
    });
    expect(tx.deliveryPickupBatchItem.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          batchId: 'PSTH0000000000001',
          subOrderId: 'sub_1',
          orderItemId: 'order_item_1',
        }),
      }),
    );
  });

  it('writes prepaid freight ledger rows for the paid order', async () => {
    tx.deliveryOrderItem.findMany.mockResolvedValue([
      {
        id: 'order_item_1',
        orderId: 'order_1',
        subOrderId: 'sub_1',
        quantity: 1,
        reservedPickupQuantity: 0,
        productSnapshot: { cartItemId: 'cart_1' },
      },
    ]);
    tx.deliveryOrderItem.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryPickupBatch.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    tx.deliveryPickupBatchItem.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    tx.deliveryShippingCostLedger.create.mockResolvedValue({});

    await service.createBatchesForPaidOrder(tx, {
      orderId: 'order_1',
      checkout: {
        id: 'checkout_1',
        pickupMode: DeliveryPickupMode.SINGLE,
        plannedPickupCount: 1,
        prepaidPickupShippingFeeCents: 500,
        pickupPlanSnapshot: {
          pickupMode: DeliveryPickupMode.SINGLE,
          plannedPickupCount: 1,
          merchantGroups: [
            {
              merchantId: 'merchant_1',
              merchantName: '华南仓',
              goodsAmountCents: 1100,
              batches: [
                {
                  batchNo: 1,
                  estimatedShippingFeeCents: 500,
                  items: [{ cartItemId: 'cart_1', quantity: 1 }],
                },
              ],
            },
          ],
          perBatchEstimates: [
            { merchantId: 'merchant_1', batchNo: 1, estimatedShippingFeeCents: 500 },
          ],
        },
        itemsSnapshot: [
          {
            cartItemId: 'cart_1',
            merchantId: 'merchant_1',
            productId: 'product_1',
            skuId: 'sku_1',
            quantity: 1,
            basePriceCents: 1000,
            finalPriceCents: 1100,
            lineAmountCents: 1100,
          },
        ],
        pricingSnapshot: {
          merchantGroups: [
            { merchantId: 'merchant_1', goodsAmountCents: 1100, shippingFeeCents: 500 },
          ],
        },
      } as any,
      subOrderIdsByMerchantId: new Map([['merchant_1', 'sub_1']]),
      createdByProviderTxnId: 'ALI_TXN_1',
    });

    expect(tx.deliveryShippingCostLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order_1',
        subOrderId: null,
        batchId: null,
        provider: DeliveryCarrierProvider.HUOLALA,
        type: DeliveryShippingCostLedgerType.PREPAID_BY_USER,
        amountCents: 500,
        source: 'DELIVERY_CHECKOUT',
        sourceRefId: 'checkout_1',
        createdByType: 'SYSTEM',
        createdById: 'ALI_TXN_1',
      }),
    });
  });
});
