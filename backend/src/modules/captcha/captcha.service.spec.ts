import { CaptchaService } from './captcha.service';

describe('CaptchaService test-only bypass boundary', () => {
  const redis = {
    getdel: jest.fn(),
    set: jest.fn(),
  };
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBypassToken = process.env.CAPTCHA_BYPASS_TOKEN;
  let service: CaptchaService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis.getdel.mockResolvedValue(null);
    service = new CaptchaService(redis as any);
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalBypassToken === undefined) delete process.env.CAPTCHA_BYPASS_TOKEN;
    else process.env.CAPTCHA_BYPASS_TOKEN = originalBypassToken;
  });

  it('accepts the explicit bypass only in NODE_ENV=test without consuming a captcha', async () => {
    process.env.NODE_ENV = 'test';
    process.env.CAPTCHA_BYPASS_TOKEN = 'etest1';

    await expect(service.verify('e2e-bypass', 'etest1')).resolves.toBe(true);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('rejects the same bypass token in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CAPTCHA_BYPASS_TOKEN = 'etest1';

    await expect(service.verify('missing-captcha-id', 'etest1')).resolves.toBe(false);
    expect(redis.getdel).toHaveBeenCalledWith('captcha:missing-captcha-id');
  });

  it('rejects missing or too-short test bypass configuration', async () => {
    process.env.NODE_ENV = 'test';
    process.env.CAPTCHA_BYPASS_TOKEN = 'short';

    await expect(service.verify('e2e-bypass', 'short')).resolves.toBe(false);
    expect(redis.getdel).toHaveBeenCalledWith('captcha:e2e-bypass');
  });
});
