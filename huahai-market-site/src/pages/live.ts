/** 真实监测数据的页面片段：只拼字符串；数据文件里的文字一律转义；now 由调用方传入。 */
import {
  ageText, beijingDate, beijingTime, featuredPond, findLiveBase, findLivePond, isFeedStale, liveRanges, readingState, stamp, valueText,
  type LiveBase, type LiveFeed, type LiveIndex, type LivePond, type LiveRange, type LiveReading, type PondCurves,
} from '../live.js';
import { icon, timeChart } from '../svg.js';
import { empty, esc, href, pageHead } from '../ui.js';

const COLORS = ['#0e7490', '#15803d', '#6d28d9', '#b45309', '#0369a1', '#be185d'];
const SOURCE = '数据来源：物联网探头自动采集，约每 5 分钟更新一次';

export function liveTag(stale: boolean): string {
  return stale ? '<span class="tag tag-warn">数据中断</span>' : '<span class="tag tag-ok">实时数据</span>';
}
const slot = (html: string) => `<div data-live-slot="page">${html}</div>`;
const loading = () => `<section class="empty card"><h1 tabindex="-1" data-heading>正在载入实时数据…</h1></section>`;
const unavailable = () => empty('实时数据暂时取不到', '请稍后再来。演示内容不受影响。', href('bases'), '返回产地基地');
const banner = (index: LiveIndex, now: number) => isFeedStale(index, now)
  ? `<div class="notice notice-warn live-banner" role="status">${icon('alert', 'ic ic-sm')}实时数据暂时中断，以下为 ${stamp(index.generated_at, now)} 的数据</div>` : '';
const updated = (index: LiveIndex, now: number) => `<span>更新于 ${stamp(index.generated_at, now)}</span>`;
const place = (b: LiveBase) => [b.province, b.city, b.district].filter(Boolean).join(' ');
const area = (p: LivePond) => (p.area_value === null ? '' : `${Math.round(p.area_value * 100) / 100} ${p.area_unit}`.trim());

function tile(r: LiveReading, now: number): string {
  const state = readingState(r, now);
  const value = r.value === null ? '—' : valueText(r.value);
  const time = state === 'none' ? '暂无读数' : state === 'stale' ? `${ageText(now - Date.parse(r.observed_at!))}的读数` : stamp(r.observed_at!, now);
  return `<div class="rd live-rd${state === 'stale' ? ' rd-stale' : ''}" data-reading="${esc(r.key)}"><span class="xs muted">${esc(r.label)}</span><b class="mono">${value}${r.unit ? `<small> ${esc(r.unit)}</small>` : ''}</b><span class="xs rd-time">${time}</span></div>`;
}
const tiles = (list: LiveReading[], now: number) => `<div class="live-tiles">${list.map(r => tile(r, now)).join('')}</div>`;
const withValue = (p: LivePond) => p.readings.filter(r => r.value !== null);

// ---------- 首页面板 ----------
export function homeLivePanel(feed: LiveFeed, now: number): string | null {
  if (feed.status !== 'ok') return null;
  const hit = featuredPond(feed.index);
  if (!hit) return null;
  const stale = isFeedStale(feed.index, now);
  return `<div class="hero-panel card glass live-panel" data-live-slot="home" aria-label="${esc(hit.pond.name)}实时水质">
      <div class="row">${stale ? '' : '<span class="live-dot"></span>'}<b>${esc(hit.pond.name)} · 实时水质</b>${liveTag(stale)}</div>
      ${tiles(withValue(hit.pond).slice(0, 4), now)}
      <div class="live-foot xs muted"><span>${icon('pin', 'ic ic-xs')}${esc(hit.base.name)}</span>${updated(feed.index, now)}</div>
      <a class="link" href="${href('pond', hit.pond.code)}">查看全部读数与曲线 ${icon('arrow', 'ic ic-xs')}</a>
    </div>`;
}

// ---------- 基地列表里的真实基地卡片 ----------
export function liveBaseCards(feed: LiveFeed, now: number): string {
  if (feed.status !== 'ok') return '';
  const stale = isFeedStale(feed.index, now);
  return feed.index.bases.map(b => `<a class="base-card card glass live-base" href="${href('live', b.code)}">
      <div class="row"><b>${esc(b.name)}</b>${liveTag(stale)}</div>
      <p class="muted sm">${esc(place(b) || feed.index.company.name)}</p>
      ${(() => { const p = b.ponds.find(x => withValue(x).length); return p ? `<div class="xs muted">${esc(p.name)} 最新读数</div>${tiles(withValue(p).slice(0, 4), now)}` : ''; })()}
      <div class="base-meta mono"><span>${b.ponds.length} 口公开塘</span><span>探头自动采集</span></div>
      <span class="link">查看实时数据 ${icon('arrow', 'ic ic-xs')}</span></a>`).join('');
}

