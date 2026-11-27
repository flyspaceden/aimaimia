import { parseRoute, routeHash, routeTitles, isSort, type Route } from './model.js';
import { demands, findBatch, findProduct, liveReading, readingText, platformStats, pondsOfBase, findBase, type Metric } from './data.js';
import { Assistant } from './assistant.js';
import { cart, orders, addToCart, setQty, cartCount, esc } from './ui.js';
import { homePage, demoHeroPanel } from './pages/home.js';
import { shopPage, productPage } from './pages/shop.js';
import { tracePage, traceSearchPage, waterBlock } from './pages/trace.js';
import { basesPage, basesGrid, basePage } from './pages/bases.js';
import { sourcePage, workPage } from './pages/source.js';
import { cartPage, checkoutPage, orderPage, totals } from './pages/cart.js';

function get<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`页面缺少必要元素：${selector}`);
  return el;
}
const app = get<HTMLElement>('#app');
const view = get<HTMLElement>('#view');
const dlg = get<HTMLDialogElement>('#dlg');
const dlgBody = get<HTMLElement>('#dlg-body');
const toast = get<HTMLElement>('#toast');
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => reducedQuery.matches;
const assistant = new Assistant(get('#ai-panel'), get('#ai-log'), get('#ai-chips'), get('#ai-title'), reduced);

let route: Route = parseRoute(location.hash);
let tick = 0;
let selectedPond = '';
let samples = platformStats.samplesToday;
let dlgReturn: HTMLElement | null = null;
/** 前进导航（点链接、程序跳转）回到顶部；浏览器后退/前进恢复该页上次的滚动位置。 */
let forwardNav = false;
const scrollMemo = new Map<string, number>();
window.addEventListener('scroll', () => scrollMemo.set(location.hash, window.scrollY), { passive: true });

function go(next: Parameters<typeof routeHash>[0]): void { forwardNav = true; location.hash = routeHash(next); }

function render(focus: boolean): void {
  const r = route;
  let html: string;
  switch (r.name) {
    case 'shop': html = shopPage(r); break;
    case 'product': html = productPage(r.id); break;
    case 'trace': html = r.id ? tracePage(r.id) : traceSearchPage(); break;
    case 'bases': html = basesPage(basesGrid({ status: 'loading' }, Date.now())); break;
    case 'base': {
      const list = pondsOfBase(r.id);
      if (!list.some(p => p.id === selectedPond)) selectedPond = list[0]?.id ?? '';
      html = basePage(r.id, selectedPond, tick); break;
    }
    case 'source': html = sourcePage(); break;
    case 'work': html = workPage(r); break;
    case 'cart': html = cartPage(); break;
    case 'checkout': html = checkoutPage(); break;
    case 'order': html = orderPage(r.id); break;
    default: html = homePage(demoHeroPanel());
  }
  view.innerHTML = html;
  const product = r.name === 'product' ? findProduct(r.id) : undefined;
  const batch = r.name === 'trace' ? findBatch(r.id) : product ? findBatch(product.batchCode) : undefined;
  const detail = product?.name ?? batch?.code ?? (r.name === 'base' ? findBase(r.id)?.name : undefined);
  document.title = `${detail ? detail + ' · ' : ''}${routeTitles[r.name]} | 华海农科 AI 农贸市场`;
  const section = r.name === 'product' ? 'shop' : r.name === 'base' ? 'bases' : r.name === 'checkout' || r.name === 'order' ? 'cart' : r.name;
  app.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach(a => a.dataset.nav === section ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  assistant.setContext(batch?.code);
  setMenu(false);
  updateCartBadge();
  if (focus) {
    const restore = forwardNav ? 0 : scrollMemo.get(location.hash) ?? 0;
    forwardNav = false;
    (view.querySelector<HTMLElement>('[data-heading]') ?? view).focus({ preventScroll: true });
    window.scrollTo({ top: restore, behavior: 'instant' as ScrollBehavior });
  }
}
function onRoute(): void {
  if (dlg.open) { dlgReturn = null; dlg.close(); }
  route = parseRoute(location.hash);
  render(true);
}

function updateCartBadge(): void {
  const badge = get<HTMLElement>('#cart-count');
  const n = cartCount();
  badge.textContent = String(n);
  badge.hidden = n === 0;
}
let toastTimer = 0;
function notify(text: string): void {
  toast.textContent = text; toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2200);
}
function setMenu(open: boolean): void {
  get<HTMLElement>('#nav').classList.toggle('nav-open', open);
  const btn = get<HTMLElement>('#menu-btn');
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', open ? '收起导航' : '展开导航');
}
function closeAssistant(): void { assistant.close(); get<HTMLElement>('.top-actions [data-action="assistant"]').focus(); }

