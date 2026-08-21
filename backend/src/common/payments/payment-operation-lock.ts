import { ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

import { RedisCoordinatorService } from '../infra/redis-coordinator.service';

export type PaymentOperationLockContext = {
  owner: string;
  assertOwned(): Promise<void>;
};

const LOCK_TTL_MS = 60_000;
const LOCK_WAIT_ATTEMPTS = 20;
const LOCK_WAIT_MS = 100;

/**
 * 所有预支付、查单、关单共用的跨实例 owner 锁。
 * Redis 不可用或续租失败时 fail-closed，不允许无锁调用支付渠道。
 */
export async function withPaymentOperationLock<T>(input: {
  coordinator?: RedisCoordinatorService;
  namespace: string;
  subjectId: string;
  operation: (context: PaymentOperationLockContext) => Promise<T>;
}): Promise<T> {
  if (!input.coordinator) {
    throw new ServiceUnavailableException('支付会话协调服务暂不可用，请稍后重试');
  }

  const subjectHash = createHash('sha256')
    .update(input.subjectId)
    .digest('hex')
    .slice(0, 32);
  const lockKey = `${input.namespace}:${subjectHash}`;
  const owner = randomBytes(24).toString('hex');
  let acquired: boolean | null = false;
  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    acquired = await input.coordinator.acquireLock(lockKey, owner, LOCK_TTL_MS);
    if (acquired === true) break;
    if (acquired === null) {
      throw new ServiceUnavailableException('支付会话协调服务暂不可用，请稍后重试');
    }
    if (attempt < LOCK_WAIT_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
    }
  }
  if (acquired !== true) {
    throw new ServiceUnavailableException('支付会话正在处理中，请稍后重试');
  }

  let ownershipLost = false;
  const renew = async (): Promise<boolean> => {
    const renewed = await input.coordinator!.renewLock(lockKey, owner, LOCK_TTL_MS);
    if (renewed !== true) ownershipLost = true;
    return renewed === true;
  };
  const interval = setInterval(() => {
    void renew().catch(() => {
      ownershipLost = true;
    });
  }, Math.floor(LOCK_TTL_MS / 3));
  interval.unref?.();

  const context: PaymentOperationLockContext = {
    owner,
    assertOwned: async () => {
      if (ownershipLost || !(await renew())) {
        throw new ServiceUnavailableException('支付会话协调状态不确定，请稍后重试');
      }
    },
  };

  try {
    await context.assertOwned();
    return await input.operation(context);
  } finally {
    clearInterval(interval);
    await input.coordinator.releaseLock(lockKey, owner);
  }
}
