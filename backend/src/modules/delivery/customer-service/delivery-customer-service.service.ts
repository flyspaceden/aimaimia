import { Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryConversationSource, Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { CreateDeliveryConversationDto } from './dto/create-delivery-conversation.dto';
import { UpdateDeliveryConversationDto } from './dto/update-delivery-conversation.dto';

type ListConversationQuery = {
  page?: number;
  pageSize?: number;
  status?: string;
};

const conversationInclude = {
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
  order: {
    select: {
      id: true,
      status: true,
    },
  },
  subOrder: {
    select: {
      id: true,
      status: true,
    },
  },
} satisfies Prisma.DeliveryCustomerServiceConversationInclude;

@Injectable()
export class DeliveryCustomerServiceService {
  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {}

  async listAdminConversations(query: ListConversationQuery) {
    return this.listConversations({ query });
  }

  async listSellerConversations(merchantId: string, query: ListConversationQuery) {
    return this.listConversations({
      merchantId,
      query,
    });
  }

  async getAdminConversation(id: string) {
    const conversation = await this.deliveryPrisma.deliveryCustomerServiceConversation.findFirst({
      where: { id },
      include: conversationInclude,
    });
    if (!conversation) {
      throw new NotFoundException('配送客服会话不存在');
    }
    return conversation;
  }

  async getSellerConversation(merchantId: string, id: string) {
    const conversation = await this.deliveryPrisma.deliveryCustomerServiceConversation.findFirst({
      where: { id, merchantId },
      include: conversationInclude,
    });
    if (!conversation) {
      throw new NotFoundException('配送客服会话不存在');
    }
    return conversation;
  }

  async createSellerConversation(
    merchantId: string,
    deliverySellerStaffId: string,
    dto: CreateDeliveryConversationDto,
  ) {
    const relationContext = await this.resolveConversationContext(merchantId, dto);
    return this.deliveryPrisma.deliveryCustomerServiceConversation.create({
      data: {
        merchantId,
        assignedStaffId: deliverySellerStaffId,
        source: 'SELLER',
        status: 'OPEN',
        subject: dto.subject?.trim() || relationContext.defaultSubject,
        lastMessagePreview: dto.message.trim(),
        lastMessageAt: new Date(),
        orderId: relationContext.orderId,
        subOrderId: relationContext.subOrderId,
        userId: relationContext.userId,
        unitId: relationContext.unitId,
      },
    });
  }

  async updateAdminConversation(
    id: string,
    deliveryAdminUserId: string,
    dto: UpdateDeliveryConversationDto,
  ) {
    const conversation = await this.deliveryPrisma.deliveryCustomerServiceConversation.findFirst({
      where: { id },
    });
    if (!conversation) {
      throw new NotFoundException('配送客服会话不存在');
    }

    return this.deliveryPrisma.deliveryCustomerServiceConversation.update({
      where: { id },
      data: {
        assignedAdminId: dto.assignedAdminId ?? deliveryAdminUserId,
        assignedStaffId: dto.assignedStaffId ?? conversation.assignedStaffId,
        source: dto.message ? DeliveryConversationSource.ADMIN : conversation.source,
        status: dto.status ?? conversation.status,
        subject: dto.subject?.trim() || conversation.subject,
        lastMessagePreview: dto.message?.trim() || conversation.lastMessagePreview,
        lastMessageAt: dto.message ? new Date() : conversation.lastMessageAt,
      },
    });
  }

  async updateSellerConversation(
    merchantId: string,
    deliverySellerStaffId: string,
    id: string,
    dto: UpdateDeliveryConversationDto,
  ) {
    const conversation = await this.deliveryPrisma.deliveryCustomerServiceConversation.findFirst({
      where: { id, merchantId },
    });
    if (!conversation) {
      throw new NotFoundException('配送客服会话不存在');
    }

    return this.deliveryPrisma.deliveryCustomerServiceConversation.update({
      where: { id },
      data: {
        assignedStaffId: deliverySellerStaffId,
        source: dto.message ? DeliveryConversationSource.SELLER : conversation.source,
        status: dto.status ?? conversation.status,
        subject: dto.subject?.trim() || conversation.subject,
        lastMessagePreview: dto.message?.trim() || conversation.lastMessagePreview,
        lastMessageAt: dto.message ? new Date() : conversation.lastMessageAt,
      },
    });
  }

  private async listConversations(params: {
    merchantId?: string;
    query: ListConversationQuery;
  }) {
    const page = params.query.page && params.query.page > 0 ? params.query.page : 1;
    const pageSize = params.query.pageSize && params.query.pageSize > 0 ? params.query.pageSize : 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.DeliveryCustomerServiceConversationWhereInput = {};
    if (params.merchantId) {
      where.merchantId = params.merchantId;
    }
    if (params.query.status === 'OPEN' || params.query.status === 'CLOSED') {
      where.status = params.query.status;
    }

    return this.deliveryPrisma.deliveryCustomerServiceConversation.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      take: pageSize,
      skip,
      include: conversationInclude,
    });
  }

  private async resolveConversationContext(merchantId: string, dto: CreateDeliveryConversationDto) {
    if (dto.subOrderId) {
      const subOrder = await this.deliveryPrisma.deliverySubOrder.findUnique({
        where: { id: dto.subOrderId },
        select: {
          id: true,
          merchantId: true,
          orderId: true,
          order: {
            select: {
              userId: true,
              unitId: true,
            },
          },
        },
      });
      if (!subOrder || subOrder.merchantId !== merchantId) {
        throw new NotFoundException('配送子订单不存在');
      }
      return {
        orderId: subOrder.orderId,
        subOrderId: subOrder.id,
        userId: subOrder.order.userId,
        unitId: subOrder.order.unitId,
        defaultSubject: '配送订单咨询',
      };
    }

    if (dto.orderId) {
      const sellerScopedOrder = await this.deliveryPrisma.deliverySubOrder.findFirst({
        where: {
          orderId: dto.orderId,
          merchantId,
        },
        select: {
          orderId: true,
          order: {
            select: {
              userId: true,
              unitId: true,
            },
          },
        },
      });
      if (!sellerScopedOrder) {
        throw new NotFoundException('配送订单不存在');
      }
      return {
        orderId: sellerScopedOrder.orderId,
        subOrderId: undefined,
        userId: sellerScopedOrder.order.userId,
        unitId: sellerScopedOrder.order.unitId,
        defaultSubject: '配送订单咨询',
      };
    }

    return {
      orderId: undefined,
      subOrderId: undefined,
      userId: undefined,
      unitId: undefined,
      defaultSubject: '配送中心咨询',
    };
  }
}
