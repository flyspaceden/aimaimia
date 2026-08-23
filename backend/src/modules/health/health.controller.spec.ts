import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { ResultWrapperInterceptor } from '../../common/interceptors/result-wrapper.interceptor';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController response contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{
        provide: HealthService,
        useValue: {
          liveness: () => ({ status: 'ok', releaseSha: 'a'.repeat(40) }),
          readiness: () => ({
            status: 'ready',
            releaseSha: 'a'.repeat(40),
            components: { database: 'up', redis: 'up' },
          }),
        },
      }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResultWrapperInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps readiness and keeps releaseSha under data for deployment verification', async () => {
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({
        ok: true,
        data: {
          status: 'ready',
          releaseSha: 'a'.repeat(40),
          components: { database: 'up', redis: 'up' },
        },
      });
  });
});
