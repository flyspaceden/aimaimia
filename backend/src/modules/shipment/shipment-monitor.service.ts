import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { InboxService } from '../inbox/inbox.service';

@Injectable()
export class ShipmentMonitorService {
  private readonly logger = new Logger(ShipmentMonitorService.name);
  /** 超过多少天未更新视为异常 */
  private static readonly STALE_DAYS = 3;

  constructor(
    private prisma: PrismaService,
    private inboxService: InboxService,
  ) {}

  /**
   * 每天早上 9 点扫描超过 N 天未更新的 IN_TRANSIT 包裹
   * 通知买家，并 touch updatedAt 防止重复通知
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkStaleShipments() {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - ShipmentMonitorService.STALE_DAYS);

    const staleShipments = await this.prisma.shipment.findMany({
      where: {
        status: 'IN_TRANSIT',
        updatedAt: { lt: staleDate },
      },
      include: {
        order: { select: { userId: true } },
      },
      take: 100,
    });

    if (staleShipments.length === 0) return;

    this.logger.warn(
      `发现 ${staleShipments.length} 个物流超 ${ShipmentMonitorService.STALE_DAYS} 天未更新的包裹`,
    );

    for (const shipment of staleShipments) {
      try {
        // 通知买家
        if (shipment.order?.userId) {
          await this.inboxService.send({
            userId: shipment.order.userId,
            category: 'order',
            type: 'logistics_stale',
            title: '物流更新异常',
            content: `您的包裹（顺丰速运）已超过 ${ShipmentMonitorService.STALE_DAYS} 天未更新物流信息，请关注。`,
            target: { route: '/orders/track', params: { orderId: shipment.orderId } },
          });
        }

        // touch updatedAt 防止重复通知
        await this.prisma.shipment.update({
          where: { id: shipment.id },
          data: { updatedAt: new Date() },
        });
      } catch (err: any) {
        this.logger.error(`物流异常通知发送失败: shipmentId=${shipment.id}, ${err.message}`);
      }
    }

    this.logger.log(`物流异常通知完成: 已通知 ${staleShipments.length} 个包裹`);
  }
}
