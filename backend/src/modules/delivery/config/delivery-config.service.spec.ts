import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryConfigService } from './delivery-config.service';

describe('DeliveryConfigService', () => {
  it('writes audit logs when an admin updates delivery configuration', async () => {
    const deliveryPrisma = {
      deliveryConfig: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'config_1',
          key: 'LOW_STOCK_DISPLAY_THRESHOLD',
          scope: 'SYSTEM',
          description: '旧说明',
          value: { value: 5 },
        }),
        upsert: jest.fn().mockResolvedValue({
          id: 'config_1',
          key: 'LOW_STOCK_DISPLAY_THRESHOLD',
          scope: 'SYSTEM',
          description: '低库存展示阈值',
          value: { value: 10 },
        }),
      },
      deliveryAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit_1' }),
      },
    };
    const service = new DeliveryConfigService(deliveryPrisma as unknown as DeliveryPrismaService);

    await service.update([
      {
        key: 'LOW_STOCK_DISPLAY_THRESHOLD',
        scope: 'SYSTEM' as any,
        description: '低库存展示阈值',
        value: { value: 10 },
      },
    ], 'admin_1');

    expect(deliveryPrisma.deliveryAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorType: 'ADMIN',
        actorId: 'admin_1',
        module: 'config',
        action: 'UPDATE_CONFIG',
        targetType: 'DeliveryConfig',
        targetId: 'LOW_STOCK_DISPLAY_THRESHOLD',
        before: expect.objectContaining({ value: { value: 5 } }),
        after: expect.objectContaining({ value: { value: 10 } }),
      }),
    }));
  });
});
