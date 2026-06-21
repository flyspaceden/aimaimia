import { DELIVERY_MANIFEST_TEMPLATES } from './delivery-manifest.definitions';

describe('delivery manifest default definitions', () => {
  it('uses operator-facing Chinese names and column labels by default', () => {
    expect(DELIVERY_MANIFEST_TEMPLATES.BUYER_FULL.name).toBe('买家整单清单');
    expect(DELIVERY_MANIFEST_TEMPLATES.SELLER_FULFILLMENT.name).toBe('配送中心履约清单');
    expect(DELIVERY_MANIFEST_TEMPLATES.SELLER_FINANCE.name).toBe('配送中心财务结算导出');

    const allVisibleText = Object.values(DELIVERY_MANIFEST_TEMPLATES)
      .flatMap((template) => [
        template.name,
        template.description,
        ...template.columns.map((column) => column.label),
      ])
      .join(' ');

    expect(allVisibleText).not.toMatch(
      /\b(Buyer Full Manifest|Seller Fulfillment Manifest|Seller Finance Export|Order ID|SubOrder ID|Final Unit Price|Supply Amount|Settlement Amount)\b/,
    );
    expect(allVisibleText).toEqual(expect.stringContaining('配送订单号'));
    expect(allVisibleText).toEqual(expect.stringContaining('商品名称'));
    expect(allVisibleText).toEqual(expect.stringContaining('供货金额'));
    expect(allVisibleText).toEqual(expect.stringContaining('应结金额'));
  });
});
