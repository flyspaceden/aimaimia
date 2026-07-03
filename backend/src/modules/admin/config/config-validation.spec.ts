import { validateConfigValue, VIP_POOL_PERCENT_KEYS } from './config-validation';

describe('invoice config validation', () => {
  it('accepts valid invoice provider mode and line mode', () => {
    expect(validateConfigValue('INVOICE_PROVIDER_MODE', 'MOCK')).toBeNull();
    expect(validateConfigValue('INVOICE_LINE_MODE', 'ORDER_ITEMS')).toBeNull();
    expect(validateConfigValue('INVOICE_LINE_MODE', 'MERGED_CATEGORY')).toBeNull();
  });

  it('accepts valid invoice issuer profile', () => {
    expect(
      validateConfigValue('INVOICE_ISSUER_PROFILE', {
        companyName: '爱买买app',
        taxNo: '91440300MAEXAMPLE',
        registeredAddress: '深圳市南山区',
        registeredPhone: '0755-88888888',
        bankName: '中国农业银行深圳分行',
        bankAccount: '6222000000000000',
        drawer: '系统开票',
        reviewer: '复核员',
        payee: '收款员',
      }),
    ).toBeNull();
  });

  it('rejects invalid invoice tax rate and issuer profile', () => {
    expect(validateConfigValue('INVOICE_DEFAULT_TAX_RATE', 0.2)).toContain(
      'INVOICE_DEFAULT_TAX_RATE',
    );
    expect(
      validateConfigValue('INVOICE_ISSUER_PROFILE', { companyName: '', taxNo: '' }),
    ).toContain('companyName');
  });

  it('rejects unknown remark variables', () => {
    expect(
      validateConfigValue('INVOICE_REMARK_TEMPLATE', '订单 {{orderId}} {{token}}'),
    ).toContain('白名单');
  });

  it('rejects secret-like keys in issuer profile', () => {
    expect(
      validateConfigValue('INVOICE_ISSUER_PROFILE', {
        companyName: '爱买买app',
        taxNo: '91440300MAEXAMPLE',
        privateKey: 'should-not-be-here',
      }),
    ).toContain('密钥');
  });
});

describe('LOW_STOCK_DISPLAY_THRESHOLD validation', () => {
  it('accepts integer threshold between 0 and 999', () => {
    expect(validateConfigValue('LOW_STOCK_DISPLAY_THRESHOLD', 0)).toBeNull();
    expect(validateConfigValue('LOW_STOCK_DISPLAY_THRESHOLD', 10)).toBeNull();
    expect(validateConfigValue('LOW_STOCK_DISPLAY_THRESHOLD', 999)).toBeNull();
  });

  it('rejects invalid low-stock threshold values', () => {
    expect(validateConfigValue('LOW_STOCK_DISPLAY_THRESHOLD', -1)).toContain('最小值');
    expect(validateConfigValue('LOW_STOCK_DISPLAY_THRESHOLD', 1000)).toContain('最大值');
    expect(validateConfigValue('LOW_STOCK_DISPLAY_THRESHOLD', 1.5)).toContain('整数');
  });
});

describe('VIP direct referral percent validation', () => {
  it('accepts VIP direct referral percent and includes it in the VIP pool keys', () => {
    expect(validateConfigValue('VIP_DIRECT_REFERRAL_PERCENT', 0.05)).toBeNull();
    expect(VIP_POOL_PERCENT_KEYS).toContain('VIP_DIRECT_REFERRAL_PERCENT');
  });
});
