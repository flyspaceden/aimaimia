import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AdminProductsService } from './admin-products.service';
import { SkuUpdateItem, UpdateProductSkusDto } from './dto/update-sku.dto';

describe('AdminProductsService SKU weight validation', () => {
  const buildService = () => {
    const tx = {
      productSKU: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'sku_1' }])
          .mockResolvedValueOnce([{ price: 18 }])
          .mockResolvedValueOnce([{ id: 'sku_1', weightGram: 650 }]),
        update: jest.fn().mockResolvedValue({ id: 'sku_1' }),
        create: jest.fn().mockResolvedValue({ id: 'sku_2' }),
      },
      product: {
        update: jest.fn().mockResolvedValue({ id: 'product_1' }),
      },
    };
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product_1',
          status: 'ACTIVE',
        }),
      },
      $transaction: jest.fn((fn) => fn(tx)),
    };

    return {
      service: new AdminProductsService(prisma as any),
      prisma,
      tx,
    };
  };

  it('DTO rejects SKU update items without weightGram', async () => {
    const dto = plainToInstance(UpdateProductSkusDto, {
      skus: [{
        id: 'sku_1',
        specText: '默认规格',
        price: 18,
        stock: 5,
      }],
    });

    const errors = await validate(dto);
    const skuErrors = errors.find((error) => error.property === 'skus');

    expect(JSON.stringify(skuErrors)).toContain('weightGram');
  });

  it('DTO rejects non-positive SKU weights with a Chinese message', async () => {
    const dto = plainToInstance(SkuUpdateItem, {
      id: 'sku_1',
      specText: '默认规格',
      price: 18,
      stock: 5,
      weightGram: 0,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'weightGram')).toBe(true);
    expect(JSON.stringify(errors)).toContain('SKU 重量必须大于 0 克');
  });

  it('rejects missing weightGram in service before writing SKU changes', async () => {
    const { service, tx } = buildService();

    await expect(service.updateSkus('product_1', {
      skus: [{
        id: 'sku_1',
        specText: '默认规格',
        price: 18,
        stock: 5,
      } as any],
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.productSKU.update).not.toHaveBeenCalled();
    expect(tx.productSKU.create).not.toHaveBeenCalled();
  });

  it('writes provided weightGram for existing and new SKUs in a Serializable transaction', async () => {
    const { service, prisma, tx } = buildService();

    await service.updateSkus('product_1', {
      skus: [
        {
          id: 'sku_1',
          specText: '默认规格',
          price: 18,
          stock: 5,
          weightGram: 650,
        },
        {
          specText: '新增规格',
          price: 28,
          cost: 12,
          stock: 3,
          weightGram: 900,
        },
      ],
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.productSKU.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sku_1' },
      data: expect.objectContaining({ weightGram: 650 }),
    }));
    expect(tx.productSKU.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ weightGram: 900 }),
    }));
  });
});
