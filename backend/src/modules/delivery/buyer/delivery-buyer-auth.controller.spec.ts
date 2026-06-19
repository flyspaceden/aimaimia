import { DeliveryBuyerAuthController } from './delivery-buyer-auth.controller';

describe('DeliveryBuyerAuthController', () => {
  let service: {
    phoneLogin: jest.Mock;
    wechatLogin: jest.Mock;
    getMe: jest.Mock;
  };
  let controller: DeliveryBuyerAuthController;

  beforeEach(() => {
    service = {
      phoneLogin: jest.fn().mockResolvedValue({ accessToken: 'token-a' }),
      wechatLogin: jest.fn().mockResolvedValue({ accessToken: 'token-b' }),
      getMe: jest.fn().mockResolvedValue({ requiresUnit: true }),
    };
    controller = new DeliveryBuyerAuthController(service as any);
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
