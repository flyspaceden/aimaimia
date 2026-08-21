import { Controller, Post, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as request from 'supertest';
import { configureBodyParsers } from './configure-body-parsers';

@Controller('raw-body-probe')
class RawBodyProbeController {
  @Post()
  probe(@Req() req: { rawBody?: Buffer; body?: unknown }) {
    return {
      rawBody: req.rawBody?.toString('utf8') ?? null,
      body: req.body,
    };
  }
}

describe('configureBodyParsers', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RawBodyProbeController],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    configureBodyParsers(app, '1mb');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('preserves the exact JSON bytes used by WeChat Pay signature verification', async () => {
    const rawBody = '{"event_type":"REFUND.SUCCESS","resource":{"ciphertext":"signed"}}';

    const response = await request(app.getHttpServer())
      .post('/raw-body-probe')
      .set('content-type', 'application/json')
      .send(rawBody)
      .expect(201);

    expect(response.body).toEqual({
      rawBody,
      body: JSON.parse(rawBody),
    });
  });
});
