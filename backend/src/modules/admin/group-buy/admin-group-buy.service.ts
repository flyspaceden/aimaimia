import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupBuyActivityStatus,
  GroupBuyInstanceStatus,
  GroupBuyRebateLedgerStatus,
  GroupBuyRebateLedgerType,
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
  UpdateGroupBuySettingsDto,
} from './admin-group-buy.dto';

type GroupBuyConfigClient = Pick<
  Prisma.TransactionClient,
  'product' | 'productSKU' | 'groupBuyActivity' | 'groupBuyTier'
>;

const GROUP_BUY_MAX_MONTHLY_LAUNCHES_KEY = 'GROUP_BUY_MAX_MONTHLY_LAUNCHES';
const GROUP_BUY_MAX_MONTHLY_LAUNCHES_DESCRIPTION = '每个用户每月最多可发起的团购次数';
const DEFAULT_GROUP_BUY_SETTINGS = {
  maxMonthlyLaunches: 4,
};

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
          description: this.normalizeDescription(dto.description),
          productId: dto.productId,
          skuId: dto.skuId,
          price: dto.price,
          freeShipping: dto.freeShipping ?? false,
          status: dto.status ?? GroupBuyActivityStatus.DRAFT,
          startAt: dto.startAt ?? null,
          endAt: dto.endAt ?? null,
          displayOrder: dto.displayOrder ?? 0,
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
          description: dto.description === undefined
            ? undefined
            : this.normalizeDescription(dto.description),
          productId: dto.productId,
          skuId: dto.skuId,
          price: dto.price,
          freeShipping: dto.freeShipping,
          status: dto.status,
          startAt: dto.startAt,
          endAt: dto.endAt,
          displayOrder: dto.displayOrder,
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

  async findInstances(options: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    status?: string;
    activityId?: string;
    userId?: string;
  } = {}) {
    const { page, pageSize, skip } = this.normalizePagination(options.page, options.pageSize);
    const where: Prisma.GroupBuyInstanceWhereInput = {};

    if (options.status) {
      where.status = options.status as GroupBuyInstanceStatus;
    }
    if (options.activityId) {
      where.activityId = options.activityId;
    }
    if (options.userId) {
      where.userId = options.userId;
    }
    if (options.keyword) {
      const keyword = options.keyword.trim();
      where.OR = [
        { id: keyword },
        { user: { buyerNo: { contains: keyword, mode: 'insensitive' } } },
        { user: { profile: { is: { nickname: { contains: keyword, mode: 'insensitive' } } } } },
        { activity: { title: { contains: keyword, mode: 'insensitive' } } },
        { code: { is: { code: { contains: keyword, mode: 'insensitive' } } } },
        { initiatorOrderId: keyword },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.groupBuyInstance.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: this.instanceListInclude,
      }),
      this.prisma.groupBuyInstance.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findInstance(id: string) {
    const instance = await this.prisma.groupBuyInstance.findUnique({
      where: { id },
      include: this.instanceDetailInclude,
    });
    if (!instance) {
      throw new NotFoundException('团购记录不存在');
    }
    return instance;
  }

  async findOrders(options: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    status?: string;
    activityId?: string;
    userId?: string;
  } = {}) {
    const { page, pageSize, skip } = this.normalizePagination(options.page, options.pageSize);
    const where: Prisma.OrderWhereInput = { bizType: 'GROUP_BUY' };

    if (options.status) {
      where.status = options.status as any;
    }
    if (options.userId) {
      where.userId = options.userId;
    }
    if (options.activityId) {
      where.OR = [
        { groupBuyInitiatedInstance: { is: { activityId: options.activityId } } },
        { groupBuyReferredPurchase: { is: { instance: { activityId: options.activityId } } } },
      ];
    }
    if (options.keyword) {
      const keyword = options.keyword.trim();
      const keywordWhere: Prisma.OrderWhereInput[] = [
        { id: keyword },
        { user: { buyerNo: { contains: keyword, mode: 'insensitive' } } },
        { user: { profile: { is: { nickname: { contains: keyword, mode: 'insensitive' } } } } },
      ];
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        { OR: keywordWhere },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: this.orderInclude,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findRebateLedgers(options: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    type?: string;
    status?: string;
    userId?: string;
    instanceId?: string;
  } = {}) {
    const { page, pageSize, skip } = this.normalizePagination(options.page, options.pageSize);
    const where: Prisma.GroupBuyRebateLedgerWhereInput = { deletedAt: null };

    if (options.type) {
      where.type = options.type as GroupBuyRebateLedgerType;
    }
    if (options.status) {
      where.status = options.status as GroupBuyRebateLedgerStatus;
    }
    if (options.userId) {
      where.userId = options.userId;
    }
    if (options.instanceId) {
      where.instanceId = options.instanceId;
    }
    if (options.keyword) {
      const keyword = options.keyword.trim();
      where.OR = [
        { id: keyword },
        { refId: keyword },
        { orderId: keyword },
        { user: { buyerNo: { contains: keyword, mode: 'insensitive' } } },
        { user: { profile: { is: { nickname: { contains: keyword, mode: 'insensitive' } } } } },
        { instance: { activity: { title: { contains: keyword, mode: 'insensitive' } } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.groupBuyRebateLedger.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: this.ledgerInclude,
      }),
      this.prisma.groupBuyRebateLedger.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async getSettings() {
    const row = await this.prisma.ruleConfig.findUnique({
      where: { key: GROUP_BUY_MAX_MONTHLY_LAUNCHES_KEY },
      select: { value: true },
    });
    return {
      maxMonthlyLaunches: this.unwrapRuleConfigNumber(row?.value)
        ?? DEFAULT_GROUP_BUY_SETTINGS.maxMonthlyLaunches,
    };
  }

  async updateSettings(dto: UpdateGroupBuySettingsDto) {
    const maxMonthlyLaunches = Math.floor(Number(dto.maxMonthlyLaunches));
    if (!Number.isFinite(maxMonthlyLaunches) || maxMonthlyLaunches < 1 || maxMonthlyLaunches > 100) {
      throw new BadRequestException('每月发起次数必须在 1 到 100 之间');
    }

    await this.prisma.ruleConfig.upsert({
      where: { key: GROUP_BUY_MAX_MONTHLY_LAUNCHES_KEY },
      update: {
        value: {
          value: maxMonthlyLaunches,
          description: GROUP_BUY_MAX_MONTHLY_LAUNCHES_DESCRIPTION,
        },
      },
      create: {
        key: GROUP_BUY_MAX_MONTHLY_LAUNCHES_KEY,
        value: {
          value: maxMonthlyLaunches,
          description: GROUP_BUY_MAX_MONTHLY_LAUNCHES_DESCRIPTION,
        },
      },
    });

    return { maxMonthlyLaunches };
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

  private normalizePagination(pageInput?: number, pageSizeInput?: number) {
    const page = Math.max(pageInput ?? 1, 1);
    const pageSize = Math.min(Math.max(pageSizeInput ?? 20, 1), 100);
    return {
      page,
      pageSize,
      skip: (page - 1) * pageSize,
    };
  }

  private normalizeDescription(value?: string | null) {
    if (value === undefined || value === null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private unwrapRuleConfigNumber(raw: unknown) {
    const value = raw
      && typeof raw === 'object'
      && !Array.isArray(raw)
      && 'value' in raw
      ? (raw as { value?: unknown }).value
      : raw;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private readonly userSummarySelect: Prisma.UserSelect = {
    id: true,
    buyerNo: true,
    profile: {
      select: { nickname: true, avatarUrl: true },
    },
  };

  private readonly instanceListInclude: Prisma.GroupBuyInstanceInclude = {
    user: { select: this.userSummarySelect },
    activity: {
      select: { id: true, title: true, price: true, status: true },
    },
    code: {
      select: { code: true, status: true, activatedAt: true, disabledAt: true, completedAt: true },
    },
    initiatorOrder: {
      select: { id: true, status: true, totalAmount: true, goodsAmount: true, receivedAt: true, returnWindowExpiresAt: true, createdAt: true },
    },
    _count: {
      select: { referrals: true, rebateLedgers: true },
    },
  };

  private readonly instanceDetailInclude: Prisma.GroupBuyInstanceInclude = {
    ...this.instanceListInclude,
    referrals: {
      orderBy: [{ candidateSequence: 'asc' }, { createdAt: 'asc' }],
      include: {
        referredUser: { select: this.userSummarySelect },
        referredOrder: {
          select: { id: true, status: true, totalAmount: true, goodsAmount: true, receivedAt: true, returnWindowExpiresAt: true, createdAt: true },
        },
        referredInstance: {
          select: { id: true, status: true, validReferralCount: true, candidateCount: true },
        },
      },
    },
    rebateLedgers: {
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
    },
  };

  private readonly orderInclude: Prisma.OrderInclude = {
    user: { select: this.userSummarySelect },
    items: {
      select: { id: true, skuId: true, productSnapshot: true, unitPrice: true, quantity: true },
    },
    groupBuyInitiatedInstance: {
      select: {
        id: true,
        status: true,
        validReferralCount: true,
        candidateCount: true,
        activity: { select: { id: true, title: true, price: true } },
        code: { select: { code: true, status: true } },
      },
    },
    groupBuyReferredPurchase: {
      select: {
        id: true,
        status: true,
        candidateSequence: true,
        effectiveSequence: true,
        amountSnapshot: true,
        instance: {
          select: {
            id: true,
            status: true,
            user: { select: this.userSummarySelect },
            activity: { select: { id: true, title: true, price: true } },
            code: { select: { code: true, status: true } },
          },
        },
      },
    },
  };

  private readonly ledgerInclude: Prisma.GroupBuyRebateLedgerInclude = {
    user: { select: this.userSummarySelect },
    instance: {
      select: {
        id: true,
        status: true,
        activity: { select: { id: true, title: true, price: true } },
        code: { select: { code: true, status: true } },
      },
    },
    referral: {
      select: {
        id: true,
        status: true,
        candidateSequence: true,
        effectiveSequence: true,
        referredOrderId: true,
        referredUser: { select: this.userSummarySelect },
      },
    },
    order: {
      select: { id: true, status: true, totalAmount: true, goodsAmount: true },
    },
  };

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
