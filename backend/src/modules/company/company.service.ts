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
      })),
    }));
    this.listCache.set('companies:all', result);
    return result;
  }

  /** 企业列表缓存失效（供管理端修改企业后调用） */
  invalidateListCache() {
    this.listCache.invalidate('companies:all');
  }

  /** 企业详情 */
  async getById(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: { profile: true },
    });
    if (!company) throw new NotFoundException('企业信息不存在');

    return this.mapToFrontend(company);
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
      badges: highlights.badges || [],
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
      industryTags: highlights.industryTags || [],
      productKeywords: highlights.productKeywords || [],
      productFeatures: highlights.productFeatures || [],
      certifications: highlights.certifications || [],
    };
  }
}
