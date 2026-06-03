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

describe('AlipayService.transferToAccount', () => {
  let service: AlipayService;
  let exec: jest.Mock;

  beforeEach(() => {
    exec = jest.fn();
    service = new AlipayService({ get: jest.fn().mockReturnValue('test') } as any);
    (service as any).sdk = { exec };
  });

  it('calls alipay.fund.trans.uni.transfer with direct account transfer parameters', async () => {
    exec.mockResolvedValue({ code: '10000', orderId: 'O1', payFundOrderId: 'F1' });

    await service.transferToAccount({
      outBizNo: 'WD-x',
      amount: 80,
      payeeAccount: 'a@b.com',
      payeeRealName: '张三',
    });

    expect(exec).toHaveBeenCalledWith('alipay.fund.trans.uni.transfer', {
      bizContent: expect.objectContaining({
        out_biz_no: 'WD-x',
        trans_amount: '80.00',
        product_code: 'TRANS_ACCOUNT_NO_PWD',
        biz_scene: 'DIRECT_TRANSFER',
        payee_info: {
          identity: 'a@b.com',
          identity_type: 'ALIPAY_LOGON_ID',
          name: '张三',
        },
      }),
    });
  });

  it('maps successful transfer response', async () => {
    exec.mockResolvedValue({
      code: '10000',
      orderId: 'O1',
      payFundOrderId: 'F1',
      status: 'SUCCESS',
    });

    const result = await service.transferToAccount({
      outBizNo: 'WD-x',
      amount: 80,
      payeeAccount: 'a',
      payeeRealName: 'b',
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      processing: false,
      outBizNo: 'WD-x',
      orderId: 'O1',
      payFundOrderId: 'F1',
      providerStatus: 'SUCCESS',
    }));
  });

  it('maps deterministic business failure with sub code and message', async () => {
    exec.mockResolvedValue({
      code: '40004',
      subCode: 'PAYEE_NOT_EXIST',
      subMsg: '收款方账户不存在',
      msg: 'Business Failed',
    });

    const result = await service.transferToAccount({
      outBizNo: 'WD-x',
      amount: 80,
      payeeAccount: 'a',
      payeeRealName: 'b',
    });

    expect(result.success).toBe(false);
    expect(result.processing).toBe(false);
    expect(result.errorCode).toBe('PAYEE_NOT_EXIST');
    expect(result.errorMessage).toContain('收款方账户不存在');
  });

  it('maps system error as processing because the final result is unknown', async () => {
    exec.mockResolvedValue({
      code: '20000',
      subCode: 'SYSTEM_ERROR',
      subMsg: '系统错误',
    });

    const result = await service.transferToAccount({
      outBizNo: 'WD-x',
      amount: 80,
      payeeAccount: 'a',
      payeeRealName: 'b',
    });

    expect(result.success).toBe(false);
    expect(result.processing).toBe(true);
  });
});

describe('AlipayService.queryTransfer', () => {
  let service: AlipayService;
  let exec: jest.Mock;

  beforeEach(() => {
    exec = jest.fn();
    service = new AlipayService({ get: jest.fn().mockReturnValue('test') } as any);
    (service as any).sdk = { exec };
  });

  it('queries transfer by out_biz_no with direct transfer parameters', async () => {
    exec.mockResolvedValue({ code: '10000', status: 'SUCCESS', orderId: 'O1' });

    await service.queryTransfer({ outBizNo: 'WD-x' });

    expect(exec).toHaveBeenCalledWith('alipay.fund.trans.common.query', {
      bizContent: expect.objectContaining({
        out_biz_no: 'WD-x',
        product_code: 'TRANS_ACCOUNT_NO_PWD',
        biz_scene: 'DIRECT_TRANSFER',
      }),
    });
  });

  it('maps successful query response', async () => {
    exec.mockResolvedValue({
      code: '10000',
      status: 'SUCCESS',
      orderId: 'O1',
      payFundOrderId: 'F1',
      payDate: '2026-01-01 10:00:00',
    });

    const result = await service.queryTransfer({ outBizNo: 'WD-x' });

    expect(result.status).toBe('SUCCESS');
    expect(result.orderId).toBe('O1');
    expect(result.payFundOrderId).toBe('F1');
    expect(result.payDate).toBeInstanceOf(Date);
  });

  it('maps not-found provider responses to NOT_FOUND', async () => {
    exec.mockResolvedValue({
      code: '40004',
      subCode: 'ORDER_NOT_EXIST',
      subMsg: '订单不存在',
    });

    const result = await service.queryTransfer({ outBizNo: 'WD-x' });

    expect(result.status).toBe('NOT_FOUND');
    expect(result.errorCode).toBe('ORDER_NOT_EXIST');
  });

  it('keeps transient provider query failures as PROCESSING', async () => {
    exec.mockResolvedValue({
      code: '20000',
      subCode: 'SYSTEM_ERROR',
      msg: '服务不可用',
      subMsg: '系统繁忙，请稍后查询',
    });

    const result = await service.queryTransfer({ outBizNo: 'WD-x' });

    expect(result.status).toBe('PROCESSING');
    expect(result.errorCode).toBe('SYSTEM_ERROR');
  });
});
