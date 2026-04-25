import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, ReturnPolicy } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminUpdateProductDto } from './dto/update-product.dto';
import { UpdateProductSkusDto } from './dto/update-sku.dto';

@Injectable()
export class AdminProductsService {
  constructor(private prisma: PrismaService) {}

  /** 商品列表（管理端） */
  async findAll(
    page = 1,
    pageSize = 20,
    status?: string,
    auditStatus?: string,
    keyword?: string,
    companyId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    // DRAFT 是卖家私有视图，管理端永远不可见。
    // 即使 caller 显式传 status=DRAFT 也强制忽略并 fallback 到"非草稿"——
    // 这是服务端可见性边界，不依赖前端约束。
    if (status && status !== 'DRAFT') {
      where.status = status;
    } else {
      where.status = { not: 'DRAFT' };
    }
    if (auditStatus) where.auditStatus = auditStatus;
    if (companyId) where.companyId = companyId;
    if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
    if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate + 'T23:59:59') };
    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { id: keyword },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true, status: true } },
          category: { select: { id: true, name: true, returnPolicy: true, parentId: true } },
          skus: { select: { id: true, price: true, cost: true, stock: true, maxPerOrder: true } },
          media: { select: { url: true }, take: 1 },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    // 解析每个商品的最终生效退货政策
    // 批量加载所有分类（避免 N+1），分类数量有限可全量缓存
    const needResolve = items.filter(
      (item) => ((item as any).returnPolicy || 'INHERIT') === 'INHERIT',
    );
    let categoryMap: Map<string, { returnPolicy: ReturnPolicy; parentId: string | null }> | undefined;
    if (needResolve.length > 0) {
      const allCategories = await this.prisma.category.findMany({
        select: { id: true, returnPolicy: true, parentId: true },
      });
      categoryMap = new Map(allCategories.map((c) => [c.id, { returnPolicy: c.returnPolicy, parentId: c.parentId }]));
    }

    const enriched = items.map((item) => {
      const policy = (item as any).returnPolicy || 'INHERIT';
      if (policy !== 'INHERIT') {
        return { ...item, effectiveReturnPolicy: policy };
      }
      // 沿分类链内存查找
      let catPolicy: ReturnPolicy | undefined = item.category?.returnPolicy as ReturnPolicy | undefined;
      let parentId = (item.category as any)?.parentId as string | null;
      while (catPolicy === 'INHERIT' && parentId && categoryMap) {
        const parent = categoryMap.get(parentId);
        if (!parent) break;
        catPolicy = parent.returnPolicy;
        parentId = parent.parentId;
      }
      return {
        ...item,
        effectiveReturnPolicy: catPolicy === 'INHERIT' ? 'RETURNABLE' : catPolicy,
      };
    });

    return { items: enriched, total, page, pageSize };
  }

  /** 商品统计：DRAFT 不进任何聚合（草稿不应展示在管理端运营视图） */
  async getStats() {
    const excludeDraft = { status: { not: 'DRAFT' as const } };
    const [byStatus, byAudit] = await Promise.all([
      this.prisma.product.groupBy({ by: ['status'], _count: true, where: excludeDraft }),
      this.prisma.product.groupBy({ by: ['auditStatus'], _count: true, where: excludeDraft }),
    ]);
    const result: Record<string, number> = {};
    let total = 0;
    for (const g of byStatus) {
      result[g.status] = g._count;
      total += g._count;
    }
    for (const g of byAudit) {
      result[`AUDIT_${g.auditStatus}`] = g._count;
    }
    result.ALL = total;
    return result;
  }

  /** 商品详情 */
  async findById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        skus: true,
        media: true,
        tags: { include: { tag: true } },
      },
    });
    // 草稿对管理端不可见，统一返回 404（不泄露草稿存在）
    if (!product || product.status === 'DRAFT') throw new NotFoundException('商品不存在');
    return product;
  }

  /** 更新商品 */
  async update(id: string, dto: AdminUpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.status === 'DRAFT') throw new NotFoundException('商品不存在');

    // 提取 tagIds，不传给 Prisma product.update
    const { tagIds, returnPolicy, ...rest } = dto;
    const productData: Prisma.ProductUncheckedUpdateInput = {
      ...rest,
      ...(returnPolicy !== undefined ? { returnPolicy: returnPolicy as ReturnPolicy } : {}),
    };

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: productData,
      });

      // 更新商品标签关联
      if (tagIds !== undefined) {
        await tx.productTag.deleteMany({ where: { productId: id } });
        if (tagIds.length > 0) {
          const tags = await tx.tag.findMany({
            where: { id: { in: tagIds }, isActive: true },
            include: { category: { select: { scope: true } } },
          });
          const validTagIds = tags
            .filter((t) => t.category.scope === 'PRODUCT')
            .map((t) => t.id);
          if (validTagIds.length > 0) {
            await tx.productTag.createMany({
              data: validTagIds.map((tagId) => ({ productId: id, tagId })),
              skipDuplicates: true,
            });
          }
        }
      }

      // 记录运营（ops）提供的语义字段来源，写入 attributes.semanticMeta
      const now = new Date().toISOString();
      type OpsFieldMeta = { source: 'ops'; updatedAt: string };
      const existingAttrs = (updated.attributes as Record<string, any>) || {};
      const existingMeta = (existingAttrs.semanticMeta as Record<string, OpsFieldMeta>) || {};

      if (dto.flavorTags !== undefined) {
        if (dto.flavorTags.length > 0) {
          existingMeta.flavorTags = { source: 'ops', updatedAt: now };
        } else {
          delete existingMeta.flavorTags;
        }
      }
      if (dto.seasonalMonths !== undefined) {
        if (dto.seasonalMonths.length > 0) {
          existingMeta.seasonalMonths = { source: 'ops', updatedAt: now };
        } else {
          delete existingMeta.seasonalMonths;
        }
      }
      if (dto.usageScenarios !== undefined) {
        if (dto.usageScenarios.length > 0) {
          existingMeta.usageScenarios = { source: 'ops', updatedAt: now };
        } else {
          delete existingMeta.usageScenarios;
        }
      }
      if (dto.dietaryTags !== undefined) {
        if (dto.dietaryTags.length > 0) {
          existingMeta.dietaryTags = { source: 'ops', updatedAt: now };
        } else {
          delete existingMeta.dietaryTags;
        }
      }
      if (dto.originRegion !== undefined) {
        if (dto.originRegion) {
          existingMeta.originRegion = { source: 'ops', updatedAt: now };
        } else {
          delete existingMeta.originRegion;
        }
      }

      await tx.product.update({
        where: { id },
        data: { attributes: { ...existingAttrs, semanticMeta: existingMeta } },
      });

      return updated;
    });
  }

  /** 上下架 */
  async toggleStatus(id: string, status: 'ACTIVE' | 'INACTIVE') {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.status === 'DRAFT') throw new NotFoundException('商品不存在');

    return this.prisma.product.update({
      where: { id },
      data: { status },
    });
  }

  /** 硬删除商品（要求已下架 + 无订单/购物车引用） */
  async remove(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { skus: { select: { id: true } } },
    });
    // 草稿对管理端不可见，统一返回 404
    if (!product || product.status === 'DRAFT') throw new NotFoundException('商品不存在');
    if (product.status !== 'INACTIVE') {
      throw new BadRequestException('请先下架商品后再删除');
    }

    const skuIds = product.skus.map((s) => s.id);

    const [orderItemCount, cartItemCount, lotteryPrizes, vipGiftItems] = await Promise.all([
      skuIds.length > 0
        ? this.prisma.orderItem.count({ where: { skuId: { in: skuIds } } })
        : Promise.resolve(0),
      skuIds.length > 0
        ? this.prisma.cartItem.count({ where: { skuId: { in: skuIds } } })
        : Promise.resolve(0),
      this.prisma.lotteryPrize.findMany({
        where: {
          OR: [
            { productId: id },
            ...(skuIds.length > 0 ? [{ skuId: { in: skuIds } }] : []),
          ],
        },
        select: { name: true },
        take: 5,
      }),
      skuIds.length > 0
        ? this.prisma.vipGiftItem.findMany({
            where: { skuId: { in: skuIds } },
            select: { giftOption: { select: { title: true } } },
            take: 5,
          })
        : Promise.resolve([]),
    ]);

    const blockers: string[] = [];
    if (orderItemCount > 0) blockers.push(`已有 ${orderItemCount} 条订单记录`);
    if (cartItemCount > 0) blockers.push(`${cartItemCount} 个用户购物车中`);
    if (lotteryPrizes.length > 0) {
      blockers.push(`抽奖奖品：${lotteryPrizes.map((p) => p.name).join('、')}`);
    }
    if (vipGiftItems.length > 0) {
      blockers.push(`VIP赠品：${vipGiftItems.map((i) => i.giftOption.title).join('、')}`);
    }
    if (blockers.length > 0) {
      throw new BadRequestException(`无法删除：${blockers.join('；')}。请先清理相关引用后重试。`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productTraceLink.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });

    return { ok: true };
  }

  /** 审核 */
  async audit(id: string, auditStatus: 'APPROVED' | 'REJECTED', auditNote?: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.status === 'DRAFT') throw new NotFoundException('商品不存在');

    // C20: 审核通过自动上架（status -> ACTIVE）；拒绝保持原状态
    const updateData: Prisma.ProductUncheckedUpdateInput = { auditStatus, auditNote };
    if (auditStatus === 'APPROVED') {
      updateData.status = 'ACTIVE';
    }

    return this.prisma.product.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * C21: 管理端 SKU 批量编辑（UPSERT-only，不删除未列出的 SKU）
   * 使用 Serializable 隔离级别（涉及价格与库存）
   * - 含 id → 更新对应 SKU
   * - 无 id → 新建 SKU
   */
  async updateSkus(productId: string, dto: UpdateProductSkusDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.status === 'DRAFT') throw new NotFoundException('商品不存在');

    return this.prisma.$transaction(
      async (tx) => {
        // 校验传入带 id 的 SKU 必须属于该商品
        const incomingIds = dto.skus.map((s) => s.id).filter((v): v is string => !!v);
        if (incomingIds.length > 0) {
          const existing = await tx.productSKU.findMany({
            where: { id: { in: incomingIds }, productId },
            select: { id: true },
          });
          if (existing.length !== incomingIds.length) {
            throw new NotFoundException('存在不属于该商品的 SKU');
          }
        }

        for (const sku of dto.skus) {
          if (sku.id) {
            // 更新已存在 SKU
            const data: Prisma.ProductSKUUncheckedUpdateInput = {
              price: sku.price,
              stock: sku.stock,
            };
            if (sku.cost !== undefined) data.cost = sku.cost;
            if (sku.specText !== undefined) data.title = sku.specText;
            await tx.productSKU.update({ where: { id: sku.id }, data });
          } else {
            // 新建 SKU
            await tx.productSKU.create({
              data: {
                productId,
                title: sku.specText ?? '默认规格',
                price: sku.price,
                cost: sku.cost ?? 0,
                stock: sku.stock,
              },
            });
          }
        }

        // 同步 Product.basePrice = min(active SKU.price)，与卖家端逻辑保持一致
        const allActiveSkus = await tx.productSKU.findMany({
          where: { productId, status: 'ACTIVE' },
          select: { price: true },
        });
        if (allActiveSkus.length > 0) {
          const minPrice = Math.min(...allActiveSkus.map((s) => s.price));
          await tx.product.update({
            where: { id: productId },
            data: { basePrice: minPrice },
          });
        }

        return tx.productSKU.findMany({
          where: { productId },
          orderBy: { createdAt: 'asc' },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** 清除语义字段来源标记，使 SemanticFillService 可以重新填充 */
  async clearSemanticMeta(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, status: true, attributes: true },
    });
    if (!product || product.status === 'DRAFT') throw new NotFoundException('商品不存在');

    const attributes = (product.attributes as Record<string, unknown>) ?? {};
    // 删除 semanticMeta，让 fillProduct 将所有字段视为可覆盖
    const updatedAttributes = { ...attributes };
    delete updatedAttributes['semanticMeta'];

    return this.prisma.product.update({
      where: { id },
      data: { attributes: updatedAttributes as any },
    });
  }
}
