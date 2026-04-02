import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RecommendationService {
  constructor(private prisma: PrismaService) {}

  /** 获取个性推荐（占位：返回最新上架商品 + 推荐理由） */
  async getForUser(userId: string) {
    const products = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        company: { isPlatform: { not: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: {
        media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 },
        tags: { include: { tag: true } },
        skus: { where: { status: 'ACTIVE' }, take: 1 },
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
      const firstSku = p.skus?.[0];
      const tagNames = (p.tags || []).map((pt: any) => pt.tag?.name).filter(Boolean);
      const origin = p.origin as any;

      return {
        id: `rec-${p.id}`,
        product: {
          id: p.id,
          title: p.title,
          price: firstSku?.price ?? p.basePrice,
          defaultSkuId: firstSku?.id ?? null,
          unit: origin?.unit || '斤',
          origin: origin?.text || origin?.name || '',
          image: firstImage,
          tags: tagNames.length > 0 ? tagNames : p.aiKeywords || [],
          companyId: p.companyId,
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
