import { ConflictException } from '@nestjs/common';
import { ProductImageOptimizationStatus } from '@prisma/client';
import {
  assertProductImageOptimizationTransition,
  isProductImageOptimizationTerminal,
} from './product-image-optimization-state';

describe('product image optimization state machine', () => {
  it('allows only the monotonic candidate-task lifecycle', () => {
    expect(() => assertProductImageOptimizationTransition(ProductImageOptimizationStatus.REQUESTED, ProductImageOptimizationStatus.QUEUED)).not.toThrow();
    expect(() => assertProductImageOptimizationTransition(ProductImageOptimizationStatus.QUEUED, ProductImageOptimizationStatus.RUNNING)).not.toThrow();
    expect(() => assertProductImageOptimizationTransition(ProductImageOptimizationStatus.RUNNING, ProductImageOptimizationStatus.SUCCEEDED)).not.toThrow();
    expect(() => assertProductImageOptimizationTransition(ProductImageOptimizationStatus.RUNNING, ProductImageOptimizationStatus.RECONCILING)).not.toThrow();
    expect(() => assertProductImageOptimizationTransition(ProductImageOptimizationStatus.RECONCILING, ProductImageOptimizationStatus.EXPIRED)).not.toThrow();
    expect(() => assertProductImageOptimizationTransition(ProductImageOptimizationStatus.SUCCEEDED, ProductImageOptimizationStatus.ADOPTED)).not.toThrow();
  });

  it('never lets a terminal candidate become runnable or public again', () => {
    expect(() => assertProductImageOptimizationTransition(ProductImageOptimizationStatus.ADOPTED, ProductImageOptimizationStatus.RUNNING)).toThrow(ConflictException);
    expect(() => assertProductImageOptimizationTransition(ProductImageOptimizationStatus.FAILED, ProductImageOptimizationStatus.REQUESTED)).toThrow(ConflictException);
    expect(() => assertProductImageOptimizationTransition(ProductImageOptimizationStatus.RUNNING, ProductImageOptimizationStatus.EXPIRED)).toThrow(ConflictException);
    expect(isProductImageOptimizationTerminal(ProductImageOptimizationStatus.REJECTED)).toBe(true);
    expect(isProductImageOptimizationTerminal(ProductImageOptimizationStatus.RECONCILING)).toBe(false);
    expect(isProductImageOptimizationTerminal(ProductImageOptimizationStatus.RUNNING)).toBe(false);
  });
});
