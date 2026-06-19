import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryUnitsService } from './delivery-units.service';

describe('DeliveryUnitsService', () => {
  let tx: any;
  let deliveryPrisma: any;
  let service: DeliveryUnitsService;

  beforeEach(() => {
    tx = {
      deliveryUser: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      deliveryUnit: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    deliveryPrisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      deliveryUnit: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    service = new DeliveryUnitsService(deliveryPrisma as DeliveryPrismaService);
  });

  it('creating the first unit selects it so the user can enter delivery mall', async () => {
    tx.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: null,
      _count: { units: 0 },
    });
    tx.deliveryUnit.create.mockResolvedValue({
      id: 'unit_1',
      userId: 'PSYH0000000000001',
      name: '青禾食堂',
    });
    tx.deliveryUser.update.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: 'unit_1',
    });

    await expect(
      service.createUnit('PSYH0000000000001', {
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
      }),
    ).resolves.toMatchObject({
      currentUnitId: 'unit_1',
      requiresUnit: false,
      unit: { id: 'unit_1' },
    });

    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('switching unit only permits units owned by the current delivery user', async () => {
    deliveryPrisma.deliveryUnit.findUnique.mockResolvedValue({
      id: 'unit_other',
      userId: 'PSYH0000000000002',
      status: 'ACTIVE',
    });

    await expect(service.selectUnit('PSYH0000000000001', 'unit_other')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
