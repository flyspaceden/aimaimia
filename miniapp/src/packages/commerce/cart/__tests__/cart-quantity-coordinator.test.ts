import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Cart, CartQuantityAck, Result } from '@/types';
import {
  CartQuantityCoordinator,
  patchCartQuantity,
} from '../cart-quantity-coordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function ok(cartItemId: string, quantity: number): Result<CartQuantityAck> {
  return {
    ok: true,
    data: { cartItemId, skuId: `sku-${cartItemId}`, quantity },
  };
}

function cartResult(): Result<Cart> {
  return {
    ok: true,
    data: {
      id: 'cart-1',
      selectedTotal: 50,
      items: [
        {
          id: 'item-a',
          skuId: 'sku-a',
          quantity: 1,
          isSelected: true,
          product: {
            id: 'product-a', title: '商品 A', image: null, price: 10,
            originalPrice: null, stock: 20,
          },
        },
        {
          id: 'item-b',
          skuId: 'sku-b',
          quantity: 2,
          isSelected: true,
          product: {
            id: 'product-b', title: '商品 B', image: null, price: 20,
            originalPrice: null, stock: 20,
          },
        },
      ],
    },
  };
}

describe('CartQuantityCoordinator', () => {
  it('coalesces rapid taps for one item without losing increments from a stale render', async () => {
    const first = deferred<Result<CartQuantityAck>>();
    const writes: Array<{ cartItemId: string; quantity: number }> = [];
    const optimistic: number[] = [];
    const acknowledgements: number[] = [];
    const writer = vi.fn(async (cartItemId: string, quantity: number) => {
      writes.push({ cartItemId, quantity });
      if (writes.length === 1) return first.promise;
      return ok(cartItemId, quantity);
    });
    const coordinator = new CartQuantityCoordinator(writer, {
      onOptimistic: (_cartItemId, quantity) => optimistic.push(quantity),
      onAcknowledged: (_ack, quantity) => acknowledgements.push(quantity),
    });

    expect(coordinator.enqueueDelta('item-a', 1, 1, 10, 1)).toBe(2);
    expect(coordinator.enqueueDelta('item-a', 1, 1, 10, 1)).toBe(3);
    expect(coordinator.enqueueDelta('item-a', 1, 1, 10, 1)).toBe(4);
    expect(writes).toEqual([{ cartItemId: 'item-a', quantity: 2 }]);

    first.resolve(ok('item-a', 2));
    await coordinator.waitForIdle();

    expect(writes).toEqual([
      { cartItemId: 'item-a', quantity: 2 },
      { cartItemId: 'item-a', quantity: 4 },
    ]);
    expect(optimistic).toEqual([2, 3, 4]);
    expect(acknowledgements).toEqual([4]);
  });

  it('keeps two item queues independent when responses finish out of order', async () => {
    const pendingA = deferred<Result<CartQuantityAck>>();
    const pendingB = deferred<Result<CartQuantityAck>>();
    const acknowledgements: Array<{ cartItemId: string; quantity: number }> = [];
    const coordinator = new CartQuantityCoordinator(
      (cartItemId, quantity) => cartItemId === 'item-a'
        ? pendingA.promise
        : pendingB.promise,
      {
        onAcknowledged: (ack, quantity) => acknowledgements.push({
          cartItemId: ack.cartItemId,
          quantity,
        }),
      },
    );

    coordinator.enqueueDelta('item-a', 1, 1, 10, 1);
    coordinator.enqueueDelta('item-b', 2, 1, 10, 1);
    pendingB.resolve(ok('item-b', 3));
    await Promise.resolve();
    expect(acknowledgements).toEqual([{ cartItemId: 'item-b', quantity: 3 }]);

    pendingA.resolve(ok('item-a', 2));
    await coordinator.waitForIdle();
    expect(acknowledgements).toEqual([
      { cartItemId: 'item-b', quantity: 3 },
      { cartItemId: 'item-a', quantity: 2 },
    ]);
  });

  it('clears the failed item queue and requests one authoritative rollback', async () => {
    const failures: string[] = [];
    const rollbacks: number[] = [];
    const idle = vi.fn();
    const coordinator = new CartQuantityCoordinator(
      async () => ({
        ok: false,
        error: {
          code: 'NETWORK', message: 'offline', displayMessage: '网络开小差了', retryable: true,
        },
      }),
      {
        onFailure: (cartItemId) => failures.push(cartItemId),
        onRollback: (_cartItemId, quantity) => rollbacks.push(quantity),
        onIdle: idle,
      },
    );

    coordinator.enqueueDelta('item-a', 1, 1, 10, 1);
    await coordinator.waitForIdle();

    expect(failures).toEqual(['item-a']);
    expect(rollbacks).toEqual([1]);
    expect(coordinator.isPending('item-a')).toBe(false);
    expect(idle).toHaveBeenCalledWith(true);
  });

  it('rolls back to the last server acknowledgement when a later coalesced write fails', async () => {
    const rollbacks: number[] = [];
    const coordinator = new CartQuantityCoordinator(
      async (cartItemId, quantity) => quantity === 2
        ? ok(cartItemId, quantity)
        : {
          ok: false,
          error: { code: 'NETWORK', message: 'offline', retryable: true },
        },
      { onRollback: (_cartItemId, quantity) => rollbacks.push(quantity) },
    );

    coordinator.enqueueDelta('item-a', 1, 1, 10, 1);
    coordinator.enqueueDelta('item-a', 1, 1, 10, 1);
    coordinator.enqueueDelta('item-a', 1, 1, 10, 1);
    await coordinator.waitForIdle();

    expect(rollbacks).toEqual([2]);
  });

  it('rejects a mismatched acknowledgement instead of painting another row', async () => {
    const acknowledgements = vi.fn();
    const failures = vi.fn();
    const coordinator = new CartQuantityCoordinator(
      async () => ok('item-b', 2),
      { onAcknowledged: acknowledgements, onFailure: failures },
    );

    coordinator.enqueueDelta('item-a', 1, 1, 10, 1);
    await coordinator.waitForIdle();

    expect(acknowledgements).not.toHaveBeenCalled();
    expect(failures).toHaveBeenCalledWith(
      'item-a',
      expect.objectContaining({ ok: false }),
    );
  });

  it('turns an unexpected writer rejection into a recoverable failure', async () => {
    const failures = vi.fn();
    const coordinator = new CartQuantityCoordinator(
      async () => { throw new Error('transport exploded'); },
      { onFailure: failures },
    );

    coordinator.enqueueDelta('item-a', 1, 1, 10, 1);
    await coordinator.waitForIdle();

    expect(failures).toHaveBeenCalledWith('item-a', {
      ok: false,
      error: expect.objectContaining({
        code: 'NETWORK',
        message: 'transport exploded',
        retryable: true,
      }),
    });
  });
});

