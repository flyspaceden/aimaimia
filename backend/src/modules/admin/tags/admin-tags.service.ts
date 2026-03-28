import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TagScope } from '@prisma/client';
import { CreateTagCategoryDto, UpdateTagCategoryDto, CreateTagDto, UpdateTagDto } from './admin-tags.dto';

@Injectable()
export class AdminTagsService {
  constructor(private prisma: PrismaService) {}

  // ===================== TagCategory =====================

  async listCategories(scope?: TagScope) {
    return this.prisma.tagCategory.findMany({
      where: scope ? { scope } : undefined,
      orderBy: { sortOrder: 'asc' },
      include: {
        tags: {
          orderBy: { sortOrder: 'asc' },
          include: {
            _count: { select: { productTags: true, companyTags: true } },
          },
        },
      },
    });
  }

  async createCategory(dto: CreateTagCategoryDto) {
    const existing = await this.prisma.tagCategory.findUnique({ where: { code: dto.code } });
    if (existing) throw new BadRequestException(`类别编码 "${dto.code}" 已存在`);
    return this.prisma.tagCategory.create({ data: dto });
  }

  async updateCategory(id: string, dto: UpdateTagCategoryDto) {
    const category = await this.prisma.tagCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('标签类别不存在');
    return this.prisma.tagCategory.update({ where: { id }, data: dto });
  }

  async deleteCategory(id: string) {
    const category = await this.prisma.tagCategory.findUnique({
      where: { id },
      include: { tags: { include: { _count: { select: { productTags: true, companyTags: true } } } } },
    });
    if (!category) throw new NotFoundException('标签类别不存在');

    const usedTags = category.tags.filter(t => t._count.productTags > 0 || t._count.companyTags > 0);
    if (usedTags.length > 0) {
      throw new BadRequestException(
        `该类别下有 ${usedTags.length} 个标签正在使用中，无法删除。请先移除关联后再试。`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.tag.deleteMany({ where: { categoryId: id } }),
      this.prisma.tagCategory.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  // ===================== Tag =====================

  async listTags(categoryId?: string, scope?: TagScope) {
    return this.prisma.tag.findMany({
      where: {
        ...(categoryId ? { categoryId } : {}),
        ...(scope ? { category: { scope } } : {}),
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      include: {
        category: { select: { id: true, name: true, code: true, scope: true } },
        _count: { select: { productTags: true, companyTags: true } },
      },
    });
  }

  async createTag(dto: CreateTagDto) {
    const category = await this.prisma.tagCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw new NotFoundException('标签类别不存在');

    const existing = await this.prisma.tag.findUnique({
      where: { name_categoryId: { name: dto.name, categoryId: dto.categoryId } },
    });
    if (existing) throw new BadRequestException(`标签 "${dto.name}" 在该类别下已存在`);

    return this.prisma.tag.create({
      data: {
        name: dto.name,
        categoryId: dto.categoryId,
        synonyms: dto.synonyms || [],
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateTag(id: string, dto: UpdateTagDto) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('标签不存在');

    if (dto.name && dto.name !== tag.name) {
      const existing = await this.prisma.tag.findUnique({
        where: { name_categoryId: { name: dto.name, categoryId: tag.categoryId } },
      });
      if (existing) throw new BadRequestException(`标签 "${dto.name}" 在该类别下已存在`);
    }

    return this.prisma.tag.update({ where: { id }, data: dto });
  }

  async deleteTag(id: string) {
    const tag = await this.prisma.tag.findUnique({
      where: { id },
      include: { _count: { select: { productTags: true, companyTags: true } } },
    });
    if (!tag) throw new NotFoundException('标签不存在');

    const totalUsage = tag._count.productTags + tag._count.companyTags;
    if (totalUsage > 0) {
      throw new BadRequestException(
        `该标签已被 ${tag._count.companyTags} 个企业和 ${tag._count.productTags} 个商品使用，无法删除。请先移除关联或将标签设为停用。`,
      );
    }

    await this.prisma.tag.delete({ where: { id } });
    return { ok: true };
  }
}
