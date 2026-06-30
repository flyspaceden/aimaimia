import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NotificationAction,
  NotificationAudience,
  NotificationEvent,
  NotificationMessageDraft,
  NotificationRecipientKind,
  NotificationResolveResult,
  NotificationRouteKey,
  NotificationSeverity,
} from './notification.types';

type MessageInput = Omit<NotificationMessageDraft, 'eventType' | 'idempotencyKey'>;

@Injectable()
export class NotificationRegistry {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async resolve(event: NotificationEvent): Promise<NotificationResolveResult> {
    switch (event.eventType) {
      case 'order.shipped':
        return this.buyer(event, {
          category: 'order',
          title: '订单已发货',
          body: '您的订单已发货，可查看物流进度。',
          severity: 'SUCCESS',
          entityType: 'order',
          routeKey: 'ORDER_DETAIL',
        });
      case 'order.delivered':
        return this.buyer(event, {
          category: 'order',
          title: '包裹已送达',
          body: '您的包裹已签收，请确认收货。如有问题可申请售后。',
          severity: 'SUCCESS',
          entityType: 'order',
          routeKey: 'ORDER_DETAIL',
        });
      case 'order.receiverInfoRequired':
        return this.buyer(event, {
          category: 'order',
          title: '请修改收货信息',
          body: '商家发货时发现收货信息无法生成快递面单，请修改后等待商家继续发货。',
          severity: 'WARNING',
          entityType: 'order',
          routeKey: 'ORDER_RECEIVER_INFO',
        });
      case 'logistics.exception':
        return this.buyer(event, {
          category: 'order',
          title: '物流状态异常',
          body: '您的包裹物流状态出现异常，平台和商家会继续跟进。',
          severity: 'WARNING',
          entityType: 'shipment',
          routeKey: 'ORDER_DETAIL',
        });
      case 'logistics.stale':
        return this.buyer(event, {
          category: 'order',
          title: '物流长时间未更新',
          body: '您的包裹物流长时间未更新，平台会持续跟踪。',
          severity: 'WARNING',
          entityType: 'shipment',
          routeKey: 'ORDER_TRACK',
        });
      case 'coupon.granted':
        return this.buyer(event, {
          category: 'wallet',
          title: '红包到账',
          body: '您收到一张平台红包，可在我的红包中查看。',
          severity: 'SUCCESS',
          entityType: 'couponInstance',
          routeKey: 'COUPONS',
        });
      case 'coupon.expired':
        return this.buyer(event, {
          category: 'wallet',
          title: '红包已过期',
          body: '您有平台红包已过期，可在我的红包中查看明细。',
          severity: 'INFO',
          entityType: 'couponInstance',
          routeKey: 'COUPONS',
        });
      case 'reward.credited':
        return this.buyer(event, {
          category: 'wallet',
          title: '消费奖励到账',
          body: `您收到${this.amountText(event)}消费奖励，已计入钱包。`,
          severity: 'SUCCESS',
          entityType: 'rewardLedger',
          routeKey: 'WALLET',
        });
      case 'reward.unfrozen':
        return this.buyer(event, {
          category: 'wallet',
          title: '冻结奖励已解锁',
          body: `您的${this.amountText(event)}冻结消费奖励已解锁。`,
          severity: 'SUCCESS',
          entityType: 'rewardLedger',
          routeKey: 'WALLET',
        });
      case 'reward.expired':
        return this.buyer(event, {
          category: 'wallet',
          title: '消费奖励已过期',
          body: '您有消费奖励已过期，可在钱包中查看明细。',
          severity: 'INFO',
          entityType: 'rewardLedger',
          routeKey: 'WALLET',
        });
      case 'withdraw.approved':
        return this.buyer(event, {
          category: 'wallet',
          title: '提现审核通过',
          body: '您的提现申请已审核通过，平台将继续处理打款。',
          severity: 'SUCCESS',
          entityType: 'withdrawRequest',
          routeKey: 'WALLET',
        });
      case 'withdraw.rejected':
        return this.buyer(event, {
          category: 'wallet',
          title: '提现申请未通过',
          body: '您的提现申请未通过，可在钱包中查看处理结果。',
          severity: 'WARNING',
          entityType: 'withdrawRequest',
          routeKey: 'WALLET',
        });
      case 'withdraw.processing':
        return this.buyer(event, {
          category: 'wallet',
          title: '提现处理中',
          body: '您的提现已进入打款处理，请留意钱包状态。',
          severity: 'INFO',
          entityType: 'withdrawRequest',
          routeKey: 'WALLET',
        });
      case 'withdraw.paid':
        return this.buyer(event, {
          category: 'wallet',
          title: '提现已到账',
          body: '您的提现已完成打款，可在钱包中查看明细。',
          severity: 'SUCCESS',
          entityType: 'withdrawRequest',
          routeKey: 'WALLET',
        });
      case 'withdraw.failed':
        return this.buyer(event, {
          category: 'wallet',
          title: '提现打款失败',
          body: '您的提现打款未成功，资金已按规则退回或等待平台处理。',
          severity: 'WARNING',
          entityType: 'withdrawRequest',
          routeKey: 'WALLET',
        });
      case 'withdraw.yearlyAlert':
        return this.withdrawYearlyAlert(event);
      case 'vip.activated':
        return this.buyer(event, {
          category: 'order',
          title: 'VIP 已开通',
          body: '您的 VIP 权益已开通，可查看订单和会员权益。',
          severity: 'SUCCESS',
          entityType: 'order',
          routeKey: 'ORDER_DETAIL',
        });
      case 'refund.credited':
        return this.buyer(event, {
          category: 'after_sale',
          title: '退款已到账',
          body: '您的退款已处理完成，可查看订单或售后详情。',
          severity: 'SUCCESS',
          entityType: 'refund',
          routeKey: event.payload.orderId ? 'ORDER_DETAIL' : 'WALLET',
        });
      case 'order.newPaidForSeller':
        return this.seller(event, {
          category: 'order',
          title: '新订单待发货',
          body: '您有新的已付款订单，请及时处理发货。',
          severity: 'INFO',
          entityType: 'order',
          routeKey: 'SELLER_ORDER_DETAIL',
        });
      case 'order.canceledByBuyerForSeller':
        return this.seller(event, {
          category: 'order',
          title: '买家取消订单',
          body: '买家已在发货前取消订单，请在订单详情中查看处理结果。',
          severity: 'INFO',
          entityType: 'order',
          routeKey: 'SELLER_ORDER_DETAIL',
        });
      case 'order.stockShortage':
        return this.seller(event, {
          category: 'order',
          title: '商品超卖补货提醒',
          body: '有商品出现超卖或库存不足，请尽快补货。',
          severity: 'WARNING',
          entityType: 'sku',
          routeKey: 'SELLER_PRODUCT_DETAIL',
        });
      default:
        throw new Error(`未注册的通知事件: ${event.eventType}`);
    }
  }