function addAndNotify(p: NonNullable<ReturnType<typeof findProduct>>, qty: number): void {
  const before = cartCount();
  addToCart(p, qty);
  updateCartBadge();
  const added = cartCount() - before;
  notify(added ? `已加入购物车：${p.name} × ${added}` : `${p.name} 已达库存上限（${p.stock}）`);
}

// ---------- 对话框（询价、报价、发布表单预览；关闭即清除） ----------
function showDialog(title: string, html: string): void {
  if (!dlg.open) dlgReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  get('#dlg-title').textContent = title;
  dlgBody.innerHTML = html;
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  get<HTMLButtonElement>('[data-action="dlg-close"]').focus();
}
dlg.addEventListener('close', () => {
  dlgBody.replaceChildren();
  if (dlgReturn?.isConnected) dlgReturn.focus();
});
const fields = (rows: [string, string][]) => `<dl class="dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
const panels: Record<string, { title: string; rows: [string, string][] }> = {
  review: { title: '鲜活罗非鱼 · 报价核对', rows: [['供应方', '茂名电白生态基地（演示）'], ['报价', '¥11.20 / kg，含活鱼车运输至广州'], ['供货', '每周 2,000 kg，每周三到店'], ['批次', 'HH-MM-2604-01B，预计 2026-12-12 起捕'], ['资料', '随货附溯源二维码与检测报告']] },
  orderdetail: { title: '交付前确认清单', rows: [['产品与批次', '金鲳鱼 HH-YJ-2605-02，500–600 g/尾，检测报告 YXJC-2610-0428'], ['运输', '冷链车 0–4 ℃，温度记录随单归档'], ['验收', '到货称重、品质抽检、异议 24 小时内提出'], ['凭证', '出库单、运输温度记录、签收单进入批次档案']] },
};
function today(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function showForm(kind: 'buy' | 'sell'): void {
  const buy = kind === 'buy';
  showDialog(buy ? '发布采购需求' : '发布货源', `<p class="sm muted">填写后可预览内容。演示站不发送、不保存，关闭窗口即清除；请勿填写真实个人信息。</p>
  <form class="form" id="local-form">
    <label>${buy ? '采购品种' : '供应品种'}<input required name="subject" maxlength="80" placeholder="例如：金鲳鱼"></label>
    <label>${buy ? '采购类型' : '供应方式'}<select name="kind">${(buy ? ['单次采购', '周期采购', '产地预定'] : ['现货供应', '在塘预售']).map(v => `<option>${v}</option>`).join('')}</select></label>
    <label>数量（kg）<input name="quantity" type="number" min="1" max="100000000" step="1" required placeholder="例如：2000"></label>
    <label>期望交付日期<input name="date" type="date" min="${today()}" required></label>
    <label class="full">规格与要求<textarea name="req" required maxlength="800" placeholder="规格、溯源与检测资料要求、收发货地点、运输方式"></textarea></label>
    <div class="full"><button type="submit" class="btn btn-primary">预览</button></div>
    <div class="full" id="form-result" role="status" aria-live="polite"></div>
  </form>`);
  const form = get<HTMLFormElement>('#local-form');
  form.addEventListener('input', e => { const f = e.target; if (f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement) f.setCustomValidity(''); get('#form-result').replaceChildren(); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=number]):not([type=date]),textarea').forEach(f => f.setCustomValidity(f.value.trim() ? '' : '请填写有效内容，不能只输入空格。'));
    if (!form.reportValidity()) return;
    const out = get<HTMLElement>('#form-result');
    out.className = 'full notice notice-ok';
    const dl = document.createElement('dl'); dl.className = 'dl';
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea').forEach(f => {
      const dt = document.createElement('dt'); dt.textContent = f.closest('label')?.firstChild?.textContent?.trim() ?? '';
      const dd = document.createElement('dd'); dd.textContent = f.value.trim(); // 用户输入只写入文本节点
      dl.append(dt, dd);
    });
    const note = document.createElement('p'); note.className = 'xs'; note.textContent = '未发送、未保存。正式版将推送给匹配的基地或采购方。';
    out.replaceChildren(dl, note);
  });
}

// ---------- 交互 ----------
app.addEventListener('click', e => {
  if (!(e.target instanceof Element)) return;
  const el = e.target.closest<HTMLElement>('button,a');
  if (!el) return;
  const d = el.dataset;
  const modified = e instanceof MouseEvent && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey);
  if (el instanceof HTMLAnchorElement && el.getAttribute('href')?.startsWith('#') && !d.jump && !modified) { forwardNav = true; setMenu(false); }
  if (d.jump) { if (modified) return; e.preventDefault(); const t = document.getElementById(d.jump); t?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); return; }
  if (el.classList.contains('skip')) { e.preventDefault(); (view.querySelector<HTMLElement>('[data-heading]') ?? view).focus(); return; }
  if (d.add) { const p = findProduct(d.add); if (p) addAndNotify(p, 1); return; }
  if (d.step) { const input = view.querySelector<HTMLInputElement>('#pd-qty'); if (input) input.value = String(Math.max(1, Math.min(Number(input.max), (Number(input.value) || 1) + Number(d.step)))); return; }
  if (d.addQty || d.buy) {
    const p = findProduct(d.addQty || d.buy);
    const qty = Math.max(1, Math.min(p?.stock ?? 1, Math.floor(Number(view.querySelector<HTMLInputElement>('#pd-qty')?.value) || 1)));
    if (p) { if (d.buy) { addToCart(p, qty); updateCartBadge(); go({ name: 'checkout' }); } else addAndNotify(p, qty); }
    return;
  }
  if (d.cartStep || d.cartRemove) {
    const p = findProduct(d.pid || d.cartRemove);
    const line = cart.find(l => l.productId === p?.id);
    if (p && line) setQty(p, d.cartRemove ? 0 : line.qty + Number(d.cartStep));
    const id = d.pid; render(false);
    const same = view.querySelector<HTMLButtonElement>(`[data-cart-step="${d.cartStep}"][data-pid="${id}"]`);
    const target = same && !same.disabled ? same : view.querySelector<HTMLElement>(`[data-pid="${id}"]:not([disabled])`) ?? view.querySelector<HTMLElement>('[data-heading]');
    target?.focus();
    return;
  }
  if (d.metric && route.name === 'trace') {
    const b = findBatch(route.id); if (!b) return;
    get('#water-chart').innerHTML = waterBlock(b, d.metric as Metric);
    view.querySelectorAll('[data-metric]').forEach(x => x.setAttribute('aria-pressed', String(x === el)));
    return;
  }
  if (d.pond && route.name === 'base') { selectedPond = d.pond; render(false); view.querySelector<HTMLElement>(`[data-pond="${d.pond}"]`)?.focus(); return; }
  if (d.ask !== undefined) { assistant.open(d.batch, Number(d.ask)); return; }
  if (d.aiQ !== undefined) { assistant.ask(Number(d.aiQ)); return; }
  if (d.form === 'buy' || d.form === 'sell') { showForm(d.form); return; }
  if (d.inquiry) {
    const p = findProduct(d.inquiry); if (!p) return;
    showDialog(`${p.name} · 询价`, `<div class="notice">演示流程：正式询价需登录并完成企业认证。</div>${fields([['批发参考价', `¥${p.b2b.wholesale.toFixed(2)} / kg（演示）`], ['在塘存量', `${p.b2b.inPondKg.toLocaleString('zh-CN')} kg`], ['预计起捕', p.b2b.nextHarvest], ['起订量', p.b2b.moq], ['批次资料', `${p.batchCode}，含水质、饲料与检测报告`], ['下一步', '填写采购量、交付日期与收货地，基地 24 小时内报价']])}`);
    return;
  }
  if (d.quote) {
    const q = demands.find(x => x.id === d.quote); if (!q) return;
    showDialog(`${q.name} · 报价`, `<div class="notice">演示需求：正式报价需完成基地认证，本次不发送。</div>${fields([['采购方', q.buyer], ['规格', q.spec], ['采购量', q.quantity], ['收货地', q.destination], ['交付', q.delivery], ['要求', q.requirement]])}`);
    return;
  }
  if (d.panel) { const p = panels[d.panel]; if (p) showDialog(p.title, fields(p.rows)); return; }
  switch (d.action) {
    case 'assistant': assistant.open(d.batch); return;
    case 'ai-close': closeAssistant(); return;
    case 'dlg-close': dlg.close(); return;
    case 'pay': {
      if (!cart.length) return;
      const t = totals(cart);
      const id = `DEMO${Date.now().toString().slice(-8)}`;
      orders.push({ id, lines: cart.map(l => ({ ...l })), total: t.total, shipping: t.shipping, created: new Date().toLocaleString('zh-CN', { hour12: false }), address: '示例地址' });
      cart.splice(0);
      go({ name: 'order', id });
      return;
    }
  }
  if (el.id === 'menu-btn') setMenu(el.getAttribute('aria-expanded') !== 'true');
});

app.addEventListener('submit', e => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === 'hero-trace' || form.id === 'trace-form') {
    e.preventDefault();
    const code = (form.querySelector('input')?.value ?? '').trim().toUpperCase().slice(0, 40);
    if (code) go({ name: 'trace', id: code });
  } else if (form.id === 'shop-search') {
    e.preventDefault();
    go({ ...route, name: 'shop', query: (form.querySelector('input')?.value ?? '').trim().slice(0, 100) });
  } else if (form.id === 'ai-form') {
    e.preventDefault();
    const input = form.querySelector('input')!;
    assistant.askText(input.value); input.value = '';
  }
});
app.addEventListener('change', e => {
  const t = e.target;
  if (t instanceof HTMLSelectElement && t.id === 'shop-sort' && isSort(t.value)) {
    // 只替换地址并原地重绘，保留下拉框焦点，键盘用户可连续用方向键切换排序
    route = { ...route, sort: t.value };
    history.replaceState(null, '', routeHash(route));
    render(false);
    view.querySelector<HTMLSelectElement>('#shop-sort')?.focus();
  }
  if (t instanceof HTMLInputElement && t.id === 'pd-qty') t.value = String(Math.max(1, Math.min(Number(t.max), Math.floor(Number(t.value) || 1))));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !get<HTMLElement>('#ai-panel').hidden && !dlg.open) closeAssistant(); });

// ---------- 实时数据（演示）：每 3 秒更新读数；减少动态效果时不跳动 ----------
window.setInterval(() => {
  if (reduced() || document.hidden) return;
  tick++;
  if (route.name === 'base') {
    view.querySelectorAll<HTMLElement>('[data-live]').forEach(el => {
      const [pond = '', key = 'do'] = (el.dataset.live ?? '').split(':');
      const value = readingText(key as Metric, liveReading(pond, tick)[key as Metric]);
      if (el.textContent !== value) { el.textContent = value; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    });
  }
  if (route.name === 'home') {
    samples += 37 + (tick % 5) * 9;
    const el = view.querySelector<HTMLElement>('[data-counter="samples"]');
    if (el) el.textContent = samples.toLocaleString('zh-CN');
  }
}, 3000);

window.addEventListener('hashchange', onRoute);
render(false);
