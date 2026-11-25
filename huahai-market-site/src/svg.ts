/** 内联 SVG：图标、商品插画、图表。只生成静态标记，数值均来自演示数据，不含用户输入。 */
import type { ArtKind, Point, Pond, Reading } from './data.js';

const ICONS: Record<string, string> = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  fish: '<path d="M3 12c3-5 9-6 14-2l4-3v10l-4-3c-5 4-11 3-14-2z"/><circle cx="8" cy="11" r=".8" fill="currentColor"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M7 15l4-5 3 3 5-6"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 12h11l2-8H6.2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  sensor: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M4 9h3M4 15h3M17 9h3M17 15h3M9 4v3M15 4v3M9 17v3M15 17v3"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3"/><path d="M7.5 15h9"/>',
  leaf: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15"/><path d="M5 19l8-8"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a4 4 0 000-8h-4a4 4 0 010-8h6" transform="translate(0 2)"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".6" fill="currentColor"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  building: '<path d="M4 21V5l8-2v18"/><path d="M12 9h8v12"/><path d="M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  truck: '<path d="M2 6h12v10H2zM14 10h4l3 3v3h-7"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  drop: '<path d="M12 3s6 6.6 6 11a6 6 0 01-12 0c0-4.4 6-11 6-11z"/>',
  thermo: '<path d="M10 14V5a2 2 0 014 0v9a4 4 0 11-4 0z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/>',
  send: '<path d="M4 12l16-8-6 16-2-7z"/>',
  wave: '<path d="M2 9c3 0 3-3 6-3s3 3 6 3 3-3 6-3M2 15c3 0 3-3 6-3s3 3 6 3 3-3 6-3"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>',
  store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 005.3 0 2.7 2.7 0 005.4 0 2.7 2.7 0 005.3 0"/><path d="M5 11v9h14v-9"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};
export function icon(name: keyof typeof ICONS | string, cls = 'ic'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;
}

