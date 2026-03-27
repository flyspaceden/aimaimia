import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PLATFORM_COMPANY_ID } from '../../bonus/engine/constants';
import {
  CreateVipGiftOptionDto,
  UpdateVipGiftOptionDto,
  UpdateVipGiftOptionStatusDto,
  BatchSortVipGiftDto,
  VipGiftItemDto,
} from './vip-gift.dto';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import { CoverMode } from '@prisma/client';

/** items include 子句：查询赠品方案时一并加载 items → sku → product */
const ITEMS_INCLUDE = {
  items: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      sku: {
        select: {
          id: true,
          title: true,
          price: true,
          cost: true,
          stock: true,
          status: true,
          product: {
            select: {
              id: true,
              title: true,
              companyId: true,
              status: true,
              media: {
                where: { type: 'IMAGE' as const },
                orderBy: { sortOrder: 'asc' as const },
                take: 1,
                select: { url: true },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** 计算一个赠品方案的 items 总价 */
function computeTotalPrice(items: Array<{ quantity: number; sku: { price: number } }>): number {
  return items.reduce((sum, item) => sum + item.sku.price * item.quantity, 0);
}

@Injectable()
export class VipGiftService {
  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
  ) {}

  /** 赠品方案列表（管理端） */
  async findAll(params: { page?: number; pageSize?: number; status?: string; packageId?: string }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (params.status) {
      where.status = params.status;
    }
    if (params.packageId) {
      where.packageId = params.packageId;
    }

    const [options, total] = await Promise.all([
      this.prisma.vipGiftOption.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        include: {
          ...ITEMS_INCLUDE,
          package: { select: { id: true, price: true } },
        },
      }),
      this.prisma.vipGiftOption.count({ where }),
    ]);

    // 获取当前 VIP 价格
    const vipConfig = await this.bonusConfig.getVipConfig();

    // 为每个方案计算总价
    const items = options.map((opt) => ({
      ...opt,
      totalPrice: computeTotalPrice(opt.items),
    }));

    return { items, total, page, pageSize, vipPrice: vipConfig.vipPrice };
  }

  /** 赠品方案详情 */
  async findOne(id: string) {
    const option = await this.prisma.vipGiftOption.findUnique({
      where: { id },
      include: ITEMS_INCLUDE,
    });
    if (!option) throw new NotFoundException('赠品方案不存在');

    return {
      ...option,
      totalPrice: computeTotalPrice(option.items),
    };
  }

  /** 创建赠品方案 */
  async create(dto: CreateVipGiftOptionDto) {
    // 校验 packageId 对应的 VipPackage 存在
    if (dto.packageId) {
      const pkg = await this.prisma.vipPackage.findUnique({ where: { id: dto.packageId } });
      if (!pkg) throw new BadRequestException('所选档位不存在');
    }

    // 校验 items 中无重复 skuId
    this.validateNoDuplicateSkus(dto.items);

    // 校验所有 SKU 属于平台奖励商品且处于上架状态
    await this.validateItemSkus(dto.items);

    // 校验 coverMode / coverUrl 一致性
    this.validateCoverConsistency(dto.coverMode, dto.coverUrl);

    const result = await this.prisma.$transaction(async (tx) => {
      const option = await tx.vipGiftOption.create({
        data: {
          packageId: dto.packageId,
          title: dto.title,
          subtitle: dto.subtitle,
          coverMode: dto.coverMode ?? 'AUTO_GRID',
          coverUrl: dto.coverMode === 'CUSTOM' ? dto.coverUrl : null,
          badge: dto.badge,
          sortOrder: dto.sortOrder ?? 0,
          status: dto.status ?? 'ACTIVE',
          items: {
            create: dto.items.map((item, idx) => ({
              skuId: item.skuId,
              quantity: item.quantity,
              sortOrder: item.sortOrder ?? idx,
            })),
          },
        },
        include: ITEMS_INCLUDE,
      });

      return option;
    });

    return {
      ...result,
      totalPrice: computeTotalPrice(result.items),
    };
  }

  /** 更新赠品方案 */
  async update(id: string, dto: UpdateVipGiftOptionDto) {
    const existing = await this.prisma.vipGiftOption.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('赠品方案不存在');

    // 如果提供了 packageId，校验对应档位存在
    if (dto.packageId !== undefined) {
      const pkg = await this.prisma.vipPackage.findUnique({ where: { id: dto.packageId } });
      if (!pkg) throw new BadRequestException('所选档位不存在');
    }

    // 如果提供了 items，校验无重复 skuId + SKU 合法性
    if (dto.items) {
      this.validateNoDuplicateSkus(dto.items);
      await this.validateItemSkus(dto.items);
    }

    // 确定最终 coverMode
    const finalCoverMode = dto.coverMode ?? existing.coverMode;

    // 校验 coverMode / coverUrl 一致性（仅在显式传入 coverMode 或 coverUrl 时校验）
    if (dto.coverMode !== undefined || dto.coverUrl !== undefined) {
      this.validateCoverConsistency(finalCoverMode, dto.coverUrl);
    }

    // 非 CUSTOM 模式清除 coverUrl
    const shouldClearCoverUrl = finalCoverMode !== 'CUSTOM';

    const result = await this.prisma.$transaction(async (tx) => {
      // 如果有新 items，先删旧的再创建新的
      if (dto.items) {
        await tx.vipGiftItem.deleteMany({ where: { giftOptionId: id } });
        await tx.vipGiftItem.createMany({
          data: dto.items.map((item, idx) => ({
            giftOptionId: id,
            skuId: item.skuId,
            quantity: item.quantity,
            sortOrder: item.sortOrder ?? idx,
          })),
        });
      }

      const option = await tx.vipGiftOption.update({
        where: { id },
        data: {
          ...(dto.packageId !== undefined && { packageId: dto.packageId }),
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
          ...(dto.coverMode !== undefined && { coverMode: dto.coverMode }),
          ...(dto.coverUrl !== undefined && !shouldClearCoverUrl && { coverUrl: dto.coverUrl }),
          ...(shouldClearCoverUrl && dto.coverMode !== undefined && { coverUrl: null }),
          ...(dto.badge !== undefined && { badge: dto.badge }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
          ...(dto.status !== undefined && { status: dto.status }),
        },
        include: ITEMS_INCLUDE,
      });

      return option;
    });

    return {
      ...result,
      totalPrice: computeTotalPrice(result.items),
    };
  }

  /** 更新赠品方案状态（上架/下架） */
  async updateStatus(id: string, dto: UpdateVipGiftOptionStatusDto) {
    const existing = await this.prisma.vipGiftOption.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('赠品方案不存在');

    return this.prisma.vipGiftOption.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  /** 获取奖励商品 SKU 列表（用于赠品方案选择器） */
  async getRewardProductSkus(productId?: string) {
    const where: any = {
      product: { companyId: PLATFORM_COMPANY_ID },
      status: 'ACTIVE',
    };
    if (productId) {
      where.productId = productId;
    }

    return this.prisma.productSKU.findMany({
      where,
      select: {
        id: true,
        title: true,
        price: true,
        cost: true,
        stock: true,
        product: {
          select: { id: true, title: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** 批量排序赠品方案 */
  async batchSort(dto: BatchSortVipGiftDto) {
    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.vipGiftOption.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
    return { ok: true };
  }

  /** 删除赠品方案（VipGiftItem 通过 onDelete: Cascade 自动删除） */
  async delete(id: string) {
    const existing = await this.prisma.vipGiftOption.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('赠品方案不存在');
    await this.prisma.vipGiftOption.delete({ where: { id } });
    return { ok: true };
  }

  /** 查询 SKU 被哪些活动配置引用（通过 VipGiftItem 关联表查询） */
  async getSkuReferences(skuId: string) {
    const [vipGiftItems, lotteryPrizes] = await Promise.all([
      this.prisma.vipGiftItem.findMany({
        where: { skuId },
        select: {
          id: true,
          quantity: true,
          giftOption: {
            select: { id: true, title: true, status: true },
          },
        },
      }),
      this.prisma.lotteryPrize.findMany({
        where: { skuId },
        select: { id: true, name: true },
      }),
    ]);

    // 提取去重的 giftOption 列表
    const optionMap = new Map<string, { id: string; title: string; status: string }>();
    for (const item of vipGiftItems) {
      if (!optionMap.has(item.giftOption.id)) {
        optionMap.set(item.giftOption.id, item.giftOption);
      }
    }
    const vipGiftOptions = Array.from(optionMap.values());

    return {
      vipGiftOptions,
      lotteryPrizes,
      totalReferences: vipGiftOptions.length + lotteryPrizes.length,
    };
  }

  // ──────────────────────────────────────
  //  私有辅助方法
  // ──────────────────────────────────────

  /** 校验 items 数组中无重复 skuId */
  private validateNoDuplicateSkus(items: VipGiftItemDto[]) {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.skuId)) {
        throw new BadRequestException(`赠品方案中存在重复的 SKU: ${item.skuId}`);
      }
      seen.add(item.skuId);
    }
  }

  /** 校验所有 items 中的 SKU 属于平台奖励商品且处于上架状态 */
  private async validateItemSkus(items: VipGiftItemDto[]) {
    const skuIds = items.map((i) => i.skuId);

    const skus = await this.prisma.productSKU.findMany({
      where: { id: { in: skuIds } },
      include: {
        product: { select: { companyId: true, status: true, title: true } },
      },
    });

    // 检查是否所有 SKU 都找到了
    const foundIds = new Set(skus.map((s) => s.id));
    for (const skuId of skuIds) {
      if (!foundIds.has(skuId)) {
        throw new BadRequestException(`SKU 不存在: ${skuId}`);
      }
    }

    // 逐一校验
    for (const sku of skus) {
      if (sku.product.companyId !== PLATFORM_COMPANY_ID) {
        throw new BadRequestException(
          `赠品 SKU「${sku.title}」必须来自奖励商品（平台公司）`,
        );
      }
      if (sku.product.status !== 'ACTIVE') {
        throw new BadRequestException(
          `赠品商品「${sku.product.title}」已下架，不能用于 VIP 赠品方案`,
        );
      }
      if (sku.status !== 'ACTIVE') {
        throw new BadRequestException(
          `赠品 SKU「${sku.title}」已下架，不能用于 VIP 赠品方案`,
        );
      }
    }
  }

  /** 校验 coverMode / coverUrl 一致性 */
  private validateCoverConsistency(coverMode?: CoverMode, coverUrl?: string) {
    if (coverMode === 'CUSTOM' && !coverUrl) {
      throw new BadRequestException('自定义封面模式（CUSTOM）必须提供 coverUrl');
    }
  }
}
