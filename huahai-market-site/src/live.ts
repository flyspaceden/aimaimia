/**
 * 真实数据文件（/live/v1/，数据契约 v1）的解析、过期判断与文字格式。纯函数，不碰 DOM。
 * 解析时逐键取值、重新组装，违反契约任何一条即整份作废（返回 null），多出来的键一律丢弃。
 */
export type LiveRange = '24h' | '7d' | '30d';
export const liveRanges: readonly { id: LiveRange; label: string; spanMs: number; bucketMs: number }[] = [
  { id: '24h', label: '24小时', spanMs: 86_400_000, bucketMs: 300_000 },
  { id: '7d', label: '7天', spanMs: 604_800_000, bucketMs: 3_600_000 },
  { id: '30d', label: '30天', spanMs: 2_592_000_000, bucketMs: 14_400_000 },
];
const MAX_POINTS: Record<LiveRange, number> = { '24h': 300, '7d': 200, '30d': 200 };
export const READING_STALE_MS = 1_800_000;
export const FEED_STALE_MS = 900_000;

export interface LiveReading { key: string; label: string; metric_name: string; unit: string; value: number | null; observed_at: string | null }
export interface LivePond { code: string; name: string; area_value: number | null; area_unit: string; readings: LiveReading[] }
export interface LiveBase { code: string; name: string; province: string; city: string; district: string; address: string; lat: number | null; lng: number | null; ponds: LivePond[] }
export interface LiveIndex { schema: 1; generated_at: string; company: { name: string }; bases: LiveBase[] }
export interface LiveSeries { key: string; points: [number, number][] }
export interface LivePondFile { schema: 1; generated_at: string; pond: string; series: Record<LiveRange, LiveSeries[]> }
export type LiveFeed = { status: 'loading' } | { status: 'unavailable' } | { status: 'ok'; index: LiveIndex };
export type PondCurves = { status: 'loading' } | { status: 'missing' } | { status: 'ok'; file: LivePondFile };

export const isBaseCode = (v: string) => /^[a-z0-9]{1,12}$/.test(v);
export const isPondCode = (v: string) => /^[a-z0-9]{1,12}-[a-z0-9]{1,12}$/.test(v);

class Bad extends Error {}
const fail = (): never => { throw new Bad(); };
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : fail());
const arr = (v: unknown, min: number, max: number): unknown[] => (Array.isArray(v) && v.length >= min && v.length <= max ? v : fail());
const str = (v: unknown, min: number, max: number): string => (typeof v === 'string' && [...v].length >= min && [...v].length <= max ? v : fail());
const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail());
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const time = (v: unknown): string => (typeof v === 'string' && ISO.test(v) && Number.isFinite(Date.parse(v)) ? v : fail());
const code = (v: unknown, test: (s: string) => boolean): string => (typeof v === 'string' && test(v) ? v : fail());
const coord = (v: unknown, limit: number): number | null => (v === null ? null : Math.abs(finite(v)) <= limit ? v as number : fail());

function reading(raw: unknown): LiveReading {
  const r = obj(raw);
  const value = r.value === null ? null : finite(r.value);
  const observed = r.observed_at === null ? null : time(r.observed_at);
  if ((value === null) !== (observed === null)) fail();
  return {
    key: code(r.key, s => /^r[0-9]{1,3}$/.test(s)), label: str(r.label, 1, 40), metric_name: str(r.metric_name, 1, 20),
    unit: str(r.unit, 0, 12), value, observed_at: observed,
  };
}
function pond(raw: unknown): LivePond {
  const p = obj(raw);
  const readings = arr(p.readings, 0, 24).map(reading);
  if (new Set(readings.map(r => r.key)).size !== readings.length) fail();
  const area = p.area_value === null ? null : finite(p.area_value) > 0 ? p.area_value as number : fail();
  return { code: code(p.code, isPondCode), name: str(p.name, 1, 60), area_value: area, area_unit: str(p.area_unit, 0, 10), readings };
}
function base(raw: unknown): LiveBase {
  const b = obj(raw);
  return {
    code: code(b.code, isBaseCode), name: str(b.name, 1, 60), province: str(b.province, 0, 30), city: str(b.city, 0, 30),
    district: str(b.district, 0, 30), address: str(b.address, 0, 120), lat: coord(b.lat, 90), lng: coord(b.lng, 180),
    ponds: arr(b.ponds, 1, 50).map(pond),
  };
}

