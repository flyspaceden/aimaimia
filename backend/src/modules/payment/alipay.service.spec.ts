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
