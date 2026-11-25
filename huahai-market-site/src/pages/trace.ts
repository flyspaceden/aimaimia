import { batches, company, findBatch, findBase, findPond, productOfBatch, waterSeries, metricRange, metricInfo, complianceRate, cultureDays, totalFeedKg, feedConversion, traceCompleteness, aiAnswers, daysBetween, eventLabel, sourceLabel, type Metric, type Batch } from '../data.js';
import { fmt } from '../model.js';
import { demoCode, fishArt, icon, lineChart, ring, spanBar } from '../svg.js';
import { esc, href, pageHead, sourceBadge } from '../ui.js';

export function traceSearchPage(notFound = ''): string {
  return `${pageHead('溯源查询', '输入批次码，查看一批货的完整档案', '批次码印在包装标签与扫码页上。演示站可使用下方任一批次。')}
  <form class="trace-search card" id="trace-form" role="search"><label class="sr-only" for="trace-code">批次码</label>${icon('qr')}
    <input id="trace-code" maxlength="40" autocomplete="off" value="${esc(notFound)}" placeholder="例如 HH-YJ-2605-02"><button class="btn btn-primary" type="submit">查询</button></form>
  ${notFound ? `<div class="notice notice-warn" role="alert">${icon('alert', 'ic ic-sm')}没有找到批次“${esc(notFound)}”。请核对包装上的批次码，或从下方选择演示批次。</div>` : ''}
  <div class="batch-list">${batches.map(b => {
    const base = findBase(b.baseId)!, p = productOfBatch(b)!;
    return `<a class="batch-item card" href="${href('trace', b.code)}"><div class="bi-art">${fishArt(p.art, b.species)}</div>
      <div><b>${esc(b.species)}</b><div class="mono sm">${b.code}</div><div class="muted xs">${esc(base.name)} · ${b.harvestDate} 起捕</div></div>
      <span class="bi-score mono">${traceCompleteness(b)}%</span></a>`;
  }).join('')}</div>`;
}

const SECTIONS = [['ov', '概览'], ['lineage', '来源链'], ['timeline', '时间轴'], ['feed', '饲料投喂'], ['water', '水质环境'], ['lab', '检测报告'], ['photo', '照片记录'], ['proof', '数据确权']] as const;

