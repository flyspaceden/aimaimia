import { products, demands, filterProducts, escapeHtml as esc, parseRoute, routeHash, pageTitles, isPage, isCategory, isStatus } from './model.js';
import type { Page, Product } from './model.js';

function get<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`页面缺少必要元素：${selector}`);
  return element;
}
const root = get<HTMLElement>('#hh-market');
const dialog = get<HTMLDialogElement>('#hh-dialog');
const body = get<HTMLElement>('#hh-dialog-body');
let returnFocus: HTMLElement | null = null;
let state = parseRoute(location.hash);
const queryInput = get<HTMLInputElement>('#hh-query');
queryInput.maxLength = 100;

function updateUrl(push = false): void {
  const hash = routeHash(state);
  if (location.hash !== hash) history[push ? 'pushState' : 'replaceState'](null, '', hash);
}
function renderPage(focus = false): void {
  if (dialog.open) dialog.close();
  root.querySelectorAll<HTMLElement>('[data-view]').forEach(el => { el.hidden = el.dataset.view !== state.page; });
  root.querySelectorAll<HTMLAnchorElement>('[data-page]').forEach(el => {
    if (el.dataset.page === state.page) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  document.title = `${pageTitles[state.page]} | 华海农科 AI 农贸市场`;
  if (focus) get<HTMLElement>(`[data-view="${state.page}"] [data-view-heading]`).focus();
}
function navigate(page: Page): void {
  state.page = page;
  updateUrl(true);
  renderPage(true);
}
function renderProducts(): void {
  const found = filterProducts(state.category, state.query);
  get('#hh-count').textContent = `${found.length} 条演示货源`;
  get('#hh-products').innerHTML = found.length ? found.map(item => `
    <article class="hh-product">
      <div><strong>${esc(item.name)}</strong><div class="hh-mini">${esc(item.place)} ｜ ${esc(item.spec)}</div>
        <div class="hh-evidence">${item.evidence.map(text => `<span>${esc(text)}</span>`).join('')}</div></div>
      <div><span class="hh-price">¥${item.price}</span><div class="hh-mini">/ 公斤 · 演示价</div></div>
      <div>${esc(item.qty)}<div class="hh-mini">以实际确认为准</div></div>
      <div>${esc(item.timing)}<div class="hh-mini">${esc(item.mode)}</div></div>
      <button class="hh-btn" data-item="${item.id}" aria-label="查看${esc(item.name)}货源">查看货源</button>
    </article>`).join('') : '<div class="hh-empty"><p>暂无符合条件的演示货源。</p><p>可切换品类、清除搜索，或发布采购需求。</p><button class="hh-link" data-action="reset">清除筛选</button></div>';
  root.querySelectorAll<HTMLElement>('[data-category]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.category === state.category)));
}
function fields(rows: readonly (readonly [string, string])[]): string {
  return `<dl>${rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`;
}
function show(title: string, html: string): void {
  if (!dialog.open) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  get('#hh-dialog-title').textContent = title;
  body.innerHTML = html;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  get<HTMLButtonElement>('[data-action="close"]').focus();
}
dialog.addEventListener('close', () => {
  body.replaceChildren(); // 关闭即清除表单，不持久化主体资料。
  if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus();
});
function showProduct(item: Product): void {
  show(`${item.name} · 货源详情`, '<div class="hh-banner">演示货源，不可真实下单。资料内容及有效性以正式接入后的审核结果为准。</div>' + fields([
    ['产地与规格', `${item.place} / ${item.spec}`], ['参考报价', `¥${item.price} / 公斤（演示）`],
    ['可供数量', `${item.qty}（演示）`], ['供货安排', `${item.timing}，${item.mode}`],
    ['确认事项', '起订量、运输方式、运费承担、实收数量与验收条件。'],
  ]) + `<div class="hh-actions hh-offer"><button class="hh-btn hh-primary" data-action="inquiry" data-product="${item.id}">询价流程预览</button><button class="hh-btn" data-action="trace">查看溯源页面示例</button></div>`);
}
function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function showForm(kind: 'buy' | 'sell' | 'join'): void {
  const buy = kind === 'buy';
  const trading = kind !== 'join';
  const options = buy ? ['单次采购', '周期采购', '产地预定'] : trading ? ['现货供应', '预定供应'] : ['生产基地 / 合作社', '采购企业', '检测 / 冷链服务机构'];
  show(buy ? '发布采购需求' : trading ? '发布货源' : '申请入驻', `
    <p class="hh-sectionlead">填写后可预览内容。本演示不发送申请，关闭窗口即清除；请勿填写真实个人信息。</p>
    <form class="hh-form" id="hh-local-form">
      <label>${buy ? '采购品种' : trading ? '供应品种' : '主体名称'}<input required name="subject" maxlength="80" placeholder="${trading ? '例如：罗非鱼' : '填写示例主体名称'}"></label>
      <label>${buy ? '采购类型' : trading ? '供应方式' : '入驻角色'}<select name="kind">${options.map(value => `<option>${value}</option>`).join('')}</select></label>
      ${trading ? `<label>数量（公斤）<input name="quantity" type="number" min="0.01" max="100000000" step="0.01" required placeholder="例如：2000"></label>
        <label>期望交付日期<input name="date" type="date" min="${today()}" required></label>` : '<label class="hh-full">所在地区<input name="region" required maxlength="80" placeholder="省 / 市 / 区县"></label>'}
      <label class="hh-full">${trading ? '规格与交付要求' : '主营业务'}<textarea name="requirements" required maxlength="800" placeholder="${trading ? '说明规格、品质资料、收发货地点和运输要求' : '说明经营品类及希望开展的合作'}"></textarea></label>
      <div class="hh-full"><button type="submit" class="hh-btn hh-primary">预览填写结果</button></div>
      <div class="hh-full" id="hh-form-result" role="status" aria-live="polite"></div>
    </form>`);
  const form = get<HTMLFormElement>('#hh-local-form');
  form.addEventListener('input', event => {
    const field = event.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.setCustomValidity('');
    get('#hh-form-result').replaceChildren();
  });
  form.addEventListener('change', () => get('#hh-form-result').replaceChildren());
  form.addEventListener('submit', event => {
    event.preventDefault();
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=number]):not([type=date]),textarea').forEach(field => field.setCustomValidity(field.value.trim() ? '' : '请填写有效内容，不能只输入空格。'));
    if (!form.reportValidity()) return;
    const result = get<HTMLElement>('#hh-form-result');
    result.className = 'hh-full hh-success';
    const heading = document.createElement('h3');
    heading.textContent = '填写预览';
    const list = document.createElement('dl');
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea').forEach(field => {
      const term = document.createElement('dt');
      term.textContent = field.closest('label')?.firstChild?.textContent?.trim() || '';
      const value = document.createElement('dd');
      value.textContent = field.value.trim(); // 用户输入始终写入文本节点。
      list.append(term, value);
    });
    const note = document.createElement('p');
    note.textContent = '未发送申请或创建订单。以上内容仅保留在当前窗口。';
    result.replaceChildren(heading, list, note);
    result.scrollIntoView({ block: 'nearest' });
  });
}
function renderOrders(): void {
  root.querySelectorAll<HTMLElement>('[data-status]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.status === state.status)));
  get('#hh-orders').innerHTML = state.status === 'complete'
    ? '<div class="hh-empty">暂无已完成订单。完成到货核验后，订单将在这里归档。</div>'
    : state.status === 'quoted'
      ? '<div class="hh-row"><div><span class="hh-tag">报价演示</span><h3>鲜活罗非鱼 · 采购需求</h3><p class="hh-sectionlead">有一份示例报价等待查看。确认前需核对规格、供货量、运费及交付条件。</p></div><button class="hh-btn" data-action="review">查看报价</button></div>'
      : `<div class="hh-row"><div><span class="hh-mini">订单示例 HH-ORDER-001</span><h3>鲜活罗非鱼 · 2,000 公斤</h3></div><span class="hh-tag">待发货</span></div>
        <div class="hh-order"><div class="hh-specs"><div><b>示例养殖基地</b><span>供应方</span></div><div><b>广东广州</b><span>交付地点</span></div><div><b>双方约定日期</b><span>交付时间</span></div></div>
        <div class="hh-timeline"><div class="hh-step hh-done"><h3>供需确认</h3><p>规格、数量、报价</p></div><div class="hh-step hh-done"><h3>约定交付</h3><p>合同与验收条件</p></div><div class="hh-step"><h3>发货与运输</h3><p>等待供方上传凭证</p></div><div class="hh-step"><h3>到货核验</h3><p>数量、品质及异议</p></div></div></div>
        <div class="hh-row hh-offer"><span class="hh-mini">下一步：供应方确认出库批次和运输安排。</span><button class="hh-btn" data-action="orderdetail">查看履约清单</button></div>`;
}
const panels: Record<string, { title: string; note?: string; rows: readonly (readonly [string, string])[] }> = {
  match: { title: '为什么推荐这类货源', note: '匹配解释示例，不代表已运行的 AI 模型结果。', rows: [['品种匹配', '鲜活罗非鱼，核对 500–750 克 / 尾的规格要求。'], ['数量匹配', '检查单周可供量是否覆盖 2,000 公斤采购量。'], ['交付匹配', '核对广州收货地址、鲜活运输能力与每周三到货窗口。'], ['品质依据', '查看对应批次检测资料及有效期；缺失资料显式提示。'], ['需要确认', '最终报价、连续供货周期、运费和验收标准由双方确认。']] },
  ecology: { title: '围绕交易接入专业服务', rows: [['生产基地', '维护主体资料、生产档案和可售产能。'], ['检测机构', '提供可核验的批次报告与检测服务。'], ['冷链服务商', '支持运输询价、运力对接及交付记录。'], ['金融保险', '后续由合作机构提供相应服务；具体准入、产品和申请流程待确认。']] },
  orderdetail: { title: '交付前需要确认什么', rows: [['产品与批次', '品种、等级、出库批次、检测资料及实发数量。'], ['运输与到货', '运输方式、装卸安排、预计到货时间及联系人。'], ['验收与异议', '称重方式、品质复检、损耗认定、异议时限和证据。'], ['凭证归档', '出库单、运输凭证、签收记录和处理结果。']] },
  review: { title: '鲜活罗非鱼 · 报价核对', note: '示例报价，不可确认或支付。', rows: [['需求规格', '500–750 克 / 尾；2,000 公斤 / 周'], ['供货地点', '广东茂名（示例）'], ['货品报价', '¥12.80 / 公斤（演示），运费和包装费用待双方确认。'], ['交付要求', '广州收货，每周三配送；需核对连续供货能力、报价有效期及验收条件。'], ['品质资料', '应提供对应批次检测资料，不以商品名称替代批次核验。']] },
};
root.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('.hh-skip')) {
    event.preventDefault();
    get<HTMLElement>(`[data-view="${state.page}"] [data-view-heading]`).focus();
    return;
  }
  const control = event.target.closest<HTMLElement>('button,a[data-page]');
  if (!control) return;
  const { page, category, status, item, action } = control.dataset;
  if (page && isPage(page)) {
    if (event instanceof MouseEvent && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
    event.preventDefault(); navigate(page); return;
  }
  if (category && isCategory(category)) { state.category = category; renderProducts(); updateUrl(); return; }
  if (status && isStatus(status)) { state.status = status; renderOrders(); updateUrl(); return; }
  if (item) { const product = products.find(value => value.id === item); if (product) showProduct(product); return; }
  if (action === 'close') { dialog.close(); return; }
  if (action === 'buy' || action === 'sell' || action === 'join') { showForm(action); return; }
  if (action === 'trace') { navigate('trace'); return; }
  if (action === 'reset') { state.category = 'all'; state.query = ''; queryInput.value = ''; renderProducts(); updateUrl(); queryInput.focus(); return; }
  if (action === 'quote') {
    const demand = demands[Number(control.dataset.demand)];
    if (!demand) return;
    show(demand.name + ' · 报价流程', '<div class="hh-banner">演示需求。正式报价前需要主体认证，本次不发送报价。</div>' + fields([['规格', demand.spec], ['采购数量', demand.quantity], ['收货地点', demand.destination], ['交付安排', demand.delivery], ['报价要求', demand.requirement]])); return;
  }
  if (action === 'inquiry') {
    const product = products.find(value => value.id === control.dataset.product);
    if (!product) return;
    show(product.name + ' · 询价流程', '<div class="hh-banner">演示流程。正式询价需要先登录并完成主体认证。</div>' + fields([['货源', `${product.place} / ${product.spec}`], ['需求确认', '填写采购数量、到货时间与收货地点。'], ['报价拆分', '核对货款、运输费用、包装费用及报价有效期。'], ['交付条件', '约定验收标准、检测资料与异议处理方式。']])); return;
  }
  const panel = action ? panels[action] : undefined;
  if (panel) show(panel.title, (panel.note ? `<div class="hh-banner">${esc(panel.note)}</div>` : '') + fields(panel.rows));
});
get<HTMLFormElement>('#hh-search').addEventListener('submit', event => {
  event.preventDefault(); state.query = queryInput.value.trim().slice(0, 100); renderProducts(); updateUrl();
});
get<HTMLFormElement>('#hh-trace-search').addEventListener('submit', event => {
  event.preventDefault();
  const exists = get<HTMLInputElement>('#hh-batch').value.trim().toUpperCase() === 'HH-DEMO-001';
  get<HTMLElement>('#hh-trace-result').hidden = !exists;
  get<HTMLElement>('#hh-trace-empty').hidden = exists;
});
function restore(focus = false): void {
  state = parseRoute(location.hash); queryInput.value = state.query;
  renderPage(focus); renderProducts(); renderOrders();
}
window.addEventListener('hashchange', () => restore(true));
restore(); updateUrl();