// ---------- 商品插画（风格化矢量，不伪装实拍） ----------
interface Look { a: string; b: string; fin: string; L: number; H: number; spots?: boolean; stripes?: boolean; band?: boolean }
const LOOKS: Record<Exclude<ArtKind, 'shrimp'>, Look> = {
  pompano: { a: '#f1f5f9', b: '#94a3b8', fin: '#fbbf24', L: 1, H: 58 },
  tilapia: { a: '#cbd5e1', b: '#475569', fin: '#64748b', L: 1, H: 44, stripes: true },
  bass: { a: '#d9f99d', b: '#3f6212', fin: '#65a30d', L: 1.08, H: 36, band: true },
  grouper: { a: '#e7c9a0', b: '#7c4a1e', fin: '#92400e', L: 1.05, H: 46, spots: true },
  seabream: { a: '#e2e8f0', b: '#64748b', fin: '#facc15', L: 0.98, H: 50 },
};
let artSeq = 0;
export function fishArt(kind: ArtKind, label: string): string {
  const id = `art${++artSeq}`;
  const bg = `<defs><radialGradient id="${id}g" cx="50%" cy="45%" r="65%"><stop offset="0" stop-color="#e3f3ea"/><stop offset="1" stop-color="#f7fbf9"/></radialGradient>
    <pattern id="${id}p" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="#15803d" stroke-opacity=".08"/></pattern>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${kind === 'shrimp' ? '#fda4af' : LOOKS[kind].b}"/><stop offset=".55" stop-color="${kind === 'shrimp' ? '#fecdd3' : LOOKS[kind].a}"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#${id}g)"/><rect width="320" height="200" fill="url(#${id}p)"/>
    <circle cx="160" cy="100" r="78" fill="none" stroke="#0e7490" stroke-opacity=".28" stroke-dasharray="2 6"/>
    <path d="M18 168c40-10 80 10 120 0s80-10 164 2" fill="none" stroke="#15803d" stroke-opacity=".3"/>`;
  const body = kind === 'shrimp' ? shrimp(id) : fish(id, LOOKS[kind]);
  return `<svg class="art" viewBox="0 0 320 200" role="img" aria-label="${label}（示意插画）">${bg}${body}</svg>`;
}
function fish(id: string, k: Look): string {
  const cy = 100, x0 = 160 - 105 * k.L, xt = 160 + 70 * k.L, tail = xt + 52, H = k.H;
  const outline = `M${x0},${cy} C${x0 + 22},${cy - H} ${xt - 60},${cy - H * 1.05} ${xt},${cy - H * 0.2} L${tail},${cy - H * 0.95} L${tail - 14},${cy} L${tail},${cy + H * 0.95} L${xt},${cy + H * 0.2} C${xt - 60},${cy + H * 1.05} ${x0 + 22},${cy + H} ${x0},${cy}Z`;
  const dorsal = `M${x0 + 70},${cy - H * 0.9} Q${x0 + 120},${cy - H * 1.55} ${xt - 34},${cy - H * 0.62}Z`;
  const ventral = `M${x0 + 90},${cy + H * 0.88} Q${x0 + 120},${cy + H * 1.35} ${xt - 44},${cy + H * 0.6}Z`;
  const pect = `M${x0 + 46},${cy + 6} q22 10 34 28 q-26 -4 -34 -28z`;
  let marks = '';
  if (k.stripes) for (let i = 0; i < 6; i++) marks += `<path d="M${x0 + 60 + i * 20},${cy - H * 0.75} l-6 ${H * 1.4}" stroke="${k.b}" stroke-opacity=".35" stroke-width="5"/>`;
  if (k.band) marks += `<path d="M${x0 + 40},${cy} C${x0 + 90},${cy - 8} ${xt - 40},${cy + 6} ${xt},${cy}" stroke="${k.b}" stroke-opacity=".55" stroke-width="7" fill="none"/>`;
  if (k.spots) for (let i = 0; i < 22; i++) marks += `<circle cx="${x0 + 45 + (i * 37) % 150}" cy="${cy - H * 0.55 + ((i * 23) % Math.round(H * 1.1))}" r="${2.5 + (i % 3)}" fill="${k.b}" fill-opacity=".45"/>`;
  return `<g class="glow">
    <path d="${dorsal}" fill="${k.fin}" fill-opacity=".85"/><path d="${ventral}" fill="${k.fin}" fill-opacity=".75"/>
    <path d="${outline}" fill="url(#${id}b)" stroke="#64748b" stroke-opacity=".65" stroke-width="1.4"/>
    <clipPath id="${id}c"><path d="${outline}"/></clipPath><g clip-path="url(#${id}c)">${marks}
      <path d="M${x0 + 30},${cy + H * 0.15} C${x0 + 90},${cy + H * 0.35} ${xt - 40},${cy + H * 0.2} ${xt},${cy + H * 0.1}" stroke="#fff" stroke-opacity=".5" fill="none"/></g>
    <path d="M${x0 + 38},${cy - H * 0.55} q10 ${H * 0.55} 0 ${H * 1.1}" stroke="${k.b}" stroke-opacity=".6" fill="none" stroke-width="1.6"/>
    <path d="${pect}" fill="${k.fin}" fill-opacity=".8"/>
    <circle cx="${x0 + 20}" cy="${cy - H * 0.18}" r="5.5" fill="#0f172a"/><circle cx="${x0 + 21.5}" cy="${cy - H * 0.22}" r="1.6" fill="#fff"/></g>`;
}
function shrimp(id: string): string {
  let seg = '';
  for (let i = 0; i < 6; i++) {
    const a = (-150 + i * 30) * Math.PI / 180, r = 62;
    const x = 160 + Math.cos(a) * r, y = 108 + Math.sin(a) * r * 0.75;
    seg += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${24 - i * 2}" ry="${19 - i * 1.6}" transform="rotate(${-60 + i * 30} ${x.toFixed(1)} ${y.toFixed(1)})" fill="url(#${id}b)" stroke="#fda4af" stroke-width="1.2"/>`;
  }
  return `<g class="glow glow-pink">
    <path d="M110 70 C 70 30, 40 34, 20 20 M112 74 C 80 50, 60 70, 24 66" stroke="#fecdd3" stroke-width="1.4" fill="none"/>
    ${seg}<path d="M206 150 l30 14 -6 -24z M206 150 l20 26 6 -20z" fill="#fb7185" fill-opacity=".85"/>
    <circle cx="116" cy="76" r="5" fill="#0f172a"/><path d="M120 120 l-10 22 M136 134 l-6 22 M152 142 l-2 22" stroke="#fda4af" stroke-width="1.4"/></g>`;
}

// ---------- 图表 ----------
export interface LineOpts { range: [number, number]; color: string; unit: string; label: string; height?: number; marks?: string[] }
export function lineChart(series: Point[], o: LineOpts): string {
  const W = 720, H = o.height ?? 220, pl = 44, pr = 12, pt = 14, pb = 26;
  if (!series.length) return '<p class="muted">暂无数据</p>';
  const values = series.map(p => p.value);
  const lo = Math.min(o.range[0], ...values), hi = Math.max(o.range[1], ...values);
  const pad = (hi - lo) * 0.12 || 1, y0 = lo - pad, y1 = hi + pad;
  const x = (i: number) => pl + (i / Math.max(1, series.length - 1)) * (W - pl - pr);
  const y = (v: number) => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${line}L${x(series.length - 1).toFixed(1)},${H - pb}L${pl},${H - pb}Z`;
  const gid = `lc${++artSeq}`;
  const ticks = [0, 1, 2, 3].map(t => y0 + (t / 3) * (y1 - y0));
  const months: string[] = [];
  series.forEach((p, i) => { if (p.day.endsWith('-01') || i === 0) months.push(`<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ct">${Number(p.day.slice(5, 7))}月</text>`); });
  const marks = series.map((p, i) => (o.marks?.includes(p.day) ? `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="5" class="cm"><title>${p.day} ${p.value}${o.unit}</title></circle>` : '')).join('');
  const min = Math.min(...values), max = Math.max(...values);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.label}曲线，${series[0]!.day} 至 ${series.at(-1)!.day}，最低 ${min}${o.unit}，最高 ${max}${o.unit}，适宜区间 ${o.range[0]}–${o.range[1]}${o.unit}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.color}" stop-opacity=".35"/><stop offset="1" stop-color="${o.color}" stop-opacity="0"/></linearGradient></defs>
    <rect x="${pl}" y="${y(o.range[1]).toFixed(1)}" width="${W - pl - pr}" height="${(y(o.range[0]) - y(o.range[1])).toFixed(1)}" class="cband"/>
    ${ticks.map(t => `<line x1="${pl}" x2="${W - pr}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="cg"/><text x="${pl - 6}" y="${(y(t) + 4).toFixed(1)}" class="ct" text-anchor="end">${t.toFixed(t < 2 ? 2 : 1)}</text>`).join('')}
    <path d="${area}" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="${o.color}" stroke-width="1.8" stroke-linejoin="round"/>
    ${marks}${months.join('')}</svg>`;
}
export function sparkline(values: number[], color: string): string {
  if (values.length < 2) return '';
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1) * 100).toFixed(1)},${(26 - ((v - lo) / span) * 22).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
export function ring(percent: number, color: string, label: string): string {
  const r = 34, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, percent));
  return `<svg class="ring" viewBox="0 0 84 84" role="img" aria-label="${label} ${p}%"><circle cx="42" cy="42" r="${r}" class="ring-bg"/>
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 42 42)"/>
    <text x="42" y="47" text-anchor="middle" class="ring-t">${p}<tspan class="ring-u">%</tspan></text></svg>`;
}
/** 区间条：起止日期在整个周期上的位置（饲料阶段甘特图）。 */
export function spanBar(start: number, end: number, total: number, color: string): string {
  const a = Math.max(0, start / total * 100), b = Math.min(100, end / total * 100);
  return `<svg class="span" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="3" width="100" height="4" rx="2" class="span-bg"/><rect x="${a.toFixed(2)}" y="1" width="${Math.max(1, b - a).toFixed(2)}" height="8" rx="3" fill="${color}"/></svg>`;
}
export function weekBars(values: number[], color: string, label: string): string {
  const max = Math.max(...values, 1), W = 320, H = 96, bw = W / values.length;
  return `<svg class="weeks" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}：${values.join('、')} kg">${values.map((v, i) => {
    const h = v / max * (H - 22);
    return `<rect x="${(i * bw + 5).toFixed(1)}" y="${(H - 16 - h).toFixed(1)}" width="${(bw - 10).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${color}" fill-opacity="${0.45 + 0.55 * v / max}"/><text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" class="ct">W${i + 1}</text>`;
  }).join('')}</svg>`;
}
/** 演示码：按批次号生成的装饰性方阵，不可扫描。 */
export function demoCode(code: string): string {
  let h = 0; for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const n = 21, cells: string[] = [];
  const finder = (r: number, c: number) => [[0, 0], [0, n - 7], [n - 7, 0]].some(([fr, fc]) => r >= fr! && r < fr! + 7 && c >= fc! && c < fc! + 7);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (finder(r, c)) continue;
    h = (h * 1103515245 + 12345) >>> 0;
    if ((h >>> 16) & 1) cells.push(`<rect x="${c}" y="${r}" width="1" height="1"/>`);
  }
  const f = (x: number, y: number) => `<rect x="${x + .5}" y="${y + .5}" width="6" height="6" fill="none" stroke="#183b2a"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
  return `<svg class="qr" viewBox="-1 -1 23 23" role="img" aria-label="批次 ${code} 演示码（示意，不可扫描）"><rect x="-1" y="-1" width="23" height="23" fill="#fff" rx="1"/><g fill="#183b2a">${cells.join('')}${f(0, 0)}${f(n - 7, 0)}${f(0, n - 7)}</g></svg>`;
}
/** 基地塘口分布示意图。 */
export function pondMap(list: readonly Pond[], selected: string, readings: Record<string, Reading>): string {
  const gid = `pm${++artSeq}`;
  return `<svg class="pondmap" viewBox="0 0 100 100" role="img" aria-label="塘口分布示意图，共 ${list.length} 口塘">
    <defs><pattern id="${gid}" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#15803d" stroke-opacity=".1" stroke-width=".3"/></pattern></defs>
    <rect width="100" height="100" fill="url(#${gid})"/>
    ${list.map(p => {
      const on = p.id === selected, r = readings[p.id];
      return `<g class="pm-pond pm-${p.status}${on ? ' pm-on' : ''}"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="3"/>
        <text x="${p.x + 3}" y="${p.y + 7}" class="pm-t">${p.id}</text>
        <text x="${p.x + 3}" y="${p.y + 13}" class="pm-s">${p.species}</text>
        ${r?.online ? `<circle cx="${p.x + p.w - 4}" cy="${p.y + 5}" r="1.4" class="pm-live"/>` : ''}</g>`;
    }).join('')}</svg>`;
}
