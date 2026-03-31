import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductService } from '../../product/product.service';
import { CreateCategoryDto, UpdateCategoryDto, BatchSortDto } from './admin-categories.dto';

@Injectable()
export class AdminCategoriesService {
  constructor(
    private prisma: PrismaService,
    private productService: ProductService,
  ) {}

  /** 获取完整分类树（含停用） */
  async findAll() {
    return this.prisma.category.findMany({
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { products: true, children: true } },
      },
    });
  }

  /** 创建分类 */
  async create(dto: CreateCategoryDto) {
    let parentPath = '';
    let level = 1;

    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) throw new NotFoundException('父级分类不存在');
      // 支持多级分类，不再限制层级
      parentPath = parent.path;
      level = parent.level + 1;
    }

    const path = parentPath ? `${parentPath}/${dto.name}` : `/${dto.name}`;

    try {
      const category = await this.prisma.category.create({
        data: {
          name: dto.name,
          parentId: dto.parentId || null,
          path,
          level,
          sortOrder: dto.sortOrder ?? 0,
          ...(dto.returnPolicy ? { returnPolicy: dto.returnPolicy } : {}),
        },
      });
      this.productService.invalidateCategoriesCache();
      return category;
    } catch (err) {
      // path 有 @unique 约束，利用数据库保证唯一性
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('同名分类已存在');
      }
      throw err;
    }
  }

  /** 编辑分类（重命名时原子更新父+子 path） */
  async update(id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('分类不存在');

    const data: Record<string, any> = {};
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.returnPolicy !== undefined) data.returnPolicy = dto.returnPolicy;

    // 如果修改了名称，需同步更新 path 和子分类 path（在同一事务内）
    if (dto.name !== undefined && dto.name !== category.name) {
      data.name = dto.name;
      const oldPath = category.path;
      const lastSlash = oldPath.lastIndexOf('/');
      const parentPath = lastSlash >= 0 ? oldPath.substring(0, lastSlash) : '';
      const newPath = parentPath ? `${parentPath}/${dto.name}` : `/${dto.name}`;
      data.path = newPath;

      // 事务内原子更新：父分类 + 所有子分类 path
      try {
        const children = await this.prisma.category.findMany({
          where: { path: { startsWith: oldPath + '/' } },
        });

        await this.prisma.$transaction([
          this.prisma.category.update({ where: { id }, data }),
          ...children.map((child) =>
            this.prisma.category.update({
              where: { id: child.id },
              data: { path: child.path.replace(oldPath, newPath) },
            }),
          ),
        ]);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new BadRequestException('同名分类已存在');
        }
        throw err;
      }

      this.productService.invalidateCategoriesCache();
      return this.prisma.category.findUnique({ where: { id } });
    }

    // 仅修改 sortOrder，无需事务
    const updated = await this.prisma.category.update({ where: { id }, data });
    this.productService.invalidateCategoriesCache();
    return updated;
  }

  /** 删除分类 */
  async remove(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!category) throw new NotFoundException('分类不存在');
    if (category._count.children > 0) {
      throw new BadRequestException('请先删除子分类');
    }
    if (category._count.products > 0) {
      throw new BadRequestException('该分类下有商品，无法删除');
    }

    await this.prisma.category.delete({ where: { id } });
    this.productService.invalidateCategoriesCache();
    return { ok: true };
  }

  /** 启用/停用（级联子分类） */
  async toggleActive(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('分类不存在');

    const newActive = !category.isActive;

    // 停用父分类时，级联停用所有子分类
    if (!newActive) {
      await this.prisma.$transaction([
        this.prisma.category.update({
          where: { id },
          data: { isActive: false },
        }),
        this.prisma.category.updateMany({
          where: { parentId: id },
          data: { isActive: false },
        }),
      ]);
    } else {
      await this.prisma.category.update({
        where: { id },
        data: { isActive: true },
      });
    }

    this.productService.invalidateCategoriesCache();
    return this.prisma.category.findUnique({ where: { id } });
  }

  /** 批量排序 */
  async batchSort(dto: BatchSortDto) {
    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.category.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );

    this.productService.invalidateCategoriesCache();
    return { ok: true };
  }
}
