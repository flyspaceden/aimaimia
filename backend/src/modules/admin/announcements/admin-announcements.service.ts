import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  NotificationAudience,
  NotificationRecipientKind,
  NotificationSeverity,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AnnouncementAudienceDto,
  AnnouncementListQueryDto,
  AnnouncementTargetDto,
  AnnouncementTargetProductQueryDto,
  CreateAnnouncementDto,
} from './dto/admin-announcement.dto';

const VALID_APP_EXACT_ROUTES = [
  '/(tabs)',
  '/me',
  '/orders',
  '/cs',
  '/group-buy',
  '/invoices',
  '/about',
  '/account-security',
  '/cart',
  '/checkout',
  '/checkout-address',
  '/checkout-coupon',
  '/coupon-center',
  '/inbox',
  '/lottery',
  '/notification-settings',
  '/privacy',
  '/referral',
  '/search',
  '/settings',
  '/terms',
];

const VALID_APP_DYNAMIC_ROUTE_PREFIXES = [
  '/orders',
  '/product',
  '/company',
  '/category',
  '/ai',
  '/vip',
  '/group',
  '/group-buy',
  '/invoices',
  '/user',
  '/me',
];

const BATCH_SIZE = 1000;
const PRODUCT_DETAIL_ROUTE_KEY = 'PRODUCT_DETAIL';

type AnnouncementRecipient = {
  id: string;
  buyerNo: string | null;
};

@Injectable()
export class AdminAnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(dto: CreateAnnouncementDto) {
    await this.resolveTarget(dto.target);
    this.assertAudience(dto.audience);

    if (dto.audience.type === 'BUYER_NOS') {
      const { recipients, invalidBuyerNos } = await this.resolveBuyerNoAudience(dto.audience);
      return { count: recipients.length, invalidBuyerNos };
    }

