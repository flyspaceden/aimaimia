// 本地样例：测试、浏览器检查与本地预览共用的“真实数据文件”样子（数据契约 v1）。数值按公式确定性生成，均为样例。
export const SAMPLE_NOW = Date.UTC(2026, 10, 26, 6, 35, 0); // 北京时间 2026-11-26 14:35

const iso = ms => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const r2 = v => Math.round(v * 100) / 100;
const READINGS = [
  { key: 'r1', label: '溶解氧 · 1 号探头', metric_name: '溶解氧', unit: 'mg/L', base: 6.82, amp: 0.9 },
  { key: 'r2', label: '水温 · 1 号探头', metric_name: '水温', unit: '℃', base: 24.3, amp: 1.2 },
  { key: 'r3', label: 'pH · 1 号探头', metric_name: 'pH', unit: '', base: 7.92, amp: 0.12 },
  { key: 'r4', label: '氨氮 · 2 号探头', metric_name: '氨氮', unit: 'mg/L', base: 0.03, amp: 0.01 },
];
const RANGES = { '24h': [288, 300_000], '7d': [168, 3_600_000], '30d': [180, 14_400_000] };

export function sampleIndex(now = Date.now()) {
  const generated = Math.floor(now / 1000) * 1000;
  return {
    schema: 1, generated_at: iso(generated), company: { name: '华海农科' },
    bases: [{
      code: 'yx', name: '阳江永兴基地', province: '广东省', city: '阳江市', district: '', address: '样例地址（本地预览）',
      lat: 21.75, lng: 111.85,
      ponds: [{
        code: 'yx-00', name: '永兴 0 号塘', area_value: 5, area_unit: '亩',
        readings: [
          ...READINGS.map(r => ({ key: r.key, label: r.label, metric_name: r.metric_name, unit: r.unit, value: r.base, observed_at: iso(generated - 60_000) })),
          { key: 'r5', label: '盐度 · 2 号探头', metric_name: '盐度', unit: '‰', value: null, observed_at: null },
        ],
      }],
    }],
  };
}

export function samplePond(now = Date.now()) {
  const generated = Math.floor(now / 1000) * 1000;
  const series = {};
  for (const [range, [count, bucket]] of Object.entries(RANGES)) {
    const until = generated - (generated % bucket);
    series[range] = READINGS.map((r, k) => ({
      key: r.key,
      points: Array.from({ length: count }, (_, i) => {
        const t = until - (count - 1 - i) * bucket;
        const phase = (t / 86_400_000) * Math.PI * 2 + k;
        return [t, r2(r.base + r.amp * (0.6 * Math.sin(phase) + 0.25 * Math.sin(phase * 3.1)))];
      }),
    }));
  }
  return { schema: 1, generated_at: iso(generated), pond: 'yx-00', series };
}
