import { Injectable } from '@nestjs/common';
import { DeliveryConfigScope } from '../../../generated/delivery-client';
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

  async update(items: UpdateDeliveryConfigItemDto[]) {
    const results = [];
    for (const item of items) {
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
      results.push(result);
    }
    return results;
  }

  private isScope(value: string): value is DeliveryConfigScope {
    return ['SYSTEM', 'CUSTOMER_SERVICE', 'MANIFEST', 'UNIT'].includes(value);
  }
}
