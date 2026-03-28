import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TtlCache } from '../../common/ttl-cache';

@Injectable()
export class CompanyService {
  private listCache = new TtlCache<any[]>(3 * 60_000); // 3 分钟

  constructor(private prisma: PrismaService) {}

  /** 企业列表（3 分钟内存缓存，含每家企业 top 3 商品） */
  async list() {
    const cached = this.listCache.get('companies:all');
    if (cached) return cached;

    const companies = await this.prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        profile: true,
        companyTags: {
          include: { tag: { include: { category: { select: { code: true } } } } },
        },
        products: {
          where: { status: 'ACTIVE', auditStatus: 'APPROVED' },
          take: 8,
          orderBy: { createdAt: 'desc' },
          include: {
            media: {
              where: { type: 'IMAGE' },
              take: 1,
              orderBy: { sortOrder: 'asc' },
            },
            skus: {
              where: { status: 'ACTIVE' },
              take: 1,
              orderBy: { price: 'asc' },
            },
          },
        },
      },
    });

    const result = companies.map((c) => ({
      ...this.mapToFrontend(c),
      topProducts: c.products.map((p) => ({
        id: p.id,
        title: p.title,
        price: p.skus[0]?.price ?? p.basePrice ?? 0,
        image: p.media[0]?.url ?? '',
        defaultSkuId: p.skus[0]?.id ?? null,
      })),
    }));
    this.listCache.set('companies:all', result);
    return result;
  }

  /** 获取标签类别（含 active 标签），供前端选择器使用 */
  async listTagCategories(scope?: string) {
    return this.prisma.tagCategory.findMany({
      where: scope ? { scope: scope as any } : undefined,
      orderBy: { sortOrder: 'asc' },
      include: {
        tags: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, synonyms: true },
        },
      },
    });
  }

  /** 企业列表缓存失效（供管理端修改企业后调用） */
  invalidateListCache() {
    this.listCache.invalidate('companies:all');
  }

  /** 企业详情 */
  async getById(id: string, userId?: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        profile: true,
        companyTags: {
          include: { tag: { include: { category: { select: { code: true } } } } },
        },
      },
    });
    if (!company) throw new NotFoundException('企业信息不存在');

    let isFollowed = false;
    if (userId) {
      const follow = await this.prisma.follow.findUnique({
        where: { followerId_followedId: { followerId: userId, followedId: id } },
      });
      isFollowed = !!follow;
    }

    return {
      ...this.mapToFrontend(company),
      servicePhone: company.servicePhone ?? null,
      isFollowed,
    };
  }

  /** 企业商品分页列表 */
  async listCompanyProducts(
    companyId: string,
    options: { page?: number; pageSize?: number; category?: string },
  ) {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 10;
    const skip = (page - 1) * pageSize;

    const where: any = {
      companyId,
      status: 'ACTIVE',
      auditStatus: 'APPROVED',
      lotteryPrizes: { none: {} },
    };

    if (options.category) {
      where.category = { name: options.category };
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          media: { take: 1, orderBy: { sortOrder: 'asc' } },
          skus: { take: 1, orderBy: { price: 'asc' } },
          category: { select: { name: true } },
          tags: { include: { tag: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    // 获取该公司所有商品的去重分类列表
    const allCategories = await this.prisma.product.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        lotteryPrizes: { none: {} },
      },
      select: { category: { select: { name: true } } },
      distinct: ['categoryId'],
    });

    const categories = allCategories
      .map((p) => p.category?.name)
      .filter(Boolean) as string[];

    return {
      items: items.map((p) => ({
        id: p.id,
        title: p.title,
        price: p.skus[0]?.price ?? 0,
        image: p.media[0]?.url ?? '',
        defaultSkuId: p.skus[0]?.id ?? '',
        tags: p.tags.map((pt) => pt.tag.name),
        unit: (p.attributes as any)?.unit ?? '',
        origin: (p.origin as any)?.text ?? p.originRegion ?? '',
        categoryName: p.category?.name ?? '',
      })),
      total,
      page,
      pageSize,
      nextPage: skip + pageSize < total ? page + 1 : undefined,
      categories,
    };
  }

  /** 企业活动列表 */
  async listActivities(companyId: string) {
    const activities = await this.prisma.companyActivity.findMany({
      where: { companyId },
      orderBy: { startAt: 'asc' },
    });

    return activities.map((a) => {
      const content = a.content as any || {};
      return {
        id: a.id,
        companyId: a.companyId,
        date: a.startAt ? a.startAt.toISOString().split('T')[0] : '',
        startTime: a.startAt ? a.startAt.toISOString().split('T')[1]?.substring(0, 5) : '',
        endTime: a.endAt ? a.endAt.toISOString().split('T')[1]?.substring(0, 5) : undefined,
        title: a.title,
        type: content.type || 'event',
        description: content.description || undefined,
        location: content.location || undefined,
        capacity: content.capacity || undefined,
        bookedCount: content.bookedCount || undefined,
      };
    });
  }

  /** 获取单个活动详情 */
  async getActivityById(id: string) {
    const activity = await this.prisma.companyActivity.findUnique({
      where: { id },
    });
    if (!activity) throw new NotFoundException('活动不存在');

    const content = activity.content as any || {};
    return {
      id: activity.id,
      companyId: activity.companyId,
      date: activity.startAt ? activity.startAt.toISOString().split('T')[0] : '',
      startTime: activity.startAt ? activity.startAt.toISOString().split('T')[1]?.substring(0, 5) : '',
      endTime: activity.endAt ? activity.endAt.toISOString().split('T')[1]?.substring(0, 5) : undefined,
      title: activity.title,
      type: content.type || 'event',
      description: content.description || undefined,
      location: content.location || undefined,
      capacity: content.capacity || undefined,
      bookedCount: content.bookedCount || undefined,
    };
  }

  private getTagNamesByCode(companyTags: any[], categoryCode: string): string[] {
    if (!companyTags) return [];
    return companyTags
      .filter((ct: any) => ct.tag?.category?.code === categoryCode)
      .map((ct: any) => ct.tag.name);
  }

  /** 映射新 Schema 到前端期望的 Company 格式 */
  private mapToFrontend(company: any) {
    const address = company.address as any || {};
    const highlights = company.profile?.highlights as any || {};
    const locationText =
      address.text ||
      [address.province, address.city, address.district, address.postalCode, address.detail]
        .filter(Boolean)
        .join(' ');

    return {
      id: company.id,
      name: company.name,
      shortName: company.shortName || undefined,
      cover: highlights.cover || '',
      mainBusiness: highlights.mainBusiness || company.description || '',
      location: locationText,
      coordinates: address.lat && address.lng
        ? { lat: address.lat, lng: address.lng }
        : undefined,
      distanceKm: address.distanceKm || 0,
      badges: this.getTagNamesByCode(company.companyTags, 'company_badge'),
      latestTestedAt: highlights.latestTestedAt || undefined,
      groupTargetSize: highlights.groupTargetSize || undefined,
      description: company.description || undefined,
      address: {
        text: locationText || undefined,
        province: address.province || undefined,
        city: address.city || undefined,
        district: address.district || undefined,
        postalCode: address.postalCode || undefined,
        detail: address.detail || undefined,
      },
      companyType: highlights.companyType || null,
      industryTags: this.getTagNamesByCode(company.companyTags, 'industry'),
      productKeywords: highlights.productKeywords || [],
      productFeatures: this.getTagNamesByCode(company.companyTags, 'product_feature'),
      certifications: this.getTagNamesByCode(company.companyTags, 'company_cert'),
    };
  }
}
