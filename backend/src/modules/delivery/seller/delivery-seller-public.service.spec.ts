import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliverySellerPublicService } from './delivery-seller-public.service';

describe('DeliverySellerPublicService', () => {
  let deliveryPrisma: any;
  let service: DeliverySellerPublicService;

  beforeEach(() => {
    deliveryPrisma = {
      deliveryConfig: {
        findUnique: jest.fn(),
      },
      deliveryProductUnit: {
        findMany: jest.fn(),
      },
      deliveryCategory: {
        findMany: jest.fn(),
      },
    };
    service = new DeliverySellerPublicService(deliveryPrisma as DeliveryPrismaService);
  });

  it('falls back to the safe default low stock threshold when delivery config is missing', async () => {
    deliveryPrisma.deliveryConfig.findUnique.mockResolvedValue(null);

    await expect(service.getPublicConfig()).resolves.toEqual({
      lowStockDisplayThreshold: 10,
    });
    expect(deliveryPrisma.deliveryConfig.findUnique).toHaveBeenCalledWith({
      where: { key: 'LOW_STOCK_DISPLAY_THRESHOLD' },
      select: { value: true },
    });
  });

  it('lists only active delivery product units in seller-facing order', async () => {
    deliveryPrisma.deliveryProductUnit.findMany.mockResolvedValue([
      { id: 'unit_1', name: '件', sortOrder: 1 },
    ]);

    await expect(service.listProductUnits()).resolves.toEqual([
      { id: 'unit_1', name: '件', sortOrder: 1 },
    ]);
    expect(deliveryPrisma.deliveryProductUnit.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, sortOrder: true },
    });
  });

  it('lists active delivery categories as an array ordered like the buyer catalog', async () => {
    deliveryPrisma.deliveryCategory.findMany.mockResolvedValue([
      { id: 'cat_1', name: '蔬菜', parentId: null, level: 1, sortOrder: 1, path: '蔬菜' },
    ]);

    await expect(service.listCategories()).resolves.toEqual([
      { id: 'cat_1', name: '蔬菜', parentId: null, level: 1, sortOrder: 1, path: '蔬菜' },
    ]);
    expect(deliveryPrisma.deliveryCategory.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        parentId: true,
        level: true,
        sortOrder: true,
        path: true,
      },
    });
  });

  it('returns an isolated empty tag category list until delivery tag tables exist', async () => {
    await expect(service.listTagCategories('PRODUCT')).resolves.toEqual([]);
  });
});