export function tracePage(code: string, metric: Metric = 'do'): string {
  const b = findBatch(code);
  if (!b) return traceSearchPage(code);
  const base = findBase(b.baseId)!, pond = findPond(b.pondId)!, p = productOfBatch(b)!;
  const ai = aiAnswers(b);
  const days = cultureDays(b);
  return `<nav class="crumbs" aria-label="位置"><a href="${href('home')}">首页</a><span>/</span><a href="${href('trace')}">溯源查询</a><span>/</span><span aria-current="page">${b.code}</span></nav>
  <section class="tr-hero card glass">
    <div class="tr-id">
      <div class="kicker">${icon('shield', 'ic ic-xs')} 批次溯源档案 · 演示</div>
      <h1 tabindex="-1" data-heading>${esc(b.species)} <span class="mono">${b.code}</span></h1>
      <p class="muted"><i>${esc(b.latin)}</i></p>
      <ol class="path path-sm">
        <li>${icon('building', 'ic ic-xs')}<span>${esc(company.name)}</span></li>
        <li><a href="${href('base', base.id)}">${icon('pin', 'ic ic-xs')}<span>${esc(base.name)}</span></a></li>
        <li>${icon('wave', 'ic ic-xs')}<span>${esc(pond.name)}（${pond.id}）</span></li>
      </ol>
      <div class="tr-stats">
        <div><b class="mono">${b.stockDate}</b><span>放苗</span></div><div><b class="mono">${b.harvestDate}</b><span>起捕</span></div>
        <div><b class="mono">${days} 天</b><span>养殖周期</span></div><div><b class="mono">${fmt(b.harvest.qtyKg)} kg</b><span>起捕量</span></div>
      </div>
      <div class="row gap"><a class="btn btn-primary" href="${href('product', p.id)}">${icon('cart')}购买这批货</a><button class="btn btn-ghost" data-action="assistant" data-batch="${b.code}">${icon('spark')}问 AI</button></div>
    </div>
    <div class="tr-code">${demoCode(b.code)}<span class="muted xs">包装扫码即达本页（演示码）</span><div class="ring-pair">${ring(traceCompleteness(b), '#34d399', '溯源完整度')}<span class="xs muted">溯源完整度</span></div></div>
  </section>

  <nav class="tabs" aria-label="档案目录">${SECTIONS.map(([id, label]) => `<a href="#sec-${id}" data-jump="sec-${id}">${label}</a>`).join('')}</nav>

  <section class="section" id="sec-ov">
    <div class="ai-box ai-lg">${icon('spark')}<div><b>AI 档案解读</b><p>${esc(`${ai[0]!.a} ${ai[2]!.a}`)}</p><p>${esc(ai[1]!.a)}</p><p class="xs muted">解读由档案数据自动生成（演示为预设文本），不替代检测报告原件。</p></div></div>
    <div class="kpis kpis-4">
      <div class="kpi card"><b class="mono">${fmt(b.seed.count)}</b><span>放苗数量（尾）</span></div>
      <div class="kpi card"><b class="mono">${b.survival}%</b><span>成活率</span></div>
      <div class="kpi card"><b class="mono">${(totalFeedKg(b) / 1000).toFixed(1)} t</b><span>累计投喂 · 饲料系数 ${feedConversion(b)}</span></div>
      <div class="kpi card"><b class="mono">${b.alerts.length}</b><span>预警次数（均已处理）</span></div>
    </div>
  </section>

  <section class="section card" id="sec-lineage">
    <div class="sec-head"><div><div class="kicker">${icon('route', 'ic ic-xs')} 来源链</div><h2>苗种从哪来，经过了哪些塘</h2></div>${sourceBadge('farmer')}</div>
    <div class="lineage">
      <div class="ln-node ln-seed"><small>苗种</small><b>${esc(b.seed.source)}</b><span class="xs muted">${esc(b.seed.size)} · ${fmt(b.seed.count)} 尾</span><span class="xs">${icon('file', 'ic ic-xs')}${esc(b.seed.quarantine)}</span></div>
      ${b.lineage.map(n => { const pd = findPond(n.pondId)!; return `<div class="ln-arrow" aria-hidden="true">${icon('arrow')}</div>
      <div class="ln-node${n.pondId === b.pondId && n.to === b.harvestDate ? ' ln-final' : ''}${n.to === '养殖中' ? ' ln-branch' : ''}"><small>${esc(n.stage)}</small><b>${esc(pd.name)}（${pd.id}）</b><span class="xs mono">${n.from} → ${esc(n.to)}</span><span class="xs">${esc(n.qty)}</span><span class="xs muted">${esc(n.note)}</span></div>`; }).join('')}
      <div class="ln-arrow" aria-hidden="true">${icon('arrow')}</div>
      <div class="ln-node ln-end"><small>起捕上市</small><b>${fmt(b.harvest.qtyKg)} kg</b><span class="xs">${esc(b.harvest.spec)}</span><span class="xs muted">${esc(b.harvest.method)}</span></div>
    </div>
  </section>

  <section class="section card" id="sec-timeline">
    <div class="sec-head"><div><div class="kicker">${icon('clock', 'ic ic-xs')} 养殖时间轴</div><h2>${b.events.length} 个关键节点</h2></div></div>
    <ol class="tl">${b.events.map(e => `<li class="tl-i tl-${e.kind.toLowerCase()}"><div class="tl-dot"></div><div class="tl-date mono">${e.date}<span class="xs muted">第 ${daysBetween(b.stockDate, e.date) + 1} 天</span></div>
      <div class="tl-body"><div class="row"><span class="tag">${eventLabel[e.kind]}</span><b>${esc(e.title)}</b></div><p class="sm muted">${esc(e.detail)}</p>${sourceBadge(e.source)}</div></li>`).join('')}</ol>
  </section>

  <section class="section card" id="sec-feed">
    <div class="sec-head"><div><div class="kicker">${icon('leaf', 'ic ic-xs')} 饲料投喂</div><h2>吃了什么，吃了多少</h2></div>${sourceBadge('farmer')}</div>
    <div class="feed-list">${b.feeds.map((f, i) => `<div class="feed-i"><div><b>${esc(f.product)}</b><div class="xs muted">${esc(f.brand)} · 粗蛋白 ${esc(f.protein)} · ${esc(f.stage)}</div></div>
      <div class="mono xs">批号 ${esc(f.lot)}</div>
      <div class="feed-bar">${spanBar(daysBetween(b.stockDate, f.from), daysBetween(b.stockDate, f.to), days, ['#22d3ee', '#34d399', '#a3e635', '#fbbf24'][i % 4]!)}<span class="xs mono">${f.from.slice(5)} – ${f.to.slice(5)}</span></div>
      <b class="mono feed-kg">${fmt(f.kg)} kg</b></div>`).join('')}</div>
    <p class="sm muted">合计 ${fmt(totalFeedKg(b))} kg，饲料系数约 ${feedConversion(b)}（投喂量 ÷ 起捕量）。饲料按入库批号领用，可追到对应饲料厂出厂批次。</p>
  </section>

  <section class="section card" id="sec-water">
    <div class="sec-head"><div><div class="kicker">${icon('drop', 'ic ic-xs')} 水质环境</div><h2>养殖期水质曲线（日均值）</h2></div>${sourceBadge('sensor')}</div>
    <div class="seg" role="tablist" aria-label="水质指标">${(Object.keys(metricInfo) as Metric[]).map(m => `<button role="tab" class="seg-i" data-metric="${m}" aria-selected="${m === metric}">${metricInfo[m].label}</button>`).join('')}</div>
    <div id="water-chart">${waterBlock(b, metric)}</div>
    <h3 class="h3">预警与处理</h3>
    ${b.alerts.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>日期</th><th>指标</th><th>级别</th><th>读数</th><th>处理</th><th>恢复用时</th></tr></thead><tbody>
      ${b.alerts.map(a => `<tr><td class="mono">${a.date}</td><td>${metricInfo[a.metric].label}</td><td><span class="tag ${a.level === '预警' ? 'tag-warn' : 'tag-info'}">${a.level}</span></td><td class="mono">${esc(a.value)}</td><td>${esc(a.action)}</td><td>${esc(a.recoveredIn)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">养殖期间未触发预警。</p>'}
  </section>

  <section class="section card" id="sec-lab">
    <div class="sec-head"><div><div class="kicker">${icon('flask', 'ic ic-xs')} 检测报告</div><h2>${b.labs.length} 份第三方检测</h2></div>${sourceBadge('lab')}</div>
    ${b.labs.map(l => `<article class="lab">
      <div class="lab-head"><div><b>${esc(l.category)}</b><div class="xs muted">${esc(l.agency)} · 报告号 <span class="mono">${esc(l.reportNo)}</span></div></div>
        <div class="xs muted">样品：${esc(l.sample)}<br>采样 ${l.sampled} · 出具 ${l.issued}</div><span class="tag tag-ok">${icon('check', 'ic ic-xs')}${l.items.filter(i => i.pass).length}/${l.items.length} 项符合</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>检测项目</th><th>结果</th><th>对照限值</th><th>判定</th></tr></thead><tbody>
      ${l.items.map(i => `<tr><td>${esc(i.name)}</td><td class="mono">${esc(i.result)}</td><td class="mono">${esc(i.limit)}</td><td>${i.pass ? '<span class="ok">符合</span>' : '<span class="bad">不符合</span>'}</td></tr>`).join('')}</tbody></table></div>
    </article>`).join('')}
    <p class="xs muted">演示数据：机构名称、报告号与结果均为虚构示例；对照限值仅用于演示页面结构，正式上线以报告原件和适用标准为准。</p>
  </section>

  <section class="section card" id="sec-photo">
    <div class="sec-head"><div><div class="kicker">${icon('camera', 'ic ic-xs')} 照片记录</div><h2>现场留痕</h2></div></div>
    <div class="photos">${b.photos.map(ph => `<figure class="photo"><div class="photo-ph photo-${ph.scene}">${icon(ph.scene === 'feed' ? 'leaf' : ph.scene === 'lab' ? 'flask' : ph.scene === 'pack' ? 'box' : ph.scene === 'seed' ? 'fish' : ph.scene === 'harvest' ? 'truck' : 'wave', 'ic ic-lg')}<span class="xs">照片示意</span></div>
      <figcaption><b class="sm">${esc(ph.caption)}</b><span class="xs mono">${ph.date}</span>${sourceBadge(ph.source)}</figcaption></figure>`).join('')}</div>
    <p class="xs muted">正式版展示养殖户在确权小程序中拍摄的原图，记录拍摄时间与归属塘口；演示站以示意图代替。</p>
  </section>

  <section class="section card" id="sec-proof">
    <div class="sec-head"><div><div class="kicker">${icon('hash', 'ic ic-xs')} 数据确权</div><h2>每条数据有来源、有修订、有指纹</h2></div></div>
    <div class="proof-grid">
      <div class="proof card-in">${sourceBadge('sensor')}<b class="mono">${fmt(b.provenance.sensorSamples)}</b><span class="xs muted">${b.sensors} 个探头自动采集，无人工干预</span></div>
      <div class="proof card-in">${sourceBadge('farmer')}<b class="mono">${fmt(b.provenance.farmerRecords)}</b><span class="xs muted">养殖户在确权小程序登记，含照片</span></div>
      <div class="proof card-in">${sourceBadge('lab')}<b class="mono">${b.labs.length} 份</b><span class="xs muted">第三方机构出具，保留原件</span></div>
    </div>
    <h3 class="h3">修订记录</h3>
    ${b.provenance.revisions.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>日期</th><th>字段</th><th>修改前</th><th>修改后</th><th>修改人</th><th>原因</th></tr></thead><tbody>
      ${b.provenance.revisions.map(v => `<tr><td class="mono">${v.date}</td><td>${esc(v.field)}</td><td class="mono strike">${esc(v.before)}</td><td class="mono">${esc(v.after)}</td><td>${esc(v.by)}</td><td>${esc(v.reason)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted sm">本批次档案无修订。</p>'}
    <div class="fingerprint"><span class="xs muted">档案数据指纹（演示）</span><code class="mono">${b.provenance.fingerprint}</code><span class="xs muted">任一数据改动都会生成新版本与新指纹，旧版本保留可查。</span></div>
    <p class="xs muted">数据来源：${Object.values(sourceLabel).slice(0, 3).join(' / ')}。演示站未接入区块链存证，不展示“已上链”标识。</p>
  </section>`;
}

export function waterBlock(b: Batch, metric: Metric): string {
  const water = findBase(b.baseId)!.water, info = metricInfo[metric], range = metricRange(metric, water);
  const series = waterSeries(b, metric), values = series.map(p => p.value);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const marks = b.alerts.filter(a => a.metric === metric).map(a => a.date);
  return `<div class="water-stats">
      <div><b class="mono">${complianceRate(series, range)}%</b><span>处于适宜区间</span></div>
      <div><b class="mono">${avg.toFixed(metric === 'temp' ? 1 : 2)}</b><span>平均 ${info.unit}</span></div>
      <div><b class="mono">${Math.min(...values)} – ${Math.max(...values)}</b><span>日均值范围</span></div>
      <div><b class="mono">${range[0]} – ${range[1]}</b><span>适宜区间（演示）</span></div></div>
    ${lineChart(series, { range, color: info.color, unit: info.unit, label: info.label, marks })}
    <p class="xs muted">${series.length} 个日均值，来自 ${b.sensors} 个探头的原始采样；阴影带为适宜区间，圆点为当天触发的提醒。</p>`;
}