  private async buyer(
    event: NotificationEvent,
    template: {
      category: string;
      title: string;
      body: string;
      severity: NotificationSeverity;
      entityType: string;
      routeKey: NotificationRouteKey;
    },
  ): Promise<NotificationResolveResult> {
    const userId = this.payloadString(event, 'buyerUserId', 'userId');
    if (!userId) return { messages: [] };

    const entityId = this.entityId(event);
    return {
      messages: [
        this.buildMessage(event, {
          recipientKind: 'BUYER_USER',
          recipientKey: `buyer:${userId}`,
          audience: 'BUYER_APP',
          category: template.category,
          title: template.title,
          body: template.body,
          severity: template.severity,
          entityType: template.entityType,
          entityId,
          action: this.action(template.routeKey, this.routeParams(event)),
        }),
      ],
    };
  }

  private async seller(
    event: NotificationEvent,
    template: {
      category: string;
      title: string;
      body: string;
      severity: NotificationSeverity;
      entityType: string;
      routeKey: NotificationRouteKey;
    },
  ): Promise<NotificationResolveResult> {
    const sellerUserIds = await this.resolveSellerUserIds(event);
    const entityId = this.entityId(event);
    return {
      messages: sellerUserIds.map((userId) =>
        this.buildMessage(event, {
          recipientKind: 'SELLER_STAFF',
          recipientKey: `seller:${userId}`,
          audience: 'SELLER_CENTER',
          category: template.category,
          title: template.title,
          body: template.body,
          severity: template.severity,
          entityType: template.entityType,
          entityId,
          action: this.action(template.routeKey, this.routeParams(event)),
        }),
      ),
    };
  }

