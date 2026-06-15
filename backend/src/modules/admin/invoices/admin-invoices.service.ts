import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { validateConfigValue } from '../config/config-validation';
import {
  AdminInvoiceQueryDto,
  FailInvoiceDto,
  IssueInvoiceDto,
  UpdateInvoiceSettingsDto,
} from './dto/admin-invoice.dto';
import { InvoiceProviderFactory } from './provider/invoice-provider.factory';
import {
  InvoiceBuyerSnapshot,
  InvoiceIssueInput,
  InvoiceIssuerProfile,
  InvoiceLineItem,
} from './provider/invoice-provider.interface';
import { normalizeBuyerNo } from '../../../common/utils/buyer-no.util';

type TxClient = Omit<
  PrismaService,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

type InvoiceSettings = {
  providerMode: 'MOCK';
  allowVipPackage: boolean;
  lineMode: 'ORDER_ITEMS' | 'MERGED_CATEGORY';
  defaultTaxRate: number;
  defaultTaxClassificationCode: string;
  defaultGoodsName: string;
  remarkTemplate: string;
  issuerProfile: InvoiceIssuerProfile;
  autoIssue: boolean;
  autoIssueMaxAttempts: number;
};

type InvoiceVisibilityOptions = {
  includeSensitive?: boolean;
};

const MAX_SERIALIZABLE_RETRIES = 3;
const DEFAULT_PROVIDER_RESET_AFTER_MINUTES = 10;
const INVOICE_IN_PROGRESS_MESSAGE = '发票正在开票中，请稍后或先重置卡住的开票任务';

const INVOICE_SETTING_DEFINITIONS = {
  providerMode: {
    key: 'INVOICE_PROVIDER_MODE',
    defaultValue: 'MOCK',
    description: '发票 Provider 模式',
  },
  allowVipPackage: {
    key: 'INVOICE_ALLOW_VIP_PACKAGE',
    defaultValue: false,
    description: 'VIP 礼包是否允许申请发票',
  },
  lineMode: {
    key: 'INVOICE_LINE_MODE',
    defaultValue: 'ORDER_ITEMS',
    description: '发票商品行生成模式',
  },
  defaultTaxRate: {
    key: 'INVOICE_DEFAULT_TAX_RATE',
    defaultValue: 0,
    description: '发票默认税率',
  },
  defaultTaxClassificationCode: {
    key: 'INVOICE_DEFAULT_TAX_CLASSIFICATION_CODE',
    defaultValue: '',
    description: '发票默认税收分类编码',
  },
  defaultGoodsName: {
    key: 'INVOICE_DEFAULT_GOODS_NAME',
    defaultValue: '农产品',
    description: '发票合并商品行默认名称',
  },
  remarkTemplate: {
    key: 'INVOICE_REMARK_TEMPLATE',
    defaultValue: '订单号：【订单号】',
    description: '发票备注模板',
  },
  issuerProfile: {
    key: 'INVOICE_ISSUER_PROFILE',
    defaultValue: {
      companyName: '爱买买app',
      taxNo: '',
      registeredAddress: '',
      registeredPhone: '',
      bankName: '',
      bankAccount: '',
      drawer: '',
      reviewer: '',
      payee: '',
    },
    description: '平台开票主体配置',
  },
  autoIssue: {
    key: 'INVOICE_AUTO_ISSUE',
    defaultValue: true,
    description: '买家申请发票后自动开票',
  },
  autoIssueMaxAttempts: {
    key: 'INVOICE_AUTO_ISSUE_MAX_ATTEMPTS',
    defaultValue: 3,
    description: '自动开票最大重试次数（含首次），超出后标记 FAILED',
  },
} as const;

const INVOICE_SETTING_KEYS = Object.values(INVOICE_SETTING_DEFINITIONS).map((item) => item.key);

@Injectable()
export class AdminInvoicesService {
  constructor(
    private prisma: PrismaService,
    private providerFactory: InvoiceProviderFactory,
    private config?: ConfigService,
  ) {}

