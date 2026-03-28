import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import { SemanticFillService } from '../../product/semantic-fill.service';
import { CreateProductDto, UpdateProductDto, SkuItemDto } from './seller-products.dto';

@Injectable()
export class SellerProductsService {
  private readonly logger = new Logger(SellerProductsService.name);

  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
    private semanticFillService: SemanticFillService,
  ) {}

  /** 我的商品列表 */
  async findAll(
    companyId: string,
    page: number,
    pageSize: number,
    status?: string,
    auditStatus?: string,
    keyword?: string,
  ) {
    const where: any = { companyId };
    if (status) where.status = status;
    if (auditStatus) where.auditStatus = auditStatus;
    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { subtitle: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          skus: true,
          media: { orderBy: { sortOrder: 'asc' } },
          tags: { include: { tag: true } },
          category: { select: { id: true, name: true, path: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** 商品详情 */
  async findById(companyId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        skus: true,
        media: { orderBy: { sortOrder: 'asc' } },
        tags: { include: { tag: true } },
        category: { select: { id: true, name: true, path: true } },
      },
    });

    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== companyId) throw new ForbiddenException('无权访问该商品');

    return product;
  }

  /** 创建商品 */
  async create(companyId: string, dto: CreateProductDto) {
    // 服务层兜底校验：所有 SKU 成本必须大于 0（DTO 已有 @Min(0.01)，此处防止绕过）
    for (const sku of dto.skus) {
      if (!sku.cost || sku.cost <= 0) {
        throw new BadRequestException('商品成本必须大于 0');
      }
    }

    // 自动定价：售价 = 成本 × markupRate
    // markupRate 在事务内读取，防止 TOCTOU 竞态（读取后被管理员修改导致定价不一致）
    // 事务结果赋值给 product 变量，以便事务提交后触发异步语义填充
    const product = await this.prisma.$transaction(async (tx) => {
      const sysConfig = await this.bonusConfig.getSystemConfig();
      const markupRate = sysConfig.markupRate;

      // 计算每个 SKU 的自动售价
      const skuPrices = dto.skus.map((s) => +(s.cost * markupRate).toFixed(2));

      // 创建商品
      const product = await tx.product.create({
        data: {
          companyId,
          title: dto.title,
          subtitle: dto.subtitle,
          description: dto.description,
          // 基准价取所有 SKU 自动售价中的最低价
          basePrice: dto.basePrice ?? Math.min(...skuPrices),
          cost: Math.min(...dto.skus.map((s) => s.cost)),
          categoryId: dto.categoryId,
          origin: dto.origin,
          attributes: dto.attributes,
          aiKeywords: dto.aiKeywords || [],
          flavorTags: dto.flavorTags ?? [],
          seasonalMonths: dto.seasonalMonths ?? [],
          usageScenarios: dto.usageScenarios ?? [],
          dietaryTags: dto.dietaryTags ?? [],
          originRegion: dto.originRegion,
          status: 'INACTIVE', // 新建商品默认下架
          auditStatus: 'PENDING', // 需管理员审核
          skus: {
            create: dto.skus.map((sku) => ({
              title: sku.specName,
              price: +(sku.cost * markupRate).toFixed(2), // 自动定价
              cost: sku.cost,
              stock: sku.stock,
              weightGram: sku.weightGram,
            })),
          },
          media: dto.mediaUrls
            ? {
                create: dto.mediaUrls.map((url, i) => ({
                  type: 'IMAGE' as const,
                  url,
                  sortOrder: i,
                })),
              }
            : undefined,
        },
        include: { skus: true, media: true },
      });

      // 创建商品标签关联（通过 tagId）
      if (dto.tagIds && dto.tagIds.length > 0) {
        const tags = await tx.tag.findMany({
          where: { id: { in: dto.tagIds }, isActive: true },
          include: { category: { select: { scope: true } } },
        });
        const validTagIds = tags
          .filter(t => t.category.scope === 'PRODUCT')
          .map(t => t.id);
        if (validTagIds.length > 0) {
          await tx.productTag.createMany({
            data: validTagIds.map(tagId => ({ productId: product.id, tagId })),
            skipDuplicates: true,
          });
        }
      }

      // 记录卖家提供的语义字段来源，写入 attributes.semanticMeta
      // 格式与 SemanticFillService 保持一致：{ source: 'seller', updatedAt: ISO字符串 }
      // canAiFill() 会检查 meta.source === 'ai'，只有此格式才能正确阻止 AI 覆盖卖家数据
      // 规则：字段非空 → source='seller'；字段显式传空 → 删除 source 条目，允许 AI 重新填充
      const now = new Date().toISOString();
      type SellerFieldMeta = { source: 'seller'; updatedAt: string };
      const existingAttrs = (product.attributes as Record<string, any>) || {};
      const existingMeta = (existingAttrs.semanticMeta as Record<string, SellerFieldMeta>) || {};

      if (dto.flavorTags !== undefined) {
        if (dto.flavorTags.length > 0) {
          existingMeta.flavorTags = { source: 'seller', updatedAt: now };
        } else {
          delete existingMeta.flavorTags;
        }
      }
      if (dto.seasonalMonths !== undefined) {
        if (dto.seasonalMonths.length > 0) {
          existingMeta.seasonalMonths = { source: 'seller', updatedAt: now };
        } else {
          delete existingMeta.seasonalMonths;
        }
      }
      if (dto.usageScenarios !== undefined) {
        if (dto.usageScenarios.length > 0) {
          existingMeta.usageScenarios = { source: 'seller', updatedAt: now };
        } else {
          delete existingMeta.usageScenarios;
        }
      }
      if (dto.dietaryTags !== undefined) {
        if (dto.dietaryTags.length > 0) {
          existingMeta.dietaryTags = { source: 'seller', updatedAt: now };
        } else {
          delete existingMeta.dietaryTags;
        }
      }
      if (dto.originRegion !== undefined) {
        if (dto.originRegion) {
          existingMeta.originRegion = { source: 'seller', updatedAt: now };
        } else {
          delete existingMeta.originRegion;
        }
      }

      await tx.product.update({
        where: { id: product.id },
        data: {
          attributes: { ...existingAttrs, semanticMeta: existingMeta },
        },
      });

      return product;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // 事务提交后异步触发 AI 语义填充（fire-and-forget）
    this.semanticFillService.fillProduct(product.id).catch((err: Error) => {
      this.logger.warn(`Async semantic fill failed: ${err.message}`);
    });

    return product;
  }

  /** 编辑商品 */
  async update(companyId: string, productId: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== companyId) throw new ForbiddenException('无权操作该商品');

    // 事务结果赋值给 updated 变量，以便事务提交后触发异步语义填充
    const updated = await this.prisma.$transaction(async (tx) => {
      // 编辑已审核通过的商品需重新审核
      const needReAudit = product.auditStatus === 'APPROVED';

      const result = await tx.product.update({
        where: { id: productId },
        data: {
          title: dto.title,
          subtitle: dto.subtitle,
          description: dto.description,
          basePrice: dto.basePrice,
          categoryId: dto.categoryId,
          origin: dto.origin,
          attributes: dto.attributes,
          aiKeywords: dto.aiKeywords,
          flavorTags: dto.flavorTags ?? undefined,
          seasonalMonths: dto.seasonalMonths ?? undefined,
          usageScenarios: dto.usageScenarios ?? undefined,
          dietaryTags: dto.dietaryTags ?? undefined,
          originRegion: dto.originRegion,
          auditStatus: needReAudit ? 'PENDING' : undefined,
        },
        include: { skus: true, media: true, tags: { include: { tag: true } } },
      });

      // 更新媒体
      if (dto.mediaUrls) {
        await tx.productMedia.deleteMany({ where: { productId } });
        if (dto.mediaUrls.length > 0) {
          await tx.productMedia.createMany({
            data: dto.mediaUrls.map((url, i) => ({
              productId,
              type: 'IMAGE' as const,
              url,
              sortOrder: i,
            })),
          });
        }
      }

      // 更新标签（通过 tagId）
      if (dto.tagIds) {
        await tx.productTag.deleteMany({ where: { productId } });
        if (dto.tagIds.length > 0) {
          const tags = await tx.tag.findMany({
            where: { id: { in: dto.tagIds }, isActive: true },
            include: { category: { select: { scope: true } } },
          });
          const validTagIds = tags
            .filter(t => t.category.scope === 'PRODUCT')
            .map(t => t.id);
          if (validTagIds.length > 0) {
            await tx.productTag.createMany({
              data: validTagIds.map(tagId => ({ productId, tagId })),
              skipDuplicates: true,
            });
          }
        }
      }

      // 记录卖家提供的语义字段来源，写入 attributes.semanticMeta
      // 格式与 SemanticFillService 保持一致：{ source: 'seller', updatedAt: ISO字符串 }
      // canAiFill() 会检查 meta.source === 'ai'，只有此格式才能正确阻止 AI 覆盖卖家数据
      // 规则：字段非空 → source='seller'；字段显式传空 → 删除 source 条目，允许 AI 重新填充
      const now = new Date().toISOString();
      type SellerFieldMeta = { source: 'seller'; updatedAt: string };
      // 使用 update 后的 attributes 作为基础，避免覆盖其他属性
      const existingAttrs = (result.attributes as Record<string, any>) || {};
      const existingMeta = (existingAttrs.semanticMeta as Record<string, SellerFieldMeta>) || {};

      if (dto.flavorTags !== undefined) {
        if (dto.flavorTags.length > 0) {
          existingMeta.flavorTags = { source: 'seller', updatedAt: now };
        } else {
          delete existingMeta.flavorTags;
        }
      }
      if (dto.seasonalMonths !== undefined) {
        if (dto.seasonalMonths.length > 0) {
          existingMeta.seasonalMonths = { source: 'seller', updatedAt: now };
        } else {
          delete existingMeta.seasonalMonths;
        }
      }
      if (dto.usageScenarios !== undefined) {
        if (dto.usageScenarios.length > 0) {
          existingMeta.usageScenarios = { source: 'seller', updatedAt: now };
        } else {
          delete existingMeta.usageScenarios;
        }
      }
      if (dto.dietaryTags !== undefined) {
        if (dto.dietaryTags.length > 0) {
          existingMeta.dietaryTags = { source: 'seller', updatedAt: now };
        } else {
          delete existingMeta.dietaryTags;
        }
      }
      if (dto.originRegion !== undefined) {
        if (dto.originRegion) {
          existingMeta.originRegion = { source: 'seller', updatedAt: now };
        } else {
          delete existingMeta.originRegion;
        }
      }

      await tx.product.update({
        where: { id: productId },
        data: {
          attributes: { ...existingAttrs, semanticMeta: existingMeta },
        },
      });

      return result;
    });

    // 事务提交后异步触发 AI 语义填充（fire-and-forget）
    this.semanticFillService.fillProduct(productId).catch((err: Error) => {
      this.logger.warn(`Async semantic fill failed: ${err.message}`);
    });

    return updated;
  }

  /** 上架/下架 */
  async toggleStatus(companyId: string, productId: string, status: 'ACTIVE' | 'INACTIVE') {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== companyId) throw new ForbiddenException('无权操作该商品');

    // 上架需审核通过
    if (status === 'ACTIVE' && product.auditStatus !== 'APPROVED') {
      throw new BadRequestException('商品未通过审核，无法上架');
    }

    return this.prisma.product.update({
      where: { id: productId },
      data: { status },
    });
  }

  /** 管理 SKU 列表 */
  async updateSkus(companyId: string, productId: string, skus: SkuItemDto[]) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== companyId) throw new ForbiddenException('无权操作该商品');

    // 服务层兜底校验：所有 SKU 成本必须大于 0
    for (const sku of skus) {
      if (!sku.cost || sku.cost <= 0) {
        throw new BadRequestException('商品成本必须大于 0');
      }
    }

    // 自动定价：售价 = 成本 × markupRate
    // markupRate 在事务内读取，防止 TOCTOU 竞态（读取后被管理员修改导致定价不一致）
    return this.prisma.$transaction(async (tx) => {
      const sysConfig = await this.bonusConfig.getSystemConfig();
      const markupRate = sysConfig.markupRate;

      // 获取现有 SKU
      const existingSkus = await tx.productSKU.findMany({ where: { productId } });
      const existingIds = new Set(existingSkus.map((s) => s.id));

      // 更新或创建
      const newSkuIds = new Set<string>();
      for (const sku of skus) {
        const autoPrice = +(sku.cost * markupRate).toFixed(2);
        if (sku.id && existingIds.has(sku.id)) {
          // 更新现有 SKU
          await tx.productSKU.update({
            where: { id: sku.id },
            data: {
              title: sku.specName,
              price: autoPrice, // 自动定价
              cost: sku.cost,
              stock: sku.stock,
              weightGram: sku.weightGram,
            },
          });
          newSkuIds.add(sku.id);
        } else {
          // 新建 SKU
          const created = await tx.productSKU.create({
            data: {
              productId,
              title: sku.specName,
              price: autoPrice, // 自动定价
              cost: sku.cost,
              stock: sku.stock,
              weightGram: sku.weightGram,
            },
          });
          newSkuIds.add(created.id);
        }
      }

      // 更新商品基准价为最低 SKU 售价
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

      // 删除不再需要的 SKU（注意：有关联 OrderItem 的不能删除）
      const toDelete = [...existingIds].filter((id) => !newSkuIds.has(id));
      if (toDelete.length > 0) {
        // 软处理：将状态标记为 INACTIVE 而非物理删除
        await tx.productSKU.updateMany({
          where: { id: { in: toDelete } },
          data: { status: 'INACTIVE' },
        });
      }

      return tx.productSKU.findMany({
        where: { productId, status: 'ACTIVE' },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
