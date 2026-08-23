import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupStatusDto } from './dto/update-group-status.dto';

const JOIN_MAX_RETRIES = 3;

class RetryableGroupJoinConflict extends Error {}

export type JoinGroupBookingInput = {
  expectedCompanyId?: string;
  existingBookingId?: string;
  identity?: string;
  contactName?: string;
};

type JoinableGroup = {
  status: string;
  deadline: string;
  memberCount: number;
  targetSize: number;
};

@Injectable()
export class GroupService {
  constructor(private prisma: PrismaService) {}

  /** 考察团列表 */
  async list() {
    const groups = await this.prisma.group.findMany({
      where: { company: { status: 'ACTIVE', isPlatform: false } },
      orderBy: { createdAt: 'desc' },
    });

    return groups.map((g) => this.mapGroup(g));
  }

  /** 企业考察团列表 */
  async listByCompany(companyId: string) {
    const groups = await this.prisma.group.findMany({
      where: {
        companyId,
        company: { status: 'ACTIVE', isPlatform: false },
      },
      orderBy: { createdAt: 'desc' },
    });

    return groups.map((g) => this.mapGroup(g));
  }

  /** 考察团详情 */
  async getById(id: string) {
    const group = await this.prisma.group.findFirst({
      where: { id, company: { status: 'ACTIVE', isPlatform: false } },
    });
    if (!group) throw new NotFoundException('考察团不存在');

    return this.mapGroup(group);
  }

  /** 创建考察团 */
  async create(dto: CreateGroupDto) {
    const company = await this.prisma.company.findFirst({
      where: { id: dto.companyId, status: 'ACTIVE', isPlatform: false },
    });
    if (!company) throw new BadRequestException('企业不存在');

    const group = await this.prisma.group.create({
      data: {
        companyId: dto.companyId,
        title: dto.title,
        destination: dto.destination,
        targetSize: dto.targetSize,
        deadline: dto.deadline,
        status: 'FORMING',
        memberCount: 0,
      },
    });

    return this.mapGroup(group);
  }

  /** 一键参团（H1修复：注入 userId，按用户去重，每次固定 +1） */
  async join(id: string, userId: string) {
    const result = await this.joinWithBooking(id, userId);
    return this.mapGroup(result.group);
  }

