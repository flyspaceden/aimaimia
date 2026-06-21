import { Injectable } from '@nestjs/common';
import { DeliveryConfigScope, Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { UpdateDeliveryConfigItemDto } from './dto/update-delivery-config.dto';

@Injectable()
export class DeliveryConfigService {
  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {}

  async list(scope?: string) {
    return this.deliveryPrisma.deliveryConfig.findMany({
      where:
        scope && this.isScope(scope)
          ? {
              scope,
            }
          : undefined,
      orderBy: [{ scope: 'asc' }, { key: 'asc' }],
    });
  }

  async update(items: UpdateDeliveryConfigItemDto[], deliveryAdminUserId?: string) {
    const results = [];
    for (const item of items) {
      const before = deliveryAdminUserId
        ? await this.deliveryPrisma.deliveryConfig.findUnique({ where: { key: item.key } })
        : null;
      const result = await this.deliveryPrisma.deliveryConfig.upsert({
        where: { key: item.key },
        create: {
          key: item.key,
          value: item.value as any,
          description: item.description?.trim() || null,
          scope: item.scope ?? 'SYSTEM',
        },
        update: {
          value: item.value as any,
          description: item.description?.trim() || null,
          scope: item.scope ?? 'SYSTEM',
        },
      });
      await this.writeAdminAuditLog(deliveryAdminUserId, {
        key: item.key,
        before,
        after: result,
      });
      results.push(result);
    }
    return results;
  }

  private async writeAdminAuditLog(
    deliveryAdminUserId: string | undefined,
    input: { key: string; before: unknown; after: unknown },
  ) {
    if (!deliveryAdminUserId) {
      return;
    }

    await this.deliveryPrisma.deliveryAuditLog.create({
      data: {
        actorType: 'ADMIN',
        actorId: deliveryAdminUserId,
        module: 'config',
        action: input.before ? 'UPDATE_CONFIG' : 'CREATE_CONFIG',
        targetType: 'DeliveryConfig',
        targetId: input.key,
        summary: input.before ? '更新配送配置' : '创建配送配置',
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

  private isScope(value: string): value is DeliveryConfigScope {
    return ['SYSTEM', 'CUSTOMER_SERVICE', 'MANIFEST', 'UNIT'].includes(value);
  }
}
