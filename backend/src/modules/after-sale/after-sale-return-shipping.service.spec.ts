import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AfterSaleReturnShippingService } from './after-sale-return-shipping.service';
import { decryptJsonValue } from '../../common/security/encryption';

jest.mock('../../common/security/encryption', () => ({
  decryptJsonValue: jest.fn((v: unknown) => v),
}));

const USER_ID = 'user_001';
const AFTER_SALE_ID = 'as_001';
const COMPANY_ID = 'company_001';

const buyerAddress = {
  receiverName: '李买家',
  phone: '13900000001',
  province: '浙江省',
  city: '杭州市',
  district: '西湖区',
  detail: '文三路 100 号',
};

const company = {
  id: COMPANY_ID,
  name: '澄源生态农业',
  servicePhone: '057100000000',
  address: {
    province: '云南省',
    city: '昆明市',
    district: '盘龙区',
    detail: '退货仓 1 号',
  },
  contact: {
    name: '王售后',
    phone: '13800000002',
  },
};

const approvedRequest = {
  id: AFTER_SALE_ID,
  userId: USER_ID,
  status: 'APPROVED',
  requiresReturn: true,
  returnWaybillNo: null,
  returnShippingPayer: 'BUYER',
  returnShippingFee: null,
  returnShippingFeeDeducted: false,
  returnShippingPaidAt: new Date('2026-05-09T10:00:00.000Z'),
  orderItemId: 'oi_001',
  order: {
    id: 'order_001',
    addressSnapshot: buyerAddress,
    items: [],
  },
  orderItem: {
    id: 'oi_001',
    quantity: 2,
    companyId: COMPANY_ID,
    sku: {
      weightGram: 500,
      product: {
        title: '有机苹果',
        company,
      },
    },
  },
};

