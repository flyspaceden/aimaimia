import { DeliveryBuyerAuthController } from './delivery-buyer-auth.controller';

describe('DeliveryBuyerAuthController', () => {
  let service: {
    sendSmsCode: jest.Mock;
    phoneLogin: jest.Mock;
    wechatLogin: jest.Mock;
    getMe: jest.Mock;
  };
  let controller: DeliveryBuyerAuthController;

  beforeEach(() => {
    service = {
      sendSmsCode: jest.fn().mockResolvedValue({ ok: true, message: '验证码已发送' }),
      phoneLogin: jest.fn().mockResolvedValue({ accessToken: 'token-a' }),
      wechatLogin: jest.fn().mockResolvedValue({ accessToken: 'token-b' }),
      getMe: jest.fn().mockResolvedValue({ requiresUnit: true }),
    };
    controller = new DeliveryBuyerAuthController(service as any);
  });

  it('delegates delivery sms code sending without touching main app auth', async () => {
    await expect(
      controller.sendSmsCode(
        {
          phone: '13800000000',
        },
        {
          ip: '127.0.0.8',
          headers: { 'user-agent': 'jest-sms' },
        } as any,
      ),
    ).resolves.toEqual({ ok: true, message: '验证码已发送' });
    expect(service.sendSmsCode).toHaveBeenCalledWith(
      {
        phone: '13800000000',
      },
      '127.0.0.8',
      'jest-sms',
    );
  });

  it('delegates phone login', async () => {
    await expect(
      controller.phoneLogin(
        {
          phone: '13800000000',
          code: '123456',
        },
        {
          ip: '127.0.0.1',
          headers: { 'user-agent': 'jest' },
        } as any,
      ),
    ).resolves.toEqual({ accessToken: 'token-a' });
    expect(service.phoneLogin).toHaveBeenCalledWith(
      {
        phone: '13800000000',
        code: '123456',
      },
      '127.0.0.1',
      'jest',
    );
  });

  it('delegates getMe with the authenticated delivery user id', async () => {
    await expect(controller.getMe('PSYH0000000000001')).resolves.toEqual({
      requiresUnit: true,
    });
    expect(service.getMe).toHaveBeenCalledWith('PSYH0000000000001');
  });
});
