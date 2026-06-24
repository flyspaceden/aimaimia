import type { Order, OrderItem, OrderItemBundleComponent } from '../types/index.ts';

type PrintResult = 'opened' | 'blocked';

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

function itemLabel(item: OrderItem): string {
  if (item.productType === 'BUNDLE') {
    return '组合商品';
  }
  if (!item.isPrize) {
    return '';
  }
  return item.prizeType ? (PRIZE_TYPE_LABELS[item.prizeType] ?? '奖品') : '奖品';
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

export function buildPickingSheetHtml(
  order: Pick<Order, 'id' | 'createdDate' | 'buyerAlias' | 'buyerNo' | 'regionText' | 'items'>,
): string {
  const itemRows = order.items
    .map((item, index) => {
      const label = itemLabel(item);
      return `
      <tr>
        <td class="index">${index + 1}</td>
        <td>
          <div class="item-title-row">
            <span class="item-title">${escapeHtml(item.title || '-')}</span>
            <span class="item-inline-qty">x${item.quantity}</span>
            ${label ? `<span class="item-type">${escapeHtml(label)}</span>` : ''}
          </div>
        </td>
        <td class="quantity">${item.quantity}</td>
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
            font-size: 16px;
          }
          h1 {
            margin: 0 0 12px;
            font-size: 34px;
            line-height: 1.2;
          }
          .meta {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px 18px;
            margin-bottom: 20px;
            font-size: 16px;
          }
          .section {
            margin-top: 24px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 17px;
          }
          th, td {
            border: 1px solid #d9d9d9;
            padding: 14px 12px;
            vertical-align: top;
            text-align: left;
          }
          th {
            background: #fafafa;
            font-weight: 600;
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
          .item-type {
            display: inline-block;
            padding: 2px 8px;
            border: 1px solid #d9d9d9;
            border-radius: 999px;
            font-size: 15px;
            color: #595959;
            white-space: nowrap;
          }
          .quantity {
            width: 104px;
            text-align: center;
            white-space: nowrap;
            font-family: Menlo, Consolas, monospace;
            font-weight: 700;
            font-size: 26px;
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
        </section>
      </body>
    </html>
  `;
}

export function buildSellerWaybillPrintHtml(
  order: Pick<Order, 'id' | 'createdDate' | 'buyerAlias' | 'buyerNo' | 'regionText' | 'items'>,
): string {
  return buildPickingSheetHtml(order);
}

export function printSellerWaybill(order: Order): PrintResult {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return 'blocked';

  printWindow.document.write(buildSellerWaybillPrintHtml(order));
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 300);
  return 'opened';
}
