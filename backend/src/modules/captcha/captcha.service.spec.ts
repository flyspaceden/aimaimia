import { CaptchaService } from './captcha.service';

describe('CaptchaService E2E bypass boundary', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBypassToken = process.env.CAPTCHA_BYPASS_TOKEN;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalBypassToken === undefined) delete process.env.CAPTCHA_BYPASS_TOKEN;
    else process.env.CAPTCHA_BYPASS_TOKEN = originalBypassToken;
  });

  it('accepts the configured bypass only in NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test';
    process.env.CAPTCHA_BYPASS_TOKEN = 'etest1';
    const redis = { getdel: jest.fn() };
    const service = new CaptchaService(redis as any);

    await expect(service.verify('any-e2e-captcha-id', 'etest1')).resolves.toBe(true);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('does not bypass verification outside the test environment', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CAPTCHA_BYPASS_TOKEN = 'etest1';
    const redis = { getdel: jest.fn().mockResolvedValue(null) };
    const service = new CaptchaService(redis as any);

    await expect(service.verify('missing-captcha-id', 'etest1')).resolves.toBe(false);
    expect(redis.getdel).toHaveBeenCalledWith('captcha:missing-captcha-id');
  });
});
