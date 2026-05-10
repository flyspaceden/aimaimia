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
      [{ name: '苹果', quantity: 2 }],
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
      items: [{ name: '苹果', quantity: 2 }],
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
});
