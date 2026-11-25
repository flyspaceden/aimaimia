/** 页面共用片段与购物车内存状态（刷新即清空，不写入任何存储）。 */
import { escapeHtml as esc, routeHash, yuan, fmt } from './model.js';
import { findBatch, findBase, findPond, traceCompleteness, sourceLabel, type Product, type Source } from './data.js';
import { fishArt, icon } from './svg.js';

export { esc };
export const href = (name: Parameters<typeof routeHash>[0]['name'], id = '') => routeHash({ name, id });

export function sourceBadge(source: Source): string {
  const ic = source === 'sensor' ? 'sensor' : source === 'lab' ? 'flask' : source === 'farmer' ? 'user' : 'spark';
  return `<span class="src src-${source}">${icon(ic, 'ic ic-xs')}${sourceLabel[source]}</span>`;
}
export function demoTag(text = '演示'): string { return `<span class="tag tag-demo">${esc(text)}</span>`; }

export function pageHead(kicker: string, title: string, lead = '', extra = ''): string {
  return `<header class="phead"><div><div class="kicker">${esc(kicker)}</div><h1 tabindex="-1" data-heading>${esc(title)}</h1>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}</div>${extra}</header>`;
}
export function empty(title: string, text: string, link: string, label: string): string {
  return `<section class="empty card">${icon('search', 'ic ic-lg')}<h1 tabindex="-1" data-heading>${esc(title)}</h1><p>${esc(text)}</p><a class="btn btn-primary" href="${link}">${esc(label)}</a></section>`;
}

export function productCard(p: Product): string {
  const batch = findBatch(p.batchCode)!;
  const base = findBase(batch.baseId)!;
  const pond = findPond(batch.pondId)!;
  return `<article class="pcard">
    <a class="pcard-art" href="${href('product', p.id)}" aria-label="查看${esc(p.name)}">${fishArt(p.art, p.name)}
      <span class="pcard-trace">${icon('shield', 'ic ic-xs')}溯源完整度 ${traceCompleteness(batch)}%</span></a>
    <div class="pcard-body">
      <div class="pcard-origin">${icon('pin', 'ic ic-xs')}${esc(base.region)} · ${esc(pond.name)}</div>
      <h3><a href="${href('product', p.id)}">${esc(p.name)}</a></h3>
      <p class="muted sm">${esc(p.spec)}</p>
      <div class="chips">${p.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      <div class="pcard-foot"><div><span class="price">¥${yuan(p.price)}</span><span class="muted sm"> / ${esc(p.unit)}</span></div>
        <button class="btn btn-icon" data-add="${p.id}" aria-label="把${esc(p.name)}加入购物车">${icon('plus')}</button></div>
      <div class="muted xs">已售 ${fmt(p.sold)} · 批次 <span class="mono">${p.batchCode}</span></div>
    </div></article>`;
}

// ---------- 购物车 ----------
export interface CartLine { productId: string; qty: number }
export const cart: CartLine[] = [];
export interface DemoOrder { id: string; lines: CartLine[]; total: number; shipping: number; created: string; address: string }
export const orders: DemoOrder[] = [];
export function addToCart(product: Product, qty = 1): number {
  const line = cart.find(l => l.productId === product.id);
  const next = Math.min(product.stock, (line?.qty ?? 0) + qty);
  if (line) line.qty = next; else cart.push({ productId: product.id, qty: Math.min(product.stock, qty) });
  return cartCount();
}
export function setQty(product: Product, qty: number): void {
  const line = cart.find(l => l.productId === product.id);
  if (!line) return;
  if (qty <= 0) cart.splice(cart.indexOf(line), 1); else line.qty = Math.min(product.stock, Math.floor(qty));
}
export const cartCount = () => cart.reduce((n, l) => n + l.qty, 0);
/** 演示运费规则：满 99 元包邮，否则 12 元。 */
export function shippingFor(subtotal: number): number { return subtotal >= 99 || subtotal === 0 ? 0 : 12; }
