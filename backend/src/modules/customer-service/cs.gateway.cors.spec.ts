import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';

describe('CsGateway Socket.IO CORS configuration', () => {
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;
  const originalCorsOrigins = process.env.CORS_ORIGINS;

  afterEach(() => {
    if (originalAllowedOrigins === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    }

    if (originalCorsOrigins === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = originalCorsOrigins;
    }

    jest.resetModules();
  });

  it('reuses CORS_ORIGINS when the Socket-specific allowlist is not configured', () => {
    delete process.env.ALLOWED_ORIGINS;
    process.env.CORS_ORIGINS =
      'https://admin.ai-maimai.com,https://app.ai-maimai.com';
    jest.resetModules();

    const { CsGateway } = require('./cs.gateway');
    const gatewayOptions = Reflect.getMetadata(GATEWAY_OPTIONS, CsGateway);

    expect(gatewayOptions.cors.origin).toEqual([
      'https://admin.ai-maimai.com',
      'https://app.ai-maimai.com',
    ]);
  });
});
