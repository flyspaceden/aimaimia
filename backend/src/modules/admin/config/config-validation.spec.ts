import { validateConfigValue } from './config-validation';

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
