import { ConflictException } from '@nestjs/common';
import { ProductImageOptimizationStatus } from '@prisma/client';

const transitions: Record<ProductImageOptimizationStatus, readonly ProductImageOptimizationStatus[]> = {
  REQUESTED: [ProductImageOptimizationStatus.QUEUED, ProductImageOptimizationStatus.FAILED, ProductImageOptimizationStatus.CANCELLED, ProductImageOptimizationStatus.EXPIRED],
  QUEUED: [ProductImageOptimizationStatus.RUNNING, ProductImageOptimizationStatus.FAILED, ProductImageOptimizationStatus.CANCELLED, ProductImageOptimizationStatus.EXPIRED],
  RUNNING: [ProductImageOptimizationStatus.SUCCEEDED, ProductImageOptimizationStatus.FAILED, ProductImageOptimizationStatus.RECONCILING],
  // A paid provider may have accepted a request when a worker lease expires.
  // Keep the task and its dedupe lock alive until billing/provider status is
  // reconciled; never enqueue a second potentially chargeable request first.
  RECONCILING: [ProductImageOptimizationStatus.SUCCEEDED, ProductImageOptimizationStatus.FAILED, ProductImageOptimizationStatus.EXPIRED],
  SUCCEEDED: [ProductImageOptimizationStatus.ADOPTED, ProductImageOptimizationStatus.REJECTED, ProductImageOptimizationStatus.EXPIRED],
  FAILED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  ADOPTED: [],
};

export function assertProductImageOptimizationTransition(
  from: ProductImageOptimizationStatus,
  to: ProductImageOptimizationStatus,
): void {
  if (!transitions[from].includes(to)) {
    throw new ConflictException(`商品视觉任务不能从 ${from} 转为 ${to}`);
  }
}

export function isProductImageOptimizationTerminal(status: ProductImageOptimizationStatus): boolean {
  return transitions[status].length === 0;
}