function createMocks() {
  const tx = {
    $executeRaw: jest.fn(),
    afterSaleRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    afterSaleStatusHistory: {
      create: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((cb: any) => cb(tx)),
    afterSaleRequest: {
      findUnique: jest.fn(),
    },
  };
  const sellerShippingService = {
    createCarrierWaybillWithAddresses: jest.fn(),
    cancelCarrierWaybill: jest.fn(),
    cancelCarrierWaybillStrict: jest.fn(),
  };
  const statusHistory = {
    create: jest.fn((innerTx: any, input: any) =>
      innerTx.afterSaleStatusHistory.create({ data: input }),
    ),
  };
  const shippingPaymentService = {
    estimateReturnShippingFee: jest.fn().mockResolvedValue(18.13),
  };
  const service = new AfterSaleReturnShippingService(
    prisma as any,
    sellerShippingService as any,
    statusHistory as any,
    shippingPaymentService as any,
  );

  beforeEachMocks(tx, prisma, sellerShippingService);

  return {
    service,
    tx,
    prisma,
    sellerShippingService,
    statusHistory,
    shippingPaymentService,
  };
}

function beforeEachMocks(tx: any, prisma: any, sellerShippingService: any) {
  tx.afterSaleRequest.findFirst.mockResolvedValue(approvedRequest);
  tx.afterSaleRequest.findUnique.mockResolvedValue({
    id: AFTER_SALE_ID,
    status: 'RETURN_SHIPPING',
    returnWaybillNo: 'SF1234567890',
    returnSfOrderId: 'sf-order-return-001',
  });
  prisma.afterSaleRequest.findUnique.mockResolvedValue({
    id: AFTER_SALE_ID,
    status: 'RETURN_SHIPPING',
    returnWaybillNo: 'SF1234567890',
    returnSfOrderId: 'sf-order-return-001',
  });
  tx.afterSaleRequest.updateMany.mockResolvedValue({ count: 1 });
  sellerShippingService.createCarrierWaybillWithAddresses.mockResolvedValue({
    carrierCode: 'SF',
    carrierName: '顺丰速运',
    waybillNo: 'SF1234567890',
    waybillUrl: 'https://oss.example.com/return-label.pdf',
    sfOrderId: 'sf-order-return-001',
    senderInfoSnapshot: buyerAddress,
    receiverInfoSnapshot: company.address,
  });
  sellerShippingService.cancelCarrierWaybill.mockResolvedValue(undefined);
  sellerShippingService.cancelCarrierWaybillStrict.mockResolvedValue(undefined);
}

describe('AfterSaleReturnShippingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getReturnWaybillBizNo returns stable SF business number', () => {
    const { service } = createMocks();

    expect(service.getReturnWaybillBizNo('as_001')).toBe('AS_RETURN_as_001');
  });

  it('rejects buyer-paid return waybill creation until shipping payment is paid', async () => {
    const { service, tx, sellerShippingService } = createMocks();
    tx.afterSaleRequest.findFirst.mockResolvedValue({
      ...approvedRequest,
      returnShippingPaidAt: null,
    });

    await expect(service.createReturnWaybill(USER_ID, AFTER_SALE_ID))
      .rejects.toThrow(BadRequestException);
    await expect(service.createReturnWaybill(USER_ID, AFTER_SALE_ID))
      .rejects.toThrow('请先支付退货运费');

    expect(sellerShippingService.createCarrierWaybillWithAddresses).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.updateMany).not.toHaveBeenCalled();
  });

  it('creates a return waybill, moves APPROVED to RETURN_SHIPPING, and writes status history', async () => {
    const {
      service,
      prisma,
      tx,
      sellerShippingService,
      statusHistory,
      shippingPaymentService,
    } = createMocks();

    const result = await service.createReturnWaybill(USER_ID, AFTER_SALE_ID);

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      carrierCode: 'SF',
      carrierName: '顺丰速运',
      waybillNo: 'SF1234567890',
      waybillUrl: 'https://oss.example.com/return-label.pdf',
    }));
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
    expect(sellerShippingService.createCarrierWaybillWithAddresses).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      bizNo: 'AS_RETURN_as_001',
      carrierCode: 'SF',
      sender: {
        name: '李买家',
        tel: '13900000001',
        province: '浙江省',
        city: '杭州市',
        district: '西湖区',
        detail: '文三路 100 号',
      },
      receiver: {
        name: '王售后',
        tel: '13800000002',
        province: '云南省',
        city: '昆明市',
        district: '盘龙区',
        detail: '退货仓 1 号',
      },
      items: [{ name: '有机苹果', quantity: 2, weight: 1 }],
    });
    expect(shippingPaymentService.estimateReturnShippingFee).toHaveBeenCalledWith(AFTER_SALE_ID);
    expect(tx.afterSaleRequest.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: AFTER_SALE_ID,
        userId: USER_ID,
        status: 'APPROVED',
        returnWaybillNo: null,
        manualReviewRequestedAt: null,
      },
      data: {
        manualReviewReason: '退货面单生成中',
        manualReviewRequestedAt: expect.any(Date),
      },
    });
    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: AFTER_SALE_ID,
        userId: USER_ID,
        status: 'APPROVED',
        returnWaybillNo: null,
        manualReviewReason: '退货面单生成中',
        manualReviewRequestedAt: expect.any(Date),
      },
      data: expect.objectContaining({
        status: 'RETURN_SHIPPING',
        returnCarrierCode: 'SF',
        returnCarrierName: '顺丰速运',
        returnWaybillNo: 'SF1234567890',
        returnWaybillUrl: 'https://oss.example.com/return-label.pdf',
        returnLabelUrl: 'https://oss.example.com/return-label.pdf',
        returnSfOrderId: 'sf-order-return-001',
        returnShippingFee: 18.13,
        returnShippingPayer: 'BUYER',
        manualReviewReason: null,
        manualReviewRequestedAt: null,
      }),
    });
    expect(statusHistory.create).toHaveBeenCalledWith(tx, {
      afterSaleId: AFTER_SALE_ID,
      fromStatus: 'APPROVED',
      toStatus: 'RETURN_SHIPPING',
      reason: '买家生成退货面单',
      operatorType: 'BUYER',
      operatorId: USER_ID,
      meta: expect.objectContaining({ waybillNo: 'SF1234567890' }),
    });
  });

  it('does not call SF when return waybill generation marker cannot be acquired', async () => {
    const { service, tx, sellerShippingService } = createMocks();
    tx.afterSaleRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.createReturnWaybill(USER_ID, AFTER_SALE_ID))
      .rejects.toThrow(ConflictException);

    expect(sellerShippingService.createCarrierWaybillWithAddresses).not.toHaveBeenCalled();
    expect(sellerShippingService.cancelCarrierWaybillStrict).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledTimes(1);
  });

  it('clears the generation marker when SF return waybill creation fails', async () => {
    const { service, tx, sellerShippingService } = createMocks();
    sellerShippingService.createCarrierWaybillWithAddresses
      .mockRejectedValue(new Error('SF create timeout'));

    await expect(service.createReturnWaybill(USER_ID, AFTER_SALE_ID))
      .rejects.toThrow('SF create timeout');

    expect(tx.afterSaleRequest.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: AFTER_SALE_ID,
        userId: USER_ID,
        status: 'APPROVED',
        returnWaybillNo: null,
        manualReviewReason: '退货面单生成中',
        manualReviewRequestedAt: expect.any(Date),
      },
      data: {
        manualReviewReason: null,
        manualReviewRequestedAt: null,
      },
    });
    expect(sellerShippingService.cancelCarrierWaybillStrict).not.toHaveBeenCalled();
  });

  it('cancels the SF waybill as compensation when DB CAS fails after creation', async () => {
    const { service, prisma, tx, sellerShippingService } = createMocks();
    tx.afterSaleRequest.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      returnWaybillNo: null,
      returnSfOrderId: null,
      manualReviewReason: '退货面单生成中',
      manualReviewRequestedAt: null,
    });

    await expect(service.createReturnWaybill(USER_ID, AFTER_SALE_ID))
      .rejects.toThrow(ConflictException);

    expect(sellerShippingService.createCarrierWaybillWithAddresses).toHaveBeenCalled();
    expect(sellerShippingService.cancelCarrierWaybillStrict)
      .toHaveBeenCalledWith('sf-order-return-001', 'SF1234567890');
  });

  it('does not cancel SF waybill when final persist CAS loses to the same persisted waybill', async () => {
    const { service, prisma, tx, sellerShippingService } = createMocks();
    tx.afterSaleRequest.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      returnWaybillNo: 'SF1234567890',
      returnSfOrderId: 'sf-order-return-001',
    });

    await expect(service.createReturnWaybill(USER_ID, AFTER_SALE_ID))
      .rejects.toThrow(ConflictException);

    expect(sellerShippingService.createCarrierWaybillWithAddresses).toHaveBeenCalled();
    expect(sellerShippingService.cancelCarrierWaybillStrict).not.toHaveBeenCalled();
  });

  it('marks manual review when compensation cancel fails after SF creation and DB CAS failure', async () => {
    const { service, prisma, tx, sellerShippingService } = createMocks();
    tx.afterSaleRequest.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      returnWaybillNo: null,
      returnSfOrderId: null,
      manualReviewReason: '退货面单生成中',
      manualReviewRequestedAt: null,
    });
    sellerShippingService.cancelCarrierWaybillStrict.mockRejectedValue(new Error('SF cancel timeout'));

    await expect(service.createReturnWaybill(USER_ID, AFTER_SALE_ID))
      .rejects.toThrow(ConflictException);

    expect(sellerShippingService.createCarrierWaybillWithAddresses).toHaveBeenCalled();
    expect(sellerShippingService.cancelCarrierWaybillStrict)
      .toHaveBeenCalledWith('sf-order-return-001', 'SF1234567890');
    expect(tx.afterSaleRequest.updateMany).toHaveBeenLastCalledWith({
      where: { id: AFTER_SALE_ID },
      data: {
        manualReviewReason: expect.stringContaining(
          '退货面单已生成但本地状态更新失败，且自动取消面单失败',
        ),
        manualReviewRequestedAt: expect.any(Date),
      },
    });
    expect(tx.afterSaleRequest.updateMany.mock.calls[2][0].data.manualReviewReason)
      .toEqual(expect.stringContaining('SF1234567890'));
    expect(tx.afterSaleRequest.updateMany.mock.calls[2][0].data.manualReviewReason)
      .toEqual(expect.stringContaining('sf-order-return-001'));
  });

  it('cancelIfNotPickedUp clears local return waybill fields after remote cancel', async () => {
    const { service, prisma, tx, sellerShippingService } = createMocks();
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      status: 'RETURN_SHIPPING',
      returnWaybillNo: 'SF1234567890',
      returnSfOrderId: 'sf-order-return-001',
    });

    await expect(service.cancelIfNotPickedUp(AFTER_SALE_ID))
      .resolves.toEqual({ cancelled: true });

    expect(sellerShippingService.cancelCarrierWaybillStrict)
      .toHaveBeenCalledWith('sf-order-return-001', 'SF1234567890');
    expect(tx.afterSaleRequest.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: AFTER_SALE_ID,
        status: { in: ['APPROVED', 'RETURN_SHIPPING'] },
        returnWaybillNo: 'SF1234567890',
        returnSfOrderId: 'sf-order-return-001',
        manualReviewReason: expect.any(String),
        manualReviewRequestedAt: expect.any(Date),
      },
      data: {
        returnCarrierCode: null,
        returnCarrierName: null,
        returnWaybillNo: null,
        returnWaybillUrl: null,
        returnLabelUrl: null,
        returnSfOrderId: null,
        returnShippedAt: null,
        manualReviewReason: null,
        manualReviewRequestedAt: null,
      },
    });
  });

  it('cancelIfNotPickedUp reports CANCEL_FAILED and keeps local fields when remote cancel fails', async () => {
    const { service, prisma, tx, sellerShippingService } = createMocks();
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      status: 'RETURN_SHIPPING',
      returnWaybillNo: 'SF1234567890',
      returnSfOrderId: 'sf-order-return-001',
    });
    sellerShippingService.cancelCarrierWaybillStrict.mockRejectedValue(new Error('网络超时'));

    await expect(service.cancelIfNotPickedUp(AFTER_SALE_ID))
      .resolves.toEqual({ cancelled: false, reason: 'CANCEL_FAILED' });

    expect(sellerShippingService.cancelCarrierWaybillStrict)
      .toHaveBeenCalledWith('sf-order-return-001', 'SF1234567890');
    expect(tx.afterSaleRequest.updateMany).toHaveBeenLastCalledWith({
      where: { id: AFTER_SALE_ID },
      data: {
        manualReviewReason: expect.stringContaining('退货面单自动取消失败'),
        manualReviewRequestedAt: expect.any(Date),
      },
    });
  });

  it('cancelIfNotPickedUp skips remote cancel when row is already under manual review', async () => {
    const { service, prisma, tx, sellerShippingService } = createMocks();
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      status: 'RETURN_SHIPPING',
      returnWaybillNo: 'SF1234567890',
      returnSfOrderId: 'sf-order-return-001',
      manualReviewRequestedAt: new Date('2026-05-09T11:00:00.000Z'),
      manualReviewReason: '已进入人工复核',
    });
    tx.afterSaleRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.cancelIfNotPickedUp(AFTER_SALE_ID))
      .resolves.toEqual({ cancelled: false, reason: 'STATE_CHANGED' });

    expect(sellerShippingService.cancelCarrierWaybillStrict).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: AFTER_SALE_ID,
        status: { in: ['APPROVED', 'RETURN_SHIPPING'] },
        returnWaybillNo: 'SF1234567890',
        returnSfOrderId: 'sf-order-return-001',
        manualReviewRequestedAt: null,
      },
      data: {
        manualReviewReason: expect.stringContaining('退货面单自动取消中'),
        manualReviewRequestedAt: expect.any(Date),
      },
    });
    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledTimes(1);
  });

  it('cancelIfNotPickedUp returns STATE_CHANGED and marks manual review when remote cancel succeeds but final local CAS loses race', async () => {
    const { service, prisma, tx, sellerShippingService } = createMocks();
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      status: 'RETURN_SHIPPING',
      returnWaybillNo: 'SF1234567890',
      returnSfOrderId: 'sf-order-return-001',
    });
    tx.afterSaleRequest.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(service.cancelIfNotPickedUp(AFTER_SALE_ID))
      .resolves.toEqual({ cancelled: false, reason: 'STATE_CHANGED' });

    expect(sellerShippingService.cancelCarrierWaybillStrict)
      .toHaveBeenCalledWith('sf-order-return-001', 'SF1234567890');
    expect(tx.afterSaleRequest.updateMany).toHaveBeenNthCalledWith(3, {
      where: { id: AFTER_SALE_ID },
      data: {
        manualReviewReason: expect.stringContaining('远端退货面单已取消但本地状态已变更'),
        manualReviewRequestedAt: expect.any(Date),
      },
    });
  });

  it('cancelIfNotPickedUp reports NO_WAYBILL when no return waybill exists', async () => {
    const { service, prisma, sellerShippingService } = createMocks();
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      returnWaybillNo: null,
      returnSfOrderId: null,
    });

    await expect(service.cancelIfNotPickedUp(AFTER_SALE_ID))
      .resolves.toEqual({ cancelled: false, reason: 'NO_WAYBILL' });

    expect(sellerShippingService.cancelCarrierWaybill).not.toHaveBeenCalled();
  });

  it('throws not found when the after-sale request does not belong to the buyer', async () => {
    const { service, tx } = createMocks();
    tx.afterSaleRequest.findFirst.mockResolvedValue(null);

    await expect(service.createReturnWaybill('other_user', AFTER_SALE_ID))
      .rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when decrypted buyer address is null', async () => {
    const { service } = createMocks();
    (decryptJsonValue as jest.Mock).mockReturnValueOnce(null);

    await expect(service.createReturnWaybill(USER_ID, AFTER_SALE_ID))
      .rejects.toThrow(BadRequestException);
  });
});
