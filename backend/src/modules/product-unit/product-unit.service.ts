import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProductUnitService {
  constructor(private prisma: PrismaService) {}

  /** 启用中的单位下拉项，sortOrder asc → name asc */
  async listActive() {
    return this.prisma.productUnit.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, sortOrder: true },
    });
  }
}
