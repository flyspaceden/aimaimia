import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CheckoutDto } from './checkout.dto';
import { CheckoutService } from './checkout.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderService } from './order.service';

describe('checkout quantity safety', () => {
  const invalidQuantities = [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];

  it.each([CheckoutDto, CreateOrderDto])(
    '%p DTO rejects fractional, non-finite, and unsafe quantities',
    async (DtoClass) => {
      for (const quantity of invalidQuantities) {
        const dto = plainToInstance(DtoClass, {
          checkoutSource: 'BUY_NOW',
          items: [{ skuId: 'sku-1', quantity }],
        });
        await expect(validate(dto)).resolves.not.toHaveLength(0);
      }
    },
  );

  it.each([
    ['BUY_NOW normal product', 'BUY_NOW', 1.5],
    ['CART normal product', 'CART', Number.NaN],
    ['CART bundle product', 'CART', Number.POSITIVE_INFINITY],
    ['BUY_NOW unsafe quantity', 'BUY_NOW', Number.MAX_SAFE_INTEGER + 1],
  ])('CheckoutService rejects %s before reading SKU or creating a payment session', async (_label, checkoutSource, quantity) => {
    const prisma = {
      checkoutSession: { findFirst: jest.fn() },
      productSKU: { findMany: jest.fn() },
    };
    const service = new CheckoutService(prisma as any, {} as any);

    await expect(service.checkout('user-1', {
      checkoutSource,
      items: [{ skuId: 'sku-1', quantity }],
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.checkoutSession.findFirst).not.toHaveBeenCalled();
    expect(prisma.productSKU.findMany).not.toHaveBeenCalled();
  });

  it.each(invalidQuantities)(
    'OrderService preview rejects invalid quantity %p before reading SKU',
    async (quantity) => {
      const prisma = { productSKU: { findMany: jest.fn() } };
      const service = new OrderService(prisma as any, {} as any, {} as any, {} as any, {} as any);

      await expect(service.previewOrder('user-1', {
        checkoutSource: 'CART',
        items: [{ skuId: 'sku-1', quantity }],
      } as any)).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.productSKU.findMany).not.toHaveBeenCalled();
    },
  );

  it.each(invalidQuantities)(
    'VIP checkout rejects unsafe persisted gift quantity %p before address or payment session work',
    async (quantity) => {
      const prisma = {
        checkoutSession: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
        vipPackage: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'vip-package-1',
            status: 'ACTIVE',
            price: 399,
            referralBonusRate: 0.1,
          }),
        },
        vipGiftOption: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'vip-gift-1',
            packageId: 'vip-package-1',
            status: 'ACTIVE',
            title: 'VIP 礼包',
            items: [{
              quantity,
              sku: {
                id: 'gift-sku-1',
                title: '赠品规格',
                status: 'ACTIVE',
                stock: Number.MAX_SAFE_INTEGER,
                product: { id: 'gift-product-1', title: '赠品', status: 'ACTIVE' },
              },
            }],
          }),
        },
        address: { findUnique: jest.fn() },
        $transaction: jest.fn(),
      };
      const service = new CheckoutService(prisma as any, {} as any);

      await expect(service.checkoutVipPackage('user-1', {
        packageId: 'vip-package-1',
        giftOptionId: 'vip-gift-1',
        addressId: 'address-1',
      } as any)).rejects.toThrow('VIP 赠品数量配置异常');

      expect(prisma.address.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});
