import { OrderShippingCostService } from './order-shipping-cost.service';

describe('OrderShippingCostService', () => {
  function createMocks() {
    const prisma = {
      orderShippingCost: {
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };

    const service = new OrderShippingCostService(prisma as any);
    return { service, prisma };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('recordPackage creates or updates by sfOrderId with package cost fields', async () => {
    const { service, prisma } = createMocks();
    prisma.orderShippingCost.upsert.mockResolvedValue({ id: 'cost_001' });

    await expect(service.recordPackage({
      orderId: 'order_001',
      packageIndex: 0,
      companyId: 'company_001',
      sfOrderId: 'sf_order_001',
      weightGramSent: 2500,
      estimatedCost: 18.5,
    })).resolves.toEqual({ id: 'cost_001' });

    expect(prisma.orderShippingCost.upsert).toHaveBeenCalledWith({
      where: { sfOrderId: 'sf_order_001' },
      create: {
        orderId: 'order_001',
        packageIndex: 0,
        companyId: 'company_001',
        sfOrderId: 'sf_order_001',
        weightGramSent: 2500,
        estimatedCost: 18.5,
      },
      update: {
        orderId: 'order_001',
        packageIndex: 0,
        companyId: 'company_001',
        weightGramSent: 2500,
        estimatedCost: 18.5,
      },
    });
  });

  it('recordPackage uses the provided transaction client', async () => {
    const { service } = createMocks();
    const tx = {
      orderShippingCost: {
        upsert: jest.fn().mockResolvedValue({ id: 'cost_tx' }),
      },
    };

    await service.recordPackage({
      orderId: 'order_001',
      packageIndex: 1,
      sfOrderId: 'sf_order_tx',
      weightGramSent: 1000,
    }, tx as any);

    expect(tx.orderShippingCost.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sfOrderId: 'sf_order_tx' },
      create: expect.objectContaining({
        companyId: null,
        packageIndex: 1,
        weightGramSent: 1000,
      }),
    }));
  });

  it('reconcile writes actualCost and reconciledAt', async () => {
    const { service, prisma } = createMocks();
    prisma.orderShippingCost.update.mockResolvedValue({ id: 'cost_001' });

    await service.reconcile('sf_order_001', 21.3);

    expect(prisma.orderShippingCost.update).toHaveBeenCalledWith({
      where: { sfOrderId: 'sf_order_001' },
      data: {
        actualCost: 21.3,
        reconciledAt: expect.any(Date),
      },
    });
  });

  it('recordPackage returns null and does not throw when persistence fails', async () => {
    const { service, prisma } = createMocks();
    prisma.orderShippingCost.upsert.mockRejectedValue(new Error('db down'));

    await expect(service.recordPackage({
      orderId: 'order_001',
      packageIndex: 0,
      sfOrderId: 'sf_order_001',
      weightGramSent: 1000,
    })).resolves.toBeNull();
  });

  it('recordPackage emits a structured alert log when persistence fails', async () => {
    const { service, prisma } = createMocks();
    prisma.orderShippingCost.upsert.mockRejectedValue(new Error('db down'));
    const errorSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);

    await service.recordPackage({
      orderId: 'order_001',
      packageIndex: 0,
      companyId: 'company_001',
      sfOrderId: 'sf_order_001',
      weightGramSent: 1000,
      estimatedCost: 12.5,
    });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"action":"order_shipping_cost_record_failed"'),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"sfOrderId":"sf_order_001"'),
    );
  });
});
