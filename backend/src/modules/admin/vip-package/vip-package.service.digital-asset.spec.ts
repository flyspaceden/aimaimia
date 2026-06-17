import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateVipPackageDto, UpdateVipPackageDto } from './vip-package.dto';
import { VipPackageService } from './vip-package.service';

function makeService() {
  const prisma = {
    vipPackage: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };

  const service = new VipPackageService(prisma as any);
  return { service, prisma };
}

describe('VipPackageService digital asset config', () => {
  it('create accepts explicit self/referral seed asset amounts', async () => {
    const { service, prisma } = makeService();
    prisma.vipPackage.create.mockResolvedValue({
      id: 'pkg-1',
      price: 399,
      selfSeedAssetAmount: 1234,
      referralSeedAssetAmount: 5678,
    });

    await service.create({
      price: 399,
      selfSeedAssetAmount: 1234,
      referralSeedAssetAmount: 5678,
    } as any);

    expect(prisma.vipPackage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        price: 399,
        selfSeedAssetAmount: 1234,
        referralSeedAssetAmount: 5678,
      }),
    });
  });

  it('create fills seed asset defaults by VIP package price', async () => {
    const { service, prisma } = makeService();
    prisma.vipPackage.create.mockResolvedValue({
      id: 'pkg-699',
      price: 699,
      selfSeedAssetAmount: 2000,
      referralSeedAssetAmount: 4000,
    });

    await service.create({ price: 699 } as any);

    expect(prisma.vipPackage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        price: 699,
        selfSeedAssetAmount: 2000,
        referralSeedAssetAmount: 4000,
      }),
    });
  });

  it('update can change both seed asset fields', async () => {
    const { service, prisma } = makeService();
    prisma.vipPackage.findUnique.mockResolvedValue({ id: 'pkg-1' });
    prisma.vipPackage.update.mockResolvedValue({
      id: 'pkg-1',
      selfSeedAssetAmount: 3000,
      referralSeedAssetAmount: 8000,
    });

    await service.update('pkg-1', {
      selfSeedAssetAmount: 3000,
      referralSeedAssetAmount: 8000,
    } as any);

    expect(prisma.vipPackage.update).toHaveBeenCalledWith({
      where: { id: 'pkg-1' },
      data: expect.objectContaining({
        selfSeedAssetAmount: 3000,
        referralSeedAssetAmount: 8000,
      }),
    });
  });

  it('rejects negative seed asset values in create/update DTOs', async () => {
    const createErrors = await validate(plainToInstance(CreateVipPackageDto, {
      price: 399,
      selfSeedAssetAmount: -1,
      referralSeedAssetAmount: -2,
    }));
    const updateErrors = await validate(plainToInstance(UpdateVipPackageDto, {
      selfSeedAssetAmount: -1,
      referralSeedAssetAmount: -2,
    }));

    expect(createErrors.map((item) => item.property)).toEqual(
      expect.arrayContaining(['selfSeedAssetAmount', 'referralSeedAssetAmount']),
    );
    expect(updateErrors.map((item) => item.property)).toEqual(
      expect.arrayContaining(['selfSeedAssetAmount', 'referralSeedAssetAmount']),
    );
  });
});
