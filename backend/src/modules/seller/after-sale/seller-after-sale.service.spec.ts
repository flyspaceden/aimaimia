import { BadRequestException } from '@nestjs/common';
import { SellerAfterSaleService } from './seller-after-sale.service';

const companyId = 'company-1';
const staffId = 'staff-1';
const afterSaleId = 'as-1';

const buyerAddress = {
  recipientName: '买家',
  phone: '13800000000',
  province: '浙江省',
  city: '杭州市',
  district: '西湖区',
  detail: '文三路 1 号',
};

const companyAddress = {
  name: '卖家联系人',
  tel: '13900000000',
  province: '浙江省',
  city: '杭州市',
  district: '余杭区',
  detail: '仓库 1 号',
};

function baseRequest(overrides: Record<string, any> = {}) {
  return {
    id: afterSaleId,
    status: 'APPROVED',
    afterSaleType: 'NO_REASON_EXCHANGE',
    replacementWaybillNo: null,
    orderItemId: 'item-1',
    order: {
      id: 'order-1',
      addressSnapshot: buyerAddress,
      items: [
        {
          id: 'item-1',
          companyId,
          productSnapshot: { title: '苹果' },
          quantity: 2,
          sku: {
            product: {
              title: '苹果',
              company: {
                id: companyId,
                name: '农场店',
                servicePhone: '13900000000',
                address: {
                  province: companyAddress.province,
                  city: companyAddress.city,
                  district: companyAddress.district,
                  detail: companyAddress.detail,
                },
                contact: {
                  name: companyAddress.name,
                  phone: companyAddress.tel,
                },
              },
            },
          },
        },
      ],
    },
    orderItem: {
      id: 'item-1',
      companyId,
      productSnapshot: { title: '苹果' },
      quantity: 2,
      sku: {
        product: {
          title: '苹果',
          company: {
            id: companyId,
            name: '农场店',
            servicePhone: '13900000000',
            address: {
              province: companyAddress.province,
              city: companyAddress.city,
              district: companyAddress.district,
              detail: companyAddress.detail,
            },
            contact: {
              name: companyAddress.name,
              phone: companyAddress.tel,
            },
          },
        },
      },
    },
    ...overrides,
  };
}

function makeService(tx: any) {
  const shippingService = {
    createCarrierWaybill: jest.fn().mockResolvedValue({
      carrierCode: 'SF',
      carrierName: '顺丰速运',
      waybillNo: 'SF1234567890',
      waybillUrl: 'https://example.com/waybill.pdf',
      sfOrderId: 'sf-order-1',
    }),
    createCarrierWaybillWithAddresses: jest.fn().mockResolvedValue({
      carrierCode: 'SF',
      carrierName: '顺丰速运',
      waybillNo: 'SF0987654321',
      waybillUrl: 'https://example.com/reject-waybill.pdf',
      sfOrderId: 'sf-order-return-1',
      senderInfoSnapshot: companyAddress,
      receiverInfoSnapshot: buyerAddress,
    }),
    cancelCarrierWaybill: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  };
  const service = new SellerAfterSaleService(
    prisma as any,
    {
      get: jest.fn().mockReturnValue('/api/v1'),
      getOrThrow: jest.fn().mockReturnValue('seller-secret'),
    } as any,
    shippingService as any,
    {} as any,
    {} as any,
    {} as any,
    { startRefund: jest.fn() } as any,
    { create: jest.fn().mockResolvedValue({ id: 'history-1' }) } as any,
    { queryRoutes: jest.fn().mockResolvedValue(null) } as any,
  );

  return { service, prisma, shippingService };
}