export function parseIndex(raw: unknown): LiveIndex | null {
  try {
    const r = obj(raw);
    if (r.schema !== 1) fail();
    const bases = arr(r.bases, 0, 20).map(base);
    const codes = bases.flatMap(b => b.ponds.map(p => p.code));
    if (new Set(codes).size !== codes.length || new Set(bases.map(b => b.code)).size !== bases.length) fail();
    return { schema: 1, generated_at: time(r.generated_at), company: { name: str(obj(r.company).name, 1, 60) }, bases };
  } catch (e) {
    if (e instanceof Bad) return null;
    throw e;
  }
}

export function parsePondFile(raw: unknown, pondCode: string): LivePondFile | null {
  try {
    const r = obj(raw);
    if (r.schema !== 1 || r.pond !== pondCode || !isPondCode(pondCode)) fail();
    const s = obj(r.series);
    if (Object.keys(s).length !== 3) fail();
    const series = {} as Record<LiveRange, LiveSeries[]>;
    for (const { id } of liveRanges) {
      const list = arr(s[id], 0, 24).map(item => {
        const it = obj(item);
        let last = -Infinity;
        const points = arr(it.points, 0, MAX_POINTS[id]).map(p => {
          const [t, v] = arr(p, 2, 2);
          if (!Number.isInteger(t) || (t as number) <= last) fail();
          last = t as number;
          return [t as number, finite(v)] as [number, number];
        });
        return { key: code(it.key, x => /^r[0-9]{1,3}$/.test(x)), points };
      });
      if (new Set(list.map(x => x.key)).size !== list.length) fail();
      series[id] = list;
    }
    return { schema: 1, generated_at: time(r.generated_at), pond: pondCode, series };
  } catch (e) {
    if (e instanceof Bad) return null;
    throw e;
  }
}

export const findLiveBase = (index: LiveIndex, baseCode: string) => index.bases.find(b => b.code === baseCode);
export function findLivePond(index: LiveIndex, pondCode: string): { base: LiveBase; pond: LivePond } | undefined {
  for (const b of index.bases) { const p = b.ponds.find(x => x.code === pondCode); if (p) return { base: b, pond: p }; }
  return undefined;
}
/** 首页用的塘：按顺序第一口至少有一项读数不为空的塘。 */
export function featuredPond(index: LiveIndex): { base: LiveBase; pond: LivePond } | undefined {
  for (const b of index.bases) for (const p of b.ponds) if (p.readings.some(r => r.value !== null)) return { base: b, pond: p };
  return undefined;
}

/** 服务器时钟比访客快时差值为负，按“没过期”处理。 */
export const isFeedStale = (index: Pick<LiveIndex, 'generated_at'>, now: number) => now - Date.parse(index.generated_at) > FEED_STALE_MS;
export function readingState(r: LiveReading, now: number): 'none' | 'stale' | 'fresh' {
  if (r.value === null || r.observed_at === null) return 'none';
  return now - Date.parse(r.observed_at) > READING_STALE_MS ? 'stale' : 'fresh';
}

export function ageText(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(ms / 3_600_000);
  if (h < 48) return `${h} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}

const beijing = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function parts(ms: number): Record<string, string> {
  return Object.fromEntries(beijing.formatToParts(ms).map(p => [p.type, p.value]));
}
/** 北京时间；与 now 同一天 “HH:MM”，否则 “MM-DD HH:MM”。 */
export function stamp(iso: string, now: number): string {
  const a = parts(Date.parse(iso)), b = parts(now);
  const hm = `${a.hour}:${a.minute}`;
  return a.year === b.year && a.month === b.month && a.day === b.day ? hm : `${a.month}-${a.day} ${hm}`;
}
export function beijingDate(ms: number): string { const a = parts(ms); return `${a.month}-${a.day}`; }
export function beijingTime(ms: number): string { const a = parts(ms); return `${a.hour}:${a.minute}`; }

export function valueText(v: number): string {
  const a = Math.abs(v);
  return a >= 100 ? String(Math.round(v)) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}
