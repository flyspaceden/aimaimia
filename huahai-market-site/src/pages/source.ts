import { demands, findBatch, findBase, inPond, findPond, products, traceCompleteness } from '../data.js';
import { addDays } from '../data.js';
import { fmt, yuan, routeHash, type Route, type WorkStatus } from '../model.js';
import { icon, weekBars } from '../svg.js';
import { esc, href, pageHead } from '../ui.js';

export function sourcePage(): string {
  const weekStart = '2026-11-30';
  return `${pageHead('产地采购 · B 端', '直连产地，按批次采购', '查看在塘存量、预计起捕时间与未来 8 周供货量；每批货都附溯源档案与检测报告。',
    `<div class="row gap"><button class="btn btn-ghost" data-form="sell">${icon('box')}发布货源</button><button class="btn btn-primary" data-form="buy">${icon('plus')}发布采购需求</button></div>`)}
  <div class="kpis kpis-4">
    <div class="kpi card"><b class="mono">${fmt(products.reduce((s, p) => s + p.b2b.inPondKg, 0))} kg</b><span>在塘可供总量</span></div>
    <div class="kpi card"><b class="mono">${inPond.length}</b><span>在塘批次（演示）</span></div>
    <div class="kpi card"><b class="mono">${products.length}</b><span>可供品种</span></div>
    <div class="kpi card"><b class="mono">${demands.length}</b><span>开放采购需求</span></div>
  </div>

  <section class="section card">
    <div class="sec-head"><div><div class="kicker">货源大厅</div><h2>产地货源</h2></div><span class="tag tag-demo">批发价为演示</span></div>
    <div class="table-wrap"><table class="table table-lg"><thead><tr><th>品种 / 产地</th><th>批发参考价</th><th>在塘存量</th><th>预计起捕</th><th>起订量</th><th>溯源</th><th></th></tr></thead><tbody>
    ${products.map(p => { const b = findBatch(p.batchCode)!, base = findBase(b.baseId)!; return `<tr>
      <td><b>${esc(p.name)}</b><div class="xs muted">${esc(base.region)} · ${esc(p.spec)}</div></td>
      <td><span class="price">¥${yuan(p.b2b.wholesale)}</span><span class="xs muted"> /kg</span></td>
      <td class="mono">${fmt(p.b2b.inPondKg)} kg</td><td class="mono">${p.b2b.nextHarvest}</td><td>${esc(p.b2b.moq)}</td>
      <td><a class="link sm" href="${href('trace', b.code)}">${icon('shield', 'ic ic-xs')}${traceCompleteness(b)}%</a></td>
      <td><button class="btn btn-sm" data-inquiry="${p.id}">询价</button></td></tr>`; }).join('')}
    </tbody></table></div>
  </section>

  <section class="section">
    <div class="sec-head"><div><div class="kicker">${icon('calendar', 'ic ic-xs')} 供货日历</div><h2>未来 8 周预计可供量</h2></div><span class="muted sm">自 ${weekStart} 起 · 按在塘存量与起捕计划估算</span></div>
    <div class="weeks-grid">${products.map(p => `<div class="card weeks-card"><div class="row"><b>${esc(p.name)}</b><span class="mono xs">${fmt(p.b2b.weekly.reduce((s, v) => s + v, 0))} kg</span></div>${weekBars(p.b2b.weekly, '#22d3ee', `${p.name}未来 8 周可供量`)}<div class="xs muted">W1 = ${weekStart} 周 · W8 = ${addDays(weekStart, 49)} 周</div></div>`).join('')}</div>
  </section>

  <section class="section">
    <div class="sec-head"><div><div class="kicker">采购需求</div><h2>采购方正在找</h2></div></div>
    <div class="demand-list">${demands.map(d => { const m = products.find(p => p.id === d.match)!; return `<article class="card demand">
      <div><span class="tag">${esc(d.buyer)}</span><h3>${esc(d.name)}</h3><p class="sm muted">${esc(d.requirement)}</p></div>
      <div class="demand-meta"><div><b>${esc(d.quantity)}</b><span class="xs muted">采购量</span></div><div><b>${esc(d.destination)}</b><span class="xs muted">收货地</span></div><div><b>${esc(d.delivery)}</b><span class="xs muted">交付</span></div></div>
      <div class="ai-match">${icon('spark', 'ic ic-xs')}AI 匹配：${esc(m.name)}，在塘 ${fmt(m.b2b.inPondKg)} kg，${m.b2b.nextHarvest} 起捕，满足规格 ${esc(d.spec)}</div>
      <button class="btn btn-sm" data-quote="${d.id}">查看并报价</button></article>`; }).join('')}</div>
  </section>

  <section class="section card">
    <div class="sec-head"><div><div class="kicker">在塘批次</div><h2>可提前锁定的产能</h2></div></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>批次</th><th>品种</th><th>塘口</th><th>放苗</th><th>存量</th><th>预计</th></tr></thead><tbody>
    ${inPond.map(x => { const pd = findPond(x.pondId)!; return `<tr><td class="mono">${x.code}</td><td>${esc(x.species)}</td><td><a class="link" href="${href('base', pd.baseId)}">${esc(pd.name)}</a></td><td class="mono">${x.stockDate}</td><td>${esc(x.count)}</td><td>${esc(x.expect)}</td></tr>`; }).join('')}
    </tbody></table></div>
  </section>`;
}