  /** 发票列表（含筛选） */
  async findAll(
    query: AdminInvoiceQueryDto,
    page = 1,
    pageSize = 20,
    options: InvoiceVisibilityOptions = {},
  ) {
    const skip = (page - 1) * pageSize;
    const where: any = {};

    if (query.status) where.status = query.status;
    if (query.keyword) {
      const normalizedKeyword = normalizeBuyerNo(query.keyword);
      where.OR = [
        { invoiceNo: { contains: query.keyword } },
        { order: { id: query.keyword } },
        { order: { user: { buyerNo: normalizedKeyword } } },
        { profileSnapshot: { path: ['title'], string_contains: query.keyword } },
      ];
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { requestedAt: 'desc' },
        include: {
          order: {
            select: {
              id: true,
              totalAmount: true,
              status: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  buyerNo: true,
                  profile: { select: { nickname: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      items: items.map((inv) => {
        const snapshot = inv.profileSnapshot as any;
        const order = inv.order;
        const profileSnapshot = this.redactInvoiceProfileSnapshot(snapshot, options.includeSensitive === true);
        return {
          ...inv,
          profileSnapshot,
          invoiceContentSnapshot: this.redactInvoiceContentSnapshot(
            inv.invoiceContentSnapshot as any,
            options.includeSensitive === true,
          ),
          profileType: snapshot?.type || null,
          profileTitle: snapshot?.title || null,
          orderAmount: order?.totalAmount || 0,
          buyerNickname: order?.user?.profile?.nickname || '未知用户',
          order: order ? {
            id: order.id,
            orderNo: order.id,
            totalAmount: order.totalAmount,
            paymentAmount: order.totalAmount,
            status: order.status,
            createdAt: order.createdAt,
            user: {
              id: order.user?.id,
              buyerNo: order.user?.buyerNo ?? null,
              nickname: order.user?.profile?.nickname || '未知用户',
            },
          } : null,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** 发票详情 */
  async findById(id: string, options: InvoiceVisibilityOptions = {}) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        order: {
          select: {
            id: true,
            totalAmount: true,
            goodsAmount: true,
            shippingFee: true,
            status: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                buyerNo: true,
                profile: { select: { nickname: true } },
              },
            },
            items: {
              select: {
                id: true,
                quantity: true,
                unitPrice: true,
                productSnapshot: true,
              },
            },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('发票不存在');

    const order = invoice.order;
    const includeSensitive = options.includeSensitive === true;
    return {
      ...invoice,
      profileSnapshot: this.redactInvoiceProfileSnapshot(invoice.profileSnapshot as any, includeSensitive),
      invoiceContentSnapshot: this.redactInvoiceContentSnapshot(
        invoice.invoiceContentSnapshot as any,
        includeSensitive,
      ),
      order: order ? {
        id: order.id,
        orderNo: order.id,
        totalAmount: order.totalAmount,
        paymentAmount: order.totalAmount,
        goodsAmount: order.goodsAmount,
        shippingFee: order.shippingFee,
        status: order.status,
        createdAt: order.createdAt,
        user: {
          id: order.user?.id,
          buyerNo: order.user?.buyerNo ?? null,
          nickname: order.user?.profile?.nickname || '未知用户',
        },
        items: order.items.map((item) => {
          const snap = item.productSnapshot as any;
          return {
            id: item.id,
            productTitle: snap?.title || '未知商品',
            productImage: snap?.image || null,
            skuName: snap?.skuTitle || null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.unitPrice * item.quantity,
          };
        }),
      } : null,
    };
  }

  /** 各状态数量统计 */
  async getStats() {
    const counts = await this.prisma.invoice.groupBy({
      by: ['status'],
      _count: true,
    });
    const stats: Record<string, number> = {};
    let total = 0;
    for (const c of counts) {
      stats[c.status] = c._count;
      total += c._count;
    }
    stats.ALL = total;
    return stats;
  }

  async getInvoiceSettings(): Promise<InvoiceSettings> {
    return this.getInvoiceSettingsFromClient(this.prisma);
  }

  async updateInvoiceSettings(dto: UpdateInvoiceSettingsDto) {
    const entries = Object.entries(INVOICE_SETTING_DEFINITIONS)
      .filter(([field]) => (dto as any)[field] !== undefined)
      .map(([field, definition]) => ({
        field,
        key: definition.key,
        value: (dto as any)[field],
        description: definition.description,
      }));

    for (const entry of entries) {
      const error = validateConfigValue(entry.key, entry.value);
      if (error) throw new BadRequestException(error);
    }

    await Promise.all(entries.map((entry) => this.prisma.ruleConfig.upsert({
      where: { key: entry.key },
      update: { value: { value: entry.value, description: entry.description } },
      create: { key: entry.key, value: { value: entry.value, description: entry.description } },
    })));

    return { ok: true };
  }

  /**
   * 开票
   * AUTO/MOCK：先用 CAS 预占 providerRequestId，再在事务外调用 provider，最后 CAS 落库。
   * MANUAL：手工录入号码和 PDF，同样写入快照与状态历史。
   */
  async issueInvoice(invoiceId: string, dto: IssueInvoiceDto, adminId: string | null) {
    const mode = this.resolveIssueMode(dto);
    if (mode === 'MANUAL') return this.issueManualInvoice(invoiceId, dto, adminId);

    const reservation = await this.reserveInvoiceForProvider(invoiceId, mode);
    const provider = this.providerFactory.resolve(reservation.provider);

    try {
      const result = await provider.issue(reservation.input);
      await this.finalizeProviderInvoice(invoiceId, reservation.providerRequestId, {
        status: 'ISSUED',
        invoiceNo: result.invoiceNo,
        pdfUrl: result.pdfUrl,
        provider: result.provider,
        providerRequestId: result.providerRequestId,
        providerRaw: this.sanitizeProviderRaw(result.raw) as Prisma.InputJsonValue,
        invoiceContentSnapshot: reservation.snapshot as Prisma.InputJsonValue,
        issuedAt: new Date(),
      }, adminId);
      return { ok: true };
    } catch (error: any) {
      const reason = error?.message || '开票服务调用失败';
      if (adminId === null) {
        // SYSTEM 自动开票：软失败，不降级 status，等 cron 重试
        await this.markAutoIssueAttemptFailure(invoiceId, reservation.providerRequestId, reason);
      } else {
        // ADMIN 主动开票：硬失败，立即翻 FAILED
        await this.markProviderIssueFailed(
          invoiceId,
          reservation.providerRequestId,
          reason,
          adminId,
          error?.raw,
        );
      }
      throw error;
    }
  }

  /**
   * 标记开票失败
   * Serializable 隔离级别 + CAS 防并发
   */
  async failInvoice(invoiceId: string, dto: FailInvoiceDto, adminId?: string) {
    return this.runSerializable(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
      });
      if (!invoice) throw new NotFoundException('发票不存在');
      if (invoice.status !== 'REQUESTED') {
        throw new BadRequestException('仅待开票状态的发票可标记失败');
      }
      if (invoice.providerRequestId) {
        throw new ConflictException(INVOICE_IN_PROGRESS_MESSAGE);
      }

      const result = await tx.invoice.updateMany({
        where: { id: invoiceId, status: 'REQUESTED', providerRequestId: null },
        data: { status: 'FAILED', failReason: dto.reason, failedAt: new Date() },
      });
      if (result.count === 0) {
        throw new ConflictException('发票状态已变更，请刷新后重试');
      }

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus: 'REQUESTED',
          toStatus: 'FAILED',
          reason: dto.reason,
          operatorId: adminId,
          operatorType: 'ADMIN',
        },
      });

      return { ok: true, reason: dto.reason };
    });
  }

  private async issueManualInvoice(invoiceId: string, dto: IssueInvoiceDto, adminId: string | null) {
    if (!dto.invoiceNo || !dto.pdfUrl) {
      throw new BadRequestException('手工开票必须填写发票号码和 PDF 地址');
    }
    this.assertAllowedManualPdfUrl(dto.pdfUrl);

    return this.runSerializable(async (tx) => {
      const invoice = await this.getIssueableInvoice(tx, invoiceId);
      const settings = await this.getInvoiceSettingsFromClient(tx);
      const providerRequestId = `manual-${invoice.id}-${invoice.requestCount || 1}`;
      const { snapshot } = this.buildInvoicePayload(invoice, settings, providerRequestId);

      const result = await tx.invoice.updateMany({
        where: { id: invoiceId, status: 'REQUESTED', providerRequestId: null },
        data: {
          status: 'ISSUED',
          invoiceNo: dto.invoiceNo,
          pdfUrl: dto.pdfUrl,
          provider: 'MANUAL',
          providerRequestId,
          providerRaw: {},
          invoiceContentSnapshot: snapshot as Prisma.InputJsonValue,
          issuedAt: new Date(),
        },
      });
      if (result.count === 0) {
        throw new ConflictException('发票状态已变更，请刷新后重试');
      }

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus: 'REQUESTED',
          toStatus: 'ISSUED',
          operatorId: adminId ?? null,
          operatorType: adminId ? 'ADMIN' : 'SYSTEM',
          metadata: { mode: 'MANUAL' },
        },
      });

      return { ok: true };
    });
  }