  /**
   * 原子参团：两条买家入口共用同一事务，避免 booking 与 memberCount 部分成功。
   * 重复调用返回已有 booking，不重复增加人数。
   */
  async joinWithBooking(
    id: string,
    userId: string,
    input: JoinGroupBookingInput = {},
  ) {
    if (!userId) throw new BadRequestException('未获取到当前买家身份');
    for (let attempt = 0; attempt < JOIN_MAX_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const group = await tx.group.findFirst({
            where: {
              id,
              company: { status: 'ACTIVE', isPlatform: false },
            },
          });
          if (!group) throw new NotFoundException('考察团不存在');

          if (input.expectedCompanyId && input.expectedCompanyId !== group.companyId) {
            throw new BadRequestException('考察团与企业不匹配');
          }

          const existingBooking = await tx.booking.findFirst({
            where: {
              ...(input.existingBookingId ? { id: input.existingBookingId } : {}),
              userId,
              companyId: group.companyId,
              groupId: id,
            },
            orderBy: { createdAt: 'asc' },
          });
          if (existingBooking && ['JOINED', 'PAID'].includes(existingBooking.status)) {
            return { group, booking: existingBooking, joined: false as const };
          }

          if (input.existingBookingId && !existingBooking) {
            throw new BadRequestException('邀请记录不存在或状态已变化');
          }
          if (existingBooking && existingBooking.status !== 'INVITED') {
            throw new BadRequestException('该用户已有本考察团的不可复用预约记录');
          }

          this.assertGroupAcceptsJoining(group);

          let booking: any;
          if (existingBooking) {
            const claimedBooking = await tx.booking.updateMany({
              where: {
                id: existingBooking.id,
                userId,
                companyId: group.companyId,
                groupId: group.id,
                status: 'INVITED',
              },
              data: { status: 'JOINED' },
            });
            if (claimedBooking.count !== 1) {
              throw new RetryableGroupJoinConflict();
            }
            booking = { ...existingBooking, status: 'JOINED' };
          } else {
            // 人数口径固定为每个用户 1 人；不信任客户端传入的 headcount。
            booking = await tx.booking.create({
              data: {
                userId,
                companyId: group.companyId,
                groupId: group.id,
                date: new Date().toISOString().slice(0, 10),
                headcount: 1,
                identity: input.identity ?? 'consumer',
                contactName: input.contactName,
                status: 'JOINED',
              },
            });
          }

          const newMemberCount = group.memberCount + 1;
          const newStatus = newMemberCount >= group.targetSize ? 'INVITING' : 'FORMING';
          const claimed = await tx.group.updateMany({
            where: {
              id: group.id,
              status: 'FORMING',
              memberCount: group.memberCount,
              targetSize: group.targetSize,
              deadline: group.deadline,
              company: { status: 'ACTIVE', isPlatform: false },
            },
            data: {
              memberCount: newMemberCount,
              status: newStatus,
            },
          });
          if (claimed.count !== 1) {
            throw new RetryableGroupJoinConflict();
          }

          return {
            group: { ...group, memberCount: newMemberCount, status: newStatus },
            booking,
            joined: true as const,
          };
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: any) {
        const retryable = error instanceof RetryableGroupJoinConflict
          || error?.code === 'P2034'
          || error?.code === 'P2002';
        if (retryable && attempt < JOIN_MAX_RETRIES - 1) continue;
        if (retryable) throw new ConflictException('参团人数发生变化，请重试');
        throw error;
      }
    }

    throw new ConflictException('参团人数发生变化，请重试');
  }

  /** 邀请和直接参团共用的 fail-closed 团状态校验。 */
  assertGroupAcceptsJoining(group: JoinableGroup) {
    if (group.status !== 'FORMING') {
      throw new BadRequestException('该考察团当前不接受报名');
    }
    if (!Number.isInteger(group.targetSize) || group.targetSize <= 0 || group.memberCount >= group.targetSize) {
      throw new BadRequestException('该考察团名额已满');
    }

    const deadlineTime = this.parseDeadlineEnd(group.deadline);
    if (deadlineTime === null) {
      throw new BadRequestException('考察团截止日期无效');
    }
    if (Date.now() > deadlineTime) {
      throw new BadRequestException('该考察团已截止报名');
    }
  }

  private parseDeadlineEnd(deadline: string): number | null {
    const normalized = deadline?.trim();
    if (!normalized) return null;
    // 纯日期按中国业务日当天 23:59:59.999 截止，避免服务器时区导致提前过期。
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    if (dateOnly) {
      const year = Number(dateOnly[1]);
      const month = Number(dateOnly[2]);
      const day = Number(dateOnly[3]);
      const daysInMonth = month >= 1 && month <= 12
        ? new Date(Date.UTC(year, month, 0)).getUTCDate()
        : 0;
      if (day < 1 || day > daysInMonth) return null;
    }
    const value = dateOnly ? `${normalized}T23:59:59.999+08:00` : normalized;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** 更新考察团状态 */
  async updateStatus(id: string, dto: UpdateGroupStatusDto) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('考察团不存在');

    const updated = await this.prisma.group.update({
      where: { id },
      data: { status: dto.status },
    });

    return this.mapGroup(updated);
  }

  /** 映射为前端 Group 类型 */
  private mapGroup(group: any) {
    return {
      id: group.id,
      companyId: group.companyId,
      title: group.title,
      destination: group.destination,
      targetSize: group.targetSize,
      memberCount: group.memberCount,
      deadline: group.deadline,
      status: group.status.toLowerCase(),
      createdAt: group.createdAt instanceof Date
        ? group.createdAt.toISOString()
        : group.createdAt,
    };
  }
}
