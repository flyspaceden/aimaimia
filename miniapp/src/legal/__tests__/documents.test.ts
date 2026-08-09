import { describe, expect, it } from 'vitest';

import {
  MINIAPP_LEGAL_DOCUMENTS,
  MINIAPP_MEMBER_SERVICE_AGREEMENT,
  MINIAPP_PRIVACY_POLICY,
  MINIAPP_TERMS_OF_SERVICE,
} from '../documents';

describe('mini program legal documents', () => {
  it('uses channel-specific titles and payment wording', () => {
    expect(MINIAPP_TERMS_OF_SERVICE.title).toContain('微信小程序');
    expect(MINIAPP_PRIVACY_POLICY.title).toContain('微信小程序');
    expect(MINIAPP_MEMBER_SERVICE_AGREEMENT.title).toContain('微信小程序');

    const rendered = JSON.stringify(MINIAPP_LEGAL_DOCUMENTS);
    expect(rendered).toContain('微信支付');
    expect(rendered).toContain('微信零钱');
    expect(rendered).not.toMatch(/支付宝|\bapp\b|expo|react native|opensdk/i);
  });

  it('contains the privacy disclosures required by implemented capabilities', () => {
    const rendered = JSON.stringify(MINIAPP_PRIVACY_POLICY);
    for (const capability of ['相机', '相册', '麦克风', '扫码', '订阅消息', '微信支付']) {
      expect(rendered).toContain(capability);
    }
  });

  it('discloses the immediate and irreversible account-deletion asset treatment', () => {
    const rendered = JSON.stringify(MINIAPP_LEGAL_DOCUMENTS);
    expect(rendered).toContain('立即生效且不可恢复');
    expect(rendered).toContain('本可提现的余额');
    expect(rendered).toContain('即时清零作废');
    expect(rendered).toContain('不予保留、折现、退还、兑现或补偿');
  });
});
