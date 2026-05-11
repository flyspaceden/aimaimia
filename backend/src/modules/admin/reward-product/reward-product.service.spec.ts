import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RewardProductService } from './reward-product.service';
import { PLATFORM_COMPANY_ID } from '../../bonus/engine/constants';

describe('RewardProductService transactional writes', () => {
  const serializableOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  };

  const buildPrisma = () => {
    const tx = {
      product: {
        create: jest.fn().mockResolvedValue({ id: 'product_1' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'product_1',
          companyId: PLATFORM_COMPANY_ID,
          basePrice: 20,
          cost: 10,
          status: 'ACTIVE',
          skus: [{ id: 'sku_1' }],
        }),
        update: jest.fn().mockResolvedValue({ id: 'product_1' }),
      },
      productSKU: {
        create: jest.fn().mockResolvedValue({ id: 'sku_2' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'sku_1',
          productId: 'product_1',
          price: 20,
          cost: 10,
          stock: 5,
        }),
        update: jest.fn().mockResolvedValue({ id: 'sku_1' }),
      },
      vipGiftItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      lotteryPrize: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const prisma = {
      $transaction: jest.fn((fn) => fn(tx)),
      product: {
        create: jest.fn().mockResolvedValue({ id: 'product_root' }),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'product_root' }),
      },
      productSKU: {
        create: jest.fn().mockResolvedValue({ id: 'sku_root' }),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'sku_root' }),
      },
    };

    return { prisma, tx, service: new RewardProductService(prisma as any) };
  };

  it('create uses a Serializable transaction for active reward product writes', async () => {
    const { prisma, tx, service } = buildPrisma();

    await service.create({
      title: '奖励商品',
      basePrice: 20,
      cost: 10,
      skus: [{ title: '默认 SKU', price: 20, cost: 10, stock: 5, weightGram: 1000 }],
    } as any);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), serializableOptions);
    expect(tx.product.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'ACTIVE',
        skus: expect.objectContaining({
          create: [expect.objectContaining({ stock: 5, weightGram: 1000 })],
        }),
      }),
    }));
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('addSku keeps validation semantics and writes inside a Serializable transaction', async () => {
    const { prisma, tx, service } = buildPrisma();

    await service.addSku('product_1', {
      title: '新增 SKU',
      price: 20,
      cost: 10,
      stock: 3,
      weightGram: 500,
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), serializableOptions);
    expect(tx.product.findUnique).toHaveBeenCalledWith({ where: { id: 'product_1' } });
    expect(tx.productSKU.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ productId: 'product_1', stock: 3, weightGram: 500 }),
    }));
    expect(prisma.productSKU.create).not.toHaveBeenCalled();
  });

  it('updateSku keeps validation semantics and writes inside a Serializable transaction', async () => {
    const { prisma, tx, service } = buildPrisma();

    await service.updateSku('product_1', 'sku_1', {
      price: 22,
      cost: 11,
      stock: 8,
      weightGram: 750,
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), serializableOptions);
    expect(tx.product.findUnique).toHaveBeenCalledWith({ where: { id: 'product_1' } });
    expect(tx.productSKU.findUnique).toHaveBeenCalledWith({ where: { id: 'sku_1' } });
    expect(tx.productSKU.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sku_1' },
      data: expect.objectContaining({ price: 22, cost: 11, stock: 8, weightGram: 750 }),
    }));
    expect(prisma.productSKU.update).not.toHaveBeenCalled();
  });

  it('addSku still rejects non-platform products before writing', async () => {
    const { tx, service } = buildPrisma();
    tx.product.findUnique.mockResolvedValueOnce({
      id: 'product_1',
      companyId: 'other-company',
    });

    await expect(service.addSku('product_1', {
      title: '新增 SKU',
      price: 20,
      cost: 10,
      stock: 3,
      weightGram: 500,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.productSKU.create).not.toHaveBeenCalled();
  });

  it('updateSku still rejects missing SKU before writing', async () => {
    const { tx, service } = buildPrisma();
    tx.productSKU.findUnique.mockResolvedValueOnce(null);

    await expect(service.updateSku('product_1', 'sku_missing', {
      stock: 8,
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.productSKU.update).not.toHaveBeenCalled();
  });
});

describe('SF style shipping pricing migration', () => {
  it('marks DRAFT SKUs whose original weight is null before the 1000g backfill', () => {
    const migrationSql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260510170000_sf_style_shipping_pricing/migration.sql',
      ),
      'utf8',
    );

    expect(migrationSql).toContain('__DRAFT_WEIGHT_PLACEHOLDER__:');
    expect(migrationSql).toMatch(/UPDATE\s+"ProductSKU"\s+AS\s+s[\s\S]+FROM\s+"Product"\s+AS\s+p/i);
    expect(migrationSql).toMatch(/p\."status"\s*=\s*'DRAFT'/);
    expect(migrationSql).toMatch(/s\."weightGram"\s+IS\s+NULL/);
    expect(migrationSql).toMatch(/"skuCode"\s*=\s*'__DRAFT_WEIGHT_PLACEHOLDER__:'\s*\|\|\s*s\."id"/);

    const markerIndex = migrationSql.indexOf('__DRAFT_WEIGHT_PLACEHOLDER__:');
    const backfillIndex = migrationSql.indexOf(
      'UPDATE "ProductSKU" SET "weightGram" = 1000 WHERE "weightGram" IS NULL;',
    );
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(backfillIndex).toBeGreaterThan(markerIndex);
  });
});
