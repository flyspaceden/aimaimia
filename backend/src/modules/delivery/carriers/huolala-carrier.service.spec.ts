import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { DeliveryPickupBatchStatus } from '../../../generated/delivery-client';
import { HuolalaCarrierService } from './huolala-carrier.service';
import { DeliveryCarrierQuoteRequest } from './delivery-carrier.types';

describe('HuolalaCarrierService', () => {
  const originalFetch = global.fetch;
  let originalDateNow: typeof Date.now;
  let originalMathRandom: typeof Math.random;
  let configService: { get: jest.Mock };
  let service: HuolalaCarrierService;

  const baseConfig: Record<string, string> = {
    DELIVERY_HUOLALA_ENABLED: 'true',
    DELIVERY_HUOLALA_APP_KEY: 'huolala-app-key',
    DELIVERY_HUOLALA_APP_SECRET: 'huolala-secret',
    DELIVERY_HUOLALA_ACCESS_TOKEN: 'huolala-access-token',
    DELIVERY_HUOLALA_PAY_TYPE: 'MONTHLY_ACCOUNT',
    DELIVERY_HUOLALA_MONTHLY_ACCOUNT_ID: 'monthly-account-id',
  };

  const quoteRequest: DeliveryCarrierQuoteRequest = {
    outsideOrderId: 'pickup_batch_001',
    cityId: '440100',
    vehicleId: 'small-van',
    sender: {
      name: '广州仓',
      phone: '13800000001',
      province: '广东省',
      city: '广州市',
      district: '天河区',
      detail: '体育东路 1 号',
      lat: 23.12908,
      lng: 113.26436,
    },
    receiver: {
      name: '配送站',
      phone: '13800000002',
      province: '广东省',
      city: '广州市',
      district: '海珠区',
      detail: '新港中路 2 号',
      lat: 23.09899,
      lng: 113.32452,
    },
    cargo: {
      name: '西红柿',
      quantity: 12,
      weightKg: 18.5,
      remark: '冷藏优先',
    },
    plannedPickupAt: new Date('2026-06-30T12:00:00.000Z'),
  };

  beforeEach(() => {
    global.fetch = jest.fn();
    originalDateNow = Date.now;
    originalMathRandom = Math.random;
    Date.now = jest.fn(() => 1767225600000);
    Math.random = jest.fn(() => 0.123456789);
    configService = {
      get: jest.fn((key: string) => baseConfig[key]),
    };
    service = new HuolalaCarrierService(configService as unknown as ConfigService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
    Math.random = originalMathRandom;
  });

  it('signs sorted parameters with nonce and timestamp', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          price_calculate_id: 'price_calc_001',
          fee_cent: 2880,
        },
      }),
    });

    await service.quote(quoteRequest);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(url).toBe('https://openapi.huolala.cn/api/e-price-calculate');
    expect(body.app_key).toBe(baseConfig.DELIVERY_HUOLALA_APP_KEY);
    expect(body.access_token).toBe(baseConfig.DELIVERY_HUOLALA_ACCESS_TOKEN);
    expect(body.timestamp).toBe('1767225600');
    expect(body.nonce_str).toBe('123456789000000');

    const signSource = Object.keys(body)
      .filter((key) => key !== 'signature' && body[key] !== undefined && body[key] !== null)
      .sort()
      .map((key) => `${key}${typeof body[key] === 'object' ? JSON.stringify(body[key]) : String(body[key])}`)
      .join('');
    const expectedSignature = createHash('md5')
      .update(`${signSource}${baseConfig.DELIVERY_HUOLALA_APP_SECRET}`)
      .digest('hex');

    expect(body.signature).toBe(expectedSignature);
  });

  it('maps driver assigned and completed states to delivery pickup statuses', () => {
    expect(service.mapHuolalaStatus('driver_assigned')).toBe(
      DeliveryPickupBatchStatus.DRIVER_ASSIGNED,
    );
    expect(service.mapHuolalaStatus('completed')).toBe(
      DeliveryPickupBatchStatus.COMPLETED,
    );
    expect(service.mapHuolalaStatus('mystery_state')).toBe(
      DeliveryPickupBatchStatus.CALLING_CARRIER,
    );
  });

  it('uses pickup batch id as outsideOrderId for idempotent order request', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          order_no: 'hl-order-001',
          status: 'driver_assigned',
        },
      }),
    });

    const result = await service.requestOrder({
      ...quoteRequest,
      priceCalculateId: 'price_calc_001',
    });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(url).toBe('https://openapi.huolala.cn/api/e-order-request');
    expect(body.outside_order_id).toBe('pickup_batch_001');
    expect(body.pay_type).toBe('8');
    expect(result.outsideOrderId).toBe('pickup_batch_001');
    expect(result.carrierOrderNo).toBe('hl-order-001');
  });

  it('throws ServiceUnavailableException when required config is missing', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DELIVERY_HUOLALA_APP_SECRET') return undefined;
      return baseConfig[key];
    });

    await expect(service.quote(quoteRequest)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns mapped status and driver snapshot from order detail', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          order_no: 'hl-order-001',
          status: 'delivering',
          driver: {
            name: '张师傅',
            phone: '13900000000',
          },
          vehicle: {
            plate_no: '粤A12345',
          },
          fee_cent: 3260,
        },
      }),
    });

    const result = await service.getOrderDetail({ outsideOrderId: 'pickup_batch_001' });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(result.carrierOrderNo).toBe('hl-order-001');
    expect(result.mappedStatus).toBe(DeliveryPickupBatchStatus.DELIVERING);
    expect(result.driverSnapshot).toEqual({
      name: '张师傅',
      phone: '13900000000',
    });
    expect(body.outside_order_id).toBe('pickup_batch_001');
    expect(body.carrier_order_no).toBeUndefined();
  });

  it('returns cancellation payload without real credentials', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          order_no: 'hl-order-001',
          status: 'canceled',
        },
      }),
    });

    const result = await service.cancelOrder({
      carrierOrderNo: 'hl-order-001',
      reason: 'seller_request',
    });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(result.carrierOrderNo).toBe('hl-order-001');
    expect(result.status).toBe('canceled');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(body.carrier_order_no).toBe('hl-order-001');
    expect(body.cancel_reason).toBe('seller_request');
  });

  it('normalizes fetch failures into ServiceUnavailableException', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('socket hang up'));

    await expect(service.quote(quoteRequest)).rejects.toMatchObject({
      message: '货拉拉运力服务暂不可用，请稍后重试',
    });
  });

  it('normalizes invalid json responses into ServiceUnavailableException', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
    });

    await expect(service.quote(quoteRequest)).rejects.toMatchObject({
      message: '货拉拉运力返回格式无效',
    });
  });

  it('normalizes non-2xx responses into ServiceUnavailableException', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
      json: jest.fn(),
    });

    await expect(service.quote(quoteRequest)).rejects.toMatchObject({
      message: '货拉拉运力服务暂不可用，请稍后重试',
    });
  });

  it.each([null, []])(
    'rejects invalid top-level json payload %p with ServiceUnavailableException',
    async (payload) => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(payload),
      });

      await expect(service.quote(quoteRequest)).rejects.toMatchObject({
        message: '货拉拉运力返回格式无效',
      });
    },
  );

  it('rejects quote responses missing required fields', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          price_calculate_id: 'price_calc_001',
        },
      }),
    });

    await expect(service.quote(quoteRequest)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects request-order responses missing required fields', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          status: 'driver_assigned',
        },
      }),
    });

    await expect(service.requestOrder({
      ...quoteRequest,
      priceCalculateId: 'price_calc_001',
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects order-detail responses missing required status', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          order_no: 'hl-order-001',
        },
      }),
    });

    await expect(service.getOrderDetail({
      outsideOrderId: 'pickup_batch_001',
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects cancel 2xx business failure payloads', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        code: 'SIGN_ERROR',
        message: 'bad sign',
      }),
    });

    await expect(service.cancelOrder({
      carrierOrderNo: 'hl-order-001',
      reason: 'seller_request',
    })).rejects.toMatchObject({
      message: '货拉拉运力服务暂不可用，请稍后重试',
    });
  });

  it('rejects cancel 2xx empty-object payloads', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    });

    await expect(service.cancelOrder({
      carrierOrderNo: 'hl-order-001',
      reason: 'seller_request',
    })).rejects.toMatchObject({
      message: '货拉拉运力返回缺少必要字段',
    });
  });
});
