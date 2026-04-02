import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupStatusDto } from './dto/update-group-status.dto';

@Injectable()
export class GroupService {
  constructor(private prisma: PrismaService) {}

  /** 考察团列表 */
  async list() {
    const groups = await this.prisma.group.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return groups.map((g) => this.mapGroup(g));
  }

  /** 企业考察团列表 */
  async listByCompany(companyId: string) {
    const groups = await this.prisma.group.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });

    return groups.map((g) => this.mapGroup(g));
  }

  /** 考察团详情 */
  async getById(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('考察团不存在');

    return this.mapGroup(group);
  }

  /** 创建考察团 */
  async create(dto: CreateGroupDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
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
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('考察团不存在');

    if (group.status !== 'FORMING') {
      throw new BadRequestException('该考察团当前不接受报名');
    }

    // 按 userId + groupId 去重：已加入过则不允许重复加入
    const existingBooking = await this.prisma.booking.findFirst({
      where: {
        userId,
        groupId: id,
        status: { in: ['JOINED', 'PAID'] },
      },
    });
    if (existingBooking) {
      throw new BadRequestException('您已参加该考察团，不可重复加入');
    }

    // 固定 +1（忽略客户端传入的 count）
    const newMemberCount = group.memberCount + 1;

    // 达到阈值自动更新状态
    const newStatus =
      newMemberCount >= group.targetSize && group.status === 'FORMING'
        ? 'INVITING'
        : group.status;

    const updated = await this.prisma.group.update({
      where: { id },
      data: {
        memberCount: newMemberCount,
        status: newStatus,
      },
    });

    return this.mapGroup(updated);
  }

  /** 更新考察团状态 */
  async updateStatus(id: string, dto: UpdateGroupStatusDto) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('考察团不存在');

    const updated = await this.prisma.group.update({
      where: { id },
      data: { status: dto.status.toUpperCase() as any },
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