  /**
   * 重置卡住的 Provider 预占。
   * 只清理超过保护窗口的 REQUESTED + providerRequestId 记录，避免覆盖真实飞行中的开票。
   */
  async resetProviderReservation(invoiceId: string, adminId?: string) {
    return this.runSerializable(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
      });
      if (!invoice) throw new NotFoundException('发票不存在');
      if (invoice.status !== 'REQUESTED') {
        throw new BadRequestException('仅待开票状态的发票可重置开票任务');
      }
      if (!invoice.providerRequestId) {
        throw new BadRequestException('发票没有开票中的 Provider 任务');
      }

      const resetAfterMinutes = this.getProviderResetAfterMinutes();
      const updatedAt = invoice.updatedAt ? new Date(invoice.updatedAt).getTime() : 0;
      const ageMs = Date.now() - updatedAt;
      if (ageMs < resetAfterMinutes * 60_000) {
        throw new ConflictException('开票任务仍在保护窗口内，请稍后再重置');
      }

      const previousProvider = invoice.provider;
      const previousProviderRequestId = invoice.providerRequestId;
      const resetAt = new Date();
      const providerRaw = {
        resetReason: 'ADMIN_RESET_PROVIDER_RESERVATION',
        previousProvider,
        previousProviderRequestId,
        resetAt: resetAt.toISOString(),
      };

