import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductBundleService } from '../product/product-bundle.service';

@Injectable()
export class RecommendationService {
  constructor(
    private prisma: PrismaService,
    private productBundleService: ProductBundleService,
  ) {}

  /** 获取个性推荐（占位：返回最新上架商品 + 推荐理由） */
  async getForUser(userId: string) {
    const products = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        company: { status: 'ACTIVE', isPlatform: false },
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: {
        company: { select: { name: true } },
        media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 },
        tags: { include: { tag: true } },
        // 与 ProductService.list 保持一致：取全部 ACTIVE SKU + price/stock/maxPerOrder，
        // 供卡片展示「仅剩 x 件」「限购 x 件」
        skus: {
          where: { status: 'ACTIVE' },
          orderBy: { price: 'asc' },
          select: { id: true, price: true, stock: true, maxPerOrder: true },
        },
        bundleItems: {
          orderBy: { sortOrder: 'asc' },
          select: {
            quantity: true,
            sku: {
              select: {
                stock: true,
                status: true,
                product: { select: { status: true, auditStatus: true } },
              },
            },
          },
        },
      },
    });

    const reasons = [
      '根据你的购买偏好推荐',
      '本周热销商品',
      '新品上架，尝鲜推荐',
      '应季好物推荐',
      '高评价商品',
      '产地直发，品质保障',
    ];

    return products.map((p, i) => {
      const firstImage = p.media?.[0]?.url || '';
      const activeSkus = p.skus || [];
      const firstSku = activeSkus[0];
      const prices = activeSkus.map((sku) => sku.price).filter((price) => Number.isFinite(price));
      const minPrice = prices.length ? Math.min(...prices) : p.basePrice;
      const maxPrice = prices.length ? Math.max(...prices) : p.basePrice;
      const cheapestSku = activeSkus.find((sku) => sku.price === minPrice) || firstSku;
      const tagNames = (p.tags || []).map((pt: any) => pt.tag?.name).filter(Boolean);
      const origin = p.origin as any;

      // 聚合库存 + 单笔限购（口径同 ProductService.mapToListItem）
      const stock = activeSkus.reduce((sum, s) => sum + (Number(s.stock) || 0), 0);
      const bundleAvailableStock = p.type === 'BUNDLE'
        ? this.productBundleService.calculateAvailability((p.bundleItems || []).map((item) => ({
            stock: item.sku?.stock ?? 0,
            quantity: item.quantity,
            skuStatus: item.sku?.status,
            productStatus: item.sku?.product?.status,
            productAuditStatus: item.sku?.product?.auditStatus,
          })))
        : null;
      let maxPerOrder: number | null = null;
      if (activeSkus.length > 0) {
        const limits = activeSkus.map((s) =>
          s.maxPerOrder != null && s.maxPerOrder > 0 ? s.maxPerOrder : null,
        );
        if (limits.every((v) => v != null)) {
          maxPerOrder = Math.min(...(limits as number[]));
        }
      }

      return {
        id: `rec-${p.id}`,
        product: {
          id: p.id,
          type: p.type === 'BUNDLE' ? 'BUNDLE' : 'SIMPLE',
          title: p.title,
          price: minPrice,
          defaultSkuId: cheapestSku?.id ?? null,
          priceFrom: maxPrice > minPrice,
          unit: p.unit || '斤',
          origin: origin?.text || origin?.name || '',
          image: firstImage,
          tags: tagNames.length > 0 ? tagNames : p.aiKeywords || [],
          categoryId: p.categoryId,
          companyId: p.companyId,
          companyName: p.company?.name || undefined,
          stock,
          bundleAvailableStock,
          maxPerOrder,
        },
        reason: reasons[i % reasons.length],
      };
    });
  }

  /** 标记不感兴趣（占位：记录日志，后续接入推荐引擎） */
  async markNotInterested(userId: string, recommendationId: string) {
    // 占位：真实实现需写入用户偏好表
    // 目前返回剩余推荐（排除该条）
    const all = await this.getForUser(userId);
    return all.filter((item) => item.id !== recommendationId);
  }
}
