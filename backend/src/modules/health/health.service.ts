import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RedisCoordinatorService } from '../../common/infra/redis-coordinator.service';
import { DeliveryPrismaService } from '../../delivery-prisma/delivery-prisma.service';
import { PrismaService } from '../../prisma/prisma.service';

type ComponentState = 'up' | 'down';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly redis: RedisCoordinatorService,
  ) {}

  liveness() {
    return { status: 'ok' as const };
  }

  async readiness() {
    const [database, deliveryDatabase, redis] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1 AS ok`,
      this.deliveryPrisma.$queryRaw`SELECT 1 AS ok`,
      this.redis.ping(),
    ]);
    const components: Record<'database' | 'deliveryDatabase' | 'redis', ComponentState> = {
      database: database.status === 'fulfilled' ? 'up' : 'down',
      deliveryDatabase: deliveryDatabase.status === 'fulfilled' ? 'up' : 'down',
      redis: redis.status === 'fulfilled' && redis.value === true ? 'up' : 'down',
    };

    if (Object.values(components).some((state) => state === 'down')) {
      throw new ServiceUnavailableException({
        code: 'SERVICE_NOT_READY',
        message: '服务依赖尚未就绪',
        components,
      });
    }

    return { status: 'ready' as const, components };
  }
}
