import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, ProductType, ReturnPolicy, SkuStatus } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import {
  BundleItemInput,
  ProductBundleService,
  ValidatedSellerBundleItem,
} from '../../product/product-bundle.service';
import { SemanticFillService } from '../../product/semantic-fill.service';
import {
  CreateProductDto,
  UpdateProductDto,
  SkuItemDto,
  CreateDraftDto,
  UpdateDraftDto,
} from './seller-products.dto';

/** 每个商户最多保留的草稿数量 */
const DRAFT_LIMIT_PER_COMPANY = 5;
const DRAFT_WEIGHT_PLACEHOLDER_GRAM = 1000;
const DRAFT_WEIGHT_PLACEHOLDER_SKU_CODE_PREFIX = '__DRAFT_WEIGHT_PLACEHOLDER__:';
const LEGACY_DRAFT_WEIGHT_PLACEHOLDER_SKU_CODE = '__DRAFT_WEIGHT_PLACEHOLDER__';
const BUNDLE_DEFAULT_SPEC_NAME = '组合默认规格';
const BUNDLE_SKU_REMOVE_MESSAGE = '该规格已被组合商品引用，请先修改组合商品';

@Injectable()
export class SellerProductsService {
  private readonly logger = new Logger(SellerProductsService.name);

  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
    private semanticFillService: SemanticFillService,
    private productBundleService: ProductBundleService,
  ) {}

  private sellerProductInclude(): any {
    return {
      skus: { where: { status: SkuStatus.ACTIVE } },
      media: { orderBy: { sortOrder: 'asc' as const } },
      tags: { include: { tag: true } },
      category: {
        select: {
          id: true,
          name: true,
          path: true,
          returnPolicy: true,
          parentId: true,
        },
      },
      bundleItems: {
        orderBy: { sortOrder: 'asc' as const },
        include: {
          sku: {
            include: {
              product: {
                include: {
                  media: {
                    where: { type: 'IMAGE' as const },
                    orderBy: { sortOrder: 'asc' as const },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  private isBundleType(type?: ProductType | string | null): boolean {
    return (type ?? ProductType.SIMPLE) === ProductType.BUNDLE;
  }

  private assertNoTypeConversion(
    currentType: ProductType | string | null | undefined,
    nextType?: ProductType | string,
  ) {
    if (nextType && currentType && nextType !== currentType) {
      throw new BadRequestException('第一版暂不支持普通商品与组合商品互相转换');
    }
  }

  private normalizeBundleItemsInput(
    bundleItems?: Array<{ skuId: string; quantity: number; sortOrder?: number }>,
  ): BundleItemInput[] {
    return (bundleItems ?? []).map((item) => ({
      skuId: item.skuId,
      quantity: item.quantity,
      sortOrder: item.sortOrder,
    }));
  }

  private async buildBundleState(
    tx: {
      productSKU: {
        findMany(args: unknown): Promise<Array<{
          id: string;
          price?: number | null;
          stock?: number | null;
          weightGram: number;
          title?: string | null;
          status?: string;
          product?: unknown;
        }>>;
      };
    },
    companyId: string,
    bundleItems: BundleItemInput[] | undefined,
    options: { allowDraft?: boolean; requireItems?: boolean } = {},
  ) {
    const normalizedInput = this.normalizeBundleItemsInput(bundleItems);
    if (normalizedInput.length === 0) {
      if (options.requireItems) {
        throw new BadRequestException('组合商品至少需要一个组成规格');
      }
      return null;
    }

    const validatedItems = await this.productBundleService.validateSellerBundleItems(
      tx as any,
      companyId,
      normalizedInput,
      { allowDraft: options.allowDraft },
    );

    const skuRows = await tx.productSKU.findMany({
      where: { id: { in: validatedItems.map((item) => item.skuId) } },
      select: {
        id: true,
        price: true,
        stock: true,
        weightGram: true,
      },
    });
    const skuMap = new Map(skuRows.map((sku) => [sku.id, sku]));

    const bundleReferenceTotal = +validatedItems
      .reduce((sum, item) => sum + (skuMap.get(item.skuId)?.price ?? 0) * item.quantity, 0)
      .toFixed(2);
    const bundleAvailableStock = this.productBundleService.calculateAvailability(
      validatedItems.map((item) => ({
        stock: skuMap.get(item.skuId)?.stock ?? 0,
        quantity: item.quantity,
      })),
    );
    const bundleTotalWeightGram = this.productBundleService.calculateTotalWeightGram(
      validatedItems.map((item) => ({
        weightGram: skuMap.get(item.skuId)?.weightGram ?? item.sku.weightGram,
        quantity: item.quantity,
      })),
    );

    return {
      validatedItems,
      bundleReferenceTotal,
      bundleAvailableStock,
      bundleTotalWeightGram,
    };
  }

  private bundleItemsCreateData(validatedItems: ValidatedSellerBundleItem[]) {
    return validatedItems.map((item) => ({
      skuId: item.skuId,
      quantity: item.quantity,
      sortOrder: item.sortOrder,
    }));
  }

  private async buildPersistedBundleState(
    tx: {
      productBundleItem: {
        findMany(args: unknown): Promise<Array<{
          skuId: string;
          quantity: number;
          sortOrder?: number | null;
        }>>;
      };
      productSKU: {
        findMany(args: unknown): Promise<Array<{
          id: string;
          price?: number | null;
          stock?: number | null;
          weightGram: number;
          title?: string | null;
          status?: string;
          product?: unknown;
        }>>;
      };
    },
    companyId: string,
    productId: string,
  ) {
    const persistedBundleItems = await tx.productBundleItem.findMany({
      where: { bundleProductId: productId },
      orderBy: { sortOrder: 'asc' },
      select: {
        skuId: true,
        quantity: true,
        sortOrder: true,
      },
    });

    return this.buildBundleState(
      tx,
      companyId,
      persistedBundleItems.map((item) => ({
        skuId: item.skuId,
        quantity: item.quantity,
        sortOrder: item.sortOrder ?? undefined,
      })),
      { requireItems: true },
    );
  }

  private decorateProductForSeller<T extends Record<string, any>>(product: T): T & {
    bundleReferenceTotal: number | null;
    bundleAvailableStock: number | null;
    bundleTotalWeightGram: number | null;
  } {
    if (!this.isBundleType(product.type)) {
      return {
        ...product,
        bundleReferenceTotal: null,
        bundleAvailableStock: null,
        bundleTotalWeightGram: null,
      };
    }

    const bundleItems = product.bundleItems ?? [];
    const bundleReferenceTotal = +bundleItems
      .reduce(
        (sum: number, item: any) => sum + ((item.sku?.price ?? 0) as number) * (item.quantity ?? 0),
        0,
      )
      .toFixed(2);

    const bundleAvailableStock = bundleItems.length === 0
      ? 0
      : this.productBundleService.calculateAvailability(
          bundleItems.map((item: any) => ({
            stock: item.sku?.stock ?? 0,
            quantity: item.quantity,
          })),
        );

    const bundleTotalWeightGram = bundleItems.length === 0
      ? 0
      : this.productBundleService.calculateTotalWeightGram(
          bundleItems.map((item: any) => ({
            weightGram: item.sku?.weightGram ?? 0,
            quantity: item.quantity,
          })),
        );

    return {
      ...product,
      bundleReferenceTotal,
      bundleAvailableStock,
      bundleTotalWeightGram,
    };
  }

  private async loadSellerProduct(
    reader: { product: { findUnique(args: unknown): Promise<any> } },
    productId: string,
  ) {
    const product = await reader.product.findUnique({
      where: { id: productId },
      include: this.sellerProductInclude(),
    });
    if (!product) {
      throw new NotFoundException('商品不存在');
    }
    return this.decorateProductForSeller(product);
  }

  private assertPositiveSkuWeights(
    skus: Array<{ specName?: string; title?: string; weightGram?: number }>,
  ) {
    for (const sku of skus) {
      if (!Number.isInteger(sku.weightGram) || (sku.weightGram ?? 0) <= 0) {
        throw new BadRequestException(
          `SKU "${sku.specName ?? sku.title ?? '默认规格'}" 必须填写包装后重量（克）`,
        );
      }
    }
  }

  private normalizeDraftWeightGram(weightGram?: number) {
    return Number.isInteger(weightGram) && (weightGram ?? 0) > 0
      ? weightGram!
      : DRAFT_WEIGHT_PLACEHOLDER_GRAM;
  }

  private draftSkuCodeForWeight(weightGram?: number) {
    return Number.isInteger(weightGram) && (weightGram ?? 0) > 0
      ? undefined
      : `${DRAFT_WEIGHT_PLACEHOLDER_SKU_CODE_PREFIX}${randomUUID()}`;
  }

  private isDraftWeightPlaceholderSkuCode(skuCode?: string | null) {
    return skuCode === LEGACY_DRAFT_WEIGHT_PLACEHOLDER_SKU_CODE
      || skuCode?.startsWith(DRAFT_WEIGHT_PLACEHOLDER_SKU_CODE_PREFIX) === true;
  }

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
    if (status) {
      where.status = status;
    } else {
      // 未指定状态时默认排除 DRAFT（草稿只在"草稿"tab 显式请求时返回）
      where.status = { not: 'DRAFT' };
    }
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
        include: this.sellerProductInclude(),
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]) as [any[], number];

    // 解析每个商品的最终生效退货政策
    // 批量加载所有分类（避免 N+1），分类数量有限可全量缓存
    const needResolve = items.filter(
      (item) => (item.returnPolicy || 'INHERIT') === 'INHERIT',
    );
    let categoryMap: Map<string, { returnPolicy: ReturnPolicy; parentId: string | null }> | undefined;
    if (needResolve.length > 0) {
      const allCategories = await this.prisma.category.findMany({
        select: { id: true, returnPolicy: true, parentId: true },
      });
      categoryMap = new Map(allCategories.map((c) => [c.id, { returnPolicy: c.returnPolicy, parentId: c.parentId }]));
    }

    const enriched = items.map((item) => {
      const policy = item.returnPolicy || 'INHERIT';
      const base = this.decorateProductForSeller(item);
      if (policy !== 'INHERIT') {
        return { ...base, effectiveReturnPolicy: policy };
      }
      let catPolicy: ReturnPolicy | undefined = item.category?.returnPolicy as ReturnPolicy | undefined;
      let parentId = item.category?.parentId as string | null;
      while (catPolicy === 'INHERIT' && parentId && categoryMap) {
        const parent = categoryMap.get(parentId);
        if (!parent) break;
        catPolicy = parent.returnPolicy;
        parentId = parent.parentId;
      }
      return {
        ...base,
        effectiveReturnPolicy: catPolicy === 'INHERIT' ? 'RETURNABLE' : catPolicy,
      };
    });

    return { items: enriched, total, page, pageSize };
  }

  /** 商品详情 */
  async findById(companyId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: this.sellerProductInclude(),
    });

    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== companyId) throw new ForbiddenException('无权访问该商品');

    return this.decorateProductForSeller(product);
  }

  /** 创建商品 */
  async create(companyId: string, dto: CreateProductDto) {
    const productType = (dto.productType ?? ProductType.SIMPLE) as ProductType;

    // 服务层兜底校验：所有 SKU 成本必须大于 0（DTO 已有 @Min(0.01)，此处防止绕过）
    for (const sku of dto.skus) {
      if (!sku.cost || sku.cost <= 0) {
        throw new BadRequestException('商品成本必须大于 0');
      }
    }
    if (!this.isBundleType(productType)) {
      this.assertPositiveSkuWeights(dto.skus);
    }

    // 自动定价：售价 = 成本 × markupRate
    // markupRate 在事务内读取，防止 TOCTOU 竞态（读取后被管理员修改导致定价不一致）
    // 事务结果赋值给 product 变量，以便事务提交后触发异步语义填充
    const product = await this.prisma.$transaction(async (tx) => {
      const sysConfig = await this.bonusConfig.getSystemConfig();
      const markupRate = sysConfig.markupRate;
      const bundleState = this.isBundleType(productType)
        ? await this.buildBundleState(tx, companyId, dto.bundleItems, { requireItems: true })
        : null;

      const bundleSeedSku = dto.skus[0];
      const bundleCost = bundleSeedSku?.cost ?? 0;
      const bundlePrice = +(bundleCost * markupRate).toFixed(2);
      const skuPrices = this.isBundleType(productType)
        ? [bundlePrice]
        : dto.skus.map((s) => +(s.cost * markupRate).toFixed(2));
      const minCost = this.isBundleType(productType)
        ? bundleCost
        : Math.min(...dto.skus.map((s) => s.cost));

      // 创建商品
      const product = await tx.product.create({
        data: {
          companyId,
          title: dto.title,
          subtitle: dto.subtitle,
          description: dto.description,
          // 基准价取所有 SKU 自动售价中的最低价
          basePrice: this.isBundleType(productType)
            ? bundlePrice
            : (dto.basePrice ?? Math.min(...skuPrices)),
          cost: minCost,
          categoryId: dto.categoryId,
          type: productType,
          // 计量单位：DTO 提供则写入，否则交由 DB 默认值 '斤'
          ...(dto.unit !== undefined && { unit: dto.unit }),
          returnPolicy: (dto.returnPolicy ?? 'INHERIT') as any,
          origin: dto.origin as any,
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
            create: this.isBundleType(productType)
              ? [{
                  title: bundleSeedSku?.specName || BUNDLE_DEFAULT_SPEC_NAME,
                  price: bundlePrice,
                  cost: bundleCost,
                  stock: 0,
                  weightGram: bundleState?.bundleTotalWeightGram ?? 0,
                  maxPerOrder: bundleSeedSku?.maxPerOrder ?? null,
                }]
              : dto.skus.map((sku) => ({
                  title: sku.specName,
                  price: +(sku.cost * markupRate).toFixed(2), // 自动定价
                  cost: sku.cost,
                  stock: sku.stock,
                  weightGram: sku.weightGram,
                  maxPerOrder: sku.maxPerOrder ?? null,
                })),
          },
          bundleItems: bundleState
            ? {
                create: this.bundleItemsCreateData(bundleState.validatedItems),
              }
            : undefined,
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
        include: { skus: true, media: true, bundleItems: true },
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

    return this.loadSellerProduct(this.prisma, product.id);
  }

  /** 编辑商品 */
  async update(companyId: string, productId: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== companyId) throw new ForbiddenException('无权操作该商品');
    if (product.status === 'DRAFT') {
      throw new BadRequestException('草稿商品请使用草稿更新接口');
    }
    this.assertNoTypeConversion(product.type, dto.productType);
    const productType = (dto.productType ?? product.type ?? ProductType.SIMPLE) as ProductType;

    // 事务结果赋值给 updated 变量，以便事务提交后触发异步语义填充
    const updated = await this.prisma.$transaction(async (tx) => {
      // 编辑已审核通过或已驳回的商品需重新进入审核队列；PENDING 状态编辑不计次
      const needReAudit =
        product.auditStatus === 'APPROVED' || product.auditStatus === 'REJECTED';
      const bundleState = this.isBundleType(productType) && dto.bundleItems !== undefined
        ? await this.buildBundleState(tx, companyId, dto.bundleItems, { requireItems: true })
        : null;

      const result = await tx.product.update({
        where: { id: productId },
        data: {
          title: dto.title,
          subtitle: dto.subtitle,
          description: dto.description,
          basePrice: dto.basePrice,
          categoryId: dto.categoryId,
          // 计量单位：DTO 提供则更新，否则保持原值（undefined 不写）
          ...(dto.unit !== undefined && { unit: dto.unit }),
          returnPolicy: dto.returnPolicy as any,
          origin: dto.origin as any,
          attributes: dto.attributes,
          aiKeywords: dto.aiKeywords,
          flavorTags: dto.flavorTags ?? undefined,
          seasonalMonths: dto.seasonalMonths ?? undefined,
          usageScenarios: dto.usageScenarios ?? undefined,
          dietaryTags: dto.dietaryTags ?? undefined,
          originRegion: dto.originRegion,
          ...(dto.productType !== undefined && { type: productType }),
          // 重新进入审核：状态回 PENDING、清空上轮驳回备注、提交次数 +1
          ...(needReAudit && {
            auditStatus: 'PENDING',
            auditNote: null,
            submissionCount: { increment: 1 },
          }),
        },
        include: { skus: { where: { status: 'ACTIVE' } }, media: true, tags: { include: { tag: true } }, bundleItems: true },
      });

      if (this.isBundleType(productType) && dto.bundleItems !== undefined) {
        await tx.productBundleItem.deleteMany({ where: { bundleProductId: productId } });
        if (bundleState) {
          await tx.productBundleItem.createMany({
            data: this.bundleItemsCreateData(bundleState.validatedItems).map((item) => ({
              ...item,
              bundleProductId: productId,
            })),
          });
        }
        await tx.productSKU.updateMany({
          where: { productId, status: 'ACTIVE' },
          data: { weightGram: bundleState?.bundleTotalWeightGram ?? 0 },
        });
      }

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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // 事务提交后异步触发 AI 语义填充（fire-and-forget）
    this.semanticFillService.fillProduct(productId).catch((err: Error) => {
      this.logger.warn(`Async semantic fill failed: ${err.message}`);
    });

    return this.loadSellerProduct(this.prisma, updated.id);
  }

  /** 上架/下架 */
  async toggleStatus(companyId: string, productId: string, status: 'ACTIVE' | 'INACTIVE') {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          companyId: true,
          status: true,
          auditStatus: true,
          type: true,
        },
      });
      if (!product) throw new NotFoundException('商品不存在');
      if (product.companyId !== companyId) throw new ForbiddenException('无权操作该商品');
      if (product.status === 'DRAFT') {
        throw new BadRequestException('草稿商品需先提交审核后才能上下架');
      }

      // 上架需审核通过
      if (status === 'ACTIVE') {
        if (product.auditStatus !== 'APPROVED') {
          throw new BadRequestException('商品未通过审核，无法上架');
        }
        if (this.isBundleType(product.type)) {
          await this.buildPersistedBundleState(tx as any, companyId, productId);
        }
      }

      return tx.product.update({
        where: { id: productId },
        data: { status },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** 硬删除商品（要求已下架 + 无订单/购物车引用） */
  async remove(companyId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { skus: { select: { id: true } } },
    });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== companyId) throw new ForbiddenException('无权操作该商品');
    // 草稿可直接删除；其他状态必须先下架
    if (product.status !== 'INACTIVE' && product.status !== 'DRAFT') {
      throw new BadRequestException('请先下架商品后再删除');
    }

    const skuIds = product.skus.map((s) => s.id);

    // 预检查 FK 引用，避免违反外键后裸 500
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
            { productId },
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
      // ProductTraceLink 无 Cascade，手动清理
      await tx.productTraceLink.deleteMany({ where: { productId } });
      // Product 删除时 SKU/Media/Tag 会自动 Cascade
      await tx.product.delete({ where: { id: productId } });
    });

    return { ok: true };
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

    // SKU 变更同样触发重新审核（APPROVED/REJECTED 状态下）
    const needReAudit =
      product.auditStatus === 'APPROVED' || product.auditStatus === 'REJECTED';
    const isBundleProduct = this.isBundleType(product.type);

    if (!isBundleProduct) {
      this.assertPositiveSkuWeights(skus);
    }

    // 自动定价：售价 = 成本 × markupRate
    // markupRate 在事务内读取，防止 TOCTOU 竞态（读取后被管理员修改导致定价不一致）
    return this.prisma.$transaction(async (tx) => {
      const sysConfig = await this.bonusConfig.getSystemConfig();
      const markupRate = sysConfig.markupRate;

      if (isBundleProduct) {
        if (skus.length !== 1) {
          throw new BadRequestException('组合商品必须且只能保留一个销售规格');
        }

        const bundleState = await this.buildPersistedBundleState(tx as any, companyId, productId);
        const existingSkus = await tx.productSKU.findMany({ where: { productId } });
        const existingIds = new Set(existingSkus.map((s) => s.id));
        const activeSkus = existingSkus.filter((sku) => sku.status === SkuStatus.ACTIVE);
        const sellingSku = skus[0];
        const bundleCost = sellingSku.cost;
        const bundlePrice = +(bundleCost * markupRate).toFixed(2);
        const targetExistingSku = sellingSku.id && existingIds.has(sellingSku.id)
          ? existingSkus.find((sku) => sku.id === sellingSku.id)
          : activeSkus[0];

        const normalizedSkuData = {
          title: sellingSku.specName || BUNDLE_DEFAULT_SPEC_NAME,
          price: bundlePrice,
          cost: bundleCost,
          stock: 0,
          weightGram: bundleState!.bundleTotalWeightGram,
          maxPerOrder: sellingSku.maxPerOrder ?? null,
          status: SkuStatus.ACTIVE,
        };

        let keepActiveSkuId: string;
        if (targetExistingSku) {
          await tx.productSKU.update({
            where: { id: targetExistingSku.id },
            data: normalizedSkuData,
          });
          keepActiveSkuId = targetExistingSku.id;
        } else {
          const created = await tx.productSKU.create({
            data: {
              productId,
              ...normalizedSkuData,
            },
          });
          keepActiveSkuId = created.id;
        }

        const extraActiveSkuIds = activeSkus
          .filter((sku) => sku.id !== keepActiveSkuId)
          .map((sku) => sku.id);
        if (extraActiveSkuIds.length > 0) {
          await tx.productSKU.updateMany({
            where: { id: { in: extraActiveSkuIds } },
            data: { status: SkuStatus.INACTIVE },
          });
        }

        const productUpdateData: Prisma.ProductUncheckedUpdateInput = {
          basePrice: bundlePrice,
          cost: bundleCost,
        };
        if (needReAudit) {
          productUpdateData.auditStatus = 'PENDING';
          productUpdateData.auditNote = null;
          productUpdateData.submissionCount = { increment: 1 };
        }
        await tx.product.update({
          where: { id: productId },
          data: productUpdateData,
        });

        return tx.productSKU.findMany({
          where: { productId, status: SkuStatus.ACTIVE },
        });
      }

      // 获取现有 SKU
      const existingSkus = await tx.productSKU.findMany({ where: { productId } });
      const existingIds = new Set(existingSkus.map((s) => s.id));

      // 更新或创建
      const newSkuIds = new Set<string>();
      for (const sku of skus) {
        const weightGram = sku.weightGram!;
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
              weightGram,
              maxPerOrder: sku.maxPerOrder ?? null,
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
              weightGram,
              maxPerOrder: sku.maxPerOrder ?? null,
            },
          });
          newSkuIds.add(created.id);
        }
      }

      // 更新商品基准价为最低 SKU 售价 + 触发重新审核（如需）
      const allActiveSkus = await tx.productSKU.findMany({
        where: { productId, status: 'ACTIVE' },
        select: { price: true },
      });
      const productUpdateData: Prisma.ProductUncheckedUpdateInput = {};
      if (allActiveSkus.length > 0) {
        productUpdateData.basePrice = Math.min(...allActiveSkus.map((s) => s.price));
      }
      if (needReAudit) {
        productUpdateData.auditStatus = 'PENDING';
        productUpdateData.auditNote = null;
        productUpdateData.submissionCount = { increment: 1 };
      }
      if (Object.keys(productUpdateData).length > 0) {
        await tx.product.update({
          where: { id: productId },
          data: productUpdateData,
        });
      }

      // 删除不再需要的 SKU（注意：有关联 OrderItem 的不能删除）
      const toDelete = [...existingIds].filter((id) => !newSkuIds.has(id));
      if (toDelete.length > 0) {
        if (!this.isBundleType(product.type)) {
          const bundleReference = await tx.productBundleItem.findFirst({
            where: {
              skuId: { in: toDelete },
              bundleProduct: {
                status: { not: 'DRAFT' },
              },
            },
            select: { id: true },
          });
          if (bundleReference) {
            throw new BadRequestException(BUNDLE_SKU_REMOVE_MESSAGE);
          }
        }
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

  // ============================================================
  // 草稿相关
  // ============================================================

  /**
   * 创建草稿
   * 事务内统计并校验商户草稿数量上限，防止并发写入越限。
   */
  async createDraft(companyId: string, dto: CreateDraftDto) {
    const productType = (dto.productType ?? ProductType.SIMPLE) as ProductType;
    return this.prisma.$transaction(
      async (tx) => {
        const draftCount = await tx.product.count({
          where: { companyId, status: 'DRAFT' },
        });
        if (draftCount >= DRAFT_LIMIT_PER_COMPANY) {
          throw new ConflictException(
            `草稿数量已达上限（${DRAFT_LIMIT_PER_COMPANY} 份），请先清理后再保存`,
          );
        }

        const product = await tx.product.create({
          data: {
            companyId,
            title: dto.title,
            type: productType,
            subtitle: dto.subtitle,
            description: dto.description,
            basePrice: 0, // 草稿占位，提交审核时按成本重新计算
            cost: null,
            categoryId: dto.categoryId,
            returnPolicy: (dto.returnPolicy ?? 'INHERIT') as ReturnPolicy,
            origin: (dto.origin as any) ?? undefined,
            attributes: dto.attributes ?? undefined,
            aiKeywords: dto.aiKeywords ?? [],
            flavorTags: dto.flavorTags ?? [],
            seasonalMonths: dto.seasonalMonths ?? [],
            usageScenarios: dto.usageScenarios ?? [],
            dietaryTags: dto.dietaryTags ?? [],
            originRegion: dto.originRegion,
            status: 'DRAFT',
            auditStatus: 'PENDING',
            submissionCount: 0, // 草稿尚未提交过审核
            skus:
              dto.skus && dto.skus.length > 0
                ? {
                    create: dto.skus.map((s) => ({
                      title: s.specName ?? '默认规格',
                      price: 0, // 草稿占位
                      cost: s.cost ?? 0,
                      stock: s.stock ?? 0,
                      skuCode: this.draftSkuCodeForWeight(s.weightGram),
                      weightGram: this.normalizeDraftWeightGram(s.weightGram),
                      maxPerOrder: s.maxPerOrder ?? null,
                    })),
                  }
                : undefined,
            bundleItems: this.isBundleType(productType) && dto.bundleItems && dto.bundleItems.length > 0
              ? {
                  create: this.bundleItemsCreateData(
                    (await this.buildBundleState(tx, companyId, dto.bundleItems, { allowDraft: true }))
                      ?.validatedItems ?? [],
                  ),
                }
              : undefined,
            media:
              dto.mediaUrls && dto.mediaUrls.length > 0
                ? {
                    create: dto.mediaUrls.map((url, i) => ({
                      type: 'IMAGE' as const,
                      url,
                      sortOrder: i,
                    })),
                  }
                : undefined,
          },
          include: { skus: true, media: true, bundleItems: true },
        });

        let tagsCreated = false;
        if (dto.tagIds && dto.tagIds.length > 0) {
          const tags = await tx.tag.findMany({
            where: { id: { in: dto.tagIds }, isActive: true },
            include: { category: { select: { scope: true } } },
          });
          const validTagIds = tags
            .filter((t) => t.category.scope === 'PRODUCT')
            .map((t) => t.id);
          if (validTagIds.length > 0) {
            await tx.productTag.createMany({
              data: validTagIds.map((tagId) => ({ productId: product.id, tagId })),
              skipDuplicates: true,
            });
            tagsCreated = true;
          }
        }

        // tags 关系是在 product.create 之后才创建的，原 product 对象不含 tags。
        // 若有 tag 写入，重读一次返回完整对象——前端会把响应直接塞进 React Query
        // cache 用于后续水合，缺 tags 会导致下次保存把已选标签覆盖为空数组。
        if (tagsCreated) {
          return this.loadSellerProduct(tx, product.id);
        }
        return this.decorateProductForSeller({ ...product, tags: [] as Array<unknown> });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * 更新草稿（仅允许 status=DRAFT 的商品）
   * 全量覆盖写：skus 和 media 传了就整体替换，tagIds 传了就整体替换。
   */
  async updateDraft(companyId: string, productId: string, dto: UpdateDraftDto) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!product) throw new NotFoundException('商品不存在');
      if (product.companyId !== companyId)
        throw new ForbiddenException('无权操作该商品');
      if (product.status !== 'DRAFT')
        throw new BadRequestException('该商品非草稿状态，不能用此接口更新');
      this.assertNoTypeConversion(product.type, dto.productType);
      const productType = (dto.productType ?? product.type ?? ProductType.SIMPLE) as ProductType;

      // 全量覆盖：dto 里出现的字段一律落库（含 null / 空数组）；只有 undefined 才视为"未触达"
      // Prisma 对 Json? 字段直接传 null 会写入 DB null，符合"清空"语义
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {};
      if (dto.title !== undefined) updateData.title = dto.title;
      if (dto.subtitle !== undefined) updateData.subtitle = dto.subtitle;
      if (dto.description !== undefined) updateData.description = dto.description;
      if (dto.categoryId !== undefined) updateData.categoryId = dto.categoryId;
      if (dto.returnPolicy !== undefined) updateData.returnPolicy = dto.returnPolicy as ReturnPolicy;
      if (dto.origin !== undefined) updateData.origin = dto.origin === null ? Prisma.JsonNull : dto.origin;
      if (dto.attributes !== undefined) updateData.attributes = dto.attributes === null ? Prisma.JsonNull : dto.attributes;
      if (dto.aiKeywords !== undefined) updateData.aiKeywords = dto.aiKeywords;
      if (dto.flavorTags !== undefined) updateData.flavorTags = dto.flavorTags;
      if (dto.seasonalMonths !== undefined) updateData.seasonalMonths = dto.seasonalMonths;
      if (dto.usageScenarios !== undefined) updateData.usageScenarios = dto.usageScenarios;
      if (dto.dietaryTags !== undefined) updateData.dietaryTags = dto.dietaryTags;
      if (dto.originRegion !== undefined) updateData.originRegion = dto.originRegion;
      if (dto.productType !== undefined) updateData.type = productType;
      if (Object.keys(updateData).length > 0) {
        await tx.product.update({ where: { id: productId }, data: updateData });
      }

      // skus 全量替换
      if (dto.skus !== undefined) {
        await tx.productSKU.deleteMany({ where: { productId } });
        if (dto.skus.length > 0) {
          await tx.productSKU.createMany({
            data: dto.skus.map((s) => ({
              productId,
              title: s.specName ?? '默认规格',
              price: 0,
              cost: s.cost ?? 0,
              stock: s.stock ?? 0,
              skuCode: this.draftSkuCodeForWeight(s.weightGram),
              weightGram: this.normalizeDraftWeightGram(s.weightGram),
              maxPerOrder: s.maxPerOrder ?? null,
            })),
          });
        }
      }

      if (this.isBundleType(productType) && dto.bundleItems !== undefined) {
        await tx.productBundleItem.deleteMany({ where: { bundleProductId: productId } });
        const bundleState = await this.buildBundleState(tx, companyId, dto.bundleItems, {
          allowDraft: true,
        });
        if (bundleState) {
          await tx.productBundleItem.createMany({
            data: this.bundleItemsCreateData(bundleState.validatedItems).map((item) => ({
              ...item,
              bundleProductId: productId,
            })),
          });
        }
      }

      // media 全量替换
      if (dto.mediaUrls !== undefined) {
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

      // tags 全量替换
      if (dto.tagIds !== undefined) {
        await tx.productTag.deleteMany({ where: { productId } });
        if (dto.tagIds.length > 0) {
          const tags = await tx.tag.findMany({
            where: { id: { in: dto.tagIds }, isActive: true },
            include: { category: { select: { scope: true } } },
          });
          const validTagIds = tags
            .filter((t) => t.category.scope === 'PRODUCT')
            .map((t) => t.id);
          if (validTagIds.length > 0) {
            await tx.productTag.createMany({
              data: validTagIds.map((tagId) => ({ productId, tagId })),
              skipDuplicates: true,
            });
          }
        }
      }

      return this.loadSellerProduct(tx, productId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * 草稿提交审核
   * 把草稿当前内容组装成 CreateProductDto 形状 → 手动跑完整校验 → DRAFT 转 INACTIVE + PENDING。
   */
  async submitDraft(companyId: string, productId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: productId },
          include: {
            skus: true,
            media: { orderBy: { sortOrder: 'asc' } },
            tags: true,
            bundleItems: { orderBy: { sortOrder: 'asc' } },
          },
        });
        if (!product) throw new NotFoundException('商品不存在');
        if (product.companyId !== companyId)
          throw new ForbiddenException('无权操作该商品');
        if (product.status !== 'DRAFT')
          throw new BadRequestException('该商品非草稿状态，不能提交');

        const isBundleProduct = this.isBundleType(product.type);
        const bundleState = isBundleProduct
          ? await this.buildBundleState(
              tx,
              companyId,
              product.bundleItems.map((item) => ({
                skuId: item.skuId,
                quantity: item.quantity,
                sortOrder: item.sortOrder,
              })),
              { requireItems: true },
            )
          : null;

        if (!isBundleProduct) {
          const missingWeightSkuIndex = product.skus.findIndex(
            (sku) => this.isDraftWeightPlaceholderSkuCode(sku.skuCode),
          );
          if (missingWeightSkuIndex >= 0) {
            throw new BadRequestException({
              message: '提交前请补全以下字段：规格(包装后重量（克）)',
              fieldErrors: [{
                field: `skus.${missingWeightSkuIndex}.weightGram`,
                message: '包装后重量（克）必须填写且大于 0',
              }],
            });
          }
        }

        const bundleSeedSku = product.skus[0];

        // 组装 CreateProductDto 形状跑全量校验
        const candidate = {
          title: product.title,
          subtitle: product.subtitle ?? undefined,
          description: product.description ?? '',
          categoryId: product.categoryId ?? '',
          returnPolicy: product.returnPolicy,
          origin: product.origin ?? undefined,
          tagIds: product.tags.map((t) => t.tagId),
          productType: product.type,
          skus: isBundleProduct
            ? (bundleSeedSku
                ? [{
                    specName: bundleSeedSku.title || BUNDLE_DEFAULT_SPEC_NAME,
                    cost: bundleSeedSku.cost ?? 0,
                    stock: 0,
                    maxPerOrder: bundleSeedSku.maxPerOrder ?? undefined,
                    weightGram: bundleState?.bundleTotalWeightGram ?? 0,
                  }]
                : [])
            : product.skus.map((s) => ({
                specName: s.title,
                cost: s.cost ?? 0,
                stock: s.stock,
                maxPerOrder: s.maxPerOrder ?? undefined,
                weightGram: s.weightGram,
              })),
          bundleItems: isBundleProduct
            ? product.bundleItems.map((item) => ({
                skuId: item.skuId,
                quantity: item.quantity,
                sortOrder: item.sortOrder,
              }))
            : undefined,
          attributes: product.attributes ?? undefined,
          aiKeywords: product.aiKeywords,
          mediaUrls: product.media.map((m) => m.url),
          flavorTags: product.flavorTags,
          seasonalMonths: product.seasonalMonths,
          usageScenarios: product.usageScenarios,
          dietaryTags: product.dietaryTags,
          originRegion: product.originRegion ?? undefined,
        };

        const dtoInstance = plainToInstance(CreateProductDto, candidate);
        const errors = await validate(dtoInstance, { whitelist: false });
        if (errors.length > 0) {
          // 字段标签：用于 message 拼接 + 前端 fallback 显示
          const FIELD_LABELS: Record<string, string> = {
            title: '商品标题',
            description: '商品描述',
            categoryId: '商品分类',
            origin: '产地',
            skus: '规格',
            basePrice: '基准价',
            subtitle: '副标题',
            returnPolicy: '退货政策',
          };

          // 展平 class-validator 嵌套错误为 { field, message } 列表
          const flatten = (
            nodes: typeof errors,
            prefix = '',
          ): Array<{ field: string; message: string }> => {
            const out: Array<{ field: string; message: string }> = [];
            for (const node of nodes) {
              const path = prefix ? `${prefix}.${node.property}` : node.property;
              const constraints = Object.values(node.constraints ?? {});
              for (const msg of constraints) {
                out.push({ field: path, message: String(msg) });
              }
              if (node.children && node.children.length > 0) {
                out.push(...flatten(node.children, path));
              }
            }
            return out;
          };
          const fieldErrors = flatten(errors);

          // 拼一条人类可读 message 作为兜底（前端没处理 fieldErrors 时 toast 用）
          const parts = errors.slice(0, 5).map((e) => {
            const label = FIELD_LABELS[e.property] || e.property;
            const msgs = Object.values(e.constraints ?? {});
            if (msgs.length > 0) return `${label}(${msgs[0]})`;
            const firstChildMsg = e.children?.[0]?.children?.[0]
              ? Object.values(e.children[0].children[0].constraints ?? {})[0]
              : e.children?.[0]
                ? Object.values(e.children[0].constraints ?? {})[0]
                : undefined;
            return firstChildMsg ? `${label}(${firstChildMsg})` : label;
          });
          const suffix = errors.length > 5 ? ` 等 ${errors.length} 项` : '';
          throw new BadRequestException({
            message: `提交前请补全以下字段：${parts.join('、')}${suffix}`,
            fieldErrors,
          });
        }

        const sysConfig = await this.bonusConfig.getSystemConfig();
        const markupRate = sysConfig.markupRate;

        let basePrice = 0;
        let minCost = 0;

        if (isBundleProduct) {
          const bundleCost = bundleSeedSku?.cost ?? 0;
          basePrice = +(bundleCost * markupRate).toFixed(2);
          minCost = bundleCost;

          await tx.productSKU.deleteMany({ where: { productId } });
          await tx.productSKU.create({
            data: {
              productId,
              title: bundleSeedSku?.title || BUNDLE_DEFAULT_SPEC_NAME,
              price: basePrice,
              cost: bundleCost,
              stock: 0,
              weightGram: bundleState?.bundleTotalWeightGram ?? 0,
              maxPerOrder: bundleSeedSku?.maxPerOrder ?? null,
            },
          });
        } else {
          // 更新每个 SKU 的 price = cost × markupRate
          for (const sku of product.skus) {
            const cost = sku.cost ?? 0;
            await tx.productSKU.update({
              where: { id: sku.id },
              data: { price: +(cost * markupRate).toFixed(2) },
            });
          }
          minCost = Math.min(...product.skus.map((s) => s.cost ?? 0));
          basePrice = +(minCost * markupRate).toFixed(2);
        }

        await tx.product.update({
          where: { id: productId },
          data: {
            status: 'INACTIVE',
            auditStatus: 'PENDING',
            submissionCount: 1,
            basePrice,
            cost: minCost,
          },
        });
        return this.loadSellerProduct(tx, productId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
