import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { CreateDeliveryStaffDto } from './dto/create-delivery-staff.dto';
import { UpdateDeliveryCompanyDto } from './dto/update-delivery-company.dto';
import { UpdateDeliveryStaffDto } from './dto/update-delivery-staff.dto';

type ListSellerOrdersQuery = {
  page?: number;
  pageSize?: number;
  status?: string;
};

@Injectable()
export class DeliverySellerOpsService {
  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {}

  async getDashboard(merchantId: string) {
    const [pendingShipmentCount, deliveredPendingSettlementCount, openConversationCount] =
      await Promise.all([
        this.deliveryPrisma.deliverySubOrder.count({
          where: {
            merchantId,
            status: 'PENDING_SHIPMENT',
          },
        }),
        this.deliveryPrisma.deliverySettlement.count({
          where: {
            merchantId,
            status: 'PENDING',
          },
        }),
        this.deliveryPrisma.deliveryCustomerServiceConversation.count({
          where: {
            merchantId,
            status: 'OPEN',
          },
        }),
      ]);

    return {
      pendingShipmentCount,
      deliveredPendingSettlementCount,
      openConversationCount,
    };
  }

  async listOrders(merchantId: string, query: ListSellerOrdersQuery) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.DeliverySubOrderWhereInput = { merchantId };
    if (query.status) {
      where.status = query.status as any;
    }

    const [total, items] = await Promise.all([
      this.deliveryPrisma.deliverySubOrder.count({ where }),
      this.deliveryPrisma.deliverySubOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: pageSize,
        skip,
        include: {
          order: {
            select: {
              id: true,
              status: true,
              paidAt: true,
              totalAmountCents: true,
            },
          },
          items: {
            select: {
              id: true,
              quantity: true,
              lineAmountCents: true,
            },
          },
          settlements: {
            select: {
              id: true,
              status: true,
              settledAmountCents: true,
            },
          },
          shipments: {
            select: {
              id: true,
              status: true,
              trackingNo: true,
              waybillNo: true,
            },
          },
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async getCompany(merchantId: string) {
    const merchant = await this.deliveryPrisma.deliveryMerchant.findUnique({
      where: { id: merchantId },
    });
    if (!merchant) {
      throw new NotFoundException('配送商家不存在');
    }
    return merchant;
  }

  async updateCompany(merchantId: string, dto: UpdateDeliveryCompanyDto) {
    return this.deliveryPrisma.deliveryMerchant.update({
      where: { id: merchantId },
      data: {
        name: dto.name?.trim(),
        contactName: dto.contactName?.trim(),
        contactPhone: dto.contactPhone?.trim(),
        servicePhone: dto.servicePhone?.trim(),
        defaultMarkupBps: dto.defaultMarkupBps,
      },
    });
  }

  async listStaff(merchantId: string) {
    return this.deliveryPrisma.deliverySellerStaff.findMany({
      where: { merchantId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async createStaff(merchantId: string, dto: CreateDeliveryStaffDto) {
    return this.deliveryPrisma.deliverySellerStaff.create({
      data: {
        merchantId,
        username: dto.username.trim(),
        phone: dto.phone?.trim() || null,
        realName: dto.realName?.trim() || null,
        role: dto.role,
        permissionCodes: dto.permissionCodes ?? [],
        status: 'ACTIVE',
      },
    });
  }

  async updateStaff(merchantId: string, id: string, dto: UpdateDeliveryStaffDto) {
    const staff = await this.deliveryPrisma.deliverySellerStaff.findFirst({
      where: { id, merchantId },
      select: { id: true },
    });
    if (!staff) {
      throw new NotFoundException('配送中心员工不存在');
    }

    return this.deliveryPrisma.deliverySellerStaff.update({
      where: { id },
      data: {
        realName: dto.realName?.trim(),
        role: dto.role,
        status: dto.status,
        permissionCodes: dto.permissionCodes,
      },
    });
  }
}