  private withdrawYearlyAlert(event: NotificationEvent): NotificationResolveResult {
    const messages: NotificationMessageDraft[] = [];
    const userId = this.payloadString(event, 'buyerUserId', 'userId');
    if (userId) {
      messages.push(
        this.buildMessage(event, {
          recipientKind: 'BUYER_USER',
          recipientKey: `buyer:${userId}`,
          audience: 'BUYER_APP',
          category: 'wallet',
          title: '提现额度提醒',
          body: '您的年度提现额度已接近平台提醒线，可在钱包中查看明细。',
          severity: 'WARNING',
          entityType: 'withdrawRisk',
          entityId: this.entityId(event),
          action: this.action('WALLET'),
        }),
      );
    }

    for (const adminUserId of this.payloadStringArray(event, 'adminUserIds')) {
      messages.push(
        this.buildMessage(event, {
          recipientKind: 'ADMIN_USER',
          recipientKey: `admin:${adminUserId}`,
          audience: 'ADMIN_CENTER',
          category: 'risk',
          title: '提现额度风险提醒',
          body: '有用户年度提现额度触发提醒线，请在管理后台核查。',
          severity: 'WARNING',
          entityType: 'withdrawRisk',
          entityId: this.entityId(event),
          action: this.action('ADMIN_WITHDRAW_DETAIL', this.routeParams(event)),
        }),
      );
    }

    return { messages };
  }

  private async resolveSellerUserIds(event: NotificationEvent): Promise<string[]> {
    const explicit = this.payloadStringArray(event, 'sellerUserIds', 'staffUserIds');
    if (explicit.length > 0) return explicit;

    const companyId = this.payloadString(event, 'companyId');
    if (!companyId || !this.prisma) return [];

    const staff = await this.prisma.companyStaff.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: { userId: true },
    });
    return staff.map((item) => item.userId);
  }

  private buildMessage(event: NotificationEvent, input: MessageInput): NotificationMessageDraft {
    return {
      ...input,
      eventType: event.eventType,
      idempotencyKey: `${event.idempotencyKey || `${event.eventType}:${event.aggregateType}:${event.aggregateId}`}:${input.recipientKey}`,
    };
  }

  private action(routeKey: NotificationRouteKey, params?: Record<string, string>): NotificationAction {
    return params ? { routeKey, params } : { routeKey };
  }

  private routeParams(event: NotificationEvent): Record<string, string> | undefined {
    const id =
      this.payloadString(event, 'orderId', 'afterSaleId', 'invoiceId', 'couponId', 'couponInstanceId', 'withdrawId', 'skuId', 'productId') ||
      event.aggregateId;
    return id ? { id } : undefined;
  }

  private entityId(event: NotificationEvent): string {
    return (
      this.payloadString(
        event,
        'orderId',
        'shipmentId',
        'couponId',
        'couponInstanceId',
        'ledgerId',
        'withdrawId',
        'refundId',
        'skuId',
        'productId',
      ) || event.aggregateId
    );
  }

  private amountText(event: NotificationEvent): string {
    const amount = event.payload.amount;
    return typeof amount === 'number' && Number.isFinite(amount) ? `${amount.toFixed(2)} 元` : '';
  }

  private payloadString(event: NotificationEvent, ...keys: string[]): string {
    for (const key of keys) {
      const value = event.payload[key];
      if (typeof value === 'string' && value.trim()) return value;
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
  }

  private payloadStringArray(event: NotificationEvent, ...keys: string[]): string[] {
    for (const key of keys) {
      const value = event.payload[key];
      if (Array.isArray(value)) {
        return value
          .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
          .map((item) => String(item))
          .filter(Boolean);
      }
    }
    return [];
  }
}