describe('SellerAfterSaleService exchange waybills', () => {
  it('generates a replacement waybill for NO_REASON_EXCHANGE in APPROVED status', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue(baseRequest()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service, shippingService } = makeService(tx);

    await service.generateWaybill(companyId, staffId, afterSaleId, 'SF');

    expect(shippingService.createCarrierWaybill).toHaveBeenCalledWith(
      companyId,
      `AS_${afterSaleId}`,
      'SF',
      buyerAddress,
      [{ name: '苹果', quantity: 2, weightGram: 1000 }],
    );
    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: afterSaleId,
          status: { in: ['APPROVED', 'RECEIVED_BY_SELLER'] },
          replacementWaybillNo: null,
        }),
        data: expect.objectContaining({
          replacementWaybillNo: 'SF1234567890',
        }),
      }),
    );
  });

  it('passes orderItem sku weightGram to replacement waybill items', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue(
          baseRequest({
            orderItem: {
              ...baseRequest().orderItem,
              sku: {
                ...baseRequest().orderItem.sku,
                weightGram: 1500,
              },
            },
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service, shippingService } = makeService(tx);

    await service.generateWaybill(companyId, staffId, afterSaleId, 'SF');

    expect(shippingService.createCarrierWaybill).toHaveBeenCalledWith(
      companyId,
      `AS_${afterSaleId}`,
      'SF',
      buyerAddress,
      [{ name: '苹果', quantity: 2, weightGram: 1500 }],
    );
  });

  it('passes per-item default weightGram to replacement waybill items when sku weight is invalid', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue(
          baseRequest({
            orderItem: {
              ...baseRequest().orderItem,
              sku: {
                ...baseRequest().orderItem.sku,
                weightGram: 0,
              },
            },
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service, shippingService } = makeService(tx);

    await service.generateWaybill(companyId, staffId, afterSaleId, 'SF');

    expect(shippingService.createCarrierWaybill).toHaveBeenCalledWith(
      companyId,
      `AS_${afterSaleId}`,
      'SF',
      buyerAddress,
      [{ name: '苹果', quantity: 2, weightGram: 1000 }],
    );
  });

  it('generates a replacement waybill for NO_REASON_EXCHANGE after seller received return', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValue(baseRequest({ status: 'RECEIVED_BY_SELLER' })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service } = makeService(tx);

    await service.generateWaybill(companyId, staffId, afterSaleId, 'SF');

    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['APPROVED', 'RECEIVED_BY_SELLER'] },
        }),
        data: expect.objectContaining({
          replacementWaybillNo: 'SF1234567890',
        }),
      }),
    );
  });

  it('does not cancel an idempotent replacement waybill already stored by a concurrent winner', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(baseRequest())
          .mockResolvedValueOnce(
            baseRequest({
              replacementWaybillNo: 'SF1234567890',
              replacementWaybillUrl: 'https://example.com/waybill.pdf',
              replacementCarrierCode: 'SF',
              replacementCarrierName: '顺丰速运',
            }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const { service, shippingService } = makeService(tx);

    await expect(
      service.generateWaybill(companyId, staffId, afterSaleId, 'SF'),
    ).resolves.toEqual(expect.objectContaining({
      ok: true,
      waybillNo: expect.any(String),
      carrierCode: 'SF',
    }));
    expect(shippingService.cancelCarrierWaybill).not.toHaveBeenCalled();
  });

  it('rejects generateWaybill when APPROVED and requiresReturn=true (must wait for buyer return)', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue(baseRequest({ requiresReturn: true })),
        updateMany: jest.fn(),
      },
      $executeRaw: jest.fn(),  // advisory lock 调用
    };
    const { service } = makeService(tx);

    await expect(
      service.generateWaybill(companyId, staffId, afterSaleId, 'SF'),
    ).rejects.toThrow('需要等买家寄回退货并确认收到后才能生成换货面单');
    expect(tx.afterSaleRequest.updateMany).not.toHaveBeenCalled();
  });
});

describe('SellerAfterSaleService.ship', () => {
  it('accepts NO_REASON_EXCHANGE replacement shipment', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            baseRequest({ replacementWaybillNo: 'SF1234567890' }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service } = makeService(tx);

    await service.ship(companyId, staffId, afterSaleId);

    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: afterSaleId,
          status: { in: ['APPROVED', 'RECEIVED_BY_SELLER'] },
          afterSaleType: { in: ['QUALITY_EXCHANGE', 'NO_REASON_EXCHANGE'] },
        }),
        data: expect.objectContaining({
          status: 'REPLACEMENT_SHIPPED',
          replacementShipmentId: 'SF1234567890',
        }),
      }),
    );
  });

  it('rejects ship when APPROVED and requiresReturn=true (must wait for buyer return)', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue(
          baseRequest({
            requiresReturn: true,
            replacementWaybillNo: 'SF1234567890',
          }),
        ),
        updateMany: jest.fn(),
      },
      $executeRaw: jest.fn(),
    };
    const { service } = makeService(tx);

    await expect(service.ship(companyId, staffId, afterSaleId)).rejects.toThrow(
      '需要等买家寄回退货并确认收到后才能发换货',
    );
    expect(tx.afterSaleRequest.updateMany).not.toHaveBeenCalled();
  });
});

