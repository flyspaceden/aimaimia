import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import {
  BatchSortDeliveryCategoriesDto,
  CreateDeliveryCategoryDto,
  UpdateDeliveryCategoryDto,
} from './dto/delivery-category.dto';
import { ReviewDeliveryMerchantApplicationDto } from './dto/review-delivery-merchant-application.dto';
import { UpdateDeliveryMerchantDto } from './dto/update-delivery-merchant.dto';

type PagingQuery = {
  page?: number;
  pageSize?: number;
  status?: string;
  keyword?: string;
};

@Injectable()
export class DeliveryAdminOpsService {
  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {}

  private readonly adminUserPublicSelect = {
    id: true,
    username: true,
    phone: true,
    realName: true,
    roleCodes: true,
    permissions: true,
    status: true,
    lastLoginAt: true,
    lastLoginIp: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.DeliveryAdminUserSelect;

  private readonly sellerStaffPublicSelect = {
    id: true,
    merchantId: true,
    phone: true,
    username: true,
    realName: true,
    role: true,
    permissionCodes: true,
    status: true,
    lastLoginAt: true,
    lastLoginIp: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.DeliverySellerStaffSelect;

  async listUsers(query: PagingQuery) {
    return this.findManyWithPage(this.deliveryPrisma.deliveryUser, {
      query,
      where: query.keyword
        ? {
            OR: [
              { phone: { contains: query.keyword } },
              { nickname: { contains: query.keyword } },
            ],
          }
        : undefined,
      include: {
        currentUnit: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  async getUser(id: string) {
    const user = await this.deliveryPrisma.deliveryUser.findUnique({
      where: { id },
      include: {
        currentUnit: true,
      },
    });
    if (!user) {
      throw new NotFoundException('配送用户不存在');
    }
    return user;
  }

  async listUnits(query: PagingQuery) {
    return this.findManyWithPage(this.deliveryPrisma.deliveryUnit, {
      query,
      where: query.status ? { status: query.status as any } : undefined,
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            nickname: true,
          },
        },
      },
    });
  }

  async getUnit(id: string) {
    const unit = await this.deliveryPrisma.deliveryUnit.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });
    if (!unit) {
      throw new NotFoundException('配送单位不存在');
    }
    return unit;
  }

  async listMerchants(query: PagingQuery) {
    const where: Prisma.DeliveryMerchantWhereInput = {};
    if (query.status) {
      where.status = query.status as any;
    }
    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword } },
        { contactName: { contains: query.keyword } },
        { contactPhone: { contains: query.keyword } },
      ];
    }

    return this.findManyWithPage(this.deliveryPrisma.deliveryMerchant, {
      query,
      where,
    });
  }

  async getMerchant(id: string) {
    const merchant = await this.deliveryPrisma.deliveryMerchant.findUnique({
      where: { id },
      include: {
        staff: {
          orderBy: [{ createdAt: 'desc' }],
          select: this.sellerStaffPublicSelect,
        },
      },
    });
    if (!merchant) {
      throw new NotFoundException('配送商家不存在');
    }
    return {
      ...merchant,
      staff: merchant.staff.map((staff) => this.sanitizeSensitiveFields(staff)),
    };
  }

  async updateMerchant(id: string, dto: UpdateDeliveryMerchantDto, deliveryAdminUserId?: string) {
    const before = deliveryAdminUserId
      ? await this.deliveryPrisma.deliveryMerchant.findUnique({ where: { id } })
      : null;
    const updated = await this.deliveryPrisma.deliveryMerchant.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        status: dto.status,
        servicePhone: dto.servicePhone?.trim(),
        defaultMarkupBps: dto.defaultMarkupBps,
      },
    });
    await this.writeAdminAuditLog(deliveryAdminUserId, {
      module: 'merchants',
      action: 'UPDATE_MERCHANT',
      targetType: 'DeliveryMerchant',
      targetId: id,
      summary: '更新配送商家',
      before,
      after: updated,
    });
    return updated;
  }

  async listMerchantApplications(query: PagingQuery) {
    return this.findManyWithPage(this.deliveryPrisma.deliveryMerchantApplication, {
      query,
      where: query.status ? { status: query.status as any } : undefined,
      include: {
        merchant: {
          select: {
            id: true,
            name: true,
          },
        },
        reviewedByAdmin: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });
  }

  async getMerchantApplication(id: string) {
    const application = await this.deliveryPrisma.deliveryMerchantApplication.findUnique({
      where: { id },
      include: {
        merchant: true,
        reviewedByAdmin: {
          select: this.adminUserPublicSelect,
        },
      },
    });
    if (!application) {
      throw new NotFoundException('配送商家入驻申请不存在');
    }
    return {
      ...application,
      reviewedByAdmin: application.reviewedByAdmin
        ? this.sanitizeSensitiveFields(application.reviewedByAdmin)
        : null,
    };
  }

  async listCategories() {
    return this.deliveryPrisma.deliveryCategory.findMany({
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { products: true, children: true } },
      },
    });
  }

  async createCategory(dto: CreateDeliveryCategoryDto, deliveryAdminUserId?: string) {
    const name = this.normalizeCategoryName(dto.name);
    try {
      const category = await this.deliveryPrisma.$transaction(
        async (tx) => {
          let parentPath = '';
          let level = 1;
          let status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE';
          if (dto.parentId) {
            const parent = await tx.deliveryCategory.findUnique({
              where: { id: dto.parentId },
            });
            if (!parent) {
              throw new NotFoundException('父级分类不存在');
            }
            parentPath = parent.path;
            level = parent.level + 1;
            status = parent.status ?? 'ACTIVE';
          }

          return tx.deliveryCategory.create({
            data: {
              name,
              parentId: dto.parentId || null,
              path: parentPath ? `${parentPath}/${name}` : name,
              level,
              sortOrder: dto.sortOrder ?? 0,
              status,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      await this.writeAdminAuditLog(deliveryAdminUserId, {
        module: 'categories',
        action: 'CREATE_CATEGORY',
        targetType: 'DeliveryCategory',
        targetId: category.id,
        summary: '新增配送商品分类',
        before: null,
        after: category,
      });
      return category;
    } catch (err) {
      this.handleCategoryUniqueError(err);
    }
  }

  async updateCategory(id: string, dto: UpdateDeliveryCategoryDto, deliveryAdminUserId?: string) {
    try {
      const result = await this.deliveryPrisma.$transaction(
        async (tx) => {
          const before = await tx.deliveryCategory.findUnique({ where: { id } });
          if (!before) {
            throw new NotFoundException('分类不存在');
          }
          const data: Prisma.DeliveryCategoryUpdateInput = {};
          if (dto.sortOrder !== undefined) {
            data.sortOrder = dto.sortOrder;
          }
          if (dto.status !== undefined) {
            data.status = dto.status;
          }

          if (dto.name !== undefined) {
            const nextName = this.normalizeCategoryName(dto.name);
            if (nextName !== before.name) {
              const nextPath = this.buildRenamedCategoryPath(before.path, nextName);
              data.name = nextName;
              data.path = nextPath;

              const children = await tx.deliveryCategory.findMany({
                where: { path: { startsWith: `${before.path}/` } },
              });
              await tx.deliveryCategory.update({ where: { id }, data });
              for (const child of children) {
                await tx.deliveryCategory.update({
                  where: { id: child.id },
                  data: { path: child.path.replace(before.path, nextPath) },
                });
              }
              const renamed = await tx.deliveryCategory.findUnique({ where: { id } });
              if (!renamed) {
                throw new NotFoundException('分类不存在');
              }
              return { before, updated: renamed, changed: true };
            }
          }

          if (Object.keys(data).length === 0) {
            return { before, updated: before, changed: false };
          }

          const updated = await tx.deliveryCategory.update({ where: { id }, data });
          return { before, updated, changed: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (!result.changed) {
        return result.updated;
      }
      await this.writeAdminAuditLog(deliveryAdminUserId, {
        module: 'categories',
        action: 'UPDATE_CATEGORY',
        targetType: 'DeliveryCategory',
        targetId: id,
        summary: '更新配送商品分类',
        before: result.before,
        after: result.updated,
      });
      return result.updated;
    } catch (err) {
      this.handleCategoryUniqueError(err);
    }
  }

  async toggleCategoryStatus(id: string, deliveryAdminUserId?: string) {
    const result = await this.deliveryPrisma.$transaction(
      async (tx) => {
        const before = await tx.deliveryCategory.findUnique({ where: { id } });
        if (!before) {
          throw new NotFoundException('分类不存在');
        }
        const nextStatus = before.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
        await tx.deliveryCategory.update({
          where: { id },
          data: { status: nextStatus },
        });
        if (nextStatus === 'INACTIVE') {
          await tx.deliveryCategory.updateMany({
            where: { path: { startsWith: `${before.path}/` } },
            data: { status: 'INACTIVE' },
          });
        }
        const row = await tx.deliveryCategory.findUnique({ where: { id } });
        if (!row) {
          throw new NotFoundException('分类不存在');
        }
        return { before, updated: row };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.writeAdminAuditLog(deliveryAdminUserId, {
      module: 'categories',
      action: 'TOGGLE_CATEGORY_STATUS',
      targetType: 'DeliveryCategory',
      targetId: id,
      summary: '启用或停用配送商品分类',
      before: result.before,
      after: result.updated,
    });
    return result.updated;
  }

  async removeCategory(id: string, deliveryAdminUserId?: string) {
    const before = await this.deliveryPrisma.$transaction(
      async (tx) => {
        const before = await tx.deliveryCategory.findUnique({
          where: { id },
          include: { _count: { select: { products: true, children: true } } },
        });
        if (!before) {
          throw new NotFoundException('分类不存在');
        }
        if (before._count.children > 0) {
          throw new BadRequestException('请先删除子分类');
        }
        if (before._count.products > 0) {
          throw new BadRequestException('该分类下有商品，无法删除');
        }
        await tx.deliveryCategory.delete({ where: { id } });
        return before;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.writeAdminAuditLog(deliveryAdminUserId, {
      module: 'categories',
      action: 'DELETE_CATEGORY',
      targetType: 'DeliveryCategory',
      targetId: id,
      summary: '删除配送商品分类',
      before,
      after: null,
    });
    return { ok: true };
  }

  async batchSortCategories(dto: BatchSortDeliveryCategoriesDto, deliveryAdminUserId?: string) {
    await this.deliveryPrisma.$transaction(
      dto.items.map((item) =>
        this.deliveryPrisma.deliveryCategory.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.writeAdminAuditLog(deliveryAdminUserId, {
      module: 'categories',
      action: 'SORT_CATEGORIES',
      targetType: 'DeliveryCategory',
      targetId: 'batch',
      summary: '调整配送商品分类排序',
      before: null,
      after: dto.items,
    });
    return { ok: true };
  }

  async reviewMerchantApplication(
    deliveryAdminUserId: string,
    id: string,
    dto: ReviewDeliveryMerchantApplicationDto,
  ) {
    const before = await this.deliveryPrisma.deliveryMerchantApplication.findUnique({ where: { id } });
    const updated = await this.deliveryPrisma.deliveryMerchantApplication.update({
      where: { id },
      data: {
        status: dto.status,
        rejectReason: dto.status === 'REJECTED' ? dto.rejectReason?.trim() || null : null,
        reviewedByAdminId: deliveryAdminUserId,
        reviewedAt: new Date(),
        merchantId: dto.status === 'APPROVED' ? dto.merchantId : undefined,
      },
    });
    await this.writeAdminAuditLog(deliveryAdminUserId, {
      module: 'merchants',
      action: 'REVIEW_MERCHANT_APPLICATION',
      targetType: 'DeliveryMerchantApplication',
      targetId: id,
      summary: '审核配送商家入驻申请',
      before,
      after: updated,
    });
    return updated;
  }

  async listOrders(query: PagingQuery) {
    return this.findManyWithPage(this.deliveryPrisma.deliveryOrder, {
      query,
      where: query.status ? { status: query.status as any } : undefined,
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            nickname: true,
          },
        },
        unit: {
          select: {
            id: true,
            name: true,
          },
        },
        subOrders: {
          select: {
            id: true,
            merchantId: true,
            status: true,
            supplyAmountCents: true,
            shippingFeeShareCents: true,
            totalAmountCents: true,
          },
        },
      },
    });
  }

  async getOrder(id: string) {
    const order = await this.deliveryPrisma.deliveryOrder.findUnique({
      where: { id },
      include: {
        user: true,
        unit: true,
        subOrders: true,
        payments: true,
        shipments: true,
      },
    });
    if (!order) {
      throw new NotFoundException('配送订单不存在');
    }
    return order;
  }

  async listAbnormalPayments(query: PagingQuery) {
    return this.findManyWithPage(this.deliveryPrisma.deliveryPayment, {
      query,
      where: {
        OR: [{ status: 'FAILED' }, { exceptionSummary: { not: null } }],
      },
      include: {
        order: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });
  }

  async listAuditLogs(query: PagingQuery) {
    return this.findManyWithPage(this.deliveryPrisma.deliveryAuditLog, {
      query,
      where: query.keyword
        ? {
            OR: [
              { module: { contains: query.keyword } },
              { action: { contains: query.keyword } },
              { summary: { contains: query.keyword } },
            ],
          }
        : undefined,
    });
  }

  private async writeAdminAuditLog(
    deliveryAdminUserId: string | undefined,
    input: {
      module: string;
      action: string;
      targetType: string;
      targetId: string;
      summary: string;
      before: unknown;
      after: unknown;
    },
  ) {
    if (!deliveryAdminUserId) {
      return;
    }

    await this.deliveryPrisma.deliveryAuditLog.create({
      data: {
        actorType: 'ADMIN',
        actorId: deliveryAdminUserId,
        module: input.module,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        summary: input.summary,
        before: this.toAuditJson(input.before),
        after: this.toAuditJson(input.after),
      },
    });
  }

  private toAuditJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private async findManyWithPage(
    delegate: { count: (args?: any) => Promise<number>; findMany: (args?: any) => Promise<any[]> },
    options: {
      query: PagingQuery;
      where?: Record<string, unknown>;
      include?: Record<string, unknown>;
    },
  ) {
    const page = options.query.page && options.query.page > 0 ? options.query.page : 1;
    const pageSize = options.query.pageSize && options.query.pageSize > 0 ? options.query.pageSize : 20;
    const skip = (page - 1) * pageSize;
    const [total, items] = await Promise.all([
      delegate.count({
        where: options.where,
      }),
      delegate.findMany({
        where: options.where,
        include: options.include,
        orderBy: [{ createdAt: 'desc' }],
        take: pageSize,
        skip,
      }),
    ]);
    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  private sanitizeSensitiveFields<T extends Record<string, unknown>>(record: T) {
    const {
      passwordHash: _passwordHash,
      refreshTokenHash: _refreshTokenHash,
      sessionToken: _sessionToken,
      accessToken: _accessToken,
      ...sanitized
    } = record;
    return sanitized;
  }

  private normalizeCategoryName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('分类名称不能为空');
    }
    if (trimmed.length > 20) {
      throw new BadRequestException('分类名称最多 20 个字符');
    }
    return trimmed;
  }

  private buildRenamedCategoryPath(currentPath: string, nextName: string) {
    const lastSlash = currentPath.lastIndexOf('/');
    return lastSlash >= 0 ? `${currentPath.substring(0, lastSlash)}/${nextName}` : nextName;
  }

  private handleCategoryUniqueError(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BadRequestException('同名分类已存在');
    }
    throw err;
  }
}
