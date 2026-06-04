import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateProductUnitDto, UpdateProductUnitDto } from './admin-product-units.dto';

@Injectable()
export class AdminProductUnitsService {
  constructor(private prisma: PrismaService) {}

  /** 全部单位（含停用），sortOrder asc → name asc */
  async findAll() {
    return this.prisma.productUnit.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** 创建单位（name 去重，trim 后校验非空） */
  async create(dto: CreateProductUnitDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('单位名称不能为空');
    try {
      return await this.prisma.productUnit.create({
        data: {
          name,
          sortOrder: dto.sortOrder ?? 0,
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('单位已存在');
      }
      throw e;
    }
  }

  /** 更新单位 */
  async update(id: string, dto: UpdateProductUnitDto) {
    const existing = await this.prisma.productUnit.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('单位不存在');

    const data: Prisma.ProductUnitUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('单位名称不能为空');
      data.name = name;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      return await this.prisma.productUnit.update({ where: { id }, data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('单位已存在');
      }
      throw e;
    }
  }

  /** 硬删除（已存在商品的 unit 字符串不受影响，删除安全） */
  async remove(id: string) {
    const existing = await this.prisma.productUnit.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('单位不存在');
    await this.prisma.productUnit.delete({ where: { id } });
    return { ok: true };
  }
}