describe('SellerAfterSaleService.rejectReturn', () => {
  it('does not require a manual seller return waybill before generated waybill flow', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(baseRequest({ status: 'RECEIVED_BY_SELLER' }))
          .mockResolvedValueOnce(baseRequest({ status: 'SELLER_REJECTED_RETURN' })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service } = makeService(tx);

    await service.rejectReturn(
      companyId,
      staffId,
      afterSaleId,
      '商品不符合退回标准',
      ['https://example.com/proof.jpg'],
    );

    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: { id: afterSaleId, status: 'RECEIVED_BY_SELLER' },
      data: {
        status: 'SELLER_REJECTED_RETURN',
        sellerRejectReason: '商品不符合退回标准',
        sellerRejectPhotos: ['https://example.com/proof.jpg'],
      },
    });
  });

  it('ignores legacy manual seller return waybill input so generated waybill can run later', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(baseRequest({ status: 'RECEIVED_BY_SELLER' }))
          .mockResolvedValueOnce(baseRequest({ status: 'SELLER_REJECTED_RETURN' })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service } = makeService(tx);

    await (service.rejectReturn as any)(
      companyId,
      staffId,
      afterSaleId,
      '商品不符合退回标准',
      ['https://example.com/proof.jpg'],
      'MANUAL-SHOULD-BE-IGNORED',
    );

    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: { id: afterSaleId, status: 'RECEIVED_BY_SELLER' },
      data: {
        status: 'SELLER_REJECTED_RETURN',
        sellerRejectReason: '商品不符合退回标准',
        sellerRejectPhotos: ['https://example.com/proof.jpg'],
      },
    });
  });
});

describe('SellerAfterSaleService.generateSellerReturnWaybill', () => {
  it('rejects seller return waybill generation outside SELLER_REJECTED_RETURN', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue(baseRequest({ status: 'APPROVED' })),
        updateMany: jest.fn(),
      },
    };
    const { service, shippingService } = makeService(tx);

    await expect(
      service.generateSellerReturnWaybill(companyId, staffId, afterSaleId),
    ).rejects.toThrow(BadRequestException);
    expect(shippingService.createCarrierWaybillWithAddresses).not.toHaveBeenCalled();
  });

  it('generates seller rejected return waybill using AS_REJECT_RETURN bizNo and seller-to-buyer direction', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            baseRequest({
              status: 'SELLER_REJECTED_RETURN',
              sellerReturnWaybillNo: null,
            }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service, shippingService } = makeService(tx);

    await service.generateSellerReturnWaybill(companyId, staffId, afterSaleId);

    expect(shippingService.createCarrierWaybillWithAddresses).toHaveBeenCalledWith({
      companyId,
      bizNo: `AS_REJECT_RETURN_${afterSaleId}`,
      carrierCode: 'SF',
      sender: companyAddress,
      receiver: expect.objectContaining({
        name: buyerAddress.recipientName,
        tel: buyerAddress.phone,
        province: buyerAddress.province,
        city: buyerAddress.city,
        district: buyerAddress.district,
        detail: buyerAddress.detail,
      }),
      items: [{ name: '苹果', quantity: 2, weightGram: 1000 }],
    });
    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: afterSaleId,
          status: 'SELLER_REJECTED_RETURN',
          sellerReturnWaybillNo: null,
        }),
        data: expect.objectContaining({
          sellerReturnCarrierCode: 'SF',
          sellerReturnCarrierName: '顺丰速运',
          sellerReturnWaybillNo: 'SF0987654321',
          sellerReturnWaybillUrl: 'https://example.com/reject-waybill.pdf',
          sellerReturnSfOrderId: 'sf-order-return-1',
        }),
      }),
    );
  });

  it('passes order item sku weightGram to seller rejected return waybill items', async () => {
    const weightedOrderItem = {
      ...baseRequest().order.items[0],
      sku: {
        ...baseRequest().order.items[0].sku,
        weightGram: 750,
      },
    };
    const request = baseRequest({
      status: 'SELLER_REJECTED_RETURN',
      sellerReturnWaybillNo: null,
      orderItem: null,
      orderItemId: null,
      order: {
        ...baseRequest().order,
        items: [weightedOrderItem],
      },
    });
    const tx = {
      $executeRaw: jest.fn(),
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service, shippingService } = makeService(tx);

    await service.generateSellerReturnWaybill(companyId, staffId, afterSaleId);

    expect(shippingService.createCarrierWaybillWithAddresses).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ name: '苹果', quantity: 2, weightGram: 750 }],
      }),
    );
  });

  it('does not cancel an idempotent seller return waybill already stored by a concurrent winner', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(
            baseRequest({
              status: 'SELLER_REJECTED_RETURN',
              sellerReturnWaybillNo: null,
            }),
          )
          .mockResolvedValueOnce(
            baseRequest({
              status: 'SELLER_REJECTED_RETURN',
              sellerReturnCarrierCode: 'SF',
              sellerReturnCarrierName: '顺丰速运',
              sellerReturnWaybillNo: 'SF0987654321',
              sellerReturnWaybillUrl: 'https://example.com/reject-waybill.pdf',
            }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const { service, shippingService } = makeService(tx);

    await expect(
      service.generateSellerReturnWaybill(companyId, staffId, afterSaleId),
    ).resolves.toEqual(expect.objectContaining({
      ok: true,
      waybillNo: expect.any(String),
      carrierCode: 'SF',
    }));
    expect(shippingService.cancelCarrierWaybill).not.toHaveBeenCalled();
  });
});

