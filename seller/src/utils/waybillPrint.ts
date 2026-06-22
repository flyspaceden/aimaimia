import type { Order, OrderItem, OrderItemBundleComponent } from '../types/index.ts';

type PrintResult = 'opened' | 'blocked';

type SellerWaybillOrder = Pick<
  Order,
  'id' | 'createdDate' | 'buyerAlias' | 'buyerNo' | 'regionText' | 'items'
> & {
  shipment?: Order['shipment'] | null;
};

type PickingComponentSummary = {
  skuId?: string;
  disambiguator?: string;
  title: string;
  skuTitle: string;
  quantity: number;
};

const PRIZE_TYPE_LABELS: Record<string, string> = {
  THRESHOLD_GIFT: '满额赠品',
  DISCOUNT_BUY: '特价购',
  LOTTERY_PRIZE: '抽奖奖品',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toPositiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}

function trimOptional(value?: string | null): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function itemDescription(item: OrderItem): string {
  return typeof item.description === 'string' ? item.description.trim() : '';
}

function itemLabel(item: OrderItem): string {
  if (item.productType === 'BUNDLE') {
    return '组合商品';
  }
  if (!item.isPrize) {
    return '';
  }
  return item.prizeType ? (PRIZE_TYPE_LABELS[item.prizeType] ?? '奖品') : '奖品';
}

function resolveMerchantSkuCode(source?: unknown): string | undefined {
  const sourceObj = source as { skuCode?: string | null; merchantSkuCode?: string | null } | undefined;
  const skuCode = trimOptional(sourceObj?.skuCode);
  if (skuCode) {
    return skuCode;
  }
  return trimOptional(sourceObj?.merchantSkuCode);
}

function shortSkuSuffix(skuId?: string): string | undefined {
  const text = trimOptional(skuId);
  if (!text) {
    return undefined;
  }
  return text.length > 6 ? text.slice(-6) : text;
}

function visibleSummaryLabel(entry: PickingComponentSummary): string {
  return `${entry.title}__${entry.skuTitle}`;
}

function disambiguatorForEntry(entry: PickingComponentSummary): string {
  if (!entry.disambiguator) {
    return '';
  }
  return ` (${entry.disambiguator})`;
}

export function resolveBundleComponentQuantity(
  component: OrderItemBundleComponent,
  parentQuantity: number,
): number | null {
  const totalQuantity = toPositiveInteger(component.totalQuantity);
  if (totalQuantity !== null) {
    return totalQuantity;
  }

  const quantityPerBundle = toPositiveInteger(component.quantityPerBundle)
    ?? toPositiveInteger(component.quantity);
  if (quantityPerBundle === null) {
    return null;
  }

  const parent = toPositiveInteger(parentQuantity);
  if (parent === null) {
    return null;
  }

  return quantityPerBundle * parent;
}

function componentDisplayTitle(component: OrderItemBundleComponent): string {
  return component.productTitle?.trim() || '未命名组件';
}

function componentDisplaySku(component: OrderItemBundleComponent): string {
  return component.skuTitle?.trim() || component.skuName?.trim() || '-';
}

function bundleComponentsOf(item: OrderItem): OrderItemBundleComponent[] {
  return Array.isArray(item.bundleItems) ? item.bundleItems : [];
}

function summaryKeyOf(input: { skuId?: string; title: string; skuTitle: string }): string {
  const skuId = input.skuId?.trim();
  if (skuId) {
    return `sku:${skuId}`;
  }
  return `text:${input.title}__${input.skuTitle}`;
}

function renderBundleDetails(item: OrderItem): string {
  if (item.productType !== 'BUNDLE') {
    return '';
  }

  const rows = bundleComponentsOf(item)
    .map((component) => {
      const quantity = resolveBundleComponentQuantity(component, item.quantity);
      if (quantity === null) {
        return '';
      }

      return `
            <div class="bundle-line">
              <span class="bundle-label">组合明细</span>
              <span class="bundle-name">${escapeHtml(componentDisplayTitle(component))}</span>
              <span class="bundle-sku">${escapeHtml(componentDisplaySku(component))}</span>
              <span class="bundle-qty">x${quantity}</span>
            </div>
      `;
    })
    .filter(Boolean)
    .join('');

  if (!rows) {
    return '';
  }

  return `<div class="bundle-list">${rows}</div>`;
}

