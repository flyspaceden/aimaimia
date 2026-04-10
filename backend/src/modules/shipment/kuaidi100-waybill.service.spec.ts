import { BadRequestException } from '@nestjs/common';
import { Kuaidi100WaybillService } from './kuaidi100-waybill.service';

// mock fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function createService(overrides: Record<string, string> = {}) {
  const config: Record<string, string> = {
    KUAIDI100_KEY: 'test-key',
    KUAIDI100_SECRET: 'test-secret',
    KUAIDI100_PARTNER_ID: 'test-partner',
    KUAIDI100_PARTNER_KEY: '',
    KUAIDI100_CALLBACK_URL: 'https://api.example.com/shipments/kuaidi100/callback',
    KUAIDI100_CALLBACK_TOKEN: 'cb-token',
    ...overrides,
  };

  const configService = {
    get: jest.fn((key: string, defaultVal?: string) => config[key] ?? defaultVal ?? ''),
  };

  return new Kuaidi100WaybillService(configService as any);
}

const validParams = {
  carrierCode: 'SF',
  senderName: '张三',
  senderPhone: '13800000001',
  senderAddress: '浙江省杭州市西湖区xxx路1号',
  recipientName: '李四',
  recipientPhone: '13900000002',
  recipientAddress: '广东省深圳市南山区xxx路2号',
  cargo: '农产品',
  weight: 1.5,
  count: 1,
};

describe('Kuaidi100WaybillService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('isConfigured', () => {
    it('全部配置时返回 true', () => {
      const service = createService();
      expect(service.isConfigured()).toBe(true);
    });

    it('缺少 SECRET 时返回 false', () => {
      const service = createService({ KUAIDI100_SECRET: '' });
      expect(service.isConfigured()).toBe(false);
    });

    it('缺少 PARTNER_ID 时返回 false', () => {
      const service = createService({ KUAIDI100_PARTNER_ID: '' });
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('createWaybill', () => {
    it('未配置时抛出 BadRequestException', async () => {
      const service = createService({ KUAIDI100_SECRET: '' });
      await expect(service.createWaybill(validParams)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('不支持的快递编码抛出 BadRequestException', async () => {
      const service = createService();
      await expect(
        service.createWaybill({ ...validParams, carrierCode: 'UNKNOWN' }),
      ).rejects.toThrow('不支持的快递公司编码');
    });

    it('成功下单返回 waybillNo + waybillImageUrl + taskId', async () => {
      const service = createService();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          code: 200,
          data: {
            kuaidinum: 'SF1234567890',
            taskId: 'TASK001',
            label: 'https://label.kuaidi100.com/xxx.png',
          },
        }),
      });

      const result = await service.createWaybill(validParams);

      expect(result.waybillNo).toBe('SF1234567890');
      expect(result.waybillImageUrl).toBe('https://label.kuaidi100.com/xxx.png');
      expect(result.taskId).toBe('TASK001');

      // 验证 fetch 调用参数
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.kuaidi100.com/label/order',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('快递100返回错误时抛出 BadRequestException', async () => {
      const service = createService();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          code: 30001,
          message: '参数错误',
        }),
      });

      await expect(service.createWaybill(validParams)).rejects.toThrow('参数错误');
    });

    it('HTTP 错误时抛出 BadRequestException', async () => {
      const service = createService();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(service.createWaybill(validParams)).rejects.toThrow(
        '快递100面单服务请求失败',
      );
    });

    it('网络异常时抛出 BadRequestException', async () => {
      const service = createService();
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(service.createWaybill(validParams)).rejects.toThrow(
        '快递100面单服务异常',
      );
    });

    it('未配置回调地址时 needSubscribe 设为 false 并输出警告', async () => {
      const service = createService({ KUAIDI100_CALLBACK_URL: '' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          code: 200,
          data: {
            kuaidinum: 'SF1234567890',
            taskId: 'TASK001',
            label: 'https://label.kuaidi100.com/xxx.png',
          },
        }),
      });

      await service.createWaybill(validParams);

      // 验证 fetch body 中 param 的 needSubscribe 为 false
      const fetchCall = mockFetch.mock.calls[0];
      const body = fetchCall[1].body as string;
      const paramStr = new URLSearchParams(body).get('param')!;
      const paramObj = JSON.parse(paramStr);
      expect(paramObj.needSubscribe).toBe(false);
      expect(paramObj.pollCallBackUrl).toBeUndefined();
    });
  });

  describe('cancelWaybill', () => {
    it('未配置时跳过并返回 success: false', async () => {
      const service = createService({ KUAIDI100_SECRET: '' });
      const result = await service.cancelWaybill('SF', 'SF1234');
      expect(result.success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('空 waybillNo 时跳过', async () => {
      const service = createService();
      const result = await service.cancelWaybill('SF', '');
      expect(result.success).toBe(false);
    });

    it('成功取消且请求体包含 kuaidicom 和 kuaidinum', async () => {
      const service = createService();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, code: 200 }),
      });

      const result = await service.cancelWaybill('SF', 'SF1234567890');
      expect(result.success).toBe(true);

      // 验证 fetch body 中 param 包含 kuaidicom 和 kuaidinum
      const fetchCall = mockFetch.mock.calls[0];
      const body = fetchCall[1].body as string;
      const paramStr = new URLSearchParams(body).get('param')!;
      const paramObj = JSON.parse(paramStr);
      expect(paramObj.partnerId).toBe('test-partner');
      expect(paramObj.kuaidicom).toBe('shunfeng');
      expect(paramObj.kuaidinum).toBe('SF1234567890');
    });

    it('取消失败不抛异常', async () => {
      const service = createService();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false, code: 30005, message: '取消失败' }),
      });

      const result = await service.cancelWaybill('SF', 'SF1234567890');
      expect(result.success).toBe(false);
    });
  });
});
