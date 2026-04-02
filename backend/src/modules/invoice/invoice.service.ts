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

@Injectable()
export class InvoiceService {
  constructor(private prisma: PrismaService) {}

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

  /** 申请开票 */
  async requestInvoice(userId: string, dto: RequestInvoiceDto) {
    // 校验订单归属和状态
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      select: { id: true, userId: true, status: true, totalAmount: true, invoice: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.userId !== userId) throw new ForbiddenException('无权操作');
    if (order.status !== 'RECEIVED') {
      throw new BadRequestException('仅已确认收货的订单可申请发票');
    }
    // 一单一票
    if (order.invoice) {
      throw new ConflictException('该订单已申请过发票');
    }

    // 校验抬头归属
    const profile = await this.prisma.invoiceProfile.findUnique({
      where: { id: dto.profileId },
    });
    if (!profile) throw new NotFoundException('发票抬头不存在');
    if (profile.userId !== userId) throw new ForbiddenException('无权操作');

    // 快照抬头信息（解密后存入快照）
    const profileSnapshot = {
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

    const invoice = await this.prisma.invoice.create({
      data: {
        orderId: dto.orderId,
        profileSnapshot,
        status: 'REQUESTED',
      },
    });
    return invoice;
  }

  /** 取消发票申请 */
  async cancelInvoice(userId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { order: { select: { userId: true } } },
    });
    if (!invoice) throw new NotFoundException('发票不存在');
    if (invoice.order.userId !== userId) throw new ForbiddenException('无权操作');
    if (invoice.status !== 'REQUESTED') {
      throw new BadRequestException('仅已申请状态的发票可取消');
    }

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'CANCELED' },
    });
    return { ok: true };
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
        orderBy: { createdAt: 'desc' },
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
      },
    });
    if (!invoice) throw new NotFoundException('发票不存在');
    if (invoice.order.userId !== userId) throw new ForbiddenException('无权操作');
    return invoice;
  }
}
