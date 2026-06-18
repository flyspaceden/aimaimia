import type { Order } from '@/types';
import { toAbsoluteApiUrl } from './api-url.ts';

type PrintResult = 'opened' | 'blocked' | 'missing-url';

const PRIZE_TYPE_LABELS: Record<string, string> = {
  THRESHOLD_GIFT: '满额赠品',
  DISCOUNT_BUY: '特价购',
  LOTTERY_PRIZE: '抽奖奖品',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function itemLabel(item: Order['items'][number]): string {
  if (!item.isPrize) return '普通';
  return item.prizeType ? (PRIZE_TYPE_LABELS[item.prizeType] ?? '奖品') : '奖品';
}

export function buildSellerWaybillPrintHtml(order: Order, waybillUrl: string): string {
  const rows = order.items
    .map((item, index) => {
      return `
        <tr>
          <td class="index">${index + 1}</td>
          <td>
            <div class="item-title">${escapeHtml(item.title || '-')}</div>
            <div class="item-meta">${escapeHtml(itemLabel(item))}</div>
          </td>
          <td class="quantity">${item.quantity}</td>
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
      }
      .page {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        padding: 16mm;
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
        font-size: 24px;
        line-height: 1.2;
      }
      .subtle {
        color: #5f6b7a;
        font-size: 12px;
        margin-top: 6px;
      }
      .waybill-no {
        text-align: right;
        font-size: 13px;
        line-height: 1.8;
      }
      .waybill-no strong {
        display: block;
        color: #111827;
        font-family: Menlo, Consolas, monospace;
        font-size: 18px;
      }
      .meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 18px;
        margin-bottom: 16px;
        font-size: 13px;
      }
      .meta span {
        color: #5f6b7a;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      th {
        text-align: left;
        background: #eef2f7;
        border: 1px solid #d8dee8;
        padding: 8px;
      }
      td {
        border: 1px solid #d8dee8;
        padding: 9px 8px;
        vertical-align: top;
      }
      .index {
        width: 36px;
        text-align: center;
        color: #5f6b7a;
      }
      .item-title {
        font-weight: 700;
        line-height: 1.4;
      }
      .item-meta {
        color: #5f6b7a;
        font-size: 12px;
        margin-top: 3px;
      }
      .quantity {
        width: 92px;
        text-align: center;
        white-space: nowrap;
        font-family: Menlo, Consolas, monospace;
        font-weight: 700;
        font-size: 16px;
      }
      .waybill-page {
        page-break-before: always;
        padding: 0;
      }
      iframe {
        width: 100%;
        height: 282mm;
        border: 0;
        display: block;
      }
      @media print {
        body { background: #fff; }
        .page {
          width: auto;
          min-height: auto;
          margin: 0;
          padding: 10mm;
        }
        .waybill-page { padding: 0; }
        iframe { height: 100vh; }
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
        <tbody>${rows}</tbody>
      </table>
    </section>
    <section class="page waybill-page">
      <iframe id="waybill-frame" src="${escapeHtml(waybillUrl)}" title="waybill-${escapeHtml(order.id)}"></iframe>
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
        var frame = document.getElementById('waybill-frame');
        if (frame) {
          frame.addEventListener('load', function () {
            setTimeout(printNow, 700);
          });
        }
        setTimeout(printNow, 1800);
      })();
    </script>
  </body>
</html>`;
}

export function printSellerWaybill(order: Order): PrintResult {
  const waybillUrl = toAbsoluteApiUrl(order.shipment?.waybillPrintUrl);
  if (!waybillUrl) return 'missing-url';

  const printWindow = window.open('', '_blank');
  if (!printWindow) return 'blocked';

  printWindow.document.write(buildSellerWaybillPrintHtml(order, waybillUrl));
  printWindow.document.close();
  return 'opened';
}
