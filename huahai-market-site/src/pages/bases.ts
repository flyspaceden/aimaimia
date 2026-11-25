import { bases, batches, company, findBase, inPond, liveReading, metricInfo, readingText, pondsOfBase, productOfBatch, type Pond, type Reading } from '../data.js';
import { icon, pondMap } from '../svg.js';
import { esc, href, pageHead, empty } from '../ui.js';

export function basesPage(): string {
  return `${pageHead('产地基地', `${company.short}的 ${bases.length} 个养殖基地`, company.intro)}
  <div class="base-grid base-grid-lg">${bases.map(b => {
    const list = pondsOfBase(b.id);
    return `<a class="base-card card glass" href="${href('base', b.id)}">
      <div class="row"><b>${esc(b.name)}</b><span class="tag">${b.water === 'marine' ? '海水' : '淡水'}</span></div>
      <div class="mini-map">${pondMap(list, '', {})}</div>
      <p class="muted sm">${esc(b.intro)}</p>
      <div class="base-meta mono"><span>${esc(b.region)}</span><span>${esc(b.area)}</span><span>${list.length} 口塘</span><span>${b.sensors} 探头</span></div>
      <span class="link">进入基地 ${icon('arrow', 'ic ic-xs')}</span></a>`;
  }).join('')}</div>`;
}

const statusText: Record<Pond['status'], string> = { growing: '养殖中', harvested: '已起捕 · 待清塘', idle: '空塘' };

export function basePage(id: string, selected: string, tick: number): string {
  const b = findBase(id);
  if (!b) return empty('没有找到这个基地', '链接可能有误。', href('bases'), '查看全部基地');
  const list = pondsOfBase(b.id);
  const sel = list.find(p => p.id === selected) ?? list[0]!;
  const readings: Record<string, Reading> = Object.fromEntries(list.map(p => [p.id, liveReading(p.id, tick)]));
  const sold = batches.filter(x => x.baseId === b.id);
  return `<nav class="crumbs" aria-label="位置"><a href="${href('home')}">首页</a><span>/</span><a href="${href('bases')}">产地基地</a><span>/</span><span aria-current="page">${esc(b.name)}</span></nav>
  ${pageHead(`${b.region} · ${b.coords}`, b.name, b.intro, `<div class="phead-meta mono"><span>${esc(b.area)}</span><span>${list.length} 口塘</span><span>${b.sensors} 探头</span><span>负责人 ${esc(b.manager)}</span></div>`)}
  <div class="base-layout">
    <div class="card glass">
      <div class="row"><span class="live-dot"></span><b>塘口分布与实时状态</b><span class="tag tag-demo">演示</span></div>
      <div id="pond-map">${pondMap(list, sel.id, readings)}</div>
      <div class="legend xs"><span class="lg lg-growing"></span>养殖中<span class="lg lg-harvested"></span>已起捕<span class="lg lg-live"></span>探头在线</div>
    </div>
    <div class="pond-list">${list.map(p => pondCard(p, readings[p.id]!, p.id === sel.id)).join('')}</div>
  </div>
  <section class="section">
    <div class="sec-head"><div><div class="kicker">本基地已上市批次</div><h2>可查完整档案</h2></div></div>
    <div class="batch-list">${sold.map(x => `<a class="batch-item card" href="${href('trace', x.code)}"><div><b>${esc(x.species)}</b><div class="mono sm">${x.code}</div><div class="muted xs">${x.stockDate} 放苗 · ${x.harvestDate} 起捕</div></div><span class="link sm">${esc(productOfBatch(x)!.name)} ${icon('arrow', 'ic ic-xs')}</span></a>`).join('') || '<p class="muted">暂无。</p>'}</div>
  </section>`;
}

function pondCard(p: Pond, r: Reading, on: boolean): string {
  const ip = inPond.find(x => x.pondId === p.id);
  const metric = (k: 'do' | 'temp' | 'ph' | 'nh3') => `<div class="rd"><span class="xs muted">${metricInfo[k].label}</span><b class="mono" data-live="${p.id}:${k}">${readingText(k, r[k])}</b><span class="xs muted">${metricInfo[k].unit}</span></div>`;
  return `<button class="pond card${on ? ' pond-on' : ''}" data-pond="${p.id}" aria-pressed="${on}">
    <div class="row"><b>${esc(p.name)}</b><span class="mono xs">${p.id}</span><span class="tag ${p.status === 'growing' ? 'tag-ok' : ''}">${statusText[p.status]}</span></div>
    <div class="xs muted">${esc(p.kind)} · ${p.areaMu} 亩 · 水深 ${p.depthM} m · ${esc(p.species)}</div>
    <div class="readings">${metric('do')}${metric('temp')}${metric('ph')}${metric('nh3')}</div>
    ${ip ? `<div class="xs inpond">${icon('fish', 'ic ic-xs')}在塘批次 <span class="mono">${ip.code}</span> · ${esc(ip.count)} · 预计 ${esc(ip.expect)}</div>` : ''}
  </button>`;
}
