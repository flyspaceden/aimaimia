import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ReviewBookingDto } from './dto/review-booking.dto';
import { InviteBookingDto } from './dto/invite-booking.dto';
import { JoinGroupDto } from './dto/join-group.dto';
import { maskName, maskPhone } from '../../common/security/privacy-mask';

@Injectable()
export class BookingService {
  constructor(private prisma: PrismaService) {}

  /** 预约列表（当前用户） */
  async list(userId: string) {
    const bookings = await this.prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return bookings.map((b) => this.mapBooking(b));
  }

  /** 企业预约列表 */
  async listByCompany(companyId: string) {
    const bookings = await this.prisma.booking.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });

    return bookings.map((b) => this.mapBooking(b));
  }

  /** 提交预约 */
  async create(userId: string, dto: CreateBookingDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
    });
    if (!company) throw new BadRequestException('企业不存在');

    const booking = await this.prisma.booking.create({
      data: {
        userId,
        companyId: dto.companyId,
        activityId: dto.eventId,
        date: dto.date,
        headcount: dto.headcount,
        identity: dto.identity,
        note: dto.note,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        status: 'PENDING',
      },
    });

    return this.mapBooking(booking);
  }

  /** 审核预约（通过/驳回）— H3修复：校验调用者是该 booking 所属企业的卖家 */
  async review(id: string, dto: ReviewBookingDto, callerCompanyId?: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('预约不存在');

    // H3修复：校验 booking 归属当前卖家的企业
    if (callerCompanyId && booking.companyId !== callerCompanyId) {
      throw new ForbiddenException('无权审核其他企业的预约');
    }

    if (booking.status !== 'PENDING') {
      throw new BadRequestException('当前状态不可审核');
    }

    const statusMap: Record<string, any> = {
      approved: 'APPROVED',
      rejected: 'REJECTED',
    };

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: statusMap[dto.status] || dto.status.toUpperCase(),
        auditNote: dto.note,
        reviewedAt: new Date(),
      },
    });

    return this.mapBooking(updated);
  }

  /** 发起成团邀请 — H4修复：校验调用者是该 booking 所属企业的卖家 */
  async inviteToGroup(id: string, dto: InviteBookingDto, callerCompanyId?: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('预约不存在');

    // H4修复：校验 booking 归属当前卖家的企业
    if (callerCompanyId && booking.companyId !== callerCompanyId) {
      throw new ForbiddenException('无权操作其他企业的预约');
    }

    const group = await this.prisma.group.findUnique({
      where: { id: dto.groupId },
    });
    if (!group) throw new BadRequestException('考察团不存在');

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'INVITED',
        groupId: dto.groupId,
      },
    });

    return this.mapBooking(updated);
  }

  /** 用户确认参团 */
  async confirmJoin(id: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('预约不存在');
    if (booking.userId !== userId) throw new NotFoundException('预约不存在');

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: 'JOINED' },
    });

    return this.mapBooking(updated);
  }

  /** 一键参团入口 */
  async joinGroup(userId: string, dto: JoinGroupDto) {
    const group = await this.prisma.group.findUnique({
      where: { id: dto.groupId },
    });
    if (!group) throw new BadRequestException('考察团不存在');

    const booking = await this.prisma.booking.create({
      data: {
        userId,
        companyId: dto.companyId,
        groupId: dto.groupId,
        date: new Date().toISOString().slice(0, 10),
        headcount: dto.headcount ?? 1,
        identity: dto.identity ?? 'consumer',
        contactName: dto.contactName,
        status: 'JOINED',
      },
    });

    return this.mapBooking(booking);
  }

  /** 标记支付完成 */
  async markPaid(id: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('预约不存在');
    if (booking.userId !== userId) throw new NotFoundException('预约不存在');

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: 'PAID' },
    });

    return this.mapBooking(updated);
  }

  /** 映射为前端 Booking 类型（H14修复：只返回脱敏版联系信息，不返回原始值） */
  private mapBooking(booking: any) {
    return {
      id: booking.id,
      companyId: booking.companyId,
      eventId: booking.activityId || undefined,
      date: booking.date,
      headcount: booking.headcount,
      identity: booking.identity,
      note: booking.note || undefined,
      contactNameMasked: maskName(booking.contactName || undefined) || undefined,
      contactPhoneMasked: maskPhone(booking.contactPhone || undefined) || undefined,
      status: booking.status.toLowerCase(),
      createdAt: booking.createdAt instanceof Date
        ? booking.createdAt.toISOString()
        : booking.createdAt,
      reviewedAt: booking.reviewedAt instanceof Date
        ? booking.reviewedAt.toISOString()
        : booking.reviewedAt || undefined,
      auditNote: booking.auditNote || undefined,
      groupId: booking.groupId || undefined,
    };
  }
}
