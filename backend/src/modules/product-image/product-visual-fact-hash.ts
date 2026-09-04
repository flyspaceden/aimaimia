import { createHash } from 'node:crypto';

export type ProductVisualFactSource = {
  title: string;
  subtitle: string | null;
  description: string | null;
  categoryId: string | null;
  category?: { name: string } | null;
  categoryName?: string | null;
  /** Concurrency metadata only; intentionally excluded from the fact hash. */
  updatedAt?: Date;
  mediaVersion: number;
};

export function productVisualFactHash(product: ProductVisualFactSource) {
  return createHash('sha256').update(JSON.stringify({
    version: 'product-visual-facts-v2',
    title: product.title,
    subtitle: product.subtitle,
    description: product.description,
    categoryId: product.categoryId,
    categoryName: (product.categoryName ?? product.category?.name ?? '').trim() || null,
    mediaVersion: product.mediaVersion,
  })).digest('hex');
}