    const count = await (this.prisma as any).user.count({
      where: this.buildUserWhere(dto.audience),
    });
    return { count, invalidBuyerNos: [] };
  }

  async create(dto: CreateAnnouncementDto, adminId: string) {
    this.assertAudience(dto.audience);
    const target = await this.resolveTarget(dto.target);
    const { recipients, invalidBuyerNos } = await this.resolveAudience(dto.audience);
    if (invalidBuyerNos.length > 0) {
      throw new BadRequestException(`以下买家编号不存在或不可发送: ${invalidBuyerNos.join(', ')}`);
    }
    if (recipients.length === 0) {
      throw new BadRequestException('当前筛选范围没有可发送买家');
    }

    const announcement = await (this.prisma as any).announcement.create({
      data: {
        title: dto.title,
        content: dto.content,
        category: dto.category ?? 'system',
        type: dto.type ?? 'platform_announcement',
        priority: dto.priority ?? 'NORMAL',
        target,
        audienceType: dto.audience.type,
        audienceFilter: this.summarizeAudience(dto.audience),
        status: 'SENDING',
        recipientCount: recipients.length,
        successCount: 0,
        failedCount: 0,
        createdBy: adminId,
      },
    });

    let successCount = 0;
    let failedCount = 0;
    for (const batch of this.chunk(recipients, BATCH_SIZE)) {
      try {
        const result = await (this.prisma as any).notificationMessage.createMany({
          data: batch.map((recipient) => ({
            recipientKind: NotificationRecipientKind.BUYER_USER,
            recipientKey: this.recipientKey(recipient.id),
            audience: NotificationAudience.BUYER_APP,
            category: dto.category ?? 'system',
            eventType: dto.type ?? 'platform_announcement',
            title: dto.title,
            body: dto.content,
            severity: dto.priority === 'IMPORTANT'
              ? NotificationSeverity.WARNING
              : NotificationSeverity.INFO,
            entityType: 'announcement',
            entityId: announcement.id,
            action: target,
            metadata: {
              announcementId: announcement.id,
              priority: dto.priority ?? 'NORMAL',
              audienceType: dto.audience.type,
            },
            idempotencyKey: `announcement:${announcement.id}:${recipient.id}`,
          })),
          skipDuplicates: true,
        });
        const insertedCount = Math.min(batch.length, Math.max(0, result.count ?? batch.length));
        successCount += insertedCount;
        failedCount += batch.length - insertedCount;
      } catch {
        failedCount += batch.length;
      }
    }

    const status = failedCount === 0
      ? 'SENT'
      : successCount === 0
        ? 'FAILED'
        : 'PARTIAL_FAILED';

    return (this.prisma as any).announcement.update({
      where: { id: announcement.id },
      data: {
        status,
        successCount,
        failedCount,
      },
    });
  }

  async findAll(query: AnnouncementListQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const [items, total] = await Promise.all([
      (this.prisma as any).announcement.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { sentAt: 'desc' },
      }),
      (this.prisma as any).announcement.count(),
    ]);
    return { items, total, page, pageSize };
  }

  async findTargetProducts(query: AnnouncementTargetProductQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize ?? 20)));
    const keyword = query.keyword?.trim();
    const where: any = {
      status: 'ACTIVE',
      auditStatus: 'APPROVED',
      company: { isPlatform: false },
    };
    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { id: keyword },
        { company: { name: { contains: keyword, mode: 'insensitive' } } },
      ];
    }

    const [products, total] = await Promise.all([
      (this.prisma as any).product.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          basePrice: true,
          createdAt: true,
          company: { select: { id: true, name: true } },
          media: {
            where: { type: 'IMAGE' },
            orderBy: { sortOrder: 'asc' },
            take: 1,
            select: { url: true },
          },
        },
      }),
      (this.prisma as any).product.count({ where }),
    ]);

    return {
      items: products.map((product: any) => ({
        id: product.id,
        title: product.title,
        basePrice: product.basePrice,
        companyId: product.company.id,
        companyName: product.company.name,
        imageUrl: product.media[0]?.url ?? null,
        createdAt: product.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  async findById(id: string) {
    const announcement = await (this.prisma as any).announcement.findUnique({ where: { id } });
    if (!announcement) throw new NotFoundException('公告不存在');
    return announcement;
  }

  private async resolveAudience(audience: AnnouncementAudienceDto): Promise<{
    recipients: AnnouncementRecipient[];
    invalidBuyerNos: string[];
  }> {
    if (audience.type === 'BUYER_NOS') {
      return this.resolveBuyerNoAudience(audience);
    }

    const recipients = await (this.prisma as any).user.findMany({
      where: this.buildUserWhere(audience),
      select: { id: true, buyerNo: true },
      orderBy: { createdAt: 'asc' },
    });
    return { recipients, invalidBuyerNos: [] };
  }

  private async resolveBuyerNoAudience(audience: AnnouncementAudienceDto): Promise<{
    recipients: AnnouncementRecipient[];
    invalidBuyerNos: string[];
  }> {
    const buyerNos = this.normalizeBuyerNos(audience.buyerNos);
    const recipients: AnnouncementRecipient[] = await (this.prisma as any).user.findMany({
      where: {
        status: 'ACTIVE',
        buyerNo: { in: buyerNos },
      },
      select: { id: true, buyerNo: true },
      orderBy: { createdAt: 'asc' },
    });
    const found = new Set(recipients.map((recipient) => recipient.buyerNo?.toUpperCase()).filter(Boolean));
    const invalidBuyerNos = buyerNos.filter((buyerNo) => !found.has(buyerNo));
    return { recipients, invalidBuyerNos };
  }

  private buildUserWhere(audience: AnnouncementAudienceDto) {
    const base: any = {
      status: 'ACTIVE',
      buyerNo: { not: null },
    };

    if (audience.type === 'VIP') {
      base.memberProfile = { is: { tier: 'VIP' } };
    }
    if (audience.type === 'NORMAL') {
      base.OR = [
        { memberProfile: { is: null } },
        { memberProfile: { is: { tier: 'NORMAL' } } },
      ];
    }

    return base;
  }

  private assertValidTarget(target?: AnnouncementTargetDto) {
    if (!target?.route) return;
    const route = target.route.trim();
    const isExactRoute = VALID_APP_EXACT_ROUTES.some((exactRoute) => (
      route === exactRoute || route.startsWith(`${exactRoute}?`)
    ));
    const isDynamicRoute = VALID_APP_DYNAMIC_ROUTE_PREFIXES.some((prefix) => (
      route.startsWith(`${prefix}/`)
    ));
    const isValid = isExactRoute || isDynamicRoute;
    if (!isValid) {
      throw new BadRequestException('公告跳转地址不在允许范围内');
    }
  }

  private async resolveTarget(target?: AnnouncementTargetDto) {
    if (!target) return undefined;
    if (target.routeKey && target.route) {
      throw new BadRequestException('公告跳转目标不能同时使用页面动作和历史地址');
    }

    if (target.routeKey) {
      if (target.routeKey !== PRODUCT_DETAIL_ROUTE_KEY) {
        throw new BadRequestException('公告跳转页面不受支持');
      }
      return this.resolveProductTarget(target.params?.id);
    }

    if (!target.route) {
      if (target.params && Object.keys(target.params).length > 0) {
        throw new BadRequestException('公告跳转参数缺少对应页面');
      }
      return undefined;
    }

    this.assertValidTarget(target);
    const route = target.route.trim();
    const productRouteMatch = route.match(/^\/product\/([^/?#]+)$/);
    if (productRouteMatch) {
      return this.resolveProductTarget(productRouteMatch[1]);
    }

    return {
      ...target,
      route,
    };
  }

  private async resolveProductTarget(rawProductId: unknown) {
    const productId = typeof rawProductId === 'string' ? rawProductId.trim() : '';
    if (!productId) {
      throw new BadRequestException('请选择要跳转的商品');
    }

    const product = await (this.prisma as any).product.findFirst({
      where: {
        id: productId,
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        company: { isPlatform: false },
      },
      select: { id: true, title: true },
    });
    if (!product) {
      throw new BadRequestException('所选商品已下架、未通过审核或买家不可见');
    }

    return {
      routeKey: PRODUCT_DETAIL_ROUTE_KEY,
      params: { id: product.id },
      label: `商品详情：${product.title}`,
    };
  }

  private assertAudience(audience?: AnnouncementAudienceDto): asserts audience is AnnouncementAudienceDto {
    if (!audience?.type) {
      throw new BadRequestException('请选择公告发送范围');
    }
  }

  private recipientKey(userId: string) {
    return `buyer:${userId}`;
  }

  private normalizeBuyerNos(buyerNos?: string[]) {
    const normalized = [...new Set((buyerNos ?? [])
      .map((buyerNo) => buyerNo.trim().toUpperCase())
      .filter(Boolean))];
    if (normalized.length === 0) {
      throw new BadRequestException('请至少填写一个买家编号');
    }
    return normalized;
  }

  private summarizeAudience(audience: AnnouncementAudienceDto) {
    if (audience.type !== 'BUYER_NOS') return { type: audience.type };
    return {
      type: audience.type,
      buyerNos: this.normalizeBuyerNos(audience.buyerNos),
    };
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }
}
