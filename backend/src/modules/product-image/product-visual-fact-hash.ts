import { createHash } from 'node:crypto';

export type ProductVisualFactSource = {
  title: string;
  subtitle: string | null;
  description: string | null;
  categoryId: string | null;
  updatedAt: Date;
  mediaVersion: number;
};

export function productVisualFactHash(product: ProductVisualFactSource) {
  return createHash('sha256').update(JSON.stringify({
    title: product.title,
    subtitle: product.subtitle,
    description: product.description,
    categoryId: product.categoryId,
    updatedAt: product.updatedAt.toISOString(),
    mediaVersion: product.mediaVersion,
  })).digest('hex');
}
