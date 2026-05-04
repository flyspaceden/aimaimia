import { AlipayService } from './alipay.service';

describe('AlipayService', () => {
  it('passes app-pay callback parameters into sdkExecute', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'ALIPAY_NOTIFY_URL') {
          return 'https://test-api.ai-maimai.com/api/v1/payments/alipay/notify';
        }
        if (key === 'ALIPAY_RETURN_URL') {
          return 'aimaimai://alipay';
        }
        return fallback;
      }),
    };
    const service = new AlipayService(config as any);
    const sdkExecute = jest.fn().mockReturnValue('signed-order-string');
    (service as any).sdk = { sdkExecute };

    await service.createAppPayOrder({
      merchantOrderNo: 'CS-test',
      totalAmount: 0.01,
      subject: '爱买买订单-CS-test',
    });

    expect(sdkExecute).toHaveBeenCalledWith('alipay.trade.app.pay', {
      alipaySdk: 'alipay-sdk-nodejs-4.0.0',
      bizContent: {
        out_trade_no: 'CS-test',
        total_amount: '0.01',
        subject: '爱买买订单-CS-test',
        body: '',
        product_code: 'QUICK_MSECURITY_PAY',
        timeout_express: '30m',
      },
      notify_url: 'https://test-api.ai-maimai.com/api/v1/payments/alipay/notify',
      return_url: 'aimaimai://alipay',
    });
  });
});

describe('AlipayService.closeOrder', () => {
  function buildSvc(execResult: any | (() => any) | (() => Promise<any>) | Error) {
    const config = { get: jest.fn(() => null) } as any;
    const svc = new AlipayService(config);
    // 把 sdk 替换成 mock；isAvailable 由 sdk !== null 决定，此处赋值即可
    (svc as any).sdk = {
      exec: jest.fn().mockImplementation(async () => {
        if (execResult instanceof Error) throw execResult;
        if (typeof execResult === 'function') return await (execResult as any)();
        return execResult;
      }),
    };
    return svc;
  }

  it('成功：code=10000 返 { success: true }', async () => {
    const svc = buildSvc({ code: '10000' });
    const r = await svc.closeOrder('MO-1');
    expect(r).toEqual({ success: true });
  });

  it('已支付：ACQ.TRADE_STATUS_ERROR 返 { success: false, alreadyPaid: true }', async () => {
    const svc = buildSvc({ code: '40004', subCode: 'ACQ.TRADE_STATUS_ERROR' });
    const r = await svc.closeOrder('MO-2');
    expect(r).toEqual({ success: false, alreadyPaid: true });
  });

  it('已完成（含退款）：ACQ.TRADE_HAS_FINISHED 也归 alreadyPaid', async () => {
    const svc = buildSvc({ code: '40004', subCode: 'ACQ.TRADE_HAS_FINISHED' });
    const r = await svc.closeOrder('MO-3');
    expect(r).toEqual({ success: false, alreadyPaid: true });
  });

  it('交易不存在：ACQ.TRADE_NOT_EXIST 返 { success: true, terminal: true }', async () => {
    const svc = buildSvc({ code: '40004', subCode: 'ACQ.TRADE_NOT_EXIST' });
    const r = await svc.closeOrder('MO-4');
    expect(r).toEqual({ success: true, terminal: true });
  });

  it('已关闭（未支付）：ACQ.TRADE_HAS_CLOSE 返 { success: true, terminal: true }', async () => {
    const svc = buildSvc({ code: '40004', subCode: 'ACQ.TRADE_HAS_CLOSE' });
    const r = await svc.closeOrder('MO-5');
    expect(r).toEqual({ success: true, terminal: true });
  });

  it('其他错误：未知 subCode 返 { success: false }（让调用方重试）', async () => {
    const svc = buildSvc({ code: '40004', subCode: 'ACQ.SOME_RANDOM_ERROR' });
    const r = await svc.closeOrder('MO-6');
    expect(r).toEqual({ success: false });
  });

  it('SDK 抛异常：透传抛错', async () => {
    const svc = buildSvc(new Error('network down'));
    await expect(svc.closeOrder('MO-7')).rejects.toThrow('network down');
  });

  it('SDK 未初始化：直接返 { success: false }', async () => {
    const config = { get: jest.fn(() => null) } as any;
    const svc = new AlipayService(config);
    // 不赋 sdk，保持 null
    (svc as any).sdk = null;
    const r = await svc.closeOrder('MO-8');
    expect(r).toEqual({ success: false });
  });
});