function buildPickingSummary(items: OrderItem[]): PickingComponentSummary[] {
  const summary = new Map<string, PickingComponentSummary>();

  items.forEach((item) => {
    if (item.productType === 'BUNDLE') {
      bundleComponentsOf(item).forEach((component) => {
        const quantity = resolveBundleComponentQuantity(component, item.quantity);
        if (quantity === null) {
          return;
        }

        const title = componentDisplayTitle(component);
        const skuTitle = componentDisplaySku(component);
        const skuId = component.skuId?.trim() || undefined;
        const shortId = shortSkuSuffix(skuId);
        const disambiguator = resolveMerchantSkuCode(component) ?? (shortId ? `#${shortId}` : undefined);
        const key = summaryKeyOf({ skuId, title, skuTitle });
        const existing = summary.get(key);
        if (existing) {
          existing.quantity += quantity;
          return;
        }
        summary.set(key, { skuId, disambiguator, title, skuTitle, quantity });
      });
      return;
    }

    const quantity = toPositiveInteger(item.quantity);
    if (quantity === null) {
      return;
    }

    const title = item.title?.trim() || '未命名商品';
    const skuId = item.skuId?.trim() || undefined;
    const skuTitle = item.skuTitle?.trim() || '-';
    const shortId = shortSkuSuffix(skuId);
    const disambiguator = resolveMerchantSkuCode(item as {
      skuCode?: string | null;
      merchantSkuCode?: string | null;
    }) ?? (shortId ? `#${shortId}` : undefined);
    const key = summaryKeyOf({ skuId, title, skuTitle });
    const existing = summary.get(key);
    if (existing) {
      existing.quantity += quantity;
      return;
    }
    summary.set(key, { skuId, disambiguator, title, skuTitle, quantity });
  });

  return Array.from(summary.values()).sort((a, b) => {
    if (a.title === b.title) {
      const skuTitleCompare = a.skuTitle.localeCompare(b.skuTitle, 'zh-CN');
      if (skuTitleCompare !== 0) {
        return skuTitleCompare;
      }
      return (a.skuId || '').localeCompare(b.skuId || '', 'zh-CN');
    }
    return a.title.localeCompare(b.title, 'zh-CN');
  });
}

