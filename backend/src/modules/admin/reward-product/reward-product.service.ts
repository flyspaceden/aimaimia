import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PLATFORM_COMPANY_ID } from '../../bonus/engine/constants';
import {
  CreateRewardProductDto,
  UpdateRewardProductDto,
  CreateRewardProductSkuForUpdateDto,
  UpdateRewardProductSkuDto,
} from './reward-product.dto';

@Injectable()
export class RewardProductService {
  constructor(private prisma: PrismaService) {}

  private async buildReferenceSummaryMap(
    products: Array<{ id: string; skus: Array<{ id: string }> }>,
  ) {
    const productIds = products.map((product) => product.id);
    const skuIds = products.flatMap((product) => product.skus.map((sku) => sku.id));

    const [vipGiftItems, lotteryPrizes] = await Promise.all([
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

        return [
          product.id,
          {
            vipGiftOptionCount,
            lotteryPrizeCount,
            totalReferences: vipGiftOptionCount + lotteryPrizeCount,
          },
        ];
      }),
    );
  }

  private async assertProductNotReferenced(productId: string, skuIds: string[], action: string) {
    const [vipGiftItems, lotteryPrizes] = await Promise.all([
      skuIds.length > 0
        ? this.prisma.vipGiftItem.findMany({
            where: {
              skuId: { in: skuIds },
              giftOption: { status: 'ACTIVE' },
            },
            select: { id: true, giftOption: { select: { title: true } } },
            take: 5,
          })
        : Promise.resolve([]),
      this.prisma.lotteryPrize.findMany({
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
    ]);

    if (vipGiftItems.length === 0 && lotteryPrizes.length === 0) {
      return;
    }

    const vipSummary = vipGiftItems.map((item) => item.giftOption.title).join('、');
    const lotterySummary = lotteryPrizes.map((item) => item.name).join('、');
    const details = [
      vipGiftItems.length > 0 ? `VIP赠品：${vipSummary}` : null,
      lotteryPrizes.length > 0 ? `抽奖奖品：${lotterySummary}` : null,
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
    if (status) {
      where.status = status;
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
    }

    return this.prisma.product.create({
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
            weightGram: sku.weightGram,
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
    });
  }

  /** 更新奖励商品 */
  async update(
    id: string,
    dto: UpdateRewardProductDto,
  ) {
    const product = await this.prisma.product.findUnique({
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
      );
    }

    return this.prisma.product.update({
      where: { id },
      data: dto as any,
      include: {
        skus: true,
        media: true,
      },
    });
  }

  /** 下架奖励商品（软删除） */
  async remove(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { skus: { select: { id: true } } },
    });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== PLATFORM_COMPANY_ID) {
      throw new BadRequestException('只能操作奖励商品');
    }

    await this.assertProductNotReferenced(
      id,
      product.skus.map((sku) => sku.id),
      '下架',
    );

    return this.prisma.product.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });
  }

  /** 新增 SKU */
  async addSku(productId: string, dto: CreateRewardProductSkuForUpdateDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== PLATFORM_COMPANY_ID) {
      throw new BadRequestException('只能操作奖励商品');
    }

    // 校验成本价不超过售价
    if (dto.cost !== undefined && dto.cost > dto.price) {
      throw new BadRequestException('SKU 成本价不能超过售价');
    }

    return this.prisma.productSKU.create({
      data: {
        productId,
        title: dto.title,
        price: dto.price,
        cost: dto.cost ?? 0,
        stock: dto.stock,
        skuCode: dto.skuCode,
        weightGram: dto.weightGram,
      },
    });
  }

  /** 更新单个 SKU */
  async updateSku(productId: string, skuId: string, dto: UpdateRewardProductSkuDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.companyId !== PLATFORM_COMPANY_ID) {
      throw new BadRequestException('只能操作奖励商品');
    }

    const sku = await this.prisma.productSKU.findUnique({ where: { id: skuId } });
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

    return this.prisma.productSKU.update({
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
