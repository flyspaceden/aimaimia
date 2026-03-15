import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminUpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class AdminProductsService {
  constructor(private prisma: PrismaService) {}

  /** 商品列表（管理端） */
  async findAll(
    page = 1,
    pageSize = 20,
    status?: string,
    auditStatus?: string,
    keyword?: string,
    companyId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (status) where.status = status;
    if (auditStatus) where.auditStatus = auditStatus;
    if (companyId) where.companyId = companyId;
    if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
    if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate + 'T23:59:59') };
    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { id: keyword },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true, status: true } },
          category: { select: { id: true, name: true } },
          skus: { select: { id: true, price: true, cost: true, stock: true } },
          media: { select: { url: true }, take: 1 },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** 商品统计 */
  async getStats() {
    const [byStatus, byAudit] = await Promise.all([
      this.prisma.product.groupBy({ by: ['status'], _count: true }),
      this.prisma.product.groupBy({ by: ['auditStatus'], _count: true }),
    ]);
    const result: Record<string, number> = {};
    let total = 0;
    for (const g of byStatus) {
      result[g.status] = g._count;
      total += g._count;
    }
    for (const g of byAudit) {
      result[`AUDIT_${g.auditStatus}`] = g._count;
    }
    result.ALL = total;
    return result;
  }

  /** 商品详情 */
  async findById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        skus: true,
        media: true,
        tags: { include: { tag: true } },
      },
    });
    if (!product) throw new NotFoundException('商品不存在');
    return product;
  }

  /** 更新商品 */
  async update(id: string, dto: AdminUpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('商品不存在');

    return this.prisma.product.update({
      where: { id },
      data: dto,
    });
  }

  /** 上下架 */
  async toggleStatus(id: string, status: 'ACTIVE' | 'INACTIVE') {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('商品不存在');

    return this.prisma.product.update({
      where: { id },
      data: { status },
    });
  }

  /** 审核 */
  async audit(id: string, auditStatus: 'APPROVED' | 'REJECTED', auditNote?: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('商品不存在');

    return this.prisma.product.update({
      where: { id },
      data: { auditStatus, auditNote },
    });
  }

  /** 清除语义字段来源标记，使 SemanticFillService 可以重新填充 */
  async clearSemanticMeta(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, attributes: true },
    });
    if (!product) throw new NotFoundException('商品不存在');

    const attributes = (product.attributes as Record<string, unknown>) ?? {};
    // 删除 semanticMeta，让 fillProduct 将所有字段视为可覆盖
    const updatedAttributes = { ...attributes };
    delete updatedAttributes['semanticMeta'];

    return this.prisma.product.update({
      where: { id },
      data: { attributes: updatedAttributes as any },
    });
  }
}
