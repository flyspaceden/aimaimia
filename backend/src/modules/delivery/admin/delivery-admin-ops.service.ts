import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
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
        },
      },
    });
    if (!merchant) {
      throw new NotFoundException('配送商家不存在');
    }
    return merchant;
  }

  async updateMerchant(id: string, dto: UpdateDeliveryMerchantDto) {
    return this.deliveryPrisma.deliveryMerchant.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        status: dto.status,
        servicePhone: dto.servicePhone?.trim(),
        defaultMarkupBps: dto.defaultMarkupBps,
      },
    });
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
        reviewedByAdmin: true,
      },
    });
    if (!application) {
      throw new NotFoundException('配送商家入驻申请不存在');
    }
    return application;
  }

  async reviewMerchantApplication(
    deliveryAdminUserId: string,
    id: string,
    dto: ReviewDeliveryMerchantApplicationDto,
  ) {
    return this.deliveryPrisma.deliveryMerchantApplication.update({
      where: { id },
      data: {
        status: dto.status,
        rejectReason: dto.status === 'REJECTED' ? dto.rejectReason?.trim() || null : null,
        reviewedByAdminId: deliveryAdminUserId,
        reviewedAt: new Date(),
        merchantId: dto.status === 'APPROVED' ? dto.merchantId : undefined,
      },
    });
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
        status: 'FAILED',
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
}
