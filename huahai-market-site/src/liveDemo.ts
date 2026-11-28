/**
 * 真实塘口页上的演示读数：氨氮、亚硝酸盐目前没有探头，先用确定性生成的数值展示（同一时刻所有访客看到的一样）。
 * 一旦数据文件里出现同类真实读数，对应的演示项自动不再显示。纯函数，不碰 DOM。
 */
import { liveRanges, type LivePond, type LiveRange } from './live.js';

export interface DemoReading { key: string; label: string; unit: string; base: number; day: number; week: number; noise: number; real: RegExp }
export const DEMO_READINGS: readonly DemoReading[] = [
  { key: 'd1', label: '氨氮', unit: 'mg/L', base: 0.18, day: 0.05, week: 0.02, noise: 0.01, real: /氨氮|nh3|nh4/i },
  { key: 'd2', label: '亚硝酸盐', unit: 'mg/L', base: 0.04, day: 0.012, week: 0.005, noise: 0.003, real: /亚硝酸|no2/i },
];
const STEP = 300_000, DAY = 86_400_000, WEEK = 7 * DAY;

/** 这口塘还缺哪些演示项（已有同类真实读数的不再演示）。 */
export const demoReadingsFor = (pond: LivePond) =>
  DEMO_READINGS.filter(d => !pond.readings.some(r => d.real.test(r.label) || d.real.test(r.metric_name)));

function noise(key: string, bucket: number): number {
  let h = 2166136261;
  for (const c of `${key}:${bucket}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) / 4294967296) * 2 - 1;
}
/** 某一时刻的演示值（按 5 分钟取整），保留 3 位小数，不会小于 0。 */
export function demoValue(d: DemoReading, ms: number): number {
  const t = Math.floor(ms / STEP) * STEP;
  const v = d.base + d.day * Math.sin((2 * Math.PI * t) / DAY - 1) + d.week * Math.sin((2 * Math.PI * t) / WEEK) + d.noise * noise(d.key, t / STEP);
  return Math.max(0, Math.round(v * 1000) / 1000);
}
/** 某个时间范围的演示曲线，间隔与真实曲线的桶宽一致。 */
export function demoSeries(d: DemoReading, range: LiveRange, to: number): [number, number][] {
  const { spanMs, bucketMs } = liveRanges.find(x => x.id === range)!;
  const end = Math.floor(to / bucketMs) * bucketMs, points: [number, number][] = [];
  for (let t = end - spanMs + bucketMs; t <= end; t += bucketMs) points.push([t, demoValue(d, t)]);
  return points;
}
