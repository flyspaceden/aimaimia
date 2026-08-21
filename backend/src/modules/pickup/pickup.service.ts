import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Prisma,
  PickupFulfillmentStatus,
  PickupPointCoverage,
  PickupPointKind,
} from '@prisma/client';
import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'crypto';
import {
  decryptJsonValue,
  decryptText,
  encryptJsonValue,
  encryptText,
} from '../../common/security/encryption';
import { sanitizeForLog } from '../../common/logging/log-sanitizer';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderService } from '../order/order.service';
import { OrderReceivedEffectsService } from '../order/order-received-effects.service';
import {
  ResolvedFulfillmentInput,
} from './dto/fulfillment.dto';
import {
  AdminCreatePickupPointDto,
  AdminPickupPointQueryDto,
  AdminUpdatePickupPointDto,
  CreatePickupPointDto,
  UpdatePickupPointDto,
} from './dto/pickup-point.dto';
import { VerifyPickupDto } from './dto/pickup-verify.dto';
import { getConfigValue, resolveRewardSafeWindowMs } from '../after-sale/after-sale.utils';
import { NotificationService } from '../notification/notification.service';
import * as QRCode from 'qrcode';

type Tx = Prisma.TransactionClient;

export type AdminPointAuditContext = {
  adminUserId: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

type ValidatedPickupSelection = {
  companyId: string;
  pickupPointId: string;
  pickupPointSnapshot: Record<string, unknown>;
};

type PickupOperationActor =
  | { actorType: 'SELLER_STAFF'; actorId: string; companyId: string }
  | { actorType: 'ADMIN'; actorId: string };

export type ValidatedFulfillment =
  | { mode: 'DELIVERY'; addressId: string }
  | {
      mode: 'PICKUP';
      recipientSnapshot: Prisma.InputJsonValue;
      selectionsSnapshot: ValidatedPickupSelection[];
    };

const PASS_TTL_SECONDS = 5 * 60;
const PASS_VIEW_AUDIT_WINDOW_MS = 60 * 1000;
const PASS_QR_MAX_BYTES = 200_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IEND = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
const SERIALIZABLE_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

@Injectable()
export class PickupService implements OnModuleInit {
  private readonly logger = new Logger(PickupService.name);
  private orderService: OrderService | null = null;
  private orderReceivedEffectsService: OrderReceivedEffectsService | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
    private readonly notificationService: NotificationService,
  ) {}

  onModuleInit() {
    this.orderService = this.moduleRef.get(OrderService, { strict: false });
    this.orderReceivedEffectsService = this.moduleRef.get(OrderReceivedEffectsService, { strict: false });
    if (!this.orderService) {
      throw new Error('[PickupService] OrderService 未注入，自提核销后收货副作用无法收口');
    }
    if (!this.orderReceivedEffectsService) {
      throw new Error('[PickupService] OrderReceivedEffectsService 未注入，自提核销副作用不可靠');
    }
  }

  isCheckoutEnabled() {
    return String(process.env.PICKUP_FULFILLMENT_ENABLED ?? 'false').toLowerCase() === 'true';
  }

  private assertCheckoutEnabled() {
    if (!this.isCheckoutEnabled()) {
      throw new ServiceUnavailableException({
        code: 'PICKUP_FULFILLMENT_DISABLED',
        message: '到店自提暂未开放',
      });
    }
  }

  async validateCheckoutFulfillment(
    tx: Tx,
    companyIds: string[],
    input: ResolvedFulfillmentInput,
  ): Promise<ValidatedFulfillment> {
    if (input.mode === 'DELIVERY') {
      return input;
    }
    this.assertCheckoutEnabled();

    const expectedCompanyIds = [...new Set(companyIds.filter(Boolean))].sort();
    // preview/final checkout 会先排除失效商品：如果某商家唯一商品被排除，
    // 客户端旧 selections 可以作为 stale superset 提交。只校验并快照最终商家，
    // 不查询/不存储额外点位，避免跨商家数据被带入订单。
    const relevantSelections = input.selections.filter((item) =>
      expectedCompanyIds.includes(item.companyId),
    );
    const submittedCompanyIds = relevantSelections.map((item) => item.companyId);
    if (submittedCompanyIds.length !== new Set(submittedCompanyIds).size) {
      throw new BadRequestException('每个商家只能选择一个自提点');
    }
    if (
      expectedCompanyIds.length !== submittedCompanyIds.length ||
      expectedCompanyIds.some((companyId) => !submittedCompanyIds.includes(companyId))
    ) {
      throw new BadRequestException('请为每个商家的商品选择自提点');
    }

    const activeCompanies = await tx.company.findMany({
      where: { id: { in: expectedCompanyIds }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (activeCompanies.length !== expectedCompanyIds.length) {
      throw new BadRequestException({
        code: 'PICKUP_POINT_MISMATCH',
        message: '商家不可用，无法选择自提点',
      });
    }

    const pointIds = [...new Set(relevantSelections.map((item) => item.pickupPointId))];

    const points = await tx.pickupPoint.findMany({
      where: { id: { in: pointIds }, isActive: true, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, status: true, isPlatform: true } },
        serviceCompanies: { select: { companyId: true } },
      },
    });
    if (points.length !== pointIds.length) {
      throw new BadRequestException({
        code: 'PICKUP_POINT_UNAVAILABLE',
        message: '所选自提点不存在或已停用',
      });
    }

    const pointMap = new Map(points.map((point) => [point.id, point]));
    const selectionsSnapshot = relevantSelections.map((selection) => {
      const point = pointMap.get(selection.pickupPointId);
      if (!point || point.company.status !== 'ACTIVE' || !this.pointServesCompany(point, selection.companyId)) {
        throw new BadRequestException({
          code: 'PICKUP_POINT_MISMATCH',
          message: '自提点未获该企业授权或商家不可用',
        });
      }
      return {
        companyId: selection.companyId,
        pickupPointId: point.id,
        pickupPointSnapshot: this.buildPointSnapshot(point),
      };
    });

    return {
      mode: 'PICKUP',
      recipientSnapshot: encryptJsonValue({
        recipientName: input.recipientName,
        phone: input.recipientPhone,
      }) as Prisma.InputJsonValue,
      selectionsSnapshot,
    };
  }

  async listBuyerPoints(companyIds: string[]) {
    this.assertCheckoutEnabled();
    const ids = [...new Set(companyIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0 || ids.length > 100) {
      throw new BadRequestException('companyIds 参数无效');
    }
    const companies = await this.prisma.company.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    const activeCompanyIds = companies.map((company) => company.id);
    const points = await this.prisma.pickupPoint.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { kind: PickupPointKind.MERCHANT, companyId: { in: activeCompanyIds } },
          {
            kind: PickupPointKind.PLATFORM_HUB,
            coverage: PickupPointCoverage.ALL_ACTIVE_COMPANIES,
            company: { isPlatform: true, status: 'ACTIVE' },
          },
          {
            kind: PickupPointKind.PLATFORM_HUB,
            coverage: PickupPointCoverage.SELECTED_COMPANIES,
            company: { isPlatform: true, status: 'ACTIVE' },
            serviceCompanies: { some: { companyId: { in: activeCompanyIds } } },
          },
        ],
      },
      include: {
        company: { select: { id: true, isPlatform: true } },
        serviceCompanies: { select: { companyId: true } },
      },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const companyMap = new Map(companies.map((company) => [company.id, company]));
    return {
      items: ids.map((companyId) => {
        const company = companyMap.get(companyId);
        return {
          companyId,
          companyName: company?.name ?? '',
          points: points
            .filter((point) => Boolean(company) && this.pointServesCompany(point, companyId))
            .map((point) => this.mapPointForBuyer(point)),
        };
      }),
    };
  }

  async listSellerPoints(companyId: string, page = 1, pageSize = 20, isActive?: boolean) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(100, Math.max(1, pageSize));
    const where = {
      companyId,
      deletedAt: null,
      ...(typeof isActive === 'boolean' ? { isActive } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.pickupPoint.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.pickupPoint.count({ where }),
    ]);
    return {
      items: items.map((point) => this.mapPointForOwner(point)),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  async listAdminPoints(query: AdminPickupPointQueryDto) {
    const safePage = Math.max(1, query.page ?? 1);
    const safePageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where: Prisma.PickupPointWhereInput = {
      deletedAt: query.isDeleted ? { not: null } : null,
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(typeof query.isActive === 'boolean' ? { isActive: query.isActive } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.pickupPoint.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, isPlatform: true } },
          serviceCompanies: { include: { company: { select: { id: true, name: true } } } },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.pickupPoint.count({ where }),
    ]);
    return {
      items: items.map((point) => this.mapPointForAdmin(point)),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  async listAdminPickupCompanyOptions(keyword?: string) {
    const normalizedKeyword = keyword?.trim();
    const items = await this.prisma.company.findMany({
      where: {
        status: 'ACTIVE',
        ...(normalizedKeyword
          ? { name: { contains: normalizedKeyword, mode: 'insensitive' as const } }
          : {}),
      },
      select: { id: true, name: true, isPlatform: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return { items };
  }

  /** Validate point ownership and the explicit companies a platform hub serves. */
  private async resolvePlatformHubConfig(
    tx: Tx,
    input: {
      owner: { id: string; isPlatform: boolean };
      kind?: PickupPointKind;
      coverage?: PickupPointCoverage;
      serviceCompanyIds?: string[];
    },
  ) {
    const kind = input.kind ?? PickupPointKind.MERCHANT;
    const coverage = input.coverage ?? PickupPointCoverage.OWNER_COMPANY;
    const suppliedCompanyIds = [...new Set(
      (input.serviceCompanyIds ?? []).map((value) => value.trim()).filter(Boolean),
    )];
    if (kind === PickupPointKind.MERCHANT) {
      if (coverage !== PickupPointCoverage.OWNER_COMPANY || suppliedCompanyIds.length) {
        throw new BadRequestException('企业自有自提点不能配置中心仓服务范围');
      }
      return {
        kind: PickupPointKind.MERCHANT,
        coverage: PickupPointCoverage.OWNER_COMPANY,
        serviceCompanyIds: [],
      };
    }

    if (!input.owner.isPlatform) {
      throw new BadRequestException('平台中心仓必须归属平台公司');
    }
    if (coverage === PickupPointCoverage.OWNER_COMPANY) {
      throw new BadRequestException('平台中心仓必须服务全部企业或指定企业');
    }
    if (coverage === PickupPointCoverage.ALL_ACTIVE_COMPANIES) {
      if (suppliedCompanyIds.length) {
        throw new BadRequestException('服务全部企业时不能同时指定企业名单');
      }
      return { kind: PickupPointKind.PLATFORM_HUB, coverage, serviceCompanyIds: [] };
    }

    const serviceCompanyIds = [...new Set([input.owner.id, ...suppliedCompanyIds])];
    if (serviceCompanyIds.length === 0) {
      throw new BadRequestException('请至少选择一个可使用中心仓的企业');
    }
    const activeCount = await tx.company.count({
      where: { id: { in: serviceCompanyIds }, status: 'ACTIVE' },
    });
    if (activeCount !== serviceCompanyIds.length) {
      throw new BadRequestException('中心仓服务企业必须全部为正常经营状态');
    }
    return { kind: PickupPointKind.PLATFORM_HUB, coverage, serviceCompanyIds };
  }

  async createSellerPoint(companyId: string, dto: CreatePickupPointDto) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!company) throw new ForbiddenException('当前商家不可配置自提点');
    const point = await this.prisma.pickupPoint.create({
      data: this.pickupPointCreateData(companyId, dto),
    });
    return this.mapPointForOwner(point);
  }

  async updateSellerPoint(companyId: string, pointId: string, dto: UpdatePickupPointDto) {
    const updateData = this.pickupPointUpdateData(dto);
    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('至少需要修改一个自提点字段');
    }
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.pickupPoint.findFirst({
        where: { id: pointId, companyId, deletedAt: null },
      });
      if (!current) throw new NotFoundException('自提点不存在');
      const updated = await tx.pickupPoint.updateMany({
        where: {
          id: pointId,
          companyId,
          deletedAt: null,
          updatedAt: current.updatedAt,
        },
        data: updateData as Prisma.PickupPointUpdateManyMutationInput,
      });
      if (updated.count !== 1) {
        throw new ConflictException('自提点已被平台删除或修改，请刷新后重试');
      }
      const point = await tx.pickupPoint.findUniqueOrThrow({ where: { id: pointId } });
      return this.mapPointForOwner(point);
    });
  }

  async createAdminPoint(dto: AdminCreatePickupPointDto, audit: AdminPointAuditContext) {
    const {
      companyId,
      kind = PickupPointKind.MERCHANT,
      coverage,
      serviceCompanyIds,
      ...pointDto
    } = dto;
    return this.prisma.$transaction(async (tx) => {
      const company = kind === PickupPointKind.PLATFORM_HUB
        ? await this.resolvePlatformHubOwner(tx)
        : await tx.company.findFirst({
            where: { id: companyId, status: 'ACTIVE' },
            select: { id: true, isPlatform: true },
          });
      if (!company) throw new BadRequestException('只能为正常经营的企业创建自提点');
      const hubConfig = await this.resolvePlatformHubConfig(tx, {
        owner: company,
        kind,
        coverage,
        serviceCompanyIds,
      });

      const point = await tx.pickupPoint.create({
        data: {
          ...this.pickupPointCreateData(company.id, pointDto),
          kind: hubConfig.kind,
          coverage: hubConfig.coverage,
          ...(hubConfig.serviceCompanyIds.length
            ? { serviceCompanies: { create: hubConfig.serviceCompanyIds.map((serviceCompanyId) => ({ companyId: serviceCompanyId })) } }
            : {}),
        },
        include: {
          company: { select: { id: true, name: true, isPlatform: true } },
          serviceCompanies: { include: { company: { select: { id: true, name: true } } } },
        },
      });
      await this.writeAdminPointAudit(tx, {
        action: 'CREATE',
        after: point,
        audit,
      });
      return this.mapPointForAdmin(point);
    });
  }

  /** Platform hubs never trust a browser-supplied owner company ID. */
  private async resolvePlatformHubOwner(tx: Tx) {
    const owners = await tx.company.findMany({
      where: { isPlatform: true, status: 'ACTIVE' },
      select: { id: true, isPlatform: true },
      take: 2,
      orderBy: { id: 'asc' },
    });
    if (owners.length !== 1) {
      throw new BadRequestException('平台中心仓需要且只能配置一个正常经营的平台公司');
    }
    return owners[0];
  }

  async updateAdminPoint(
    pointId: string,
    dto: AdminUpdatePickupPointDto,
    audit: AdminPointAuditContext,
  ) {
    const { reason, coverage, serviceCompanyIds, ...pointDto } = dto;
    const updateData = this.pickupPointUpdateData(pointDto);
    const updatesHubConfiguration = coverage !== undefined || serviceCompanyIds !== undefined;
    if (Object.keys(updateData).length === 0 && !updatesHubConfiguration) {
      throw new BadRequestException('至少需要修改一个自提点字段');
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.pickupPoint.findUnique({
        where: { id: pointId },
        include: {
          company: { select: { id: true, name: true, isPlatform: true } },
          serviceCompanies: { select: { companyId: true } },
        },
      });
      if (!current) throw new NotFoundException('自提点不存在');
      if (current.deletedAt) throw new ConflictException('已删除的自提点需要先恢复');
      const hubConfig = await this.resolvePlatformHubConfig(tx, {
        owner: current.company,
        kind: current.kind,
        coverage: coverage ?? current.coverage,
        serviceCompanyIds: serviceCompanyIds ?? (current.serviceCompanies ?? []).map((item) => item.companyId),
      });

      const updated = await tx.pickupPoint.updateMany({
        where: { id: pointId, deletedAt: null, updatedAt: current.updatedAt },
        data: {
          ...updateData,
          ...(updatesHubConfiguration ? { coverage: hubConfig.coverage, updatedAt: new Date() } : {}),
        } as Prisma.PickupPointUpdateManyMutationInput,
      });
      if (updated.count !== 1) throw new ConflictException('自提点已被其他管理员修改，请刷新后重试');
      if (updatesHubConfiguration) {
        await tx.pickupPointServiceCompany.deleteMany({ where: { pickupPointId: pointId } });
        if (hubConfig.serviceCompanyIds.length) {
          await tx.pickupPointServiceCompany.createMany({
            data: hubConfig.serviceCompanyIds.map((companyId) => ({ pickupPointId: pointId, companyId })),
          });
        }
      }
      const point = await tx.pickupPoint.findUniqueOrThrow({
        where: { id: pointId },
        include: {
          company: { select: { id: true, name: true, isPlatform: true } },
          serviceCompanies: { include: { company: { select: { id: true, name: true } } } },
        },
      });
      await this.writeAdminPointAudit(tx, {
        action: 'UPDATE',
        before: current,
        after: point,
        reason,
        audit,
      });
      return this.mapPointForAdmin(point);
    });
  }

  async deleteAdminPoint(pointId: string, reason: string, audit: AdminPointAuditContext) {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new BadRequestException('请填写删除原因');

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.pickupPoint.findUnique({
        where: { id: pointId },
        include: {
          company: { select: { id: true, name: true, isPlatform: true } },
          serviceCompanies: { include: { company: { select: { id: true, name: true } } } },
        },
      });
      if (!current) throw new NotFoundException('自提点不存在');
      if (current.deletedAt) {
        return { ...this.mapPointForAdmin(current), alreadyDeleted: true };
      }

      const now = new Date();
      const deleted = await tx.pickupPoint.updateMany({
        where: { id: pointId, deletedAt: null, updatedAt: current.updatedAt },
        data: {
          isActive: false,
          deletedAt: now,
          deletedByAdminId: audit.adminUserId,
          deleteReason: normalizedReason,
        },
      });
      if (deleted.count !== 1) throw new ConflictException('自提点已被其他管理员修改，请刷新后重试');
      const point = await tx.pickupPoint.findUniqueOrThrow({
        where: { id: pointId },
        include: {
          company: { select: { id: true, name: true, isPlatform: true } },
          serviceCompanies: { include: { company: { select: { id: true, name: true } } } },
        },
      });
      await this.writeAdminPointAudit(tx, {
        action: 'DELETE',
        before: current,
        after: point,
        reason: normalizedReason,
        audit,
      });
      return { ...this.mapPointForAdmin(point), alreadyDeleted: false };
    });
  }

  async restoreAdminPoint(pointId: string, reason: string, audit: AdminPointAuditContext) {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new BadRequestException('请填写恢复原因');

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.pickupPoint.findUnique({
        where: { id: pointId },
        include: {
          company: { select: { id: true, name: true, isPlatform: true } },
          serviceCompanies: { include: { company: { select: { id: true, name: true } } } },
        },
      });
      if (!current) throw new NotFoundException('自提点不存在');
      if (!current.deletedAt) {
        return { ...this.mapPointForAdmin(current), alreadyRestored: true };
      }

      const restored = await tx.pickupPoint.updateMany({
        where: { id: pointId, deletedAt: current.deletedAt, updatedAt: current.updatedAt },
        data: {
          isActive: false,
          deletedAt: null,
          deletedByAdminId: null,
          deleteReason: null,
        },
      });
      if (restored.count !== 1) throw new ConflictException('自提点已被其他管理员修改，请刷新后重试');
      const point = await tx.pickupPoint.findUniqueOrThrow({
        where: { id: pointId },
        include: {
          company: { select: { id: true, name: true, isPlatform: true } },
          serviceCompanies: { include: { company: { select: { id: true, name: true } } } },
        },
      });
      await this.writeAdminPointAudit(tx, {
        action: 'UPDATE',
        before: current,
        after: point,
        reason: `恢复：${normalizedReason}`,
        audit,
      });
      return { ...this.mapPointForAdmin(point), alreadyRestored: false };
    });
  }

  async createForPaidOrder(
    tx: Tx,
    params: {
      orderId: string;
      companyId: string;
      recipientSnapshot: Prisma.JsonValue;
      selectionsSnapshot: Prisma.JsonValue;
    },
  ) {
    const existing = await tx.pickupFulfillment.findUnique({ where: { orderId: params.orderId } });
    if (existing) return existing;
    const selections = Array.isArray(params.selectionsSnapshot)
      ? (params.selectionsSnapshot as unknown as ValidatedPickupSelection[])
      : [];
    const selection = selections.find((item) => item.companyId === params.companyId);
    if (!selection) {
      throw new BadRequestException('结算会话自提点快照不完整');
    }

    const point = await tx.pickupPoint.findUnique({
      where: { id: selection.pickupPointId },
      select: { id: true },
    });
    // 支付前 checkout 已校验 isActive 并锁定快照。支付后点位被停用只影响
    // 新结算，不能让已扣款回调因配置变更而建单失败。
    if (!point) {
      throw new BadRequestException('结算会话自提点归属异常');
    }

    // 凭证摘要、加密恢复与 QR 签名共用可轮换的服务端 secret。
    // 生产环境缺少 secret 时必须在建凭证前失败，不得落入开发默认值。
    this.credentialSecret();
    const pickupCode = randomInt(0, 100_000_000).toString().padStart(8, '0');
    const pickupToken = randomBytes(32).toString('base64url');
    const created = await tx.pickupFulfillment.create({
      data: {
        orderId: params.orderId,
        pickupPointId: point.id,
        status: 'PREPARING',
        pickupPointSnapshot: selection.pickupPointSnapshot as Prisma.InputJsonValue,
        recipientSnapshot: params.recipientSnapshot as Prisma.InputJsonValue,
        pickupCodeDigest: this.digest(pickupCode),
        pickupTokenDigest: this.digest(pickupToken),
        pickupCredentialEncrypted: encryptJsonValue({ pickupCode, pickupToken }) as Prisma.InputJsonValue,
        events: {
          create: {
            fromStatus: null,
            toStatus: 'PREPARING',
            eventType: 'PAYMENT_CREATED',
            actorType: 'SYSTEM',
          },
        },
      },
    });
    return created;
  }

  async markReady(companyId: string, staffId: string, orderId: string) {
    return this.markReadyForActor({ actorType: 'SELLER_STAFF', actorId: staffId, companyId }, orderId);
  }

  async markReadyByAdmin(adminUserId: string, orderId: string) {
    return this.markReadyForActor({ actorType: 'ADMIN', actorId: adminUserId }, orderId);
  }

  private async markReadyForActor(actor: PickupOperationActor, orderId: string) {
    return this.withSerializableRetry(async (tx) => {
      const fulfillment = await tx.pickupFulfillment.findUnique({
        where: { orderId },
        include: { order: { include: { items: { select: { companyId: true } } } } },
      });
      if (!fulfillment || fulfillment.order.fulfillmentMode !== 'PICKUP') {
        throw new NotFoundException('自提订单不存在');
      }
      this.assertActorCanOperateOrder(fulfillment.order, actor);
      if (fulfillment.status === 'READY') {
        await this.emitReadyOutbox(tx, orderId, actor);
        return {
          orderId,
          status: 'READY' as const,
          readyAt: fulfillment.readyAt,
          alreadyReady: true,
        };
      }
      if (fulfillment.status !== 'PREPARING' || fulfillment.order.status !== 'PAID') {
        throw new ConflictException('当前订单状态无法标记备货完成');
      }
      const now = new Date();
      const updated = await tx.pickupFulfillment.updateMany({
        where: { id: fulfillment.id, status: 'PREPARING' },
        data: { status: 'READY', readyAt: now },
      });
      if (updated.count !== 1) throw new ConflictException('自提状态已变更，请刷新');
      await tx.pickupFulfillmentEvent.create({
        data: {
          fulfillmentId: fulfillment.id,
          fromStatus: 'PREPARING',
          toStatus: 'READY',
          eventType: actor.actorType === 'ADMIN' ? 'ADMIN_READY' : 'SELLER_READY',
          actorType: actor.actorType,
          actorId: actor.actorId,
        },
      });
      await this.emitReadyOutbox(tx, orderId, actor);
      return { orderId, status: 'READY' as const, readyAt: now, alreadyReady: false };
    });
  }

  private emitReadyOutbox(tx: Tx, orderId: string, actor: PickupOperationActor) {
    return this.notificationService.emit({
      eventType: 'order.pickupReady',
      aggregateType: 'order',
      aggregateId: orderId,
      idempotencyKey: `order.pickup_ready:${orderId}`,
      actor: { kind: actor.actorType === 'ADMIN' ? 'admin' : 'seller', id: actor.actorId },
      payload: { orderId },
    }, tx as any);
  }

  async verify(companyId: string, staffId: string, orderId: string, dto: VerifyPickupDto) {
    return this.verifyForActor({ actorType: 'SELLER_STAFF', actorId: staffId, companyId }, orderId, dto);
  }

  async verifyByAdmin(adminUserId: string, orderId: string, dto: VerifyPickupDto) {
    return this.verifyForActor({ actorType: 'ADMIN', actorId: adminUserId }, orderId, dto);
  }

  private async verifyForActor(actor: PickupOperationActor, orderId: string, dto: VerifyPickupDto) {
    this.assertExactlyOneCredential(dto);
    const result = await this.withSerializableRetry(async (tx) => {
      const fulfillment = await tx.pickupFulfillment.findUnique({
        where: { orderId },
        include: { order: { include: { items: { select: { companyId: true, isPrize: true } } } } },
      });
      if (!fulfillment || fulfillment.order.fulfillmentMode !== 'PICKUP') {
        throw new NotFoundException('自提订单不存在');
      }
      this.assertActorCanOperateOrder(fulfillment.order, actor);
      if (fulfillment.status === 'PICKED_UP' && fulfillment.order.status === 'RECEIVED') {
        return {
          order: fulfillment.order,
          orderId,
          status: 'PICKED_UP' as const,
          pickedUpAt: fulfillment.pickedUpAt,
          alreadyPickedUp: true,
          newlyPickedUp: false,
        };
      }
      if (fulfillment.status !== 'READY' || fulfillment.order.status !== 'PAID') {
        throw new ConflictException('当前订单未到可核销状态');
      }
      this.assertCredential(fulfillment, dto);

      const now = new Date();
      const [returnWindowDays, normalReturnDays, freshReturnHours] = await Promise.all([
        getConfigValue(tx as any, 'RETURN_WINDOW_DAYS', 7),
        getConfigValue(tx as any, 'NORMAL_RETURN_DAYS', 7),
        getConfigValue(tx as any, 'FRESH_RETURN_HOURS', 24),
      ]);
      const returnWindowExpiresAt = new Date(
        now.getTime() + resolveRewardSafeWindowMs(
          returnWindowDays,
          normalReturnDays,
          freshReturnHours,
        ),
      );
      const pickupCas = await tx.pickupFulfillment.updateMany({
        where: { id: fulfillment.id, status: 'READY' },
        data: { status: 'PICKED_UP', pickedUpAt: now, pickedUpByStaffId: actor.actorId },
      });
      if (pickupCas.count !== 1) throw new ConflictException('取货凭证已被核销');
      const orderCas = await tx.order.updateMany({
        where: { id: orderId, status: 'PAID', fulfillmentMode: 'PICKUP' },
        data: {
          status: 'RECEIVED',
          receivedAt: now,
          deliveredAt: now,
          returnWindowExpiresAt,
        },
      });
      if (orderCas.count !== 1) throw new ConflictException('订单状态已变更，核销未生效');
      await tx.pickupFulfillmentEvent.create({
        data: {
          fulfillmentId: fulfillment.id,
          fromStatus: 'READY',
          toStatus: 'PICKED_UP',
          eventType: actor.actorType === 'ADMIN' ? 'ADMIN_VERIFIED' : 'SELLER_VERIFIED',
          actorType: actor.actorType,
          actorId: actor.actorId,
        },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: 'PAID',
          toStatus: 'RECEIVED',
          reason: actor.actorType === 'ADMIN' ? '平台管理员核销自提凭证' : '卖家核销自提凭证',
          meta: { pickupFulfillmentId: fulfillment.id, actorType: actor.actorType, actorId: actor.actorId },
        },
      });
      const receivedCount = await tx.order.count({
        where: { userId: fulfillment.order.userId, status: 'RECEIVED' },
      });
      if (this.orderReceivedEffectsService) {
        await this.orderReceivedEffectsService.enqueueInTransaction(tx, {
          orderId,
          userId: fulfillment.order.userId,
          source: 'PICKUP_VERIFY',
          isFirstReceived: receivedCount === 1,
        });
      }
      return {
        order: { ...fulfillment.order, status: 'RECEIVED', receivedAt: now, _isFirstReceived: receivedCount === 1 },
        orderId,
        status: 'PICKED_UP' as const,
        pickedUpAt: now,
        alreadyPickedUp: false,
        newlyPickedUp: true,
        receivedEffectsPersisted: Boolean(this.orderReceivedEffectsService),
      };
    });

    if (result.newlyPickedUp) {
      if (result.receivedEffectsPersisted) {
        this.orderReceivedEffectsService!.kick(orderId);
      } else {
        // 仅供直接 new PickupService 的旧单测试构造；生产 onModuleInit fail-closed。
        await this.dispatchPostReceiveSideEffects(result.order).catch((error: unknown) => {
          this.logger.error(`自提核销后收货副作用执行失败: orderId=${orderId}; error=${String((error as any)?.message ?? error)}`);
        });
      }
    }
    const {
      order: _order,
      newlyPickedUp: _newlyPickedUp,
      receivedEffectsPersisted: _receivedEffectsPersisted,
      ...response
    } = result;
    return response;
  }

  /**
   * 核销台的第一步：只解析并复核凭证，不改变订单或履约状态。
   * 绝不把短码/二维码内容返回给浏览器，也不把它们写进事件或日志。
   */
  async resolveCredential(companyId: string, dto: VerifyPickupDto) {
    return this.resolveCredentialForActor({ actorType: 'SELLER_STAFF', actorId: '', companyId }, dto);
  }

  async resolveCredentialByAdmin(adminUserId: string, dto: VerifyPickupDto) {
    return this.resolveCredentialForActor({ actorType: 'ADMIN', actorId: adminUserId }, dto);
  }

  private async resolveCredentialForActor(actor: PickupOperationActor, dto: VerifyPickupDto) {
    this.assertExactlyOneCredential(dto);
    const fulfillment = await this.findFulfillmentForCredential(this.prisma, dto, true);
    if (!fulfillment || fulfillment.order.fulfillmentMode !== 'PICKUP') {
      throw new NotFoundException('取货凭证不存在或已失效');
    }
    this.assertActorCanOperateOrder(fulfillment.order, actor);
    const alreadyPickedUp = fulfillment.status === 'PICKED_UP' && fulfillment.order.status === 'RECEIVED';
    if (!alreadyPickedUp) {
      if (fulfillment.status !== 'READY' || fulfillment.order.status !== 'PAID') {
        throw new ConflictException('当前订单未到可核销状态');
      }
      this.assertCredential(fulfillment, dto);
    }
    const preview = this.toCredentialPreview(fulfillment, alreadyPickedUp);
    if (actor.actorType !== 'ADMIN') return preview;

    const companyIds = Array.from(new Set<string>(
      (fulfillment.order.items ?? [])
        .map((item: any) => item.companyId)
        .filter((companyId: unknown): companyId is string => typeof companyId === 'string' && Boolean(companyId)),
    )).sort();
    if (!companyIds.length) throw new ConflictException('订单企业信息不完整，不能在平台核销台操作');
    const companies = await this.prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (companies.length !== companyIds.length) {
      throw new ConflictException('订单企业信息不完整，不能在平台核销台操作');
    }
    return { ...preview, companies };
  }

  /**
   * 全局扫码核销入口。解析仅用于定位订单，实际状态变更仍完全复用
   * 按订单核销的 Serializable/CAS 主链，避免扫码台绕开既有安全守门。
   */
  async verifyCredential(companyId: string, staffId: string, dto: VerifyPickupDto) {
    const preview = await this.resolveCredential(companyId, dto);
    return this.verify(companyId, staffId, preview.orderId, dto);
  }

  async verifyCredentialByAdmin(adminUserId: string, dto: VerifyPickupDto) {
    const preview = await this.resolveCredentialByAdmin(adminUserId, dto);
    return this.verifyByAdmin(adminUserId, preview.orderId, dto);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePickedUpSideEffects() {
    const pending = await this.prisma.pickupFulfillment.findMany({
      where: {
        status: 'PICKED_UP',
        events: { none: { eventType: 'RECEIVE_SIDE_EFFECTS_COMPLETED' } },
        // 新链路由 OrderReceivedEffectOutbox 完全托管；这个 cron 只补旧数据，
        // 禁止与 outbox 并发重放同一副作用。
        order: { receivedEffectOutbox: { none: {} } },
      },
      include: {
        order: { include: { items: true } },
      },
      orderBy: [{ pickedUpAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    for (const fulfillment of pending) {
      await this.dispatchPostReceiveSideEffects(fulfillment.order).catch((error: unknown) => {
        this.logger.warn(`自提收货副作用补偿失败: orderId=${fulfillment.orderId}; error=${String((error as any)?.message ?? error)}`);
      });
    }
  }

  private async dispatchPostReceiveSideEffects(order: any) {
    if (!this.orderService) throw new ServiceUnavailableException('订单收货服务不可用');
    const claim = await this.withSerializableRetry(async (tx) => {
      const fulfillment = await tx.pickupFulfillment.findUnique({
        where: { orderId: order.id },
        select: {
          id: true,
          status: true,
          events: {
            where: {
              eventType: {
                in: [
                  'RECEIVE_SIDE_EFFECTS_PROCESSING',
                  'RECEIVE_SIDE_EFFECTS_COMPLETED',
                  'RECEIVE_SIDE_EFFECTS_FAILED',
                ],
              },
            },
            select: { eventType: true, createdAt: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
          },
        },
      });
      if (!fulfillment || fulfillment.status !== 'PICKED_UP') return null;
      const latest = fulfillment.events[0];
      if (latest?.eventType === 'RECEIVE_SIDE_EFFECTS_COMPLETED') return null;
      const leaseCutoff = Date.now() - 30 * 60 * 1000;
      if (
        latest?.eventType === 'RECEIVE_SIDE_EFFECTS_PROCESSING'
        && latest.createdAt.getTime() > leaseCutoff
      ) {
        return null;
      }
      const event = await tx.pickupFulfillmentEvent.create({
        data: {
          fulfillmentId: fulfillment.id,
          fromStatus: 'PICKED_UP',
          toStatus: 'PICKED_UP',
          eventType: 'RECEIVE_SIDE_EFFECTS_PROCESSING',
          actorType: 'SYSTEM',
          meta: latest ? { retryAfterExpiredClaimAt: latest.createdAt.toISOString() } : undefined,
        },
      });
      return { fulfillmentId: fulfillment.id, claimEventId: event.id };
    });
    if (!claim) return;

    try {
      await this.orderService.handlePickupReceived(order);
      await this.prisma.pickupFulfillmentEvent.create({
        data: {
          fulfillmentId: claim.fulfillmentId,
          fromStatus: 'PICKED_UP',
          toStatus: 'PICKED_UP',
          eventType: 'RECEIVE_SIDE_EFFECTS_COMPLETED',
          actorType: 'SYSTEM',
          meta: { claimEventId: claim.claimEventId },
        },
      });
    } catch (error) {
      await this.prisma.pickupFulfillmentEvent.create({
        data: {
          fulfillmentId: claim.fulfillmentId,
          fromStatus: 'PICKED_UP',
          toStatus: 'PICKED_UP',
          eventType: 'RECEIVE_SIDE_EFFECTS_FAILED',
          actorType: 'SYSTEM',
          meta: { claimEventId: claim.claimEventId },
        },
      }).catch(() => undefined);
      throw error;
    }
  }

  async getBuyerPass(userId: string, orderId: string) {
    const fulfillment = await this.prisma.pickupFulfillment.findUnique({
      where: { orderId },
      include: { order: { select: { userId: true, fulfillmentMode: true } } },
    });
    if (!fulfillment || fulfillment.order.userId !== userId) {
      throw new NotFoundException('自提凭证不存在');
    }
    if (fulfillment.status !== 'READY') {
      throw new ConflictException('自提凭证尚未可用或已失效');
    }
    const credentials = decryptJsonValue<{ pickupCode?: string; pickupToken?: string }>(
      fulfillment.pickupCredentialEncrypted,
    );
    if (!credentials?.pickupCode || !credentials?.pickupToken) {
      throw new ServiceUnavailableException('自提凭证暂时无法读取');
    }
    // 取货页会轮询刷新，对同一买家/履约每分钟记录一次访问即可满足
    // 可追溯性，同时避免无意义地写入高频轮询事件。审计元数据严禁携带短码/token。
    const recentView = await this.prisma.pickupFulfillmentEvent.findFirst({
      where: {
        fulfillmentId: fulfillment.id,
        eventType: 'BUYER_PASS_VIEWED',
        actorType: 'BUYER',
        actorId: userId,
        createdAt: { gte: new Date(Date.now() - PASS_VIEW_AUDIT_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (!recentView) {
      await this.prisma.pickupFulfillmentEvent.create({
        data: {
          fulfillmentId: fulfillment.id,
          fromStatus: 'READY',
          toStatus: 'READY',
          eventType: 'BUYER_PASS_VIEWED',
          actorType: 'BUYER',
          actorId: userId,
        },
      });
    }
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + PASS_TTL_SECONDS;
    const qrPayload = this.buildQrPayload(fulfillment.id, credentials.pickupToken, expiresAtSeconds);
    const qrImage = await this.buildBuyerPassQrImage(qrPayload);
    return {
      orderId,
      status: 'READY' as const,
      pickupCode: credentials.pickupCode,
      qrPayload,
      ...qrImage,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      pickupPoint: this.mapPointSnapshot(fulfillment.pickupPointSnapshot),
      recipient: this.mapRecipient(fulfillment.recipientSnapshot),
    };
  }

  private async buildBuyerPassQrImage(qrPayload: string): Promise<{
    qrImageMimeType: 'image/png' | null;
    qrImageBase64: string | null;
  }> {
    try {
      const image = await QRCode.toBuffer(qrPayload, {
        type: 'png',
        width: 448,
        margin: 4,
        errorCorrectionLevel: 'M',
        color: { dark: '#142C1A', light: '#FFFFFFFF' },
      });
      const validPng = image.length >= PNG_SIGNATURE.length + PNG_IEND.length
        && image.length <= PASS_QR_MAX_BYTES
        && image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
        && image.subarray(-PNG_IEND.length).equals(PNG_IEND);
      if (!validPng) throw new Error('invalid PNG');
      return { qrImageMimeType: 'image/png', qrImageBase64: image.toString('base64') };
    } catch {
      this.logger.warn('取货二维码图片生成失败，买家仍可使用 8 位短码');
      return { qrImageMimeType: null, qrImageBase64: null };
    }
  }

  async listAdminEvents(orderId: string) {
    const fulfillment = await this.prisma.pickupFulfillment.findUnique({
      where: { orderId },
      select: { id: true },
    });
    if (!fulfillment) throw new NotFoundException('自提订单不存在');
    const items = await this.prisma.pickupFulfillmentEvent.findMany({
      where: { fulfillmentId: fulfillment.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        eventType: item.eventType,
        fromStatus: item.fromStatus,
        toStatus: item.toStatus,
        actorType: item.actorType,
        actorId: item.actorId,
        createdAt: item.createdAt.toISOString(),
        meta: item.meta,
      })),
    };
  }

  async voidForOrders(
    tx: Tx,
    orderIds: string[],
    toStatus: Extract<PickupFulfillmentStatus, 'VOID' | 'CANCELED'>,
    reason: string,
    actorType = 'SYSTEM',
    actorId?: string,
  ) {
    const fulfillments = await tx.pickupFulfillment.findMany({
      where: { orderId: { in: orderIds }, status: { in: ['PREPARING', 'READY'] } },
      select: { id: true, status: true },
    });
    const now = new Date();
    for (const fulfillment of fulfillments) {
      const cas = await tx.pickupFulfillment.updateMany({
        where: { id: fulfillment.id, status: fulfillment.status },
        data: { status: toStatus, voidedAt: now, voidReason: reason },
      });
      if (cas.count !== 1) throw new ConflictException('自提状态已变更，无法作废');
      await tx.pickupFulfillmentEvent.create({
        data: {
          fulfillmentId: fulfillment.id,
          fromStatus: fulfillment.status,
          toStatus,
          eventType: toStatus === 'CANCELED' ? 'ORDER_CANCELED' : 'CREDENTIAL_VOIDED',
          actorType,
          actorId,
          meta: { reason },
        },
      });
    }
  }

  mapOrderPickup(fulfillment: any) {
    if (!fulfillment) return null;
    return {
      status: fulfillment.status,
      pickupPoint: this.mapPointSnapshot(fulfillment.pickupPointSnapshot),
      recipient: this.mapRecipient(fulfillment.recipientSnapshot),
      readyAt: fulfillment.readyAt?.toISOString?.() ?? fulfillment.readyAt ?? null,
      pickedUpAt: fulfillment.pickedUpAt?.toISOString?.() ?? fulfillment.pickedUpAt ?? null,
      pickedUpByStaffId: fulfillment.pickedUpByStaffId ?? null,
    };
  }

  private pickupPointCreateData(
    companyId: string,
    dto: CreatePickupPointDto,
  ): Prisma.PickupPointUncheckedCreateInput {
    return {
      companyId,
      name: dto.name.trim(),
      contactName: dto.contactName.trim(),
      contactPhone: encryptText(dto.contactPhone)!,
      regionCode: dto.regionCode.trim(),
      regionText: dto.regionText.trim(),
      detail: dto.detail.trim(),
      location: dto.location as Prisma.InputJsonValue | undefined,
      businessHours: dto.businessHours as unknown as Prisma.InputJsonValue,
      pickupNotice: dto.pickupNotice?.trim() || null,
      isActive: dto.isActive ?? true,
    };
  }

  private pickupPointUpdateData(dto: UpdatePickupPointDto): Prisma.PickupPointUpdateInput {
    return {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.contactName !== undefined ? { contactName: dto.contactName.trim() } : {}),
      ...(dto.contactPhone !== undefined ? { contactPhone: encryptText(dto.contactPhone)! } : {}),
      ...(dto.regionCode !== undefined ? { regionCode: dto.regionCode.trim() } : {}),
      ...(dto.regionText !== undefined ? { regionText: dto.regionText.trim() } : {}),
      ...(dto.detail !== undefined ? { detail: dto.detail.trim() } : {}),
      ...(dto.location !== undefined
        ? {
            location: dto.location === null
              ? Prisma.DbNull
              : dto.location as unknown as Prisma.InputJsonValue,
          }
        : {}),
      ...(dto.businessHours !== undefined ? { businessHours: dto.businessHours as unknown as Prisma.InputJsonValue } : {}),
      ...(dto.pickupNotice !== undefined ? { pickupNotice: dto.pickupNotice.trim() || null } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
  }

  private async writeAdminPointAudit(
    tx: Tx,
    params: {
      action: 'CREATE' | 'UPDATE' | 'DELETE';
      before?: any;
      after?: any;
      reason?: string;
      audit: AdminPointAuditContext;
    },
  ) {
    const before = params.before ? this.adminPointAuditSnapshot(params.before) : undefined;
    const after = params.after ? this.adminPointAuditSnapshot(params.after) : undefined;
    const diff = params.before && params.after
      ? this.adminPointAuditDiff(params.before, params.after)
      : undefined;
    const actionLabel = params.action === 'CREATE'
      ? '创建'
      : params.action === 'DELETE'
        ? '删除'
        : '更新';
    const safeReason = params.reason?.trim()
      ? String(sanitizeForLog(params.reason.trim(), { maxStringLength: 200 }))
      : '';

    await tx.adminAuditLog.create({
      data: {
        adminUserId: params.audit.adminUserId,
        action: params.action,
        module: 'pickup',
        targetType: 'PickupPoint',
        targetId: params.after?.id ?? params.before?.id,
        summary: `${actionLabel}自提点${safeReason ? `；原因：${safeReason}` : ''}`,
        before,
        after,
        diff,
        ip: params.audit.ip,
        userAgent: params.audit.userAgent,
        requestId: params.audit.requestId,
        isReversible: false,
      },
    });
  }

  private adminPointAuditSnapshot(point: any): Prisma.InputJsonValue {
    const snapshot = this.mapPointForAdmin(point);
    return JSON.parse(JSON.stringify(sanitizeForLog({
      ...snapshot,
      contactName: this.maskName(snapshot.contactName),
    }))) as Prisma.InputJsonValue;
  }

  private adminPointAuditDiff(beforePoint: any, afterPoint: any): Prisma.InputJsonValue | undefined {
    // Compare the original owner-visible values first. Comparing already-masked
    // values would miss a phone change when only the middle four digits differ.
    const oldValue = this.mapPointForAdmin(beforePoint) as Record<string, unknown>;
    const newValue = this.mapPointForAdmin(afterPoint) as Record<string, unknown>;
    const diff: Record<string, {
      old: Prisma.JsonValue | null;
      new: Prisma.JsonValue | null;
      changed: true;
    }> = {};
    for (const key of new Set([...Object.keys(oldValue), ...Object.keys(newValue)])) {
      if (key === 'createdAt' || key === 'updatedAt') continue;
      if (JSON.stringify(oldValue[key]) !== JSON.stringify(newValue[key])) {
        diff[key] = {
          old: this.adminPointAuditValue(key, oldValue[key]),
          new: this.adminPointAuditValue(key, newValue[key]),
          changed: true,
        };
      }
    }
    return Object.keys(diff).length ? diff as unknown as Prisma.InputJsonValue : undefined;
  }

  private adminPointAuditValue(key: string, value: unknown): Prisma.JsonValue | null {
    const safeValue = key === 'contactName' && typeof value === 'string'
      ? this.maskName(value)
      : sanitizeForLog(value);
    if (safeValue === undefined) return null;
    return JSON.parse(JSON.stringify(safeValue)) as Prisma.JsonValue;
  }

  /**
   * A platform hub is discoverable only for companies in its declared coverage.
   * This guard is shared by buyer discovery and server-side checkout validation;
   * the client may never turn a platform-owned point into a cross-company point.
   */
  private pointServesCompany(point: {
    companyId: string;
    kind?: PickupPointKind;
    coverage?: PickupPointCoverage;
    company?: { isPlatform: boolean };
    serviceCompanies?: Array<{ companyId: string }>;
  }, companyId: string) {
    const kind = point.kind ?? PickupPointKind.MERCHANT;
    if (kind === PickupPointKind.MERCHANT) return point.companyId === companyId;
    if (!point.company?.isPlatform) return false;
    const coverage = point.coverage ?? PickupPointCoverage.OWNER_COMPANY;
    if (coverage === PickupPointCoverage.ALL_ACTIVE_COMPANIES) return true;
    if (coverage === PickupPointCoverage.SELECTED_COMPANIES) {
      return Boolean(point.serviceCompanies?.some((item) => item.companyId === companyId));
    }
    return false;
  }

  private assertSellerOwnsOrder(order: any, companyId: string) {
    const companyIds = new Set((order.items ?? []).map((item: any) => item.companyId).filter(Boolean));
    if (companyIds.size !== 1 || !companyIds.has(companyId)) {
      throw new NotFoundException('自提订单不存在');
    }
  }

  private assertActorCanOperateOrder(order: any, actor: PickupOperationActor) {
    if (actor.actorType === 'SELLER_STAFF') {
      this.assertSellerOwnsOrder(order, actor.companyId);
    }
    // ADMIN is gated by pickup_fulfillment:operate at the controller. The
    // service deliberately does not infer this authority from point ownership,
    // shipping permission, or a broad order-read capability.
  }

  private assertExactlyOneCredential(dto: VerifyPickupDto) {
    const hasPickupCode = Boolean(this.pickupCodeFrom(dto));
    const hasQrPayload = Boolean(this.qrPayloadFrom(dto));
    if (hasPickupCode === hasQrPayload) {
      throw new BadRequestException('取货码和二维码内容必须且只能提交一项');
    }
  }

  private pickupCodeFrom(dto: VerifyPickupDto) {
    return typeof dto.pickupCode === 'string' ? dto.pickupCode.trim() : '';
  }

  private qrPayloadFrom(dto: VerifyPickupDto) {
    return typeof dto.qrPayload === 'string' ? dto.qrPayload.trim() : '';
  }

  private async findFulfillmentForCredential(prisma: any, dto: VerifyPickupDto, includePreview: boolean) {
    const orderInclude = includePreview
      ? {
          items: {
            select: {
              companyId: true,
              isPrize: true,
              quantity: true,
              productSnapshot: true,
              sku: {
                select: {
                  title: true,
                  skuCode: true,
                  barcode: true,
                  product: { select: { title: true } },
                },
              },
            },
          },
        }
      : { items: { select: { companyId: true, isPrize: true } } };
    const include = { order: { include: orderInclude } };

    const pickupCode = this.pickupCodeFrom(dto);
    if (pickupCode) {
      const candidates = await prisma.pickupFulfillment.findMany({
        where: {
          pickupCodeDigest: this.digest(pickupCode),
          status: { in: ['READY', 'PICKED_UP'] },
        },
        include,
        take: 2,
      });
      if (candidates.length > 1) {
        throw new ConflictException('取货码匹配到多个订单，请从订单详情核销');
      }
      return candidates[0] ?? null;
    }

    const { fulfillmentId } = this.parseQrPayload(this.qrPayloadFrom(dto));
    return prisma.pickupFulfillment.findUnique({ where: { id: fulfillmentId }, include });
  }

  private toCredentialPreview(fulfillment: any, alreadyPickedUp: boolean) {
    return {
      orderId: fulfillment.orderId,
      status: fulfillment.status,
      alreadyPickedUp,
      pickupPoint: this.mapPointSnapshot(fulfillment.pickupPointSnapshot),
      recipient: this.mapRecipient(fulfillment.recipientSnapshot),
      items: (fulfillment.order.items ?? []).map((item: any) => {
        const snapshot = item.productSnapshot && typeof item.productSnapshot === 'object'
          ? item.productSnapshot as Record<string, unknown>
          : {};
        const title = typeof snapshot.title === 'string'
          ? snapshot.title
          : typeof snapshot.productTitle === 'string'
            ? snapshot.productTitle
            : item.sku?.product?.title ?? '商品';
        const skuTitle = typeof snapshot.skuTitle === 'string'
          ? snapshot.skuTitle
          : item.sku?.title ?? '';
        return {
          title,
          skuTitle,
          quantity: item.quantity,
          // 商品条码只用于卖家现场的第二道“拿对货”核对；它绝不能替代
          // 买家一次性凭证，也不参与订单状态变更。
          skuCode: item.sku?.skuCode ?? null,
          barcode: item.sku?.barcode ?? null,
        };
      }),
    };
  }

  private assertCredential(fulfillment: any, dto: VerifyPickupDto) {
    const pickupCode = this.pickupCodeFrom(dto);
    if (pickupCode) {
      if (!this.safeDigestEquals(fulfillment.pickupCodeDigest, this.digest(pickupCode))) {
        throw new BadRequestException('取货码无效');
      }
      return;
    }
    const qrPayload = this.qrPayloadFrom(dto);
    if (!qrPayload) throw new BadRequestException('请扫描取货二维码或输入取货码');
    const { fulfillmentId, token } = this.parseQrPayload(qrPayload);
    if (fulfillmentId !== fulfillment.id || !this.safeDigestEquals(fulfillment.pickupTokenDigest, this.digest(token))) {
      throw new BadRequestException('取货二维码无效');
    }
  }

  private parseQrPayload(raw: string) {
    const parts = raw.trim().split('.');
    if (parts.length !== 6 || parts[0] !== 'AIMMPICKUP' || parts[1] !== '1') {
      throw new BadRequestException('取货二维码无效');
    }
    const [, , fulfillmentId, expiresRaw, token, signature] = parts;
    const expiresAt = Number(expiresRaw);
    if (!fulfillmentId || !token || !Number.isInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('取货二维码已过期或无效');
    }
    const expectedSignature = this.signQr(`${fulfillmentId}.${expiresRaw}.${token}`);
    if (!this.safeDigestEquals(signature, expectedSignature)) {
      throw new BadRequestException('取货二维码无效');
    }
    return { fulfillmentId, token };
  }

  private buildQrPayload(fulfillmentId: string, token: string, expiresAtSeconds: number) {
    const body = `${fulfillmentId}.${expiresAtSeconds}.${token}`;
    return `AIMMPICKUP.1.${body}.${this.signQr(body)}`;
  }

  private signQr(body: string) {
    return createHmac('sha256', this.credentialSecret()).update(body).digest('base64url');
  }

  private credentialSecret() {
    const secret = process.env.PICKUP_TOKEN_SECRET || process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('自提凭证服务配置不完整');
    }
    return secret || 'nongmai-dev-pickup-token-key';
  }

  private digest(value: string) {
    return createHmac('sha256', this.credentialSecret()).update(value).digest('hex');
  }

  private safeDigestEquals(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private buildPointSnapshot(point: any) {
    return {
      id: point.id,
      companyId: point.companyId,
      kind: point.kind ?? PickupPointKind.MERCHANT,
      name: point.name,
      contactName: point.contactName,
      contactPhone: point.contactPhone,
      regionCode: point.regionCode,
      regionText: point.regionText,
      detail: point.detail,
      location: point.location ?? null,
      businessHours: point.businessHours,
      pickupNotice: point.pickupNotice ?? null,
    };
  }

  private mapPointForBuyer(point: any) {
    const phone = decryptText(point.contactPhone) ?? '';
    return {
      id: point.id,
      companyId: point.companyId,
      kind: point.kind ?? PickupPointKind.MERCHANT,
      isPlatformHub: (point.kind ?? PickupPointKind.MERCHANT) === PickupPointKind.PLATFORM_HUB,
      name: point.name,
      contactName: this.maskName(point.contactName),
      contactPhoneMasked: this.maskPhone(phone),
      regionText: point.regionText,
      detail: point.detail,
      location: point.location,
      businessHours: point.businessHours,
      pickupNotice: point.pickupNotice,
    };
  }

  private mapPointForOwner(point: any) {
    return {
      id: point.id,
      companyId: point.companyId,
      kind: point.kind ?? PickupPointKind.MERCHANT,
      coverage: point.coverage ?? PickupPointCoverage.OWNER_COMPANY,
      name: point.name,
      contactName: point.contactName,
      contactPhone: decryptText(point.contactPhone) ?? '',
      regionCode: point.regionCode,
      regionText: point.regionText,
      detail: point.detail,
      location: point.location,
      businessHours: point.businessHours,
      pickupNotice: point.pickupNotice,
      isActive: point.isActive,
      createdAt: point.createdAt,
      updatedAt: point.updatedAt,
    };
  }

  private mapPointForAdmin(point: any) {
    return {
      ...this.mapPointForOwner(point),
      company: point.company ?? null,
      serviceCompanies: (point.serviceCompanies ?? []).map((item: any) => ({
        id: item.company?.id ?? item.companyId,
        name: item.company?.name ?? '',
      })),
      deletedAt: point.deletedAt ?? null,
      deletedByAdminId: point.deletedByAdminId ?? null,
      deleteReason: point.deleteReason ?? null,
    };
  }

  private mapPointSnapshot(raw: unknown) {
    const point = (decryptJsonValue<any>(raw) ?? {}) as any;
    const phone = decryptText(point.contactPhone) ?? point.contactPhone ?? '';
    return {
      id: point.id ?? null,
      companyId: point.companyId ?? null,
      kind: point.kind ?? PickupPointKind.MERCHANT,
      isPlatformHub: (point.kind ?? PickupPointKind.MERCHANT) === PickupPointKind.PLATFORM_HUB,
      name: point.name ?? '',
      contactName: this.maskName(point.contactName ?? ''),
      contactPhoneMasked: this.maskPhone(phone),
      regionCode: point.regionCode ?? '',
      regionText: point.regionText ?? '',
      detail: point.detail ?? '',
      location: point.location ?? null,
      businessHours: point.businessHours ?? null,
      pickupNotice: point.pickupNotice ?? null,
    };
  }

  private mapRecipient(raw: unknown) {
    const recipient = decryptJsonValue<any>(raw) ?? {};
    return {
      name: this.maskName(recipient.recipientName ?? recipient.name ?? ''),
      phoneMasked: this.maskPhone(recipient.phone ?? recipient.recipientPhone ?? ''),
    };
  }

  private maskName(value: string) {
    if (!value) return '';
    return value.length === 1 ? '*' : `${value[0]}${'*'.repeat(Math.min(2, value.length - 1))}`;
  }

  private maskPhone(value: string) {
    if (!/^\d{11}$/.test(value)) return value ? '***' : '';
    return `${value.slice(0, 3)}****${value.slice(-4)}`;
  }

  private async withSerializableRetry<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, SERIALIZABLE_OPTIONS);
      } catch (error: any) {
        if (error?.code === 'P2034' && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('操作冲突，请重试');
  }
}