      const result = await tx.invoice.updateMany({
        where: { id: invoiceId, status: 'REQUESTED', providerRequestId: previousProviderRequestId },
        data: {
          provider: null,
          providerRequestId: null,
          providerRaw: providerRaw as Prisma.InputJsonValue,
        },
      });
      if (result.count === 0) {
        throw new ConflictException('发票状态已变更，请刷新后重试');
      }

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus: 'REQUESTED',
          toStatus: 'REQUESTED',
          reason: '重置卡住的开票任务',
          operatorId: adminId,
          operatorType: 'ADMIN',
          metadata: {
            action: 'RESET_PROVIDER_RESERVATION',
            previousProvider,
            previousProviderRequestId,
          },
        },
      });

      return { ok: true, providerRequestId: previousProviderRequestId };
    });
  }

  private async reserveInvoiceForProvider(invoiceId: string, mode: 'AUTO' | 'MOCK') {
    return this.runSerializable(async (tx) => {
      const invoice = await this.getIssueableInvoice(tx, invoiceId);
      const settings = await this.getInvoiceSettingsFromClient(tx);
      const provider = mode === 'MOCK' ? 'MOCK' : settings.providerMode;
      const providerRequestId = `invoice-${invoice.id}-${invoice.requestCount || 1}`;
      const { input, snapshot } = this.buildInvoicePayload(invoice, settings, providerRequestId);

      const result = await tx.invoice.updateMany({
        where: { id: invoiceId, status: 'REQUESTED', providerRequestId: null },
        data: { provider, providerRequestId },
      });
      if (result.count === 0) {
        throw new ConflictException('发票状态已变更或正在开票，请刷新后重试');
      }

      return { provider, providerRequestId, input, snapshot };
    });
  }

  private async finalizeProviderInvoice(
    invoiceId: string,
    providerRequestId: string,
    data: {
      status: InvoiceStatus;
      invoiceNo: string;
      pdfUrl: string;
      provider: string;
      providerRequestId: string;
      providerRaw: Prisma.InputJsonValue;
      invoiceContentSnapshot: Prisma.InputJsonValue;
      issuedAt: Date;
    },
    adminId: string | null,
  ) {
    return this.runSerializable(async (tx) => {
      const result = await tx.invoice.updateMany({
        where: { id: invoiceId, status: 'REQUESTED', providerRequestId },
        data,
      });
      if (result.count === 0) {
        throw new ConflictException('发票状态已变更，请刷新后重试');
      }

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus: 'REQUESTED',
          toStatus: 'ISSUED',
          operatorId: adminId ?? null,
          operatorType: adminId ? 'ADMIN' : 'SYSTEM',
          metadata: { provider: data.provider, providerRequestId },
        },
      });
    });
  }

  private async markProviderIssueFailed(
    invoiceId: string,
    providerRequestId: string,
    reason: string,
    adminId: string | null,
    providerRaw?: unknown,
  ) {
    await this.runSerializable(async (tx) => {
      const result = await tx.invoice.updateMany({
        where: { id: invoiceId, status: 'REQUESTED', providerRequestId },
        data: {
          status: 'FAILED',
          failReason: reason,
          providerRaw: this.sanitizeProviderRaw(providerRaw) as Prisma.InputJsonValue,
          failedAt: new Date(),
        },
      });
      if (result.count === 0) return;

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus: 'REQUESTED',
          toStatus: 'FAILED',
          reason,
          operatorId: adminId ?? null,
          operatorType: 'PROVIDER',
          metadata: { providerRequestId },
        },
      });
    });
  }

  /**
   * 自动开票"软失败"：不降级状态，仅记录 failedAttempts。
   * 仅供 SYSTEM 自动触发链路调用；admin 主动 issue 失败仍走 markProviderIssueFailed。
   */
  async markAutoIssueAttemptFailure(
    invoiceId: string,
    providerRequestId: string,
    reason: string,
  ) {
    return this.runSerializable(async (tx) => {
      const result = await tx.invoice.updateMany({
        where: { id: invoiceId, status: 'REQUESTED', providerRequestId },
        data: {
          provider: null,
          providerRequestId: null,
          failedAttempts: { increment: 1 },
          lastAutoIssueAttemptAt: new Date(),
        },
      });
      if (result.count === 0) return { ok: false };

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus: 'REQUESTED',
          toStatus: 'REQUESTED',
          reason: reason.slice(0, 500),
          operatorType: 'SYSTEM',
          metadata: { action: 'AUTO_ISSUE_ATTEMPT_FAILED', providerRequestId },
        },
      });
      return { ok: true };
    });
  }

  /**
   * 自动开票重试次数耗尽，强制翻 FAILED。供 cron 调用，operatorType=SYSTEM。
   */
  async markAutoIssueRetryExhausted(invoiceId: string) {
    return this.runSerializable(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice || invoice.status !== 'REQUESTED' || invoice.providerRequestId) return { ok: false };

      const result = await tx.invoice.updateMany({
        where: { id: invoiceId, status: 'REQUESTED', providerRequestId: null },
        data: {
          status: 'FAILED',
          failReason: '自动开票多次失败，请联系客服或重新申请',
          failedAt: new Date(),
        },
      });
      if (result.count === 0) return { ok: false };

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus: 'REQUESTED',
          toStatus: 'FAILED',
          reason: '自动开票重试次数耗尽',
          operatorType: 'SYSTEM',
          metadata: { action: 'AUTO_ISSUE_RETRY_EXHAUSTED', failedAttempts: invoice.failedAttempts },
        },
      });

      return { ok: true };
    });
  }

  private async getIssueableInvoice(tx: any, invoiceId: string) {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        order: {
          select: {
            id: true,
            totalAmount: true,
            goodsAmount: true,
            shippingFee: true,
            paidAt: true,
            items: {
              select: {
                id: true,
                quantity: true,
                unitPrice: true,
                productSnapshot: true,
              },
            },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('发票不存在');
    if (invoice.status !== 'REQUESTED') {
      throw new BadRequestException('仅待开票状态的发票可执行开票操作');
    }
    if (invoice.providerRequestId) {
      throw new ConflictException(INVOICE_IN_PROGRESS_MESSAGE);
    }
    if (!invoice.order) throw new BadRequestException('发票订单不存在');
    return invoice;
  }

  private async getInvoiceSettingsFromClient(client: any): Promise<InvoiceSettings> {
    const rows = await client.ruleConfig.findMany({
      where: { key: { in: INVOICE_SETTING_KEYS } },
    });
    const byKey = new Map<string, unknown>(
      rows.map((row: any) => [row.key, row.value] as [string, unknown]),
    );

    return {
      providerMode: this.getRuleValue(byKey, 'providerMode') as InvoiceSettings['providerMode'],
      allowVipPackage: this.getRuleValue(byKey, 'allowVipPackage') as boolean,
      lineMode: this.getRuleValue(byKey, 'lineMode') as InvoiceSettings['lineMode'],
      defaultTaxRate: this.getRuleValue(byKey, 'defaultTaxRate') as number,
      defaultTaxClassificationCode: this.getRuleValue(byKey, 'defaultTaxClassificationCode') as string,
      defaultGoodsName: this.getRuleValue(byKey, 'defaultGoodsName') as string,
      remarkTemplate: this.getRuleValue(byKey, 'remarkTemplate') as string,
      issuerProfile: this.getRuleValue(byKey, 'issuerProfile') as InvoiceIssuerProfile,
      autoIssue: this.getRuleValue(byKey, 'autoIssue') as boolean,
      autoIssueMaxAttempts: this.getRuleValue(byKey, 'autoIssueMaxAttempts') as number,
    };
  }

  private getRuleValue(rows: Map<string, unknown>, field: keyof typeof INVOICE_SETTING_DEFINITIONS) {
    const definition = INVOICE_SETTING_DEFINITIONS[field];
    const raw = rows.get(definition.key);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, 'value')) {
      return (raw as any).value;
    }
    return raw ?? definition.defaultValue;
  }

  private buildInvoicePayload(
    invoice: any,
    settings: InvoiceSettings,
    providerRequestId: string,
  ): { input: InvoiceIssueInput; snapshot: Record<string, unknown> } {
    const buyer = (invoice.profileSnapshot || {}) as InvoiceBuyerSnapshot;
    const lines = this.buildInvoiceLines(invoice.order.items || [], settings);
    const totalAmount = Number(invoice.order.totalAmount || 0);
    const remark = this.renderRemark(settings.remarkTemplate, {
      orderId: invoice.order.id,
      paidAt: invoice.order.paidAt ? new Date(invoice.order.paidAt).toISOString() : '',
      buyerTitle: buyer.title || '',
      totalAmount: totalAmount.toFixed(2),
    });
    const input: InvoiceIssueInput = {
      invoiceId: invoice.id,
      orderId: invoice.order.id,
      providerRequestId,
      buyer,
      issuerProfile: settings.issuerProfile,
      lines,
      totalAmount,
      remark,
    };
    const snapshot = {
      providerMode: settings.providerMode,
      lineMode: settings.lineMode,
      taxRate: settings.defaultTaxRate,
      taxClassificationCode: settings.defaultTaxClassificationCode,
      buyer,
      issuer: settings.issuerProfile,
      order: {
        id: invoice.order.id,
        totalAmount,
        goodsAmount: Number(invoice.order.goodsAmount || 0),
        shippingFee: Number(invoice.order.shippingFee || 0),
        paidAt: invoice.order.paidAt || null,
      },
      lines,
      remark,
    };
    return { input, snapshot };
  }

  private buildInvoiceLines(items: any[], settings: InvoiceSettings): InvoiceLineItem[] {
    if (settings.lineMode === 'MERGED_CATEGORY') {
      const amount = items.reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.quantity || 0), 0);
      return [{
        name: settings.defaultGoodsName,
        quantity: 1,
        unitPrice: amount,
        amount,
        taxRate: settings.defaultTaxRate,
        taxClassificationCode: settings.defaultTaxClassificationCode,
      }];
    }

    return items.map((item) => {
      const snapshot = item.productSnapshot || {};
      const productTitle = snapshot.title || '未知商品';
      const skuTitle = snapshot.skuTitle ? ` ${snapshot.skuTitle}` : '';
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unitPrice || 0);
      return {
        name: `${productTitle}${skuTitle}`,
        quantity,
        unitPrice,
        amount: unitPrice * quantity,
        taxRate: settings.defaultTaxRate,
        taxClassificationCode: settings.defaultTaxClassificationCode,
      };
    });
  }

  private renderRemark(template: string, values: Record<string, string>) {
    // 新版中文 token：【订单号】【支付时间】【发票抬头】【订单金额】
    // 保留旧版 {{orderId}} 占位符兼容历史配置
    const tokenToKey: Record<string, string> = {
      订单号: 'orderId',
      支付时间: 'paidAt',
      发票抬头: 'buyerTitle',
      订单金额: 'totalAmount',
    };
    return template
      .replace(/【([^】]+)】/g, (match, token) => {
        const key = tokenToKey[token];
        if (!key) return match;
        return values[key] ?? '';
      })
      .replace(/\{\{([^}]+)\}\}/g, (_, key) => values[key.trim()] ?? '');
  }

  private sanitizeProviderRaw(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const blocked = /(token|secret|private|cert|password|signature|phone|bank|account)/i;
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>)
        .filter(([key]) => !blocked.test(key)),
    );
  }

  private redactInvoiceProfileSnapshot(snapshot: any, includeSensitive: boolean) {
    if (includeSensitive || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return snapshot;
    }

    return {
      type: snapshot.type,
      title: snapshot.title,
    };
  }

  private redactInvoiceContentSnapshot(snapshot: any, includeSensitive: boolean) {
    if (includeSensitive || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return snapshot;
    }

    const redacted: Record<string, unknown> = { ...snapshot };
    if (snapshot.buyer && typeof snapshot.buyer === 'object' && !Array.isArray(snapshot.buyer)) {
      redacted.buyer = {
        type: snapshot.buyer.type,
        title: snapshot.buyer.title,
      };
    }
    if (snapshot.issuer && typeof snapshot.issuer === 'object' && !Array.isArray(snapshot.issuer)) {
      redacted.issuer = {
        companyName: snapshot.issuer.companyName,
        taxNo: snapshot.issuer.taxNo,
      };
    }
    return redacted;
  }

  private resolveIssueMode(dto: IssueInvoiceDto): 'AUTO' | 'MOCK' | 'MANUAL' {
    if (dto.mode) return dto.mode;
    if (dto.invoiceNo || dto.pdfUrl) return 'MANUAL';
    return 'AUTO';
  }

  private assertAllowedManualPdfUrl(pdfUrl: string) {
    let target: URL;
    try {
      target = new URL(pdfUrl);
    } catch {
      throw new BadRequestException('发票 PDF 地址格式不正确');
    }

    if (!['http:', 'https:'].includes(target.protocol)) {
      throw new BadRequestException('发票 PDF 地址仅支持 HTTP/HTTPS');
    }

    const allowedPrefixes = this.getAllowedManualPdfUrlPrefixes();
    const matched = allowedPrefixes.some((prefix) => this.isUrlUnderPrefix(target, prefix));
    if (!matched) {
      throw new BadRequestException('发票 PDF 地址必须来自平台上传域名');
    }
  }

  private getAllowedManualPdfUrlPrefixes(): string[] {
    const configured = this.getConfigValue('INVOICE_PDF_ALLOWED_URL_PREFIXES');
    const prefixes = configured
      ? configured.split(',').map((item) => item.trim()).filter(Boolean)
      : [];

    const uploadBaseUrl = this.getConfigValue('UPLOAD_BASE_URL', 'http://localhost:3000/uploads');
    if (uploadBaseUrl) prefixes.push(uploadBaseUrl);

    const privateBaseUrl = this.getConfigValue('UPLOAD_PRIVATE_BASE_URL');
    if (privateBaseUrl) prefixes.push(privateBaseUrl);

    const ossBucket = this.getConfigValue('OSS_BUCKET');
    const ossRegion = this.getConfigValue('OSS_REGION');
    if (ossBucket && ossRegion) {
      prefixes.push(`https://${ossBucket}.${ossRegion}.aliyuncs.com`);
    }

    return [...new Set(prefixes)];
  }

  private isUrlUnderPrefix(target: URL, prefixText: string): boolean {
    let prefix: URL;
    try {
      prefix = new URL(prefixText);
    } catch {
      return false;
    }

    if (target.origin !== prefix.origin) return false;
    const prefixPath = prefix.pathname.endsWith('/')
      ? prefix.pathname
      : `${prefix.pathname}/`;
    return target.pathname === prefix.pathname || target.pathname.startsWith(prefixPath);
  }

  private getProviderResetAfterMinutes(): number {
    const raw = this.getConfigValue('INVOICE_PROVIDER_RESET_AFTER_MINUTES');
    const parsed = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_PROVIDER_RESET_AFTER_MINUTES;
    return parsed;
  }

  private getConfigValue(key: string, fallback?: string): string | undefined {
    const configValue = this.config?.get<string>(key);
    return configValue ?? process.env[key] ?? fallback;
  }

  private async runSerializable<T>(handler: (tx: TxClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_SERIALIZABLE_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(handler, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: any) {
        if (error?.code === 'P2034' && attempt < MAX_SERIALIZABLE_RETRIES - 1) continue;
        throw error;
      }
    }
    throw new ConflictException('事务冲突，请重试');
  }
}
