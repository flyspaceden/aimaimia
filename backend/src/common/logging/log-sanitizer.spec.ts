import { sanitizeForLog } from './log-sanitizer';

describe('sanitizeForLog sensitive credential keys', () => {
  it('redacts camelCase tokens, mini-program tickets and verification credentials', () => {
    expect(sanitizeForLog({
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      miniLoginTicket: 'ticket-secret',
      smsCode: '123456',
      otp: '654321',
      verificationCode: 'abcdef',
      captchaCode: 'wxyz',
      nested: { APIKey: 'api-secret' },
      regionCode: '440305',
    })).toEqual({
      accessToken: '[REDACTED]',
      refreshToken: '[REDACTED]',
      miniLoginTicket: '[REDACTED]',
      smsCode: '[REDACTED]',
      otp: '[REDACTED]',
      verificationCode: '[REDACTED]',
      captchaCode: '[REDACTED]',
      nested: { APIKey: '[REDACTED]' },
      regionCode: '440305',
    });
  });

  it('redacts snake_case and kebab-case variants without hiding ordinary business codes', () => {
    expect(sanitizeForLog({
      access_token: 'access-secret',
      'mini-login-ticket': 'ticket-secret',
      verification_code: '123456',
      businessCode: 'CAPTCHA_INVALID',
    })).toEqual({
      access_token: '[REDACTED]',
      'mini-login-ticket': '[REDACTED]',
      verification_code: '[REDACTED]',
      businessCode: 'CAPTCHA_INVALID',
    });
  });
});
