import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTraceBatchDto, UpdateTraceBatchDto } from './seller-trace.dto';

@Injectable()
export class SellerTraceService {
  constructor(private prisma: PrismaService) {}

  /** 我的溯源批次列表 */
  async findAll(companyId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const where = { companyId };

    const [items, total] = await Promise.all([
      this.prisma.traceBatch.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { events: true, productTraceLinks: true } },
        },
      }),
      this.prisma.traceBatch.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** 批次详情 */
  async findById(companyId: string, batchId: string) {
    const batch = await this.prisma.traceBatch.findUnique({
      where: { id: batchId },
      include: {
        events: { orderBy: { occurredAt: 'asc' } },
        productTraceLinks: {
          include: { product: { select: { id: true, title: true } } },
        },
      },
    });
    if (!batch) throw new NotFoundException('批次不存在');
    if (batch.companyId !== companyId) throw new ForbiddenException('无权访问该批次');
    return batch;
  }

  /** 创建批次 */
  async create(companyId: string, dto: CreateTraceBatchDto) {
    return this.prisma.traceBatch.create({
      data: {
        companyId,
        batchCode: dto.batchCode,
        meta: dto.meta,
      },
    });
  }

  /** 更新批次 */
  async update(companyId: string, batchId: string, dto: UpdateTraceBatchDto) {
    const batch = await this.prisma.traceBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('批次不存在');
    if (batch.companyId !== companyId) throw new ForbiddenException('无权操作该批次');

    return this.prisma.traceBatch.update({
      where: { id: batchId },
      data: {
        batchCode: dto.batchCode,
        meta: dto.meta,
      },
    });
  }

  /** 删除批次 */
  async remove(companyId: string, batchId: string) {
    const batch = await this.prisma.traceBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('批次不存在');
    if (batch.companyId !== companyId) throw new ForbiddenException('无权操作该批次');

    await this.prisma.traceBatch.delete({ where: { id: batchId } });
    return { ok: true };
  }
}
