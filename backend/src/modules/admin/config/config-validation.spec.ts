import { NORMAL_PERCENT_KEYS, validateConfigValue, VIP_POOL_PERCENT_KEYS } from './config-validation';
import {
  CAPTAIN_SEAFOOD_CONFIG_KEY,
  DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
} from '../../captain/captain.constants';

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

describe('normal direct referral and auto VIP config validation', () => {
  it('validates normal direct referral percent and includes it in normal pool keys', () => {
    expect(validateConfigValue('NORMAL_DIRECT_REFERRAL_PERCENT', 0.01)).toBeNull();
    expect(validateConfigValue('NORMAL_DIRECT_REFERRAL_PERCENT', -0.01)).toContain('最小值');
    expect(validateConfigValue('NORMAL_DIRECT_REFERRAL_PERCENT', 1.01)).toContain('最大值');
    expect(validateConfigValue('NORMAL_DIRECT_REFERRAL_PERCENT', '0.01')).toContain('必须是数字');
    expect(NORMAL_PERCENT_KEYS).toContain('NORMAL_DIRECT_REFERRAL_PERCENT');
  });

  it('validates auto VIP by spend switch', () => {
    expect(validateConfigValue('AUTO_VIP_BY_SPEND_ENABLED', true)).toBeNull();
    expect(validateConfigValue('AUTO_VIP_BY_SPEND_ENABLED', false)).toBeNull();
    expect(validateConfigValue('AUTO_VIP_BY_SPEND_ENABLED', 'true')).toContain('布尔值');
  });

  it('validates auto VIP cumulative spend threshold', () => {
    expect(validateConfigValue('AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD', 399)).toBeNull();
    expect(validateConfigValue('AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD', 1)).toBeNull();
    expect(validateConfigValue('AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD', 0)).toContain('最小值');
    expect(validateConfigValue('AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD', 100001)).toContain('最大值');
    expect(validateConfigValue('AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD', '399')).toContain('必须是数字');
  });
});

describe('CAPTAIN_SEAFOOD_CONFIG validation', () => {
  it('accepts the default disabled captain seafood config', () => {
    expect(
      validateConfigValue(CAPTAIN_SEAFOOD_CONFIG_KEY, DEFAULT_CAPTAIN_SEAFOOD_CONFIG),
    ).toBeNull();
  });

  it('rejects captain config that restores a secondary per-order commission', () => {
    expect(
      validateConfigValue(CAPTAIN_SEAFOOD_CONFIG_KEY, {
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
        perOrderCommission: {
          ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.perOrderCommission,
          indirectRate: 0.02,
        },
      }),
    ).toContain('indirectRate');
  });

  it('rejects captain config that exceeds the incentive cap', () => {
    expect(
      validateConfigValue(CAPTAIN_SEAFOOD_CONFIG_KEY, {
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
        monthlyRewards: {
          ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.monthlyRewards,
          growthBonusRate: 0.02,
        },
      }),
    ).toContain('growthBonusRate');
  });
});
