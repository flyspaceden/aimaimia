import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PLATFORM_COMPANY_ID } from '../../bonus/engine/constants';
import {
  CreateRewardProductDto,
  UpdateRewardProductDto,
  CreateRewardProductSkuForUpdateDto,
  UpdateRewardProductSkuDto,
} from './reward-product.dto';

type RewardProductReferenceClient = Pick<
  PrismaService,
  'vipGiftItem' | 'lotteryPrize' | 'groupBuyActivity' | 'groupBuyActivityItem'
>;

@Injectable()
export class RewardProductService {
  constructor(private prisma: PrismaService) {}

  private readonly serializableTransactionOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  };

  private resolveSkuWeightGram(weightGram?: number | null): number {
    if (typeof weightGram !== 'number' || !Number.isInteger(weightGram) || weightGram <= 0) {
      throw new BadRequestException('SKU 重量必须为正整数克');
    }
    return weightGram;
  }

  private async buildReferenceSummaryMap(
    products: Array<{ id: string; skus: Array<{ id: string }> }>,
  ) {
    const productIds = products.map((product) => product.id);
    const skuIds = products.flatMap((product) => product.skus.map((sku) => sku.id));

    const [
      vipGiftItems,
      lotteryPrizes,
      groupBuyActivities,
      groupBuyActivityItems,
    ] = await Promise.all([
      skuIds.length > 0
        ? this.prisma.vipGiftItem.findMany({
            where: {
              skuId: { in: skuIds },
              giftOption: { status: 'ACTIVE' },
            },
            select: { skuId: true },
          })
        : Promise.resolve([]),
      productIds.length > 0 || skuIds.length > 0
        ? this.prisma.lotteryPrize.findMany({
            where: {
              isActive: true,
              OR: [
                ...(productIds.length > 0 ? [{ productId: { in: productIds } }] : []),
                ...(skuIds.length > 0 ? [{ skuId: { in: skuIds } }] : []),
              ],
            },
            select: { id: true, productId: true, skuId: true },
          })
        : Promise.resolve([]),
      productIds.length > 0 || skuIds.length > 0
        ? this.prisma.groupBuyActivity.findMany({
            where: {
              deletedAt: null,
              status: { in: ['ACTIVE', 'PAUSED'] },
              OR: [
                ...(productIds.length > 0 ? [{ productId: { in: productIds } }] : []),
                ...(skuIds.length > 0 ? [{ skuId: { in: skuIds } }] : []),
              ],
            },
            select: { id: true, productId: true, skuId: true },
          })
        : Promise.resolve([]),
      productIds.length > 0 || skuIds.length > 0
        ? this.prisma.groupBuyActivityItem.findMany({
            where: {
              activity: {
                deletedAt: null,
                status: { in: ['ACTIVE', 'PAUSED'] },
              },
              OR: [
                ...(productIds.length > 0 ? [{ productId: { in: productIds } }] : []),
                ...(skuIds.length > 0 ? [{ skuId: { in: skuIds } }] : []),
              ],
            },
            select: { activityId: true, productId: true, skuId: true },
          })
        : Promise.resolve([]),
    ]);

    const vipBySkuId = new Map<string, number>();
    for (const item of vipGiftItems) {
      vipBySkuId.set(item.skuId, (vipBySkuId.get(item.skuId) || 0) + 1);
    }

    const lotteryBySkuId = new Map<string, Set<string>>();
    const lotteryByProductId = new Map<string, Set<string>>();
    for (const item of lotteryPrizes) {
      if (item.skuId) {
        if (!lotteryBySkuId.has(item.skuId)) lotteryBySkuId.set(item.skuId, new Set());
        lotteryBySkuId.get(item.skuId)!.add(item.id);
      }
      if (item.productId) {
        if (!lotteryByProductId.has(item.productId)) {
          lotteryByProductId.set(item.productId, new Set());
        }
        lotteryByProductId.get(item.productId)!.add(item.id);
      }
    }

    const productIdBySkuId = new Map<string, string>();
    for (const product of products) {
      for (const sku of product.skus) {
        productIdBySkuId.set(sku.id, product.id);
      }
    }

    const groupBuyByProductId = new Map<string, Set<string>>();
    for (const activity of groupBuyActivities) {
      const targetProductIds = new Set<string>();
      if (activity.productId) {
        targetProductIds.add(activity.productId);
      }
      if (activity.skuId && productIdBySkuId.has(activity.skuId)) {
        targetProductIds.add(productIdBySkuId.get(activity.skuId)!);
      }
      for (const targetProductId of targetProductIds) {
        if (!groupBuyByProductId.has(targetProductId)) {
          groupBuyByProductId.set(targetProductId, new Set());
        }
        groupBuyByProductId.get(targetProductId)!.add(activity.id);
      }
    }
    for (const item of groupBuyActivityItems) {
      const targetProductIds = new Set<string>();
      if (item.productId) {
        targetProductIds.add(item.productId);
      }
      if (item.skuId && productIdBySkuId.has(item.skuId)) {
        targetProductIds.add(productIdBySkuId.get(item.skuId)!);
      }
      for (const targetProductId of targetProductIds) {
        if (!groupBuyByProductId.has(targetProductId)) {
          groupBuyByProductId.set(targetProductId, new Set());
        }
        groupBuyByProductId.get(targetProductId)!.add(item.activityId);
      }
    }

    return new Map(
      products.map((product) => {
        const vipGiftOptionCount = product.skus.reduce(
          (sum, sku) => sum + (vipBySkuId.get(sku.id) || 0),
          0,
        );
        const lotteryIds = new Set<string>(lotteryByProductId.get(product.id) || []);
        for (const sku of product.skus) {
          for (const lotteryId of lotteryBySkuId.get(sku.id) || []) {
            lotteryIds.add(lotteryId);
          }
        }
        const lotteryPrizeCount = lotteryIds.size;
        const groupBuyActivityCount = groupBuyByProductId.get(product.id)?.size ?? 0;

        return [
          product.id,
          {
            vipGiftOptionCount,
            lotteryPrizeCount,
            groupBuyActivityCount,
            totalReferences: vipGiftOptionCount + lotteryPrizeCount + groupBuyActivityCount,
          },
        ];
      }),
    );
  }

  private async assertProductNotReferenced(
    productId: string,
    skuIds: string[],
    action: string,
    client: RewardProductReferenceClient = this.prisma,
  ) {
    const [
      vipGiftItems,
      lotteryPrizes,
      groupBuyActivities,
      groupBuyActivityItems,
    ]: [
      Array<{ id: string; giftOption: { title: string } }>,
      Array<{ id: string; name: string }>,
      Array<{ id: string; title: string }>,
      Array<{ activity: { id: string; title: string } }>,
    ] = await Promise.all([
      skuIds.length > 0
        ? client.vipGiftItem.findMany({
            where: {
              skuId: { in: skuIds },
              giftOption: { status: 'ACTIVE' },
            },
            select: { id: true, giftOption: { select: { title: true } } },
            take: 5,
          })
        : Promise.resolve([]),
      client.lotteryPrize.findMany({
        where: {
          isActive: true,
          OR: [
            { productId },
            ...(skuIds.length > 0 ? [{ skuId: { in: skuIds } }] : []),
          ],
        },
        select: { id: true, name: true },
        take: 5,
      }),
      client.groupBuyActivity.findMany({
        where: {
          deletedAt: null,
          status: { in: ['ACTIVE', 'PAUSED'] },
          OR: [
            { productId },
            ...(skuIds.length > 0 ? [{ skuId: { in: skuIds } }] : []),
          ],
        },
        select: { id: true, title: true },
        take: 5,
      }),
      client.groupBuyActivityItem.findMany({
        where: {
          activity: {
            deletedAt: null,
            status: { in: ['ACTIVE', 'PAUSED'] },
          },
          OR: [
            { productId },
            ...(skuIds.length > 0 ? [{ skuId: { in: skuIds } }] : []),
          ],
        },
        select: { activity: { select: { id: true, title: true } } },
        take: 5,
      }),
    ]);

    const groupBuyById = new Map<string, { id: string; title: string }>();
    for (const activity of groupBuyActivities) {
      groupBuyById.set(activity.id, activity);
    }
    for (const item of groupBuyActivityItems) {
      groupBuyById.set(item.activity.id, item.activity);
    }
    const referencedGroupBuyActivities = Array.from(groupBuyById.values());

    if (
      vipGiftItems.length === 0
      && lotteryPrizes.length === 0
      && referencedGroupBuyActivities.length === 0
    ) {
      return;
    }

    const vipSummary = vipGiftItems.map((item) => item.giftOption.title).join('、');
    const lotterySummary = lotteryPrizes.map((item) => item.name).join('、');
    const groupBuySummary = referencedGroupBuyActivities.map((item) => item.title).join('、');
    const details = [
      vipGiftItems.length > 0 ? `VIP赠品：${vipSummary}` : null,
      lotteryPrizes.length > 0 ? `抽奖奖品：${lotterySummary}` : null,
      referencedGroupBuyActivities.length > 0 ? `团购活动：${groupBuySummary}` : null,
    ]
      .filter(Boolean)
      .join('；');

    throw new BadRequestException(
      `该奖励商品/SKU 已被活动引用，无法${action}。请先下架相关配置后重试。${details ? `（${details}）` : ''}`,
    );
  }

  /** 奖励商品列表 */
  async findAll(page = 1, pageSize = 20, keyword?: string, status?: string) {
    const skip = (page - 1) * pageSize;
    const where: any = { companyId: PLATFORM_COMPANY_ID };

    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { id: keyword },
      ];
    }
    // 奖励商品由管理员创建，理论上不应出现 DRAFT；硬排除防御异常数据 + caller 越权
    if (status && status !== 'DRAFT') {
      where.status = status;
    } else {
      where.status = { not: 'DRAFT' };
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          skus: { select: { id: true, title: true, price: true, cost: true, stock: true } },
          media: { select: { id: true, url: true, type: true, sortOrder: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    const referenceSummaryMap = await this.buildReferenceSummaryMap(items);

    return {
      items: items.map((item) => ({
        ...item,
        referenceSummary: referenceSummaryMap.get(item.id) ?? {
          vipGiftOptionCount: 0,
          lotteryPrizeCount: 0,
          groupBuyActivityCount: 0,
          totalReferences: 0,
        },
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 奖励商品详情 */
  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        skus: {
          select: {
            id: true,
            title: true,
            price: true,
            cost: true,
            stock: true,
            skuCode: true,
            weightGram: true,
            status: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        media: { select: { id: true, url: true, type: true, sortOrder: true } },
      },
    });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== PLATFORM_COMPANY_ID) {
      throw new BadRequestException('只能查看奖励商品');
    }
    const referenceSummaryMap = await this.buildReferenceSummaryMap([product]);
    return {
      ...product,
      referenceSummary: referenceSummaryMap.get(product.id) ?? {
        vipGiftOptionCount: 0,
        lotteryPrizeCount: 0,
        groupBuyActivityCount: 0,
        totalReferences: 0,
      },
    };
  }

  /** 创建奖励商品 */
  async create(dto: CreateRewardProductDto) {
    // 校验：cost 不能超过 price
    if (dto.cost !== undefined && dto.cost > dto.basePrice) {
      throw new BadRequestException('成本价不能超过售价');
    }
    for (const sku of dto.skus) {
      if (sku.cost !== undefined && sku.cost > sku.price) {
        throw new BadRequestException(`SKU "${sku.title}" 成本价不能超过售价`);
      }
      this.resolveSkuWeightGram(sku.weightGram);
    }

    return this.prisma.$transaction(
      (tx) => tx.product.create({
        data: {
          companyId: PLATFORM_COMPANY_ID,
          title: dto.title,
          subtitle: dto.subtitle,
          description: dto.description,
          detailRich: dto.detailRich,
          categoryId: dto.categoryId,
          basePrice: dto.basePrice,
          cost: dto.cost,
          origin: dto.origin,
          attributes: dto.attributes,
          status: 'ACTIVE',       // 奖励商品免审核，直接上架
          auditStatus: 'APPROVED', // 免审核
          skus: {
            create: dto.skus.map((sku) => ({
              title: sku.title,
              price: sku.price,
              cost: sku.cost,
              stock: sku.stock,
              skuCode: sku.skuCode,
              weightGram: this.resolveSkuWeightGram(sku.weightGram),
            })),
          },
          media: dto.media
            ? {
                create: dto.media.map((m) => ({
                  type: m.type as any,
                  url: m.url,
                  sortOrder: m.sortOrder ?? 0,
                  alt: m.alt,
                })),
              }
            : undefined,
        },
        include: {
          skus: true,
          media: true,
        },
      }),
      this.serializableTransactionOptions,
    );
  }

  /** 更新奖励商品 */
  async update(
    id: string,
    dto: UpdateRewardProductDto,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({
          where: { id },
          include: { skus: { select: { id: true } } },
        });
        if (!product) throw new NotFoundException('商品不存在');
        if (product.companyId !== PLATFORM_COMPANY_ID) {
          throw new BadRequestException('只能编辑奖励商品');
        }

        // 校验成本价不超过售价（考虑部分更新情况）
        const effectiveCost = dto.cost ?? product.cost;
        const effectivePrice = dto.basePrice ?? product.basePrice;
        if (effectiveCost !== undefined && effectiveCost !== null && effectiveCost > effectivePrice) {
          throw new BadRequestException('成本价不能超过售价');
        }

        if (dto.status && dto.status !== 'ACTIVE' && dto.status !== product.status) {
          await this.assertProductNotReferenced(
            id,
            product.skus.map((sku) => sku.id),
            '下架',
            tx,
          );
        }

        return tx.product.update({
          where: { id },
          data: dto as any,
          include: {
            skus: true,
            media: true,
          },
        });
      },
      this.serializableTransactionOptions,
    );
  }

  /** 删除奖励商品（硬删除）
   *  Product / SKU / Media / Tag 已配置 Cascade，会自动级联；
   *  但订单、购物车、抽奖、VIP 赠品引用会违反外键约束，需先校验。
   */
  async remove(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { skus: { select: { id: true } } },
    });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== PLATFORM_COMPANY_ID) {
      throw new BadRequestException('只能操作奖励商品');
    }

    const skuIds = product.skus.map((sku) => sku.id);

    // 硬删除前检查所有会违反外键的引用（不区分 active/inactive）
    const [
      vipGiftItems,
      lotteryPrizes,
      groupBuyActivities,
      groupBuyActivityItems,
      orderItemCount,
      cartItemCount,
    ] = await Promise.all([
      skuIds.length > 0
        ? this.prisma.vipGiftItem.findMany({
            where: { skuId: { in: skuIds } },
            select: { giftOption: { select: { title: true } } },
            take: 5,
          })
        : Promise.resolve([]),
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
      this.prisma.groupBuyActivity.findMany({
        where: {
          deletedAt: null,
          OR: [
            { productId: id },
            ...(skuIds.length > 0 ? [{ skuId: { in: skuIds } }] : []),
          ],
        },
        select: { id: true, title: true },
        take: 5,
      }),
      this.prisma.groupBuyActivityItem.findMany({
        where: {
          activity: { deletedAt: null },
          OR: [
            { productId: id },
            ...(skuIds.length > 0 ? [{ skuId: { in: skuIds } }] : []),
          ],
        },
        select: { activity: { select: { id: true, title: true } } },
        take: 5,
      }),
      skuIds.length > 0
        ? this.prisma.orderItem.count({ where: { skuId: { in: skuIds } } })
        : Promise.resolve(0),
      skuIds.length > 0
        ? this.prisma.cartItem.count({ where: { skuId: { in: skuIds } } })
        : Promise.resolve(0),
    ]);

    const blockers: string[] = [];
    if (vipGiftItems.length > 0) {
      const summary = vipGiftItems.map((i) => i.giftOption.title).join('、');
      blockers.push(`VIP赠品：${summary}`);
    }
    if (lotteryPrizes.length > 0) {
      const summary = lotteryPrizes.map((i) => i.name).join('、');
      blockers.push(`抽奖奖品：${summary}`);
    }
    if (groupBuyActivities.length > 0 || groupBuyActivityItems.length > 0) {
      const titles = new Map<string, string>();
      for (const activity of groupBuyActivities) {
        titles.set(activity.id, activity.title);
      }
      for (const item of groupBuyActivityItems) {
        titles.set(item.activity.id, item.activity.title);
      }
      const summary = Array.from(titles.values()).join('、');
      blockers.push(`团购活动：${summary}`);
    }
    if (orderItemCount > 0) {
      blockers.push(`已有 ${orderItemCount} 条订单记录`);
    }
    if (cartItemCount > 0) {
      blockers.push(`${cartItemCount} 个用户购物车中`);
    }

    if (blockers.length > 0) {
      throw new BadRequestException(
        `无法删除：${blockers.join('；')}。请先清理相关引用后重试。`,
      );
    }

    await this.prisma.product.delete({ where: { id } });
    return { ok: true };
  }

  /** 新增 SKU */
  async addSku(productId: string, dto: CreateRewardProductSkuForUpdateDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product) throw new NotFoundException('商品不存在');
        if (product.companyId !== PLATFORM_COMPANY_ID) {
          throw new BadRequestException('只能操作奖励商品');
        }

        // 校验成本价不超过售价
        if (dto.cost !== undefined && dto.cost > dto.price) {
          throw new BadRequestException('SKU 成本价不能超过售价');
        }
        const weightGram = this.resolveSkuWeightGram(dto.weightGram);

        return tx.productSKU.create({
          data: {
            productId,
            title: dto.title,
            price: dto.price,
            cost: dto.cost ?? 0,
            stock: dto.stock,
            skuCode: dto.skuCode,
            weightGram,
          },
        });
      },
      this.serializableTransactionOptions,
    );
  }

  /** 更新单个 SKU */
  async updateSku(productId: string, skuId: string, dto: UpdateRewardProductSkuDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product) throw new NotFoundException('商品不存在');
        if (product.companyId !== PLATFORM_COMPANY_ID) {
          throw new BadRequestException('只能操作奖励商品');
        }

        const sku = await tx.productSKU.findUnique({ where: { id: skuId } });
        if (!sku) throw new NotFoundException('SKU 不存在');
        if (sku.productId !== productId) {
          throw new BadRequestException('SKU 不属于该商品');
        }

        // 校验成本价不超过售价（考虑部分更新）
        const effectiveCost = dto.cost ?? sku.cost;
        const effectivePrice = dto.price ?? sku.price;
        if (effectiveCost !== undefined && effectiveCost !== null && effectiveCost > effectivePrice) {
          throw new BadRequestException('SKU 成本价不能超过售价');
        }
        if (dto.weightGram !== undefined) {
          this.resolveSkuWeightGram(dto.weightGram);
        }

        return tx.productSKU.update({
          where: { id: skuId },
          data: {
            ...(dto.title !== undefined && { title: dto.title }),
            ...(dto.price !== undefined && { price: dto.price }),
            ...(dto.cost !== undefined && { cost: dto.cost }),
            ...(dto.stock !== undefined && { stock: dto.stock }),
            ...(dto.skuCode !== undefined && { skuCode: dto.skuCode }),
            ...(dto.weightGram !== undefined && { weightGram: dto.weightGram }),
          },
        });
      },
      this.serializableTransactionOptions,
    );
  }

  /** 删除 SKU */
  async deleteSku(productId: string, skuId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { skus: { select: { id: true } } },
    });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== PLATFORM_COMPANY_ID) {
      throw new BadRequestException('只能操作奖励商品');
    }

    const sku = product.skus.find((s) => s.id === skuId);
    if (!sku) throw new NotFoundException('SKU 不存在');

    // 至少保留一个 SKU
    if (product.skus.length <= 1) {
      throw new BadRequestException('至少保留一个 SKU');
    }

    await this.assertProductNotReferenced(productId, [skuId], '删除 SKU');

    await this.prisma.productSKU.delete({ where: { id: skuId } });
    return { ok: true };
  }
}
