import type { Cart, CartQuantityAck, Result } from '@/types';

type QuantityWriter = (
  cartItemId: string,
  quantity: number,
) => Promise<Result<CartQuantityAck>>;

type QuantityCallbacks = {
  onOptimistic?: (cartItemId: string, quantity: number) => void;
  onAcknowledged?: (ack: CartQuantityAck, quantity: number) => void;
  onRollback?: (cartItemId: string, quantity: number) => void;
  onFailure?: (cartItemId: string, result: Result<CartQuantityAck>) => void;
  onPendingChange?: (cartItemId: string, pending: boolean) => void;
  onIdle?: (hadFailure: boolean) => void;
};

const invalidAck = (cartItemId: string): Result<CartQuantityAck> => ({
  ok: false,
  error: {
    code: 'INVALID_RESPONSE',
    message: `quantity acknowledgement does not match ${cartItemId}`,
    displayMessage: '购物车响应异常，请刷新后重试',
    retryable: true,
  },
});

const writerFailure = (error: unknown): Result<CartQuantityAck> => ({
  ok: false,
  error: {
    code: 'NETWORK',
    message: error instanceof Error ? error.message : 'quantity writer failed',
    displayMessage: '网络开小差了，请重试',
    retryable: true,
  },
});

/**
 * Serializes absolute quantity writes per cart row while allowing different
 * rows to progress independently. Rapid taps are coalesced to the latest
 * desired quantity so a stale render cannot lose increments.
 */
export class CartQuantityCoordinator {
  private readonly desired = new Map<string, number>();
  private readonly confirmed = new Map<string, number>();
  private readonly running = new Set<string>();
  private readonly idleWaiters = new Set<() => void>();
  private disposed = false;
  private hadFailureSinceIdle = false;

  constructor(
    private readonly writer: QuantityWriter,
    private readonly callbacks: QuantityCallbacks = {},
  ) {}

  enqueueDelta(
    cartItemId: string,
    renderedQuantity: number,
    min: number,
    max: number,
    delta: number,
  ): number {
    if (this.disposed) return renderedQuantity;
    const current = this.desired.get(cartItemId) ?? renderedQuantity;
    const next = Math.max(min, Math.min(max, current + delta));
    if (next === current) return current;

    if (!this.running.has(cartItemId) && !this.desired.has(cartItemId)) {
      this.confirmed.set(cartItemId, renderedQuantity);
    }
    this.desired.set(cartItemId, next);
    this.callbacks.onOptimistic?.(cartItemId, next);
    if (!this.running.has(cartItemId)) void this.flush(cartItemId);
    return next;
  }

  isPending(cartItemId?: string): boolean {
    return cartItemId
      ? this.running.has(cartItemId)
      : this.running.size > 0;
  }

  waitForIdle(): Promise<void> {
    if (this.running.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  dispose(): void {
    this.disposed = true;
    this.desired.clear();
    this.confirmed.clear();
    this.running.clear();
    this.idleWaiters.forEach((resolve) => resolve());
    this.idleWaiters.clear();
  }

  private async flush(cartItemId: string): Promise<void> {
    this.running.add(cartItemId);
    this.callbacks.onPendingChange?.(cartItemId, true);
    try {
      while (!this.disposed && this.desired.has(cartItemId)) {
        const target = this.desired.get(cartItemId)!;
        let result: Result<CartQuantityAck>;
        try {
          result = await this.writer(cartItemId, target);
        } catch (error) {
          result = writerFailure(error);
        }
        if (this.disposed) return;

        if (!result.ok) {
          const rollbackQuantity = this.confirmed.get(cartItemId);
          this.desired.delete(cartItemId);
          this.confirmed.delete(cartItemId);
          this.hadFailureSinceIdle = true;
          if (rollbackQuantity !== undefined) {
            this.callbacks.onRollback?.(cartItemId, rollbackQuantity);
          }
          this.callbacks.onFailure?.(cartItemId, result);
          return;
        }
        if (
          result.data.cartItemId !== cartItemId
          || result.data.quantity !== target
        ) {
          const rollbackQuantity = this.confirmed.get(cartItemId);
          this.desired.delete(cartItemId);
          this.confirmed.delete(cartItemId);
          this.hadFailureSinceIdle = true;
          if (rollbackQuantity !== undefined) {
            this.callbacks.onRollback?.(cartItemId, rollbackQuantity);
          }
          this.callbacks.onFailure?.(cartItemId, invalidAck(cartItemId));
          return;
        }

        this.confirmed.set(cartItemId, target);

        // A newer tap arrived while this request was running. Do not paint the
        // intermediate acknowledgement over the newer optimistic value.
        if (this.desired.get(cartItemId) === target) {
          this.desired.delete(cartItemId);
          this.confirmed.delete(cartItemId);
          this.callbacks.onAcknowledged?.(result.data, target);
        }
      }
    } finally {
      this.running.delete(cartItemId);
      if (!this.disposed) this.callbacks.onPendingChange?.(cartItemId, false);
      if (this.running.size === 0) {
        const hadFailure = this.hadFailureSinceIdle;
        this.hadFailureSinceIdle = false;
        if (!this.disposed) this.callbacks.onIdle?.(hadFailure);
        this.idleWaiters.forEach((resolve) => resolve());
        this.idleWaiters.clear();
      }
    }
  }
}

export function patchCartQuantity(
  previous: Result<Cart> | undefined,
  cartItemId: string,
  quantity: number,
): Result<Cart> | undefined {
  if (!previous?.ok) return previous;
  let found = false;
  const items = previous.data.items.map((item) => {
    if (item.id !== cartItemId) return item;
    found = true;
    return { ...item, quantity };
  });
  if (!found) return previous;

  const selectedTotal = items
    .filter((item) => !item.isPrize && item.isSelected)
    .reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const lockedGiftsInfo = previous.data.lockedGiftsInfo?.map((gift) => ({
    ...gift,
    deficit: Math.max(0, gift.threshold - selectedTotal),
    unlocked: selectedTotal >= gift.threshold,
  }));

  return {
    ok: true,
    data: {
      ...previous.data,
      items,
      selectedTotal,
      ...(lockedGiftsInfo ? { lockedGiftsInfo } : {}),
    },
  };
}
