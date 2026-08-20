import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const mainPrisma = { $queryRaw: jest.fn() };
  const deliveryPrisma = { $queryRaw: jest.fn() };
  const redis = { ping: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mainPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    deliveryPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    redis.ping.mockResolvedValue(true);
  });

  it('reports ready only when both databases and Redis are reachable', async () => {
    const service = new HealthService(mainPrisma as any, deliveryPrisma as any, redis as any);

    await expect(service.readiness()).resolves.toEqual({
      status: 'ready',
      components: { database: 'up', deliveryDatabase: 'up', redis: 'up' },
    });
  });

  it('fails closed without leaking connection details when a dependency is unavailable', async () => {
    redis.ping.mockResolvedValue(false);
    const service = new HealthService(mainPrisma as any, deliveryPrisma as any, redis as any);

    await expect(service.readiness()).rejects.toEqual(expect.any(ServiceUnavailableException));
    try {
      await service.readiness();
    } catch (error) {
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        code: 'SERVICE_NOT_READY',
        message: '服务依赖尚未就绪',
        components: { database: 'up', deliveryDatabase: 'up', redis: 'down' },
      });
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse()))
        .not.toMatch(/postgres|redis:\/\/|password|internal/i);
    }
  });
});
