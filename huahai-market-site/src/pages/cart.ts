import { findBatch, findBase, findProduct } from '../data.js';
import { yuan } from '../model.js';
import { fishArt, icon } from '../svg.js';
import { cart, orders, shippingFor, esc, href, pageHead, empty, type CartLine } from '../ui.js';

function totals(lines: CartLine[]) {
  const subtotal = lines.reduce((s, l) => s + (findProduct(l.productId)?.price ?? 0) * l.qty, 0);
  const shipping = shippingFor(subtotal);
  return { subtotal, shipping, total: subtotal + shipping };
}
function lineRow(l: CartLine, editable: boolean): string {
  const p = findProduct(l.productId)!, b = findBatch(p.batchCode)!;
  return `<div class="cline"><div class="cline-art">${fishArt(p.art, p.name)}</div>
    <div class="cline-info"><a href="${href('product', p.id)}"><b>${esc(p.name)}</b></a><div class="xs muted">${esc(p.spec)}</div>
      <a class="xs link" href="${href('trace', b.code)}">${icon('shield', 'ic ic-xs')}批次 <span class="mono">${b.code}</span> · ${esc(findBase(b.baseId)!.name)}</a></div>
    ${editable ? `<div class="stepper stepper-sm"><button class="btn btn-icon" data-cart-step="-1" data-pid="${p.id}" aria-label="减少${esc(p.name)}数量">${icon('minus')}</button><span class="mono" aria-live="polite">${l.qty}</span><button class="btn btn-icon" data-cart-step="1" data-pid="${p.id}" aria-label="增加${esc(p.name)}数量"${l.qty >= p.stock ? ' disabled' : ''}>${icon('plus')}</button></div>` : `<span class="mono">× ${l.qty}</span>`}
    <b class="mono cline-sum">¥${yuan(p.price * l.qty)}</b>
    ${editable ? `<button class="btn btn-icon" data-cart-remove="${p.id}" aria-label="删除${esc(p.name)}">${icon('trash')}</button>` : ''}</div>`;
}
function summary(lines: CartLine[], action: string): string {
  const t = totals(lines);
  return `<aside class="card glass summary"><h2 class="h3">结算</h2>
    <div class="sum-row"><span>商品金额</span><span class="mono">¥${yuan(t.subtotal)}</span></div>
    <div class="sum-row"><span>运费</span><span class="mono">${t.shipping ? '¥' + yuan(t.shipping) : '包邮'}</span></div>
    ${t.shipping ? `<p class="xs muted">再买 ¥${yuan(99 - t.subtotal)} 包邮（演示规则）</p>` : ''}
    <div class="sum-row sum-total"><span>合计</span><span class="price price-lg">¥${yuan(t.total)}</span></div>${action}</aside>`;
}

export function cartPage(): string {
  if (!cart.length) return empty('购物车是空的', '去挑几件看得见来处的好货吧。演示购物车只保存在当前页面，刷新后清空。', href('shop'), '去买好货');
  return `${pageHead('购物车', '每件商品都绑定了养殖批次', '演示购物车只保存在当前页面，刷新后清空。')}
  <div class="checkout"><div class="card">${cart.map(l => lineRow(l, true)).join('')}</div>
  ${summary(cart, `<a class="btn btn-primary btn-lg btn-block" href="${href('checkout')}">去结算</a>`)}</div>`;
}

export function checkoutPage(): string {
  if (!cart.length) return empty('没有待结算的商品', '购物车为空。', href('shop'), '去买好货');
  return `${pageHead('确认订单', '核对商品与收货信息', '演示流程：不会扣款，也不会发货。')}
  <div class="checkout"><div class="stack">
    <div class="card"><div class="row"><b>${icon('pin', 'ic ic-sm')}收货地址</b><span class="tag tag-demo">示例地址</span></div><p class="sm">张先生（演示） 138****0000<br>广东省广州市天河区示例路 88 号</p></div>
    <div class="card">${cart.map(l => lineRow(l, false)).join('')}</div>
    <div class="card"><b>${icon('truck', 'ic ic-sm')}配送</b><p class="sm muted">冷链配送，0–4 ℃ 全程温控；起捕后 48 小时内送达（演示）。</p></div>
    <div class="card"><b>支付方式</b><div class="pay-opts"><label class="pay"><input type="radio" name="pay" checked> 支付宝（演示）</label><label class="pay"><input type="radio" name="pay"> 微信支付（演示）</label></div></div>
  </div>${summary(cart, `<button class="btn btn-primary btn-lg btn-block" data-action="pay">模拟支付</button><p class="xs muted">点击后直接生成演示订单，不会跳转任何支付页面。</p>`)}</div>`;
}

export function orderPage(id: string): string {
  const o = orders.find(x => x.id === id);
  if (!o) return empty('没有找到这个订单', '演示订单只保存在当前页面，刷新后会清空。', href('shop'), '继续逛逛');
  const steps: [string, string, boolean][] = [['支付成功', o.created, true], ['产地备货', '按批次从塘口起捕', true], ['冷链发货', '待发货', false], ['签收', '扫码查看批次档案', false]];
  return `<section class="card glass success">${icon('check', 'ic ic-xl')}<h1 tabindex="-1" data-heading>支付成功（演示）</h1><p class="muted">订单号 <span class="mono">${o.id}</span> · 实付 <b class="mono">¥${yuan(o.total)}</b></p></section>
  <div class="steps section">${steps.map(([t, d, done]) => `<div class="step${done ? ' done' : ''}"><span class="step-dot">${done ? icon('check', 'ic ic-xs') : ''}</span><b>${t}</b><span class="xs muted">${esc(d)}</span></div>`).join('')}</div>
  <div class="card section"><h2 class="h3">订单商品</h2>${o.lines.map(l => lineRow(l, false)).join('')}
    <p class="sm muted">收到货后扫描包装上的批次码，即可看到这批货的养殖全过程。</p></div>
  <div class="row gap"><a class="btn" href="${href('shop')}">继续逛逛</a><a class="btn btn-primary" href="${href('trace', findProduct(o.lines[0]!.productId)!.batchCode)}">查看批次档案</a></div>`;
}
export { totals };
