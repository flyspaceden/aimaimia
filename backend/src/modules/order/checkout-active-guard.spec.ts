import { CheckoutService } from './checkout.service';
import { ConflictException } from '@nestjs/common';

describe('CheckoutService active session guard', () => {
  it('throws ConflictException with PENDING_CHECKOUT_EXISTS when active session exists', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const activeSession = { id: 'existing', idempotencyKey: 'old-key', expiresAt };

    // 区分两次 findFirst 调用：
    // 1) 幂等检查：where.idempotencyKey 存在 → 返回 null（不命中幂等）
    // 2) 防重锁：where.status === 'ACTIVE' → 返回 activeSession（命中守卫）
    const findFirst = async (args: any) => {
      if (args?.where?.idempotencyKey) return null;
      if (args?.where?.status === 'ACTIVE') return activeSession;
      return null;
    };

    const prisma: any = { checkoutSession: { findFirst } };
    const svc = new CheckoutService(prisma, {} as any);

    await expect(
      svc.checkout('user1', { items: [{ skuId: 's1', quantity: 1 }], idempotencyKey: 'new-key' } as any),
    ).rejects.toThrow(ConflictException);

    try {
      await svc.checkout('user1', { items: [{ skuId: 's1', quantity: 1 }], idempotencyKey: 'new-key' } as any);
    } catch (e: any) {
      expect(e.getResponse()).toMatchObject({ code: 'PENDING_CHECKOUT_EXISTS' });
      expect(e.getStatus()).toBe(409);
    }
  });

  it('does not block when no active session exists (guard passes through)', async () => {
    const findFirst = async () => null;
    const prisma: any = {
      checkoutSession: { findFirst },
      // 后续会查 productSKU，让其抛错以验证守卫已放行
      productSKU: { findMany: async () => { throw new Error('REACHED_SKU_QUERY'); } },
      cart: { findUnique: async () => null },
      cartItem: { findMany: async () => [] },
    };
    const svc = new CheckoutService(prisma, {} as any);
    await expect(
      svc.checkout('user1', { items: [{ skuId: 's1', quantity: 1 }] } as any),
    ).rejects.toThrow('REACHED_SKU_QUERY');
  });
});