describe('SellerAfterSaleService.findById seller return waybill fields', () => {
  it('returns seller return carrier and print url after rejected-return waybill generation', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue(
          baseRequest({
            status: 'SELLER_REJECTED_RETURN',
            sellerReturnCarrierName: '顺丰速运',
            sellerReturnWaybillNo: 'SF0987654321',
            sellerReturnWaybillUrl: 'https://example.com/reject-waybill.pdf',
            sellerRejectReason: '商品不符合退回标准',
            sellerRejectPhotos: ['https://example.com/proof.jpg'],
            userId: 'buyer-1',
            createdAt: new Date('2026-05-10T00:00:00.000Z'),
          }),
        ),
      },
      buyerAlias: {
        findUnique: jest.fn().mockResolvedValue({ alias: '买家A' }),
      },
    };
    const { service } = makeService(tx);

    const result = await service.findById(companyId, afterSaleId, staffId);

    expect(result).toMatchObject({
      sellerReturnCarrierName: '顺丰速运',
      sellerReturnWaybillUrl: 'https://example.com/reject-waybill.pdf',
      sellerRejectReason: '商品不符合退回标准',
    });
    expect(result.sellerReturnWaybillNo).toBeTruthy();
  });
});

describe('SellerAfterSaleService.getTimeline', () => {
  it('returns status history only after company ownership is verified', async () => {
    const createdAt = new Date('2026-05-10T00:00:00.000Z');
    const tx = {
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue(baseRequest({ status: 'RETURN_SHIPPING' })),
      },
      afterSaleStatusHistory: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'history-1',
            fromStatus: 'APPROVED',
            toStatus: 'RETURN_SHIPPING',
            reason: '买家生成退货面单',
            operatorType: 'BUYER',
            createdAt,
          },
        ]),
      },
    };
    const { service } = makeService(tx);

    await expect(
      service.getTimeline(companyId, afterSaleId),
    ).resolves.toEqual({
      items: [
        {
          id: 'history-1',
          fromStatus: 'APPROVED',
          toStatus: 'RETURN_SHIPPING',
          reason: '买家生成退货面单',
          operatorType: 'BUYER',
          createdAt,
        },
      ],
    });
    expect(tx.afterSaleStatusHistory.findMany).toHaveBeenCalledWith({
      where: { afterSaleId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        operatorType: true,
        createdAt: true,
      },
    });
  });
});
