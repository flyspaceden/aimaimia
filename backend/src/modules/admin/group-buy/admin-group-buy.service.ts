import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupBuyActivityStatus,
  Prisma,
  ProductStatus,
  SkuStatus,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { GroupBuyService } from '../../group-buy/group-buy.service';
import { PLATFORM_COMPANY_ID } from '../../bonus/engine/constants';
import {
  CreateGroupBuyActivityDto,
  GroupBuyTierConfigDto,
  UpdateGroupBuyActivityDto,
} from './admin-group-buy.dto';

type GroupBuyConfigClient = Pick<
  Prisma.TransactionClient,
  'product' | 'productSKU' | 'groupBuyActivity' | 'groupBuyTier'
>;

@Injectable()
export class AdminGroupBuyService {
  constructor(private prisma: PrismaService) {}

  private readonly serializableTransactionOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  };

  private readonly activityInclude = {
    product: {
      select: {
        id: true,
        title: true,
        status: true,
        companyId: true,
        media: {
          select: { id: true, type: true, url: true, sortOrder: true },
          orderBy: { sortOrder: 'asc' as const },
        },
      },
    },
    sku: {
      select: {
        id: true,
        title: true,
        status: true,
        price: true,
        stock: true,
        weightGram: true,
      },
    },
    tiers: {
      orderBy: { sequence: 'asc' as const },
    },
    _count: {
      select: { instances: true },
    },
  };

  async findAll(options: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    status?: string;
  } = {}) {
    const page = Math.max(options.page ?? 1, 1);
    const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.GroupBuyActivityWhereInput = {
      deletedAt: null,
    };
    if (options.keyword) {
      where.OR = [
        { title: { contains: options.keyword, mode: 'insensitive' } },
        { id: options.keyword },
        { product: { title: { contains: options.keyword, mode: 'insensitive' } } },
      ];
    }
    if (options.status) {
      where.status = options.status as GroupBuyActivityStatus;
    }

    const [items, total] = await Promise.all([
      this.prisma.groupBuyActivity.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
        include: this.activityInclude,
      }),
      this.prisma.groupBuyActivity.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const activity = await this.prisma.groupBuyActivity.findUnique({
      where: { id },
      include: this.activityInclude,
    });
    if (!activity || activity.deletedAt) {
      throw new NotFoundException('团购活动不存在');
    }
    return activity;
  }

  async create(dto: CreateGroupBuyActivityDto) {
    return this.prisma.$transaction(async (tx) => {
      const tiers = this.normalizeTiers(dto.tiers);
      await this.assertPlatformProductSku(tx, dto.productId, dto.skuId);
      this.assertActivityWindow(dto.startAt, dto.endAt);

      return tx.groupBuyActivity.create({
        data: {
          title: dto.title,
          productId: dto.productId,
          skuId: dto.skuId,
          price: dto.price,
          freeShipping: dto.freeShipping ?? false,
          status: dto.status ?? GroupBuyActivityStatus.DRAFT,
          startAt: dto.startAt ?? null,
          endAt: dto.endAt ?? null,
          displayOrder: dto.displayOrder ?? 0,
          ruleSummary: dto.ruleSummary ?? null,
          tiers: {
            create: tiers,
          },
        },
        include: this.activityInclude,
      });
    }, this.serializableTransactionOptions);
  }

  async update(id: string, dto: UpdateGroupBuyActivityDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.groupBuyActivity.findUnique({
        where: { id },
        include: { tiers: true },
      });
      if (!existing || existing.deletedAt) {
        throw new NotFoundException('团购活动不存在');
      }

      const productId = dto.productId ?? existing.productId;
      const skuId = dto.skuId ?? existing.skuId;
      if (dto.productId || dto.skuId) {
        await this.assertPlatformProductSku(tx, productId, skuId);
      }
      this.assertActivityWindow(
        dto.startAt === undefined ? existing.startAt : dto.startAt,
        dto.endAt === undefined ? existing.endAt : dto.endAt,
      );

      if (dto.tiers) {
        const tiers = this.normalizeTiers(dto.tiers);
        await tx.groupBuyTier.deleteMany({ where: { activityId: id } });
        await tx.groupBuyTier.createMany({
          data: tiers.map((tier) => ({ ...tier, activityId: id })),
        });
      }

      return tx.groupBuyActivity.update({
        where: { id },
        data: {
          title: dto.title,
          productId: dto.productId,
          skuId: dto.skuId,
          price: dto.price,
          freeShipping: dto.freeShipping,
          status: dto.status,
          startAt: dto.startAt,
          endAt: dto.endAt,
          displayOrder: dto.displayOrder,
          ruleSummary: dto.ruleSummary,
        },
        include: this.activityInclude,
      });
    }, this.serializableTransactionOptions);
  }

  async updateStatus(id: string, status: GroupBuyActivityStatus) {
    return this.update(id, { status });
  }

  async softDelete(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.groupBuyActivity.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) {
        throw new NotFoundException('团购活动不存在');
      }

      return tx.groupBuyActivity.update({
        where: { id },
        data: {
          status: GroupBuyActivityStatus.ENDED,
          deletedAt: new Date(),
        },
      });
    }, this.serializableTransactionOptions);
  }

  private normalizeTiers(tiers: GroupBuyTierConfigDto[]) {
    const seenSequences = new Set<number>();
    const normalized = [...tiers]
      .map((tier) => ({
        sequence: tier.sequence,
        basisPoints: tier.basisPoints,
        label: tier.label ?? null,
      }))
      .sort((a, b) => a.sequence - b.sequence);

    for (const tier of normalized) {
      if (seenSequences.has(tier.sequence)) {
        throw new BadRequestException('返还档位序号不能重复');
      }
      seenSequences.add(tier.sequence);
    }

    GroupBuyService.assertTierBasisPointsTotal(
      normalized.map((tier) => tier.basisPoints),
    );
    return normalized;
  }

  private async assertPlatformProductSku(
    client: GroupBuyConfigClient,
    productId: string,
    skuId: string,
  ) {
    const product = await client.product.findUnique({
      where: { id: productId },
      select: { id: true, companyId: true, status: true },
    });
    if (!product) {
      throw new NotFoundException('商品不存在');
    }
    if (product.companyId !== PLATFORM_COMPANY_ID) {
      throw new BadRequestException('团购活动只能选择平台商品');
    }
    if (product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException('团购活动只能选择已上架的平台商品');
    }

    const sku = await client.productSKU.findUnique({
      where: { id: skuId },
      select: { id: true, productId: true, status: true },
    });
    if (!sku) {
      throw new NotFoundException('SKU 不存在');
    }
    if (sku.productId !== productId) {
      throw new BadRequestException('SKU 不属于所选商品');
    }
    if (sku.status !== SkuStatus.ACTIVE) {
      throw new BadRequestException('团购活动只能选择已启用 SKU');
    }
  }

  private assertActivityWindow(startAt?: Date | null, endAt?: Date | null) {
    if (startAt && endAt && startAt.getTime() >= endAt.getTime()) {
      throw new BadRequestException('活动开始时间必须早于结束时间');
    }
  }
}