export function workPage(r: Route): string {
  const tabs: [WorkStatus, string][] = [['ongoing', '履约中 1'], ['quoted', '待确认报价 1'], ['complete', '已完成 1']];
  const body = r.status === 'quoted'
    ? `<div class="row"><div><span class="tag">报价演示</span><h3>鲜活罗非鱼 · 周期直供</h3><p class="sm muted">茂名电白生态基地报价 ¥11.20/kg，每周 2,000 kg，附批次 HH-MM-2604-01B 溯源档案。</p></div><button class="btn" data-panel="review">查看报价</button></div>`
    : r.status === 'complete'
      ? `<div class="row"><div><span class="mono xs">HH-ORDER-0098</span><h3>南美白对虾 · 600 kg</h3><p class="sm muted">2026-11-14 到货，实收 598.4 kg，品质复检合格，已归档。</p></div><a class="btn" href="${href('trace', 'HH-YJ-2607-03')}">查看批次档案</a></div>`
      : `<div class="row"><div><span class="mono xs">订单示例 HH-ORDER-0112</span><h3>阳江金鲳鱼 · 3,000 kg</h3></div><span class="tag tag-info">运输中</span></div>
        <div class="steps">${[['供需确认', '规格、数量、报价', 1], ['锁定批次', 'HH-YJ-2605-02', 1], ['起捕出库', '11-18 起捕 · 预冷装箱', 1], ['冷链运输', '0–4 ℃ 全程温控', 0], ['到货核验', '数量、品质、异议', 0]].map(([t, d, done]) => `<div class="step${done ? ' done' : ''}"><span class="step-dot">${done ? icon('check', 'ic ic-xs') : ''}</span><b>${t}</b><span class="xs muted">${d}</span></div>`).join('')}</div>
        <div class="row"><span class="sm muted">下一步：到货后上传称重与复检记录。</span><div class="row gap"><a class="btn" href="${href('trace', 'HH-YJ-2605-02')}">批次档案</a><button class="btn" data-panel="orderdetail">履约清单</button></div></div>`;
  return `${pageHead('交易工作台 · B 端', '从询价到交付，每一步都可追溯', '采购方视角演示：订单与批次绑定，交付凭证归档到同一档案。')}
  <div class="seg" role="group" aria-label="订单状态">${tabs.map(([v, l]) => `<a class="seg-i" href="${routeHash({ name: 'work', status: v })}" aria-current="${r.status === v}">${l}</a>`).join('')}</div>
  <div class="card section">${body}</div>
  <div class="notice">${icon('alert', 'ic ic-sm')}资金结算、合同与发票流程待业务规则确认后设计；本页只演示供需与实物交付。</div>`;
}