describe('patchCartQuantity', () => {
  it('updates only the addressed cart row and recomputes selected total', () => {
    const patched = patchCartQuantity(cartResult(), 'item-a', 3);
    expect(patched?.ok).toBe(true);
    if (!patched?.ok) return;

    expect(patched.data.items.map((item) => [item.id, item.quantity])).toEqual([
      ['item-a', 3],
      ['item-b', 2],
    ]);
    expect(patched.data.selectedTotal).toBe(70);
  });

  it('preserves the original result when the cart item no longer exists', () => {
    const original = cartResult();
    expect(patchCartQuantity(original, 'missing', 9)).toBe(original);
  });

  it('keeps an optimistic row after cancelling an older whole-cart GET', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const oldGet = deferred<Result<Cart>>();
    const request = client.fetchQuery({
      queryKey: ['commerce', 'cart'],
      queryFn: () => oldGet.promise,
    }).catch(() => undefined);
    await Promise.resolve();

    const cancellation = client.cancelQueries({ queryKey: ['commerce', 'cart'] });
    client.setQueryData<Result<Cart>>(
      ['commerce', 'cart'],
      patchCartQuantity(cartResult(), 'item-a', 3),
    );
    oldGet.resolve(cartResult());
    await cancellation;
    await request;

    const current = client.getQueryData<Result<Cart>>(['commerce', 'cart']);
    expect(current?.ok && current.data.items.map((item) => item.quantity)).toEqual([3, 2]);
    client.clear();
  });
});