export function buildPickingSheetHtml(order: SellerWaybillOrder): string {
  const itemRows = order.items
    .map((item, index) => {
      const label = itemLabel(item);
      const description = itemDescription(item);
      return `
        <tr>
          <td class="index">${index + 1}</td>
          <td>
            <div class="item-title-row">
              <span class="item-title">${escapeHtml(item.title || '-')}</span>
              <span class="item-inline-qty">x${item.quantity}</span>
              ${label ? `<span class="item-meta">${escapeHtml(label)}</span>` : ''}
            </div>
            ${description ? `<div class="item-detail"><span>详情清单：</span>${escapeHtml(description)}</div>` : ''}
            ${renderBundleDetails(item)}
          </td>
          <td class="quantity">${item.quantity}</td>
        </tr>
      `;
    })
    .join('');

  const summaryEntries = buildPickingSummary(order.items);
  const visibleLabelCount = new Map<string, number>();
  for (const entry of summaryEntries) {
    const key = visibleSummaryLabel(entry);
    visibleLabelCount.set(key, (visibleLabelCount.get(key) ?? 0) + 1);
  }

  const summaryRows = summaryEntries
    .map((entry) => {
      const shouldDisambiguate = (visibleLabelCount.get(visibleSummaryLabel(entry)) ?? 0) > 1;
      const suffix = shouldDisambiguate ? disambiguatorForEntry(entry) : '';
      return `
        <tr>
          <td>${escapeHtml(entry.title)}</td>
          <td>${escapeHtml(entry.skuTitle)}${escapeHtml(suffix)}</td>
          <td class="summary-quantity">x${entry.quantity}</td>
        </tr>
      `;
    })
    .join('');

  const shipment = order.shipment;
  const carrier = shipment?.carrierName || shipment?.carrierCode || '-';
  const waybillNo = shipment?.waybillNo || shipment?.trackingNo || '-';
  const buyerNo = order.buyerNo || '-';
  const region = order.regionText || '-';

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>订单拣货单 ${escapeHtml(order.id)}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #f5f5f5;
        color: #1f2933;
        font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 16px;
      }
      .page {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        padding: 12mm;
        background: #fff;
      }
      .header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        border-bottom: 2px solid #1f2933;
        padding-bottom: 12px;
        margin-bottom: 14px;
      }
      h1 {
        margin: 0;
        font-size: 34px;
        line-height: 1.2;
      }
      h2 {
        margin: 18px 0 8px;
        font-size: 20px;
      }
      .subtle {
        color: #5f6b7a;
        font-size: 16px;
        margin-top: 6px;
      }
      .waybill-no {
        text-align: right;
        font-size: 16px;
        line-height: 1.8;
      }
      .waybill-no strong {
        display: block;
        color: #111827;
        font-family: Menlo, Consolas, monospace;
        font-size: 24px;
      }
      .meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 18px;
        margin-bottom: 18px;
        font-size: 16px;
      }
      .meta span {
        color: #5f6b7a;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 17px;
      }
      th {
        text-align: left;
        background: #eef2f7;
        border: 1px solid #d8dee8;
        padding: 11px 10px;
      }
      td {
        border: 1px solid #d8dee8;
        padding: 14px 10px;
        vertical-align: top;
      }
      .index {
        width: 44px;
        text-align: center;
        color: #5f6b7a;
      }
      .item-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        min-width: 0;
      }
      .item-title {
        font-weight: 700;
        font-size: 22px;
        line-height: 1.35;
      }
      .item-inline-qty {
        color: #111827;
        font-family: Menlo, Consolas, monospace;
        font-weight: 700;
        font-size: 18px;
      }
      .item-meta {
        border: 1px solid #d8dee8;
        border-radius: 999px;
        color: #5f6b7a;
        font-size: 15px;
        padding: 2px 8px;
      }
      .item-detail {
        color: #374151;
        font-size: 16px;
        line-height: 1.5;
        margin-top: 8px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .item-detail span {
        color: #111827;
        font-weight: 700;
      }
      .quantity,
      .summary-quantity {
        width: 104px;
        text-align: center;
        white-space: nowrap;
        font-family: Menlo, Consolas, monospace;
        font-weight: 700;
        font-size: 26px;
      }
      .bundle-list {
        margin-top: 8px;
        padding-left: 12px;
        border-left: 3px solid #eef2f7;
      }
      .bundle-line {
        display: flex;
        gap: 8px;
        margin-top: 5px;
        color: #374151;
        flex-wrap: wrap;
      }
      .bundle-label {
        color: #5f6b7a;
        font-weight: 700;
        min-width: 70px;
      }
      .bundle-qty {
        margin-left: auto;
        color: #111827;
        font-family: Menlo, Consolas, monospace;
        font-weight: 700;
        white-space: nowrap;
      }
      .summary-table {
        margin-top: 8px;
      }
      @media print {
        body { background: #fff; }
        .page {
          width: auto;
          min-height: auto;
          margin: 0;
          padding: 10mm;
        }
      }
    </style>
  </head>
  <body>
    <section class="page">
      <div class="header">
        <div>
          <h1>订单拣货单</h1>
          <div class="subtle">爱买买卖家中心</div>
        </div>
        <div class="waybill-no">
          电子面单号
          <strong>${escapeHtml(waybillNo)}</strong>
        </div>
      </div>
      <div class="meta">
        <div><span>订单号：</span>${escapeHtml(order.id)}</div>
        <div><span>下单日期：</span>${escapeHtml(order.createdDate || '-')}</div>
        <div><span>买家：</span>${escapeHtml(order.buyerAlias || '-')}</div>
        <div><span>用户编号：</span>${escapeHtml(buyerNo)}</div>
        <div><span>地区：</span>${escapeHtml(region)}</div>
        <div><span>快递公司：</span>${escapeHtml(carrier)}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th class="index">#</th>
            <th>商品</th>
            <th class="quantity">数量</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <h2>拣货汇总</h2>
      <table class="summary-table">
        <thead>
          <tr>
            <th>商品</th>
            <th>规格</th>
            <th class="summary-quantity">数量</th>
          </tr>
        </thead>
        <tbody>${summaryRows}</tbody>
      </table>
    </section>
    <script>
      (function () {
        var printed = false;
        function printNow() {
          if (printed) return;
          printed = true;
          window.focus();
          setTimeout(function () { window.print(); }, 300);
        }
        setTimeout(printNow, 1800);
      })();
    </script>
  </body>
</html>`;
}

export function buildSellerWaybillPrintHtml(order: SellerWaybillOrder): string {
  return buildPickingSheetHtml(order);
}

export function printSellerWaybill(order: Order): PrintResult {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return 'blocked';

  printWindow.document.write(buildSellerWaybillPrintHtml(order));
  printWindow.document.close();
  return 'opened';
}
