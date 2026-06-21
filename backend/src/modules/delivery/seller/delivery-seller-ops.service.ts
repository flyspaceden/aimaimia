import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliverySellerStaffRole, Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliverySettlementService } from '../settlement/delivery-settlement.service';
import { CreateDeliveryStaffDto } from './dto/create-delivery-staff.dto';
import { UpdateDeliveryCompanyDto } from './dto/update-delivery-company.dto';
import { UpdateDeliveryStaffDto } from './dto/update-delivery-staff.dto';

type ListSellerOrdersQuery = {
  page?: number;
  pageSize?: number;
  status?: string;
};

const sellerOrderInclude = {
  order: {
    select: {
      id: true,
      paidAt: true,
      addressSnapshot: true,
    },
  },
  items: {
    select: {
      id: true,
      quantity: true,
      productSnapshot: true,
    },
  },
  shipments: {
    orderBy: [{ createdAt: 'desc' }],
    take: 1,
    select: {
      id: true,
      status: true,
      trackingNo: true,
      waybillNo: true,
      waybillUrl: true,
      carrierCode: true,
      carrierName: true,
      shippedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.DeliverySubOrderInclude;

type SellerOrderRecord = Prisma.DeliverySubOrderGetPayload<{
  include: typeof sellerOrderInclude;
}>;

type DeliverySellerActor = {
  merchantId: string;
  deliverySellerStaffId: string;
  role: DeliverySellerStaffRole;
};

const sellerStaffPublicSelect = {
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

@Injectable()
export class DeliverySellerOpsService {
  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly deliverySettlementService: DeliverySettlementService,
  ) {}

  async getDashboard(merchantId: string) {
    await this.deliverySettlementService.materializeEligibleSettlements({
      merchantId,
    });

    const [pendingShipmentCount, deliveredPendingSettlementCount] = await Promise.all([
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
    ]);

    return {
      pendingShipmentCount,
      deliveredPendingSettlementCount,
    };
  }

  async listOrders(merchantId: string, query: ListSellerOrdersQuery) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 20;
    const skip = (page - 1) * pageSize;
    const where = this.buildSellerOrderWhere(merchantId, query.status);

    const [total, items] = await Promise.all([
      this.deliveryPrisma.deliverySubOrder.count({ where }),
      this.deliveryPrisma.deliverySubOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: pageSize,
        skip,
        include: sellerOrderInclude,
      }),
    ]);

    return {
      items: items.map((item) => this.mapSellerOrder(item)),
      total,
      page,
      pageSize,
    };
  }

  async getOrder(merchantId: string, subOrderId: string) {
    const order = await this.deliveryPrisma.deliverySubOrder.findFirst({
      where: {
        id: subOrderId,
        merchantId,
      },
      include: sellerOrderInclude,
    });
    if (!order) {
      throw new NotFoundException('配送子订单不存在');
    }
    return this.mapSellerOrder(order);
  }

  async getCompany(merchantId: string) {
    const merchant = await this.deliveryPrisma.deliveryMerchant.findUnique({
      where: { id: merchantId },
    });
    if (!merchant) {
      throw new NotFoundException('配送商家不存在');
    }
    return this.sanitizeSellerCompanyResponse(merchant);
  }

  async updateCompany(actor: DeliverySellerActor, dto: UpdateDeliveryCompanyDto) {
    this.assertCompanyManager(actor);
    const merchant = await this.deliveryPrisma.deliveryMerchant.update({
      where: { id: actor.merchantId },
      data: {
        name: dto.name?.trim(),
        contactName: dto.contactName?.trim(),
        contactPhone: dto.contactPhone?.trim(),
        servicePhone: dto.servicePhone?.trim(),
      },
    });

    return this.sanitizeSellerCompanyResponse(merchant);
  }

  async listStaff(actor: DeliverySellerActor) {
    this.assertOwner(actor, '仅企业主可管理员工');
    const staffs = await this.deliveryPrisma.deliverySellerStaff.findMany({
      where: { merchantId: actor.merchantId },
      orderBy: [{ createdAt: 'desc' }],
      select: sellerStaffPublicSelect,
    });
    return staffs.map((staff) => this.sanitizeSellerStaffResponse(staff));
  }

  async createStaff(actor: DeliverySellerActor, dto: CreateDeliveryStaffDto) {
    this.assertOwner(actor, '仅企业主可管理员工');
    if (dto.role === DeliverySellerStaffRole.OWNER) {
      throw new BadRequestException('员工管理接口不支持新增企业主');
    }
    const staff = await this.deliveryPrisma.deliverySellerStaff.create({
      data: {
        merchantId: actor.merchantId,
        username: dto.username.trim(),
        phone: dto.phone?.trim() || null,
        realName: dto.realName?.trim() || null,
        role: dto.role,
        permissionCodes: dto.permissionCodes ?? [],
        status: 'ACTIVE',
      },
      select: sellerStaffPublicSelect,
    });
    return this.sanitizeSellerStaffResponse(staff);
  }

  async updateStaff(actor: DeliverySellerActor, id: string, dto: UpdateDeliveryStaffDto) {
    this.assertOwner(actor, '仅企业主可管理员工');
    const staff = await this.deliveryPrisma.deliverySellerStaff.findFirst({
      where: { id, merchantId: actor.merchantId },
      select: { id: true, role: true },
    });
    if (!staff) {
      throw new NotFoundException('配送中心员工不存在');
    }
    if (dto.role === DeliverySellerStaffRole.OWNER && staff.role !== DeliverySellerStaffRole.OWNER) {
      throw new BadRequestException('员工管理接口不支持提升为企业主');
    }
    if (actor.deliverySellerStaffId === id) {
      if (dto.status === 'DISABLED') {
        throw new ForbiddenException('企业主不能禁用自己');
      }
      if (dto.role && dto.role !== DeliverySellerStaffRole.OWNER) {
        throw new ForbiddenException('企业主不能降低自己的角色');
      }
    }

    const updated = await this.deliveryPrisma.deliverySellerStaff.update({
      where: { id },
      data: {
        realName: dto.realName?.trim(),
        role: dto.role,
        status: dto.status,
        permissionCodes: dto.permissionCodes,
      },
      select: sellerStaffPublicSelect,
    });
    return this.sanitizeSellerStaffResponse(updated);
  }

  private sanitizeSellerCompanyResponse<T extends Record<string, unknown>>(merchant: T) {
    const { defaultMarkupBps: _defaultMarkupBps, ...sanitizedMerchant } = merchant;
    return sanitizedMerchant;
  }

  private sanitizeSellerStaffResponse<T extends Record<string, unknown>>(staff: T) {
    const { passwordHash: _passwordHash, refreshTokenHash: _refreshTokenHash, ...sanitizedStaff } = staff;
    return sanitizedStaff;
  }

  private assertOwner(actor: DeliverySellerActor, message: string) {
    if (actor.role !== DeliverySellerStaffRole.OWNER) {
      throw new ForbiddenException(message);
    }
  }

  private assertCompanyManager(actor: DeliverySellerActor) {
    if (
      actor.role !== DeliverySellerStaffRole.OWNER &&
      actor.role !== DeliverySellerStaffRole.MANAGER
    ) {
      throw new ForbiddenException('仅企业主或经理可修改企业信息');
    }
  }

  private buildSellerOrderWhere(merchantId: string, status?: string): Prisma.DeliverySubOrderWhereInput {
    const statuses = status
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      merchantId,
      ...(statuses?.length
        ? {
            status: statuses.length === 1 ? (statuses[0] as any) : { in: statuses as any[] },
          }
        : {}),
    };
  }

  private mapSellerOrder(order: SellerOrderRecord) {
    const address = this.parseAddressSnapshot(order.order.addressSnapshot);
    const latestShipment = order.shipments[0] ?? null;

    return {
      id: order.id,
      orderId: order.orderId,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      paidAt: order.order.paidAt?.toISOString() ?? null,
      createdDate: (order.order.paidAt ?? order.createdAt).toISOString().slice(0, 10),
      buyerAlias: address.recipientName ? `收货人 ${address.recipientName}` : '收货信息待补充',
      buyerNo: null,
      regionText: address.regionText || null,
      shippingAddress: address,
      items: order.items.map((item) => {
        const snapshot = this.parseProductSnapshot(item.productSnapshot);
        return {
          id: item.id,
          title: snapshot.productTitle || '',
          skuTitle: snapshot.skuTitle || '',
          unitName: snapshot.unitName || '',
          imageUrl: snapshot.imageUrl || null,
          quantity: item.quantity,
        };
      }),
      shipment: latestShipment
        ? {
            id: latestShipment.id,
            status: latestShipment.status,
            trackingNo: latestShipment.trackingNo,
            waybillNo: latestShipment.waybillNo,
            waybillPrintUrl: latestShipment.waybillUrl,
            carrierCode: latestShipment.carrierCode,
            carrierName: latestShipment.carrierName,
            shippedAt: latestShipment.shippedAt?.toISOString() ?? null,
            createdAt: latestShipment.createdAt.toISOString(),
            updatedAt: latestShipment.updatedAt.toISOString(),
          }
        : null,
    };
  }

  private parseAddressSnapshot(raw: Prisma.JsonValue) {
    const value = this.asRecord(raw);
    const regionParts = [
      this.asString(value.provinceName),
      this.asString(value.cityName),
      this.asString(value.districtName),
    ].filter(Boolean);
    return {
      recipientName: this.asString(value.recipientName),
      phone: this.asString(value.phone),
      regionText: this.asString(value.regionText) || regionParts.join(' '),
      detailAddress: this.asString(value.detailAddress),
    };
  }

  private parseProductSnapshot(raw: Prisma.JsonValue) {
    const value = this.asRecord(raw);
    return {
      productTitle: this.asString(value.productTitle),
      skuTitle: this.asString(value.skuTitle),
      unitName: this.asString(value.unitName),
      imageUrl: this.asString(value.imageUrl),
    };
  }

  private asRecord(raw: Prisma.JsonValue): Record<string, unknown> {
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  }

  private asString(raw: unknown) {
    return typeof raw === 'string' ? raw : '';
  }
}
