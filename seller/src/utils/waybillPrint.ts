import type { Order, OrderItem, OrderItemBundleComponent } from '../types/index.ts';

type PickingComponentSummary = {
  skuId?: string;
  disambiguator?: string;
  title: string;
  skuTitle: string;
  quantity: number;
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

function resolveMerchantSkuCode(
  source?: unknown,
): string | undefined {
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

export function buildPickingSheetHtml(
  order: Pick<Order, 'id' | 'createdDate' | 'buyerAlias' | 'buyerNo' | 'regionText' | 'items'>,
): string {
  const itemRows = order.items
    .map((item) => `
      <tr>
        <td>
          <div class="item-title-row">
            <span class="item-title">${escapeHtml(item.title || '-')}</span>
            ${item.productType === 'BUNDLE' ? '<span class="item-type">组合商品</span>' : ''}
          </div>
          ${renderBundleDetails(item)}
        </td>
        <td>${escapeHtml(item.productType === 'BUNDLE' ? '组合' : item.isPrize ? '奖品' : '普通')}</td>
        <td class="align-right">x${item.quantity}</td>
      </tr>
    `)
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
        <td class="align-right">x${entry.quantity}</td>
      </tr>
    `;
    })
    .join('');

  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>拣货单 - ${escapeHtml(order.id)}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 24px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #1f1f1f;
            background: #fff;
          }
          h1, h2 { margin: 0 0 12px; }
          .meta {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px 16px;
            margin-bottom: 20px;
            font-size: 13px;
          }
          .section {
            margin-top: 24px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            border: 1px solid #d9d9d9;
            padding: 10px 12px;
            vertical-align: top;
            text-align: left;
            font-size: 13px;
          }
          th {
            background: #fafafa;
            font-weight: 600;
          }
          .align-right {
            text-align: right;
            white-space: nowrap;
          }
          .item-title-row {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
          }
          .item-title {
            font-weight: 600;
          }
          .item-type {
            display: inline-block;
            padding: 1px 6px;
            border: 1px solid #d9d9d9;
            border-radius: 999px;
            font-size: 11px;
            color: #595959;
            white-space: nowrap;
          }
          .bundle-list {
            margin-top: 8px;
            padding-left: 12px;
            border-left: 2px solid #f0f0f0;
          }
          .bundle-line {
            display: flex;
            gap: 8px;
            margin-top: 4px;
            color: #595959;
            flex-wrap: wrap;
          }
          .bundle-label {
            color: #8c8c8c;
            min-width: 52px;
          }
          .bundle-qty {
            margin-left: auto;
            color: #262626;
            white-space: nowrap;
          }
          @media print {
            body {
              padding: 12mm;
            }
          }
        </style>
      </head>
      <body>
        <h1>订单拣货单</h1>
        <div class="meta">
          <div><strong>订单号：</strong>${escapeHtml(order.id)}</div>
          <div><strong>下单日期：</strong>${escapeHtml(order.createdDate)}</div>
          <div><strong>买家：</strong>${escapeHtml(order.buyerAlias)}</div>
          <div><strong>买家编号：</strong>${escapeHtml(order.buyerNo || '-')}</div>
          <div><strong>配送区域：</strong>${escapeHtml(order.regionText || '-')}</div>
        </div>

        <section class="section">
          <h2>原始订单</h2>
          <table>
            <thead>
              <tr>
                <th>商品</th>
                <th>类型</th>
                <th>数量</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
        </section>

        <section class="section">
          <h2>拣货汇总</h2>
          <table>
            <thead>
              <tr>
                <th>商品</th>
                <th>规格</th>
                <th>数量</th>
              </tr>
            </thead>
            <tbody>${summaryRows}</tbody>
          </table>
        </section>
      </body>
    </html>
  `;
}