// ---------- 真实基地页 ----------
function coords(b: LiveBase): string {
  if (b.lat === null || b.lng === null) return '';
  return `<span>${b.lat >= 0 ? '北纬' : '南纬'} ${Math.abs(b.lat).toFixed(5)}°，${b.lng >= 0 ? '东经' : '西经'} ${Math.abs(b.lng).toFixed(5)}°</span>`;
}
function pondCard(p: LivePond, now: number): string {
  const list = withValue(p).slice(0, 4);
  return `<a class="card live-pond" href="${href('pond', p.code)}">
      <div class="row"><b>${esc(p.name)}</b>${area(p) ? `<span class="xs muted">${esc(area(p))}</span>` : ''}</div>
      ${list.length ? tiles(list, now) : '<p class="muted sm">暂无读数</p>'}
      <span class="link sm">查看全部读数与曲线 ${icon('arrow', 'ic ic-xs')}</span></a>`;
}
export function liveBasePage(code: string, feed: LiveFeed, now: number): string {
  if (feed.status === 'loading') return slot(loading());
  if (feed.status === 'unavailable') return slot(unavailable());
  const b = findLiveBase(feed.index, code);
  if (!b) return slot(empty('没有找到这个基地', '链接可能有误，或这个基地已不再公开。', href('bases'), '查看全部基地'));
  const idx = feed.index, stale = isFeedStale(idx, now);
  return slot(`<nav class="crumbs" aria-label="位置"><a href="${href('home')}">首页</a><span>/</span><a href="${href('bases')}">产地基地</a><span>/</span><span aria-current="page">${esc(b.name)}</span></nav>
  ${pageHead(`${place(b) || '产地'} · 真实监测`, b.name, idx.company.name, `<div class="phead-meta mono">${liveTag(stale)}${updated(idx, now)}<span>${b.ponds.length} 口公开塘</span></div>`)}
  ${banner(idx, now)}
  <div class="card live-place"><div class="row">${icon('pin', 'ic ic-sm')}<b>位置</b></div><div class="phead-meta">${b.address ? `<span>${esc(b.address)}</span>` : ''}${coords(b)}</div></div>
  <div class="live-ponds">${b.ponds.map(p => pondCard(p, now)).join('')}</div>
  <p class="xs muted live-source">${SOURCE}</p>`);
}

// ---------- 真实塘口页 ----------
function curveCard(r: LiveReading, i: number, curves: PondCurves, range: LiveRange, index: LiveIndex): string {
  const def = liveRanges.find(x => x.id === range)!;
  let body: string;
  if (curves.status === 'loading') body = '<p class="muted chart-empty">正在载入曲线…</p>';
  else {
    const points = curves.status === 'ok' ? curves.file.series[range].find(s => s.key === r.key)?.points ?? [] : [];
    const to = Date.parse(index.generated_at);
    body = timeChart(points, {
      from: to - def.spanMs, to, gapMs: 2.5 * def.bucketMs, color: COLORS[i % COLORS.length]!, unit: r.unit, label: r.label,
      xLabel: range === '24h' ? beijingTime : beijingDate,
    });
  }
  return `<figure class="card live-curve"><figcaption class="row"><b>${esc(r.label)}</b>${r.unit ? `<span class="xs muted">${esc(r.unit)}</span>` : ''}</figcaption>${body}</figure>`;
}
export function livePondPage(code: string, feed: LiveFeed, curves: PondCurves, range: LiveRange, now: number): string {
  if (feed.status === 'loading') return slot(loading());
  if (feed.status === 'unavailable') return slot(unavailable());
  const hit = findLivePond(feed.index, code);
  if (!hit) return slot(empty('没有找到这口塘', '链接可能有误，或这口塘已不再公开。', href('bases'), '查看全部基地'));
  const { base, pond } = hit, idx = feed.index, stale = isFeedStale(idx, now);
  const meta = `<div class="phead-meta mono">${liveTag(stale)}${updated(idx, now)}${area(pond) ? `<span>${esc(area(pond))}</span>` : ''}</div>`;
  return slot(`<nav class="crumbs" aria-label="位置"><a href="${href('home')}">首页</a><span>/</span><a href="${href('bases')}">产地基地</a><span>/</span><a href="${href('live', base.code)}">${esc(base.name)}</a><span>/</span><span aria-current="page">${esc(pond.name)}</span></nav>
  ${pageHead(`${base.name} · 真实监测`, pond.name, '', meta)}
  ${banner(idx, now)}
  ${pond.readings.length ? tiles(pond.readings, now) : '<p class="muted">这口塘暂未公开读数。</p>'}
  <section class="section live-curves-sec">
    <div class="sec-head"><div><div class="kicker">变化曲线</div><h2>水质走势</h2></div>
      <div class="seg" role="group" aria-label="时间范围">${liveRanges.map(x => `<button class="seg-i" data-range="${x.id}" aria-pressed="${x.id === range}">${x.label}</button>`).join('')}</div></div>
    <div class="live-curves">${pond.readings.map((r, i) => curveCard(r, i, curves, range, idx)).join('')}</div>
  </section>
  <p class="xs muted live-source">${SOURCE}</p>`);
}

export function liveTitle(name: 'live' | 'pond', id: string, feed: LiveFeed): string | undefined {
  if (feed.status !== 'ok') return undefined;
  return name === 'pond' ? findLivePond(feed.index, id)?.pond.name : findLiveBase(feed.index, id)?.name;
}
