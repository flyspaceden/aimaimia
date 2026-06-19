import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryInventoryService } from './delivery-inventory.service';

describe('DeliveryInventoryService', () => {
  let tx: any;
  let deliveryPrisma: any;
  let service: DeliveryInventoryService;

  beforeEach(() => {
    tx = {
      deliveryProductSku: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
      },
      deliveryInventoryLedger: {
        create: jest.fn(),
      },
    };
    deliveryPrisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    service = new DeliveryInventoryService(deliveryPrisma as DeliveryPrismaService);
  });

  it('updates seller sku stock transactionally and writes a delivery inventory ledger entry', async () => {
    tx.deliveryProductSku.findUnique.mockResolvedValue({
      id: 'sku_1',
      stock: 12,
      product: {
        merchantId: 'merchant_1',
      },
    });
    tx.deliveryProductSku.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryInventoryLedger.create.mockResolvedValue({
      id: 'ledger_1',
      skuId: 'sku_1',
      quantity: 8,
      beforeStock: 12,
      afterStock: 20,
    });
    tx.deliveryProductSku.findFirst.mockResolvedValue({
      id: 'sku_1',
      stock: 20,
    });

    await expect(
      service.updateSellerSkuStock('merchant_1', 'staff_1', 'sku_1', {
        stock: 20,
        remark: '晚班盘点',
      }),
    ).resolves.toMatchObject({
      sku: { id: 'sku_1', stock: 20 },
      ledger: { quantity: 8, beforeStock: 12, afterStock: 20 },
    });

    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.deliveryInventoryLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        skuId: 'sku_1',
        type: 'ADJUST',
        quantity: 8,
        beforeStock: 12,
        afterStock: 20,
        createdByType: 'SELLER',
        createdById: 'staff_1',
        remark: '晚班盘点',
      }),
    });
  });
});
