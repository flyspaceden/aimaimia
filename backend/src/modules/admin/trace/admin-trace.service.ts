import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTraceBatchDto, UpdateTraceBatchDto } from './dto/admin-trace.dto';

@Injectable()
export class AdminTraceService {
  constructor(private prisma: PrismaService) {}

  /** 溯源批次列表 */
  async findAll(page = 1, pageSize = 20, companyId?: string) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (companyId) where.companyId = companyId;

    const [items, total] = await Promise.all([
      this.prisma.traceBatch.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true } },
          _count: { select: { events: true } },
        },
      }),
      this.prisma.traceBatch.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** 批次详情 */
  async findById(id: string) {
    const batch = await this.prisma.traceBatch.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true } },
        events: { orderBy: { occurredAt: 'asc' } },
        productTraceLinks: {
          include: { product: { select: { id: true, title: true } } },
        },
      },
    });
    if (!batch) throw new NotFoundException('溯源批次不存在');
    return batch;
  }

  /** 创建批次 */
  async create(dto: CreateTraceBatchDto) {
    return this.prisma.traceBatch.create({
      data: {
        companyId: dto.companyId,
        batchCode: dto.batchCode,
        meta: dto.meta,
      },
    });
  }

  /** 更新批次 */
  async update(id: string, dto: UpdateTraceBatchDto) {
    const batch = await this.prisma.traceBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('溯源批次不存在');

    return this.prisma.traceBatch.update({
      where: { id },
      data: dto,
    });
  }

  /** 删除批次 */
  async remove(id: string) {
    const batch = await this.prisma.traceBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('溯源批次不存在');

    await this.prisma.traceBatch.delete({ where: { id } });
    return { ok: true };
  }
}
