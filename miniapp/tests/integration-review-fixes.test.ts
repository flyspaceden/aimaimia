import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('integration review front-end fixes', () => {
  it('keeps the company page auth-aware and wires follow, phone, and WeChat sharing', () => {
    const company = source('src/packages/commerce/catalog-company/index.tsx');

    expect(company).toContain('authRevision');
    expect(company).toContain('CommunityRepo.toggleFollow(id)');
    expect(company).toContain('Taro.makePhoneCall');
    expect(company).toContain('useShareAppMessage');
    expect(company).toContain("openType='share'");
    expect(company).toContain('getCompanyInspectionReportPreviewUrl(reportId)');
    expect(company).toContain('openSecureDocument(previewUrl)');
    expect(company).not.toContain('openSecureDocument(report.fileUrl)');
  });

  it('keeps the unfinished task claim route and mutation unreachable', () => {
    const config = source('src/app.config.ts');
    const tasks = source('src/packages/benefits/tasks/index.tsx');
    const repos = source('src/packages/benefits/repos.ts');
    const me = source('src/pages/me/index.tsx');

    expect(config).not.toContain("'tasks/index'");
    expect(me).not.toContain('/packages/benefits/tasks/index');
    expect(tasks).toContain('任务中心暂未开放');
    expect(tasks).not.toContain('completeTask');
    expect(repos).not.toMatch(/\/tasks\/\$\{taskId\}\/complete/);
  });

  it('reuses the guarded checkout for buy-now and gates every mini-program money action', () => {
    const product = source('src/packages/commerce/catalog-product/index.tsx');
    const checkout = source('src/packages/commerce/checkout/index.tsx');
    const moneyPages = [
      checkout,
      source('src/packages/commerce/checkout-pending/index.tsx'),
      source('src/packages/benefits/vip-gifts/index.tsx'),
      source('src/packages/group-buy/checkout/index.tsx'),
      source('src/packages/group-buy/checkout-pending/index.tsx'),
      source('src/packages/after-sales/after-sale-detail/index.tsx'),
      source('src/packages/member/wechat-withdraw/index.tsx'),
    ];

    expect(product).toContain('buyNowProductId=');
    expect(product).toContain('立即购买');
    expect(checkout).toContain('ProductRepo.getById(buyNowProductId)');
    expect(checkout).toContain("...(!isBuyNow ? { cartItemId: item.id } : {})");
    expect(checkout).toContain("checkoutSource: isBuyNow ? 'BUY_NOW'");
    expect(source('src/repos/checkout.ts')).toContain('checkoutSource: input.checkoutSource');
    for (const page of moneyPages) expect(page).toContain('ensureWechatMiniProgramSession');
  });

  it('safely closes return-shipping payment when the user cancels the WeChat sheet', () => {
    const detail = source('src/packages/after-sales/after-sale-detail/index.tsx');
    const repo = source('src/packages/after-sales/repo.ts');
    expect(detail).toContain('MiniAfterSaleRepo.cancelReturnShippingPayment(id)');
    expect(repo).toContain('/return-shipping-payment/cancel');
  });

  it('requests optional result subscriptions only from explicit action flows', () => {
    const afterSale = source('src/packages/after-sales/after-sale-apply/index.tsx');
    const withdraw = source('src/packages/member/wechat-withdraw/index.tsx');

    expect(afterSale).toContain("requestOptionalMiniProgramSubscriptions(['AFTER_SALE_RESULT'], subscriptionTemplates)");
    expect(afterSale).toContain("confirmText: '接收提醒'");
    expect(afterSale).toContain('提醒配置暂不可用，可稍后到设置中授权');
    expect(afterSale).toContain('售后申请已成功，订阅面板失败不改变业务结果');
    expect(withdraw).toContain("requestOptionalMiniProgramSubscriptions(['WITHDRAW_RESULT'], subscriptionTemplates)");
    expect(withdraw).toContain("confirmText: '确认提现'");
    expect(withdraw).toContain('requestingSubscription');
  });

  it('cleans generated mini program code files when they are replaced or abandoned', () => {
    const panel = source('src/components/mini-program-code/index.tsx');

    expect(panel).toContain('filePathRef.current = persistedPath');
    expect(panel).toContain('removePersistedMiniProgramCode(previousPath)');
    expect(panel).toContain('removePersistedMiniProgramCode(persistedPath)');
  });
});
