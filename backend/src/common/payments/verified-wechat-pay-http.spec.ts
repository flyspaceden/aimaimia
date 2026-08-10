import { createSign, generateKeyPairSync } from 'crypto';

import { VerifiedWechatPayHttpTransport } from './verified-wechat-pay-http';

describe('VerifiedWechatPayHttpTransport', () => {
  const originalFetch = global.fetch;
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const publicKeyId = 'PUB_KEY_ID_123';

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function signedResponse(status: number, rawBody: string, overrides: Record<string, string> = {}) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = 'verified-response-nonce';
    const signer = createSign('RSA-SHA256');
    signer.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
    signer.end();
    const headers = new Headers({
      'wechatpay-signature': signer.sign(keys.privateKey, 'base64'),
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-serial': publicKeyId,
      ...overrides,
    });
    return {
      status,
      ok: status >= 200 && status < 300,
      headers,
      text: jest.fn().mockResolvedValue(rawBody),
    } as unknown as Response;
  }

  function build() {
    return new VerifiedWechatPayHttpTransport({ publicKeyId, publicKey });
  }

  it('verifies the original JSON response before returning parsed data', async () => {
    global.fetch = jest.fn().mockResolvedValue(signedResponse(200, '{"trade_state":"SUCCESS"}'));

    await expect(build().get(
      'https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/CS1?mchid=1',
      { Authorization: 'signed-request' },
    )).resolves.toEqual({ status: 200, data: { trade_state: 'SUCCESS' } });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'signed-request',
          'Wechatpay-Serial': publicKeyId,
        }),
      }),
    );
  });

  it('rejects a forged SUCCESS response before business code can consume it', async () => {
    global.fetch = jest.fn().mockResolvedValue(signedResponse(200, '{"trade_state":"SUCCESS"}', {
      'wechatpay-signature': Buffer.from('forged').toString('base64'),
    }));

    await expect(build().get(
      'https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/CS1?mchid=1',
      {},
    )).rejects.toMatchObject({ code: 'INVALID_WECHATPAY_SIGNATURE' });
  });

  it('verifies an empty 204 body using the required trailing newline', async () => {
    global.fetch = jest.fn().mockResolvedValue(signedResponse(204, ''));

    await expect(build().post(
      'https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/CS1/close',
      { mchid: '1' },
      {},
    )).resolves.toEqual({ status: 204, data: {} });
  });

  it.each([
    [{ 'wechatpay-signature': '' }, 'WECHATPAY_SIGNATURE_MISSING'],
    [{ 'wechatpay-serial': 'OTHER_KEY' }, 'WECHATPAY_SERIAL_MISMATCH'],
    // 微信支付要求签名探测流量也按普通响应验签，不能按前缀走特殊分支。
    [{ 'wechatpay-signature': 'WECHATPAY/SIGNTEST/fake' }, 'INVALID_WECHATPAY_SIGNATURE'],
    [{ 'wechatpay-timestamp': '1' }, 'WECHATPAY_TIMESTAMP_INVALID'],
  ])('fails closed for invalid signature metadata %#', async (overrides, code) => {
    global.fetch = jest.fn().mockResolvedValue(signedResponse(200, '{}', overrides));

    await expect(build().get('https://api.mch.weixin.qq.com/v3/certificates', {}))
      .rejects.toMatchObject({ code });
  });

  it('keeps a verified provider error available for safe error mapping', async () => {
    const rawBody = '{"code":"ORDER_NOT_EXIST","message":"not found"}';
    global.fetch = jest.fn().mockResolvedValue(signedResponse(404, rawBody));

    await expect(build().get('https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/X', {}))
      .resolves.toEqual({
        status: 404,
        data: { code: 'ORDER_NOT_EXIST', message: 'not found' },
        error: rawBody,
      });
  });

  it('rejects URLs outside the fixed WeChat Pay API origin', async () => {
    await expect(build().get('https://example.com/v3/pay/transactions', {}))
      .rejects.toMatchObject({ code: 'UNTRUSTED_WECHATPAY_ORIGIN' });
    expect(global.fetch).toBe(originalFetch);
  });
});
