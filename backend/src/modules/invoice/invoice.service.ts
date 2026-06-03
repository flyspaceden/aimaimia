import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceProfileDto } from './dto/create-invoice-profile.dto';
import { UpdateInvoiceProfileDto } from './dto/update-invoice-profile.dto';
import { RequestInvoiceDto } from './dto/request-invoice.dto';
import { encryptJsonValue, decryptJsonValue } from '../../common/security/encryption';
import { AdminInvoicesService } from '../admin/invoices/admin-invoices.service';

@Injectable()
export class InvoiceService {
  constructor(
    private prisma: PrismaService,
    private adminInvoicesService: AdminInvoicesService,
  ) {}

  private async runSerializable<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) continue;
        throw e;
      }
    }
    throw new ConflictException('操作冲突，请重试');
  }

  private unwrapRuleValue(row: { value: unknown } | null | undefined, fallback: unknown) {
    const raw = row?.value as any;
    if (raw && typeof raw === 'object' && 'value' in raw) return raw.value;
    return raw ?? fallback;
  }

  private async getInvoiceAllowVipPackage(tx: Prisma.TransactionClient): Promise<boolean> {
    const row = await tx.ruleConfig.findUnique({
      where: { key: 'INVOICE_ALLOW_VIP_PACKAGE' },
      select: { value: true },
    });
    return this.unwrapRuleValue(row, false) === true;
  }

  private buildProfileSnapshot(profile: any) {
    return {
      type: profile.type,
      title: profile.title,
      taxNo: profile.taxNo,
      email: profile.email,
      phone: profile.phone,
      bankInfo: profile.bankInfo
        ? (decryptJsonValue(profile.bankInfo) as Record<string, string>)
        : null,
      address: profile.address,
    };
  }

  // ===== 发票抬头管理 =====

  /** 获取用户所有发票抬头 */
  async getProfiles(userId: string) {
    const profiles = await this.prisma.invoiceProfile.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    // 解密 bankInfo
    return profiles.map((p) => ({
      ...p,
      bankInfo: p.bankInfo ? decryptJsonValue(p.bankInfo) : null,
    }));
  }

  /** 创建发票抬头 */
  async createProfile(userId: string, dto: CreateInvoiceProfileDto) {
    const data: any = {
      userId,
      type: dto.type,
      title: dto.title,
      taxNo: dto.taxNo || null,
      email: dto.email || null,
      phone: dto.phone || null,
      address: dto.address || null,
      bankInfo: dto.bankInfo ? encryptJsonValue(dto.bankInfo) : null,
    };
    const profile = await this.prisma.invoiceProfile.create({ data });
    return {
      ...profile,
      bankInfo: dto.bankInfo || null,
    };
  }

  /** 修改发票抬头 */
  async updateProfile(userId: string, profileId: string, dto: UpdateInvoiceProfileDto) {
    const existing = await this.prisma.invoiceProfile.findUnique({
      where: { id: profileId },
    });
    if (!existing) throw new NotFoundException('发票抬头不存在');
    if (existing.userId !== userId) throw new ForbiddenException('无权操作');

    const data: any = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.taxNo !== undefined) data.taxNo = dto.taxNo;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.bankInfo !== undefined) {
      data.bankInfo = dto.bankInfo ? encryptJsonValue(dto.bankInfo) : null;
    }

    // 从企业切换为个人时，清除企业专属字段
    if (dto.type === 'PERSONAL' && existing.type === 'COMPANY') {
      data.taxNo = null;
      data.bankInfo = null;
      data.address = null;
    }

    const updated = await this.prisma.invoiceProfile.update({
      where: { id: profileId },
      data,
    });
    return {
      ...updated,
      bankInfo: updated.bankInfo ? decryptJsonValue(updated.bankInfo) : null,
    };
  }

  /** 删除发票抬头 */
  async deleteProfile(userId: string, profileId: string) {
    const existing = await this.prisma.invoiceProfile.findUnique({
      where: { id: profileId },
    });
    if (!existing) throw new NotFoundException('发票抬头不存在');
    if (existing.userId !== userId) throw new ForbiddenException('无权操作');

    await this.prisma.invoiceProfile.delete({ where: { id: profileId } });
    return { ok: true };
  }

  // ===== 发票申请 =====

  /**
   * Fire-and-forget 触发自动开票。
   * - 仅在 settings.autoIssue=true 时触发
   * - HTTP 响应立即返回 REQUESTED，不等 issue 完成
   * - 失败由 AdminInvoicesService.markAutoIssueAttemptFailure 软失败兜底
   * - 任何异常被 catch 吞掉，避免污染请求上下文
   */
  private triggerAutoIssue(invoiceId: string) {
    Promise.resolve().then(async () => {
      try {
        const settings = await this.adminInvoicesService.getInvoiceSettings();
        if (!settings.autoIssue) return;
        await this.adminInvoicesService.issueInvoice(
          invoiceId,
          { mode: settings.providerMode },
          null,
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[auto-issue] unexpected error', invoiceId, e);
      }
    });
  }

  /** 申请开票 */
  async requestInvoice(userId: string, dto: RequestInvoiceDto) {
    try {
      const invoice = await this.runSerializable(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: dto.orderId },
          select: {
            id: true,
            userId: true,
            status: true,
            bizType: true,
            invoice: {
              select: {
                id: true,
                status: true,
                requestCount: true,
                profileSnapshot: true,
              },
            },
          },
        });
        if (!order) throw new NotFoundException('订单不存在');
        if (order.userId !== userId) throw new ForbiddenException('无权操作');
        if (order.status !== 'RECEIVED') {
          throw new BadRequestException('仅已确认收货的订单可申请发票');
        }
        if (order.bizType === 'VIP_PACKAGE') {
          const allowVipPackage = await this.getInvoiceAllowVipPackage(tx);
          if (!allowVipPackage) {
            throw new BadRequestException('VIP 礼包暂不支持申请发票');
          }
        }
        if (order.invoice && !['CANCELED', 'FAILED'].includes(order.invoice.status)) {
          throw new ConflictException('该订单已申请过发票');
        }

        const profile = await tx.invoiceProfile.findUnique({
          where: { id: dto.profileId },
        });
        if (!profile) throw new NotFoundException('发票抬头不存在');
        if (profile.userId !== userId) throw new ForbiddenException('无权操作');
        if (profile.type === 'COMPANY' && !profile.taxNo) {
          throw new BadRequestException('企业发票抬头必须填写税号');
        }

        const requestedAt = new Date();
        const profileSnapshot = this.buildProfileSnapshot(profile);

        if (order.invoice) {
          const previousStatus = order.invoice.status;
          const invoice = await tx.invoice.update({
            where: { id: order.invoice.id },
            data: {
              profileSnapshot,
              status: 'REQUESTED',
              invoiceNo: null,
              pdfUrl: null,
              failReason: null,
              provider: null,
              providerRequestId: null,
              providerRaw: Prisma.JsonNull,
              invoiceContentSnapshot: Prisma.JsonNull,
              issuedAt: null,
              failedAt: null,
              canceledAt: null,
              requestedAt,
              requestCount: { increment: 1 },
            },
          });
          await tx.invoiceStatusHistory.create({
            data: {
              invoiceId: invoice.id,
              fromStatus: previousStatus,
              toStatus: 'REQUESTED',
              operatorId: userId,
              operatorType: 'BUYER',
              metadata: {
                previousStatus,
                requestCount: (order.invoice.requestCount || 1) + 1,
              },
            },
          });
          return invoice;
        }

        const invoice = await tx.invoice.create({
          data: {
            orderId: dto.orderId,
            profileSnapshot,
            status: 'REQUESTED',
            requestedAt,
          },
        });
        await tx.invoiceStatusHistory.create({
          data: {
            invoiceId: invoice.id,
            fromStatus: null,
            toStatus: 'REQUESTED',
            operatorId: userId,
            operatorType: 'BUYER',
          },
        });
        return invoice;
      });
      this.triggerAutoIssue(invoice.id);
      return invoice;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('该订单已申请过发票');
      }
      throw e;
    }
  }

  /** 取消发票申请 */
  async cancelInvoice(userId: string, invoiceId: string) {
    return this.runSerializable(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { order: { select: { userId: true } } },
      });
      if (!invoice) throw new NotFoundException('发票不存在');
      if (invoice.order.userId !== userId) throw new ForbiddenException('无权操作');
      if (invoice.status !== 'REQUESTED') {
        throw new BadRequestException('仅已申请状态的发票可取消');
      }

      const canceledAt = new Date();
      const result = await tx.invoice.updateMany({
        where: { id: invoiceId, status: 'REQUESTED', providerRequestId: null },
        data: { status: 'CANCELED', canceledAt },
      });
      if (result.count === 0) {
        throw new ConflictException('发票状态已变更或正在开票，请刷新后重试');
      }

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus: 'REQUESTED',
          toStatus: 'CANCELED',
          operatorId: userId,
          operatorType: 'BUYER',
        },
      });
      return { ok: true };
    });
  }

  /** 用户发票列表 */
  async getUserInvoices(userId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const where = { order: { userId } };

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
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** 发票详情 */
  async getInvoiceDetail(userId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        order: {
          select: {
            id: true,
            userId: true,
            totalAmount: true,
            goodsAmount: true,
            shippingFee: true,
            status: true,
            createdAt: true,
          },
        },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!invoice) throw new NotFoundException('发票不存在');
    if (invoice.order.userId !== userId) throw new ForbiddenException('无权操作');
    return invoice;
  }
}
