import { Injectable } from '@nestjs/common';
import { DeliveryConfigScope, Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { UpdateDeliveryConfigItemDto } from './dto/update-delivery-config.dto';
import {
  parseSfExpressProducts,
  SF_EXPRESS_PRODUCTS_CONFIG_KEY,
  validateSfExpressProducts,
} from './sf-express-products';

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
    const normalizedItems = items.map((item) => ({
      ...item,
      key: item.key.trim(),
      value:
        item.key.trim() === SF_EXPRESS_PRODUCTS_CONFIG_KEY
          ? { products: validateSfExpressProducts(item.value) }
          : item.value,
    }));

    return this.deliveryPrisma.$transaction(
      async (tx) => {
        const results = [];
        for (const item of normalizedItems) {
          const before = deliveryAdminUserId
            ? await tx.deliveryConfig.findUnique({ where: { key: item.key } })
            : null;
          const result = await tx.deliveryConfig.upsert({
            where: { key: item.key },
            create: {
              key: item.key,
              value: item.value as Prisma.InputJsonValue,
              description: item.description?.trim() || null,
              scope: item.scope ?? 'SYSTEM',
            },
            update: {
              value: item.value as Prisma.InputJsonValue,
              description: item.description?.trim() || null,
              scope: item.scope ?? 'SYSTEM',
            },
          });
          await this.writeAdminAuditLog(tx, deliveryAdminUserId, {
            key: item.key,
            before,
            after: result,
          });
          results.push(result);
        }
        return results;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getSfExpressProducts(enabledOnly = false) {
    const row = await this.deliveryPrisma.deliveryConfig.findUnique({
      where: { key: SF_EXPRESS_PRODUCTS_CONFIG_KEY },
      select: { value: true },
    });
    const products = parseSfExpressProducts(row?.value);
    return enabledOnly ? products.filter((item) => item.enabled) : products;
  }

  private async writeAdminAuditLog(
    tx: Prisma.TransactionClient,
    deliveryAdminUserId: string | undefined,
    input: { key: string; before: unknown; after: unknown },
  ) {
    if (!deliveryAdminUserId) {
      return;
    }

    await tx.deliveryAuditLog.create({
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
