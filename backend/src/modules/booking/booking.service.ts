import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ReviewBookingDto } from './dto/review-booking.dto';
import { InviteBookingDto } from './dto/invite-booking.dto';
import { JoinGroupDto } from './dto/join-group.dto';
import { maskName, maskPhone } from '../../common/security/privacy-mask';
import { GroupService } from '../group/group.service';

@Injectable()
export class BookingService {
  constructor(
    private prisma: PrismaService,
    private groupService: GroupService,
  ) {}

  /** 预约列表（当前用户） */
  async list(userId: string) {
    const bookings = await this.prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return bookings.map((b) => this.mapBooking(b));
  }

  /** 当前买家在指定企业的预约列表 */
  async listByCompany(userId: string, companyId: string) {
    if (!userId) throw new ForbiddenException('未获取到当前买家身份');
    const bookings = await this.prisma.booking.findMany({
      where: {
        userId,
        companyId,
        company: { status: 'ACTIVE', isPlatform: false },
      },
      orderBy: { createdAt: 'desc' },
    });

    return bookings.map((b) => this.mapBooking(b));
  }

  /** 提交预约 */
  async create(userId: string, dto: CreateBookingDto) {
    const booking = await this.prisma.$transaction(async (tx) => {
      if (dto.eventId) {
        const activity = await tx.companyActivity.findFirst({
          where: {
            id: dto.eventId,
            companyId: dto.companyId,
            company: { status: 'ACTIVE', isPlatform: false },
          },
          select: { id: true },
        });
        if (!activity) throw new BadRequestException('活动不存在或不可预约');
      } else {
        const company = await tx.company.findFirst({
          where: { id: dto.companyId, status: 'ACTIVE', isPlatform: false },
          select: { id: true },
        });
        if (!company) throw new BadRequestException('企业不存在或不可预约');
      }

      return tx.booking.create({
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
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
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

  /** 发起成团邀请：企业归属、团状态和预约状态在同一事务内校验。 */
  async inviteToGroup(id: string, dto: InviteBookingDto, callerCompanyId: string) {
    if (!callerCompanyId) throw new ForbiddenException('未获取到当前卖家企业身份');
    const updated = await this.runSerializableWithRetry(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id, companyId: callerCompanyId },
      });
      if (!booking) throw new NotFoundException('预约不存在');
      if (booking.status !== 'APPROVED') {
        throw new BadRequestException('仅已通过审核的预约可邀请参团');
      }

      const group = await tx.group.findFirst({
        where: {
          id: dto.groupId,
          companyId: callerCompanyId,
          company: { status: 'ACTIVE', isPlatform: false },
        },
      });
      if (!group) throw new BadRequestException('考察团不存在或不属于当前企业');
      this.groupService.assertGroupAcceptsJoining(group);

      const duplicate = await tx.booking.findFirst({
        where: {
          id: { not: id },
          userId: booking.userId,
          groupId: group.id,
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new BadRequestException('该用户已有本考察团的预约记录');
      }

      const claimed = await tx.booking.updateMany({
        where: {
          id,
          companyId: callerCompanyId,
          status: 'APPROVED',
          groupId: null,
        },
        data: { status: 'INVITED', groupId: group.id },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('预约状态已变化，请刷新后重试');
      }

      return { ...booking, status: 'INVITED', groupId: group.id };
    });

    return this.mapBooking(updated);
  }

  /** 用户确认参团 */
  async confirmJoin(id: string, userId: string) {
    const booking = await this.prisma.booking.findFirst({ where: { id, userId } });
    if (!booking) throw new NotFoundException('预约不存在');
    if (!booking.groupId || !['INVITED', 'JOINED', 'PAID'].includes(booking.status)) {
      throw new BadRequestException('当前预约不可确认参团');
    }

    const result = await this.groupService.joinWithBooking(booking.groupId, userId, {
      expectedCompanyId: booking.companyId,
      existingBookingId: booking.id,
    });
    return this.mapBooking(result.booking);
  }

  /** 一键参团入口 */
  async joinGroup(userId: string, dto: JoinGroupDto) {
    const result = await this.groupService.joinWithBooking(dto.groupId, userId, {
      expectedCompanyId: dto.companyId,
      identity: dto.identity,
      contactName: dto.contactName,
    });
    return this.mapBooking(result.booking);
  }

  /** 买家端不得自行标记支付结果；未接入可信回调前一律 fail-closed。 */
  async markPaid(_id: string, _userId: string) {
    throw new BadRequestException('考察团支付尚未开放');
  }

  private async runSerializableWithRetry<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: any) {
        const retryable = error?.code === 'P2002' || error?.code === 'P2034';
        if (retryable && attempt < 2) continue;
        if (retryable) throw new ConflictException('预约或考察团状态已变化，请重试');
        throw error;
      }
    }
    throw new ConflictException('预约或考察团状态已变化，请重试');
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
