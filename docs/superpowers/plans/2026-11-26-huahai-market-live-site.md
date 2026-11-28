# 华海 AI 农贸市场 · 真实养殖环境数据接入（网站与官网服务器侧）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 农贸市场网站读取本站 `/live/v1/` 下的公开数据文件，显示已公开塘口的真实水质读数和 24 小时 / 7 天 / 30 天曲线；官网服务器上有一个取回脚本负责把这些文件从物联网服务器搬过来。

**Architecture:** 网站仍是无框架静态站。新增一个纯函数模块解析并校验数据文件，页面片段函数只拼字符串，`app.ts` 负责取数、定时刷新和局部重绘。官网服务器上的取回脚本是独立的 Python 标准库脚本，校验通过才原子替换文件；nginx 用一个只认两种文件名的 location 对外提供。物联网侧的导出任务在另一份计划里（`2026-11-26-huahai-market-live-iot-export.md`），两边只通过下面的“数据契约”对接，本计划用样例文件独立开发和验证。

**Tech Stack:** TypeScript 5.9.2、原生 DOM、CSS、node:test、Playwright（仓库 `tests/node_modules` 里的 1.59.1，仅浏览器检查用）；Python 3 标准库（取回脚本，语法不得高于 3.6）、systemd timer、nginx。

**Spec:** `docs/superpowers/specs/2026-11-26-huahai-market-live-environment-design.md`

## Global Constraints

- 工作目录：`huahai-market-site/`。不新增任何 npm 依赖，不引入外部字体、脚本、图片。
- 安全策略只放宽一处：`connect-src 'none'` → `connect-src 'self'`，`public/index.html` 和 `deploy/market.huahainongke.com.conf` 两处一致。其余指令不动。因此**禁止 HTML `style=""` 属性**，样式只写在 `public/assets/style.css`。
- 数据文件里的所有文字（名称、标签、单位、地址）一律经 `esc()` 输出。
- 沿用现有浅色样式和内联 SVG；写页面代码前先调用 `/ui-ux-pro-max`（项目规定）。
- 真实内容标“实时数据”，演示内容标“演示”。数据过期时不得显示“实时数据”标识。
- 不显示：适宜区间、越线标记、预警、养殖事件、员工姓名、设备序列号、内部编号。
- 时间一律按北京时间（`Asia/Shanghai`）显示，不随访客所在时区变。
- 过期界限：单项读数 30 分钟；整份数据 15 分钟。页面可见时每 60 秒刷新一次。
- 375 / 768 / 1024 / 1440 宽度无横向溢出；`prefers-reduced-motion` 下不加新动画。
- 演示页面（商品、溯源档案、B 端、演示基地）行为不变，现有测试全部照常通过。
- 不推送、不部署。服务器上的动作（Task 6 的安装步骤）只写进文档，执行前要用户放行。

### 数据契约 v1（两份计划共用，改动必须两边同步）

`live/v1/index.json`（上限 256 KB）

| 键 | 类型与约束 |
|---|---|
| `schema` | 整数 `1` |
| `generated_at` | UTC 时间，格式 `YYYY-MM-DDTHH:MM:SSZ` |
| `company.name` | 字符串，1–60 字 |
| `bases[]` | 0–20 项 |
| `bases[].code` | `^[a-z0-9]{1,12}$` |
| `bases[].name` | 1–60 字 |
| `bases[].province` / `city` / `district` | 0–30 字，可为 `""` |
| `bases[].address` | 0–120 字，可为 `""` |
| `bases[].lat` / `lng` | 数字或 `null`；纬度 −90..90，经度 −180..180 |
| `bases[].ponds[]` | 1–50 项 |
| `ponds[].code` | `^[a-z0-9]{1,12}-[a-z0-9]{1,12}$`，全站唯一 |
| `ponds[].name` | 1–60 字 |
| `ponds[].area_value` | 大于 0 的数字或 `null` |
| `ponds[].area_unit` | 0–10 字 |
| `ponds[].readings[]` | 0–24 项 |
| `readings[].key` | `^r[0-9]{1,3}$`，塘内唯一 |
| `readings[].label` | 1–40 字（公开标签） |
| `readings[].metric_name` | 1–20 字 |
| `readings[].unit` | 0–12 字 |
| `readings[].value` | 有限数字或 `null` |
| `readings[].observed_at` | UTC 时间或 `null`；`value` 为 `null` 时它也必须是 `null`，反之亦然 |

`live/v1/pond-<塘代号>.json`（上限 1 MB）

| 键 | 类型与约束 |
|---|---|
| `schema` | 整数 `1` |
| `generated_at` | 同上 |
| `pond` | 等于文件名里的塘代号 |
| `series` | 恰好三个键：`24h`、`7d`、`30d` |
| `series.<范围>[]` | 每项 `{ "key": 读数 key, "points": [[毫秒时间戳, 数值], …] }`；key 不重复；没有点的读数可以不出现 |
| `points` | 时间严格递增，时间为整数、数值为有限数字；上限 24h 300 点、7d 200 点、30d 200 点 |

分段粒度：24h 每 5 分钟一点，7d 每 1 小时一点，30d 每 4 小时一点。除上表外不得出现其他键。

## Review Focus

1. 数据文件里的文字带 HTML（标签写成 `<img onerror=…>`）→ 按纯文字显示，不执行。测试在 Task 3。
2. 两台服务器时钟不一致，`generated_at` 比访客电脑的时间还晚 → 不算过期，显示“刚刚”，不出现负数。测试在 Task 1。
3. 曲线只有 0 / 1 个点、全程同一个值、中间断了几小时 → 不出 `NaN`，断档处线断开，不足 2 点显示“曲线准备中”。测试在 Task 2。
4. 请求很慢或还没回来用户就点去别的页面；上一次刷新没结束下一次又到点 → 不报错、不把别的页面内容换掉、不重复并发请求。测试在 Task 5。
5. 一口塘被取消公开：访客正停在它的页面上，或拿着旧链接来 → 显示“没有找到这口塘”；官网服务器上它的曲线文件被删掉。测试在 Task 3、Task 6。

---

### Task 1: 数据解析、过期判断与样例

**Files:**
- Create: `huahai-market-site/src/live.ts`
- Create: `huahai-market-site/scripts/live-sample.mjs`
- Create: `huahai-market-site/tests/fixtures/live-v1/index.json`、`pond-yx-00.json`
- Test: `huahai-market-site/tests/live.test.mjs`

**Interfaces:**
- Produces（`src/live.ts`，纯函数，不碰 DOM）：

```ts
export type LiveRange = '24h' | '7d' | '30d';
export const liveRanges: readonly { id: LiveRange; label: string; spanMs: number; bucketMs: number }[];
// 24h→'24小时' 86_400_000 / 300_000；7d→'7天' 604_800_000 / 3_600_000；30d→'30天' 2_592_000_000 / 14_400_000
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

export const isBaseCode: (v: string) => boolean;
export const isPondCode: (v: string) => boolean;
export function parseIndex(raw: unknown): LiveIndex | null;          // 违反契约任何一条 → null；多出来的键丢弃
export function parsePondFile(raw: unknown, code: string): LivePondFile | null;
export function findLiveBase(index: LiveIndex, code: string): LiveBase | undefined;
export function findLivePond(index: LiveIndex, code: string): { base: LiveBase; pond: LivePond } | undefined;
export function featuredPond(index: LiveIndex): { base: LiveBase; pond: LivePond } | undefined; // 按顺序第一口至少有一项读数不为空的塘
export function isFeedStale(index: Pick<LiveIndex, 'generated_at'>, now: number): boolean;      // now − generated_at > FEED_STALE_MS
export function readingState(r: LiveReading, now: number): 'none' | 'stale' | 'fresh';
export function ageText(ms: number): string;      // <1 分钟 '刚刚'；<60 分钟 'N 分钟前'；<48 小时 'N 小时前'；否则 'N 天前'（向下取整）
export function stamp(iso: string, now: number): string; // 北京时间；与 now 同一天 'HH:MM'，否则 'MM-DD HH:MM'
export function valueText(v: number): string;     // |v|≥100 取整；≥10 一位小数；否则两位小数
```

- Produces（`scripts/live-sample.mjs`，测试、本地预览共用）：

```js
export const SAMPLE_NOW = Date.UTC(2026, 10, 26, 6, 35, 0);   // 北京时间 2026-11-26 14:35
export function sampleIndex(now = Date.now());  // generated_at = now 取整到秒；公司“华海农科”；基地 yx“阳江永兴基地”；塘 yx-00“永兴 0 号塘” 5 亩
// 读数 r1 溶解氧 6.82 mg/L、r2 水温 24.3 ℃、r3 pH 7.92（单位 ""）、r4 氨氮 0.03 mg/L，observed_at = now − 60 秒；r5 盐度 ‰ 无读数（value/observed_at 均为 null）
export function samplePond(now = Date.now());   // r1–r4 三个范围各自满点（288 / 168 / 180），按公式确定性生成，不用 Math.random；r5 不出现
```

- [ ] **Step 1: 写失败的测试** `tests/live.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIndex, parsePondFile, isPondCode, isBaseCode, findLivePond, findLiveBase, featuredPond, isFeedStale, readingState, ageText, stamp, valueText, liveRanges } from '../dist/assets/live.js';
import { SAMPLE_NOW, sampleIndex, samplePond } from '../scripts/live-sample.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/live-v1/${name}`, import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
const reading = idx => idx.bases[0].ponds[0].readings[0];

test('提交的样例文件与样例生成函数一致', () => {
  assert.deepEqual(fixture('index.json'), sampleIndex(SAMPLE_NOW));
  assert.deepEqual(fixture('pond-yx-00.json'), samplePond(SAMPLE_NOW));
});
test('解析：样例通过，多余的键被丢弃', () => {
  const raw = sampleIndex(SAMPLE_NOW); raw.secret = 'x'; reading(raw).device_sn = 'SN1'; raw.bases[0].manager = '张三';
  const idx = parseIndex(raw);
  assert.equal(idx.bases[0].ponds[0].code, 'yx-00');
  assert.equal(/SN1|张三|secret/.test(JSON.stringify(idx)), false);
  assert.deepEqual(parseIndex(sampleIndex(SAMPLE_NOW)), sampleIndex(SAMPLE_NOW));
  assert.deepEqual(parseIndex({ ...sampleIndex(SAMPLE_NOW), bases: [] }).bases, []);
});
test('解析：违反契约一律返回 null', () => {
  const mutate = fn => { const raw = sampleIndex(SAMPLE_NOW); fn(raw); return raw; };
  const bad = [null, [], 'x', {}, mutate(r => { r.schema = 2; }), mutate(r => { r.generated_at = 'yesterday'; }),
    mutate(r => { r.generated_at = '2026-11-26 14:35'; }), mutate(r => { r.company = {}; }),
    mutate(r => { r.bases[0].code = 'YX'; }), mutate(r => { r.bases[0].ponds[0].code = 'yx_00'; }), mutate(r => { r.bases[0].ponds = []; }),
    mutate(r => { r.bases.push(clone(r.bases[0])); }),                       // 塘代号重复
    mutate(r => { r.bases[0].lat = 91; }), mutate(r => { r.bases[0].ponds[0].area_value = 0; }),
    mutate(r => { reading(r).value = '6.8'; }), mutate(r => { reading(r).value = null; }), // 有时间没数值
    mutate(r => { reading(r).observed_at = null; }), mutate(r => { reading(r).label = 5; }), mutate(r => { reading(r).label = ''; }),
    mutate(r => { reading(r).key = 'do'; }), mutate(r => { r.bases[0].ponds[0].readings[1].key = 'r1'; }),
    mutate(r => { r.bases[0].ponds[0].readings = Array.from({ length: 25 }, (_, i) => ({ ...reading(r), key: `r${i}` })); }),
    mutate(r => { reading(r).label = 'x'.repeat(41); })];
  for (const raw of bad) assert.equal(parseIndex(raw), null, JSON.stringify(raw)?.slice(0, 80));
  assert.equal(parseIndex(JSON.parse('{"schema":1,"generated_at":"2026-11-26T06:35:00Z","company":{"name":"a"},"bases":[{"code":"yx","name":"b","province":"","city":"","district":"","address":"","lat":1e999,"lng":0,"ponds":[]}]}')), null);
});
test('曲线文件解析', () => {
  const ok = parsePondFile(samplePond(SAMPLE_NOW), 'yx-00');
  assert.deepEqual([ok.series['24h'][0].points.length, ok.series['7d'][0].points.length, ok.series['30d'][0].points.length], [288, 168, 180]);
  const mutate = fn => { const raw = samplePond(SAMPLE_NOW); fn(raw); return raw; };
  assert.equal(parsePondFile(samplePond(SAMPLE_NOW), 'yx-01'), null);
  for (const raw of [mutate(r => { delete r.series['7d']; }), mutate(r => { r.series['1y'] = []; }),
    mutate(r => { r.series['24h'][0].points[3] = [1]; }), mutate(r => { r.series['24h'][0].points[3][1] = null; }),
    mutate(r => { r.series['24h'][0].points[3][0] = r.series['24h'][0].points[2][0]; }),   // 时间不递增
    mutate(r => { const p = r.series['7d'][0].points; r.series['7d'][0].points = [...p, ...p.map(([t, v]) => [t + 1e12, v])]; }), // 超过 200 点
    mutate(r => { r.series['24h'].push(clone(r.series['24h'][0])); })])
    assert.equal(parsePondFile(raw, 'yx-00'), null);
  assert.deepEqual(parsePondFile(mutate(r => { r.series = { '24h': [], '7d': [], '30d': [] }; }), 'yx-00').series['24h'], []);
});
test('过期判断：整份 15 分钟、单项 30 分钟，服务器时钟偏快不算过期', () => {
  const idx = sampleIndex(SAMPLE_NOW), [r1, , , , r5] = idx.bases[0].ponds[0].readings;
  assert.equal(isFeedStale(idx, SAMPLE_NOW + 900_000), false);
  assert.equal(isFeedStale(idx, SAMPLE_NOW + 900_001), true);
  assert.equal(isFeedStale(idx, SAMPLE_NOW - 3_600_000), false);
  assert.equal(readingState(r1, SAMPLE_NOW), 'fresh');
  assert.equal(readingState(r1, Date.parse(r1.observed_at) + 1_800_001), 'stale');
  assert.equal(readingState(r1, SAMPLE_NOW - 3_600_000), 'fresh');
  assert.equal(readingState(r5, SAMPLE_NOW), 'none');
});
test('时间与数值文字', () => {
  assert.deepEqual([ageText(-5), ageText(59_000), ageText(35 * 60_000), ageText(2 * 3_600_000 + 1), ageText(49 * 3_600_000)], ['刚刚', '刚刚', '35 分钟前', '2 小时前', '2 天前']);
  assert.equal(stamp('2026-11-26T06:35:00Z', SAMPLE_NOW), '14:35');
  assert.equal(stamp('2026-11-25T16:05:00Z', SAMPLE_NOW), '00:05');          // 北京时间已是 26 日
  assert.equal(stamp('2026-11-25T06:35:00Z', SAMPLE_NOW), '11-25 14:35');
  assert.deepEqual([valueText(6.816), valueText(24.31), valueText(35210.4), valueText(0.031), valueText(-3.14159)], ['6.82', '24.3', '35210', '0.03', '-3.14']);
  assert.deepEqual(liveRanges.map(r => [r.id, r.label, r.spanMs / r.bucketMs]), [['24h', '24小时', 288], ['7d', '7天', 168], ['30d', '30天', 180]]);
});
test('查找与首页用哪口塘', () => {
  const idx = parseIndex(sampleIndex(SAMPLE_NOW));
  assert.equal(findLivePond(idx, 'yx-00').base.code, 'yx');
  assert.equal(findLivePond(idx, 'yx-99'), undefined);
  assert.equal(findLiveBase(idx, 'yx').name, '阳江永兴基地');
  assert.equal(featuredPond(idx).pond.code, 'yx-00');
  const empty = clone(idx); for (const r of empty.bases[0].ponds[0].readings) { r.value = null; r.observed_at = null; }
  assert.equal(featuredPond(empty), undefined);
  assert.deepEqual([isPondCode('yx-00'), isPondCode('yx'), isPondCode('../x'), isBaseCode('yx'), isBaseCode('Y X')], [true, false, false, true, false]);
});
```

- [ ] **Step 2: 运行确认失败** — `cd huahai-market-site && npm test`，预期：找不到 `dist/assets/live.js`。
- [ ] **Step 3: 写 `scripts/live-sample.mjs`，并用它生成两份样例文件**（`JSON.stringify(sampleIndex(SAMPLE_NOW), null, 2)`）。
- [ ] **Step 4: 实现 `src/live.ts`**。解析时逐键取值、重新组装对象，不透传原对象；时间格式用正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` 加 `Date.parse` 双重判断；`stamp` 用 `Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', … })` 的 `formatToParts`。
- [ ] **Step 5: 运行确认通过** — `npm test`，预期全部通过（含原有 7 组）。
- [ ] **Step 6: 提交** — `git add huahai-market-site/src/live.ts huahai-market-site/scripts/live-sample.mjs huahai-market-site/tests/live.test.mjs huahai-market-site/tests/fixtures && git commit -m "feat(market): 真实数据文件的解析、过期判断与样例"`

### Task 2: 时间曲线图

**Files:**
- Modify: `huahai-market-site/src/svg.ts`（在 `lineChart` 之后新增）
- Test: `huahai-market-site/tests/live.test.mjs`（追加）

**Interfaces:**
- Produces：

```ts
export interface TimeChartOpts { from: number; to: number; gapMs: number; color: string; unit: string; label: string; xLabel: (ms: number) => string; height?: number }
export function timeChart(points: readonly (readonly [number, number])[], o: TimeChartOpts): string;
```

  只画落在 `[from, to]` 内的点；不足 2 点返回 `<p class="muted chart-empty">曲线准备中</p>`。横轴按时间在 `[from, to]` 上定位（不是按序号）；相邻两点间隔大于 `gapMs` 时另起一段。纵轴取最小–最大值上下各留 12%，全程同值时上下各留 1。输出 `<svg class="chart chart-time" viewBox="0 0 720 H" role="img" aria-label="…">`，折线是**一个** `<path class="cl" d="…">`，最后一点画 `<circle class="cm">`，横轴标起点、中点、终点三个 `xLabel`。`aria-label` 为 `${label}曲线，${xLabel(from)} 至 ${xLabel(to)}，最低 ${min}${unit}，最高 ${max}${unit}，最新 ${last}${unit}`，其中 `label`、`unit` 先转义。不画适宜区间带。

- [ ] **Step 1: 写失败的测试**（追加到 `tests/live.test.mjs`，并在文件顶部加 `import { timeChart } from '../dist/assets/svg.js';`）

```js
test('时间曲线：断档处断开、平线和单点不出 NaN、标签转义、无内联样式', () => {
  const t0 = SAMPLE_NOW - 86_400_000;
  const o = { from: t0, to: SAMPLE_NOW, gapMs: 750_000, color: '#0e7490', unit: 'mg/L', label: '溶解氧 <1>"', xLabel: ms => String(ms - t0) };
  const svg = timeChart([[t0, 5], [t0 + 300_000, 5], [t0 + 3_600_000, 5], [t0 + 3_900_000, 5]], o);
  const d = svg.match(/class="cl" d="([^"]+)"/)[1];
  assert.equal(d.split('M').length - 1, 2);
  assert.equal(/NaN|Infinity|style=/.test(svg), false);
  assert.equal(svg.includes('<1>'), false);
  assert.match(svg, /最低 5mg\/L，最高 5mg\/L，最新 5mg\/L/);
  assert.match(timeChart([[t0 + 1, 5]], o), /曲线准备中/);
  assert.match(timeChart([], o), /曲线准备中/);
  assert.match(timeChart([[t0 - 9e9, 1], [t0 - 8e9, 2]], o), /曲线准备中/);   // 都在窗口之外
  const real = timeChart(samplePond(SAMPLE_NOW).series['24h'][0].points, { ...o, label: '溶解氧' });
  assert.equal(real.match(/class="cl" d="([^"]+)"/)[1].split('M').length - 1, 1);
});
```

- [ ] **Step 2: 运行确认失败** — `npm test`，预期：`timeChart` 不是函数。
- [ ] **Step 3: 实现 `timeChart`**，复用 `lineChart` 的画布尺寸、`.cg` 网格线和 `.ct` 刻度文字类。
- [ ] **Step 4: 运行确认通过** — `npm test`。
- [ ] **Step 5: 提交** — `git commit -am "feat(market): 按时间定位、断档断线的曲线图"`

### Task 3: 页面片段与样式

**Files:**
- Create: `huahai-market-site/src/pages/live.ts`
- Modify: `huahai-market-site/src/pages/bases.ts`（`basesPage` 改签名，新增 `basesGrid`）
- Modify: `huahai-market-site/src/pages/home.ts`（拆出 `demoHeroPanel`，`homePage` 改签名，底部演示基地卡片加“演示”标识）
- Modify: `huahai-market-site/public/assets/style.css`
- Test: `huahai-market-site/tests/live-pages.test.mjs`

**Interfaces:**
- Consumes：Task 1 的类型与函数；Task 2 的 `timeChart`；现有 `esc`、`href`、`pageHead`、`empty`、`demoTag`、`icon`。
- Produces（都只拼字符串，`now` 由调用方传入）：

```ts
// src/pages/live.ts
export function liveTag(stale: boolean): string;   // 未过期 <span class="tag tag-ok">实时数据</span>；过期 <span class="tag tag-warn">数据中断</span>
export function homeLivePanel(feed: LiveFeed, now: number): string | null; // feed 不是 ok 或 featuredPond 为空 → null
export function liveBaseCards(feed: LiveFeed, now: number): string;        // feed 不是 ok → ''
export function liveBasePage(code: string, feed: LiveFeed, now: number): string;
export function livePondPage(code: string, feed: LiveFeed, curves: PondCurves, range: LiveRange, now: number): string;
export function liveTitle(name: 'live' | 'pond', id: string, feed: LiveFeed): string | undefined; // 基地名 / 塘名，供 document.title 用
// src/pages/bases.ts
export function basesGrid(feed: LiveFeed, now: number): string;  // <div class="base-grid base-grid-lg" data-live-slot="bases">真实卡片在前 + 演示卡片</div>
export function basesPage(grid: string): string;                 // 标题固定为“华海农科养殖基地”，不再写基地个数
// src/pages/home.ts
export function demoHeroPanel(): string;                         // 现在的“平台实时数据（演示）”面板原样拆出
export function homePage(heroPanel: string): string;
```

- 可被局部重绘的片段，根元素都带 `data-live-slot`：首页面板（真实面板和 `demoHeroPanel()` 都是）`="home"`；`basesGrid` `="bases"`；`liveBasePage` 和 `livePondPage` 的整页内容包在 `<div data-live-slot="page">` 里。
- 固定的钩子：范围按钮 `<button class="seg-i" data-range="24h|7d|30d" aria-pressed>`；读数格 `<div class="rd live-rd" data-reading="<key>">`，过期时加类 `rd-stale`；整份过期提示 `<div class="notice notice-warn live-banner" role="status">`；每页 `<h1 tabindex="-1" data-heading>`。
- 固定文案（原样使用）：

| 场合 | 文案 |
|---|---|
| 整份过期提示 | `实时数据暂时中断，以下为 ${stamp(generated_at, now)} 的数据` |
| 更新时间 | `更新于 ${stamp(generated_at, now)}` |
| 读数过期 | `${ageText(now − observed_at)}的读数`（如“2 小时前的读数”） |
| 读数为空 | 数值处显示 `—`，时间处显示 `暂无读数` |
| 取不到 | 标题 `实时数据暂时取不到`，说明 `请稍后再来。演示内容不受影响。`，按钮 `返回产地基地` |
| 载入中 | `正在载入实时数据…` |
| 塘不存在 | 标题 `没有找到这口塘`，说明 `链接可能有误，或这口塘已不再公开。`，按钮 `查看全部基地` |
| 基地不存在 | 标题 `没有找到这个基地`，说明同上句式，按钮 `查看全部基地` |
| 曲线 | 载入中 `正在载入曲线…`；没有 `曲线准备中` |
| 来源说明 | `数据来源：物联网探头自动采集，约每 5 分钟更新一次` |

- 页面内容：
  - **首页面板**：`${塘名} · 实时水质` + `liveTag`，前 4 项有数值的读数（数值、单位、公开标签），一行 `${基地名}` 与更新时间，链接到 `#pond/<代号>`，链接文字 `查看全部读数与曲线`。整份过期时不显示跳动圆点。
  - **真实基地卡片**（列表里）：基地名 + `liveTag`，省市区，`${塘数} 口公开塘`，链接到 `#live/<代号>`。
  - **真实基地页**：面包屑（首页 / 产地基地 / 基地名），公司名、地址、坐标（`北纬 x.xxxxx°，东经 y.yyyyy°`，为空则不显示这一行），每口塘一张卡（塘名、面积、前 4 项读数、更新时间）链接到 `#pond/<代号>`。不嵌地图。
  - **真实塘口页**：面包屑（首页 / 产地基地 / 基地名 → `#live/<基地代号>` / 塘名），`liveTag` 和更新时间，整份过期提示，每项读数一格，范围按钮，每项读数一张曲线卡（标题是公开标签，`timeChart` 的 `from = Date.parse(generated_at) − spanMs`、`to = Date.parse(generated_at)`、`gapMs = 2.5 × bucketMs`；24h 的 `xLabel` 给 `HH:MM`，7d / 30d 给 `MM-DD`），最后是来源说明。`curves` 为 `missing` 或该读数没有点时，该卡显示“曲线准备中”。

- [ ] **Step 1: 调用 `/ui-ux-pro-max`**，以现有浅色样式为基准确认读数格、曲线卡、过期状态的呈现，结论只落在上面的结构钩子和 `style.css` 里。
- [ ] **Step 2: 写失败的测试** `tests/live-pages.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIndex, parsePondFile } from '../dist/assets/live.js';
import { homeLivePanel, liveBasePage, livePondPage, liveTitle } from '../dist/assets/pages/live.js';
import { basesGrid, basesPage } from '../dist/assets/pages/bases.js';
import { homePage, demoHeroPanel } from '../dist/assets/pages/home.js';
import { SAMPLE_NOW as now, sampleIndex, samplePond } from '../scripts/live-sample.mjs';
const feed = { status: 'ok', index: parseIndex(sampleIndex(now)) };
const curves = { status: 'ok', file: parsePondFile(samplePond(now), 'yx-00') };

test('塘口页：读数、更新时间、空读数、曲线张数、无内联样式', () => {
  const html = livePondPage('yx-00', feed, curves, '24h', now);
  assert.match(html, /^<div data-live-slot="page">/);
  assert.match(html, /<h1 tabindex="-1" data-heading>永兴 0 号塘<\/h1>/);
  assert.match(html, /tag-ok">实时数据/); assert.match(html, /更新于 14:35/);
  assert.match(html, /data-reading="r1"[^>]*>[\s\S]*?6\.82[\s\S]*?mg\/L/);
  assert.match(html, /data-reading="r5"[^>]*>[\s\S]*?暂无读数/);
  assert.equal((html.match(/<svg class="chart chart-time/g) || []).length, 4);
  assert.equal((html.match(/曲线准备中/g) || []).length, 1);
  assert.match(html, /data-range="24h" aria-pressed="true"/); assert.match(html, /data-range="7d" aria-pressed="false"/);
  assert.match(html, /href="#live\/yx"/); assert.match(html, /约每 5 分钟更新一次/);
  assert.equal(/style=|live-banner|rd-stale/.test(html), false);
  assert.match(livePondPage('yx-00', feed, curves, '30d', now), /data-range="30d" aria-pressed="true"/);
});
test('塘口页：整份过期与单项过期不再显示“实时数据”', () => {
  const late = livePondPage('yx-00', feed, curves, '24h', now + 2 * 3_600_000 + 60_000);
  assert.match(late, /live-banner[^>]*>[\s\S]*?实时数据暂时中断，以下为 14:35 的数据/);
  assert.match(late, /rd-stale[\s\S]*?2 小时前的读数/); assert.match(late, /tag-warn">数据中断/);
  assert.equal(late.includes('tag-ok">实时数据'), false);
  assert.match(livePondPage('yx-00', feed, curves, '24h', now + 86_400_000 + 1), /以下为 11-26 14:35 的数据/);
});
test('塘口页：文字转义、载入中、取不到、塘不存在、曲线缺失', () => {
  const raw = sampleIndex(now); raw.bases[0].ponds[0].readings[0].label = '<img src=x onerror=1>'; raw.bases[0].ponds[0].name = '"><b>塘';
  const evil = livePondPage('yx-00', { status: 'ok', index: parseIndex(raw) }, curves, '24h', now);
  assert.equal(/<img src=x|"><b>塘/.test(evil), false); assert.match(evil, /&lt;img src=x/);
  assert.match(livePondPage('yx-00', { status: 'loading' }, { status: 'loading' }, '24h', now), /正在载入实时数据…/);
  assert.match(livePondPage('yx-00', { status: 'unavailable' }, { status: 'missing' }, '24h', now), /实时数据暂时取不到/);
  for (const code of ['yx-99', '<script>', '']) assert.match(livePondPage(code, feed, { status: 'missing' }, '24h', now), /没有找到这口塘/);
  const noCurve = livePondPage('yx-00', feed, { status: 'missing' }, '7d', now);
  assert.equal((noCurve.match(/曲线准备中/g) || []).length, 5); assert.match(noCurve, /6\.82/);
  assert.match(livePondPage('yx-00', feed, { status: 'loading' }, '24h', now), /正在载入曲线…/);
});
test('基地页、基地列表、首页面板、标题', () => {
  const page = liveBasePage('yx', feed, now);
  assert.match(page, /阳江永兴基地/); assert.match(page, /href="#pond\/yx-00"/); assert.match(page, /北纬 [\d.]+°，东经 [\d.]+°/);
  assert.match(liveBasePage('zz', feed, now), /没有找到这个基地/);
  const grid = basesGrid(feed, now);
  assert.match(grid, /^<div class="base-grid base-grid-lg" data-live-slot="bases">/);
  assert.ok(grid.indexOf('阳江永兴基地') < grid.indexOf('阳江海陵岛示范基地'));
  assert.equal((grid.match(/tag-demo/g) || []).length, 3); assert.match(grid, /href="#live\/yx"/);
  assert.equal((basesGrid({ status: 'unavailable' }, now).match(/class="base-card/g) || []).length, 3);
  assert.match(basesPage(grid), /华海农科养殖基地/);
  assert.equal(homeLivePanel({ status: 'unavailable' }, now), null);
  assert.equal(homeLivePanel({ status: 'loading' }, now), null);
  assert.equal(homeLivePanel({ status: 'ok', index: { ...feed.index, bases: [] } }, now), null);
  const panel = homeLivePanel(feed, now);
  assert.match(panel, /data-live-slot="home"/); assert.match(panel, /永兴 0 号塘 · 实时水质/); assert.match(panel, /href="#pond\/yx-00"/);
  assert.equal(panel.includes('暂无读数'), false);
  assert.match(demoHeroPanel(), /data-live-slot="home"[\s\S]*tag-demo/);
  assert.match(homePage(demoHeroPanel()), /data-counter="samples"/);
  assert.deepEqual([liveTitle('pond', 'yx-00', feed), liveTitle('live', 'yx', feed), liveTitle('pond', 'yx-00', { status: 'loading' })], ['永兴 0 号塘', '阳江永兴基地', undefined]);
});
```

- [ ] **Step 3: 运行确认失败** — `npm test`。
- [ ] **Step 4: 实现三个页面文件的改动和 `style.css` 新增样式**（`.live-tiles` 读数格网格、`.live-rd`、`.rd-stale` 变灰、`.live-banner`、`.live-charts` 曲线卡网格、`.chart-time`、`.cl`、`.chart-empty`；窄屏下读数格两列、曲线卡单列）。此时 `app.ts` 里对 `homePage()`、`basesPage()` 的调用会编译不过，临时改成 `homePage(demoHeroPanel())`、`basesPage(basesGrid({ status: 'loading' }, Date.now()))`，Task 4 接上真数据。
- [ ] **Step 5: 运行确认通过** — `npm test`。
- [ ] **Step 6: 提交** — `git commit -am "feat(market): 真实基地页、塘口页与首页实时面板的页面片段"`

### Task 4: 路由、取数与定时刷新

**Files:**
- Modify: `huahai-market-site/src/model.ts`（路由名）
- Modify: `huahai-market-site/src/app.ts`
- Modify: `huahai-market-site/public/index.html`
- Modify: `huahai-market-site/scripts/preview.mjs`
- Test: `huahai-market-site/tests/model.test.mjs`（追加）

**Interfaces:**
- Consumes：Task 1、Task 3 的全部导出。
- Produces：
  - `RouteName` 增加 `'live'`（真实基地页，`#live/<基地代号>`）和 `'pond'`（真实塘口页，`#pond/<塘代号>`）；`routeTitles.live = '基地实时数据'`、`routeTitles.pond = '塘口实时数据'`。两者在导航上都归到“产地基地”。演示基地仍是 `#base/<id>`，互不相干。
  - `app.ts` 内部（不导出）：

```ts
let feed: LiveFeed = { status: 'loading' };
const curves = new Map<string, PondCurves>();
let liveRange: LiveRange = '24h';
async function getJson(path: string, maxBytes: number): Promise<unknown>;   // 相对路径；10 秒超时；非 2xx、超长、解析失败都返回 undefined；fetch 选项 { credentials: 'omit', cache: 'no-cache' }
async function refreshFeed(): Promise<void>;   // 取 'live/v1/index.json'（262_144 字节上限）→ parseIndex；之后若当前是 pond 路由再 refreshCurves；最后 renderSlots()
async function refreshCurves(code: string): Promise<void>;  // 仅当 feed 为 ok 且 findLivePond 找得到；取 `live/v1/pond-${code}.json`（1_048_576 上限）→ parsePondFile(raw, code)
function slotHtml(name: string): string;       // 'home' | 'bases' | 'page' → 用当前 feed / curves / liveRange / Date.now() 重新生成
function renderSlots(): void;                  // 对 view 里每个 [data-live-slot] 用 slotHtml 的结果替换 outerHTML，并更新 document.title
```

- 行为规定：
  - 刷新失败时保留上一份成功的数据（它会随时间自然显示成过期）；从未成功过才是 `unavailable`。曲线同理：失败且之前没有 → `missing`。
  - `refreshFeed` 同一时刻只跑一个；到点时上一个还没结束就跳过这次。
  - 启动时调用一次；之后 `setInterval` 每 60_000 毫秒，在 `document.hidden` 时跳过；`visibilitychange` 变回可见且距上次成功或失败的刷新已超过 60 秒时立即补一次。
  - 进入 `pond` 路由时，若 `curves` 里没有这口塘，先置 `loading` 再取。
  - `renderSlots` 重绘前记下焦点：焦点在 `[data-range]` 上就在重绘后找回同一个 `data-range` 的按钮；在 `[data-heading]` 上就找回新的标题；都用 `focus({ preventScroll: true })`。不动滚动位置，不动片段之外的任何内容（首页搜索框里正在输入的字不能丢）。
  - 点 `[data-range]`：更新 `liveRange` 后 `renderSlots()`。
  - `render()` 里 `home` → `homePage(slotHtml('home'))`，`bases` → `basesPage(slotHtml('bases'))`，`live` / `pond` → `slotHtml('page')`；标题用 `liveTitle`。
  - 现有 3 秒演示跳动定时器不变（首页计数器只在演示面板存在时才找得到元素）。
- `public/index.html`：CSP 的 `connect-src 'none'` 改 `connect-src 'self'`；顶部提示条改为 `标有“实时数据”的是真实监测数据，其余为演示 · 不产生真实交易`；`<main>` 里的 `正在载入演示数据…` 改 `正在载入…`；`meta description` 里的“演示版”保留。
- `scripts/preview.mjs`：`types` 增加 `'.json': 'application/json'`；环境变量 `LIVE_SAMPLE=1` 时，`/live/v1/index.json` 和 `/live/v1/pond-yx-00.json` 直接返回 `sampleIndex()` / `samplePond()` 的当前时间版本；没设时 `/live/` 下一律 404（与数据还没接通时的线上一致）。

- [ ] **Step 1: 写失败的测试**（追加到 `tests/model.test.mjs`，文件顶部加 `import { readFileSync } from 'node:fs';`）

```js
test('真实基地与塘口路由', () => {
  assert.deepEqual([parseRoute('#pond/yx-00').name, parseRoute('#pond/yx-00').id], ['pond', 'yx-00']);
  assert.deepEqual([parseRoute('#live/yx').name, parseRoute('#live/yx').id], ['live', 'yx']);
  assert.equal(routeHash({ name: 'pond', id: 'yx-00' }), '#pond/yx-00');
  assert.equal(parseRoute('#base/yj').name, 'base');
});
test('页面安全策略只允许请求本站，提示条不再说全部是示例', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /connect-src 'self';/); assert.equal(html.includes("connect-src 'none'"), false);
  assert.match(html, /标有“实时数据”的是真实监测数据，其余为演示/); assert.equal(html.includes('均为示例'), false);
});
```

- [ ] **Step 2: 运行确认失败** — `npm test`。
- [ ] **Step 3: 实现上述改动。**
- [ ] **Step 4: 运行确认通过** — `npm test`。
- [ ] **Step 5: 本地看一眼** — `npm run build && LIVE_SAMPLE=1 PORT=4321 node scripts/preview.mjs`，浏览器开 `http://127.0.0.1:4321/#pond/yx-00`、`#bases`、`#home`；再不带 `LIVE_SAMPLE` 起一次，确认首页是演示面板、`#pond/yx-00` 显示“实时数据暂时取不到”。
- [ ] **Step 6: 提交** — `git commit -am "feat(market): 接入本站实时数据文件，每 60 秒刷新"`

### Task 5: 浏览器检查

**Files:**
- Modify: `huahai-market-site/tests/browser-check.mjs`

**Interfaces:**
- Consumes：`scripts/live-sample.mjs`；Playwright 的 `page.route`、`page.clock`（需 1.45 以上，用 `PLAYWRIGHT_MODULE=$(pwd)/../tests/node_modules/playwright`）。

- [ ] **Step 1: 改造检查脚本的公共部分**
  - 新增 `let live = { index: () => sampleIndex(), pond: () => samplePond(), delayMs: 0 };`，并在最开始注册 `page.route('**/live/v1/**', …)`：按 `live` 当前设置返回 JSON；某项为 `null` 时返回 404；为字符串时原样返回（用来造坏文件）；`delayMs` 大于 0 时先等。这样原有各组检查默认都跑在“真实数据正常”的状态下。
  - `failures` 监听里忽略 `/live/v1/` 的 404；`errors` 监听里忽略资源加载失败那一条浏览器自带的报错（只在 URL 含 `/live/v1/` 时）。其余断言不变（仍要求没有跨站请求、没有非 GET 请求）。
  - 原有检查里依赖旧文案的地方同步改（基地列表标题、演示面板）。
- [ ] **Step 2: 新增检查组**（每组结束把 `live` 复原）

| 组名 | 做法与断言 |
|---|---|
| 真实数据正常 | `go('bases')`：第一张卡含“阳江永兴基地”和“实时数据”；点进去到 `#live/yx`，再点塘卡到 `#pond/yx-00`；标题“永兴 0 号塘”，`[data-reading]` 5 个，`svg.chart-time` 4 个；点 `[data-range="7d"]` 后它 `aria-pressed="true"` 且焦点仍在它上面；`go('home')` 面板含“永兴 0 号塘 · 实时水质” |
| 定时刷新不丢焦点和输入 | `page.clock.install()`；`go('pond/yx-00')`，点 `[data-range="7d"]`；把 `live.index` 换成 r1 数值 7.11 的版本；`page.clock.fastForward(61_000)`；等 `[data-reading="r1"]` 出现 `7.11`；焦点仍在 `[data-range="7d"]`。再 `go('home')`，在 `#hero-code` 填 `HH-`，`fastForward(61_000)` 后输入框的值仍是 `HH-` |
| 单项读数过期 | `live.index` 的 r1 `observed_at` 设为 2 小时前（`generated_at` 仍是现在）：`[data-reading="r1"]` 有类 `rd-stale` 并含“2 小时前的读数”；没有 `.live-banner`；标识仍是“实时数据” |
| 整份数据过期 | `live.index = () => sampleIndex(Date.now() - 3 * 3_600_000)`：`.live-banner` 含“实时数据暂时中断”；页面里没有 `.tag-ok` 文字为“实时数据”的元素；有“数据中断” |
| 文件缺失 | `live.index = null`：`go('home')` 面板含“演示”；`go('bases')` 只有 3 张卡；`go('pond/yx-00')` 标题“实时数据暂时取不到”；`go('shop')` 仍有 6 件商品 |
| 文件损坏 | `live.index = '{"schema":1,'`：同上三处断言；再试 `live.index = JSON.stringify({ ...sampleIndex(), schema: 2 })` |
| 曲线缺失 | `live.pond = null`：`go('pond/yx-00')` 读数照常显示 `6.82`，“曲线准备中”出现 5 次 |
| 塘不存在 | `go('pond/yx-99')`、`go('pond/%3Cscript%3E')` 标题都是“没有找到这口塘”；这两次都没有发出 `pond-` 开头的请求 |
| 响应很慢时离开 | `live.delayMs = 1500`；`page.goto(base + '/#pond/yx-00')` 后立刻 `go('shop')`；等 2 秒；商城仍是 6 件商品、标题仍含“买好货”、无报错 |

  - “多宽度无横向溢出”那组的页面列表加上 `live/yx`、`pond/yx-00`；另存一张 390 宽的 `pond-mobile.png` 截图。
- [ ] **Step 3: 运行** — `npm run build && PORT=4319 node scripts/preview.mjs &`，然后 `PLAYWRIGHT_MODULE="$(pwd)/../tests/node_modules/playwright" node tests/browser-check.mjs`。预期输出“浏览器检查通过 N 组”，N = 原有组数 + 9。本机没有 Chrome 时加 `BROWSER_CHANNEL=chromium`。
- [ ] **Step 4: 看两张截图**（`.qa/pond-mobile.png`、`.qa/trace-mobile.png`），确认读数格、曲线、过期提示在窄屏下不挤不裁。
- [ ] **Step 5: 提交** — `git commit -am "test(market): 真实数据的正常、过期、缺失、损坏、慢响应浏览器检查"`

### Task 6: 官网服务器的取回脚本、定时器与 nginx

**Files:**
- Create: `huahai-market-site/deploy/live-fetch/fetch_live.py`
- Create: `huahai-market-site/deploy/live-fetch/test_fetch_live.py`
- Create: `huahai-market-site/deploy/live-fetch/huahai-market-live-fetch.service`、`huahai-market-live-fetch.timer`、`huahai-market-live.env.example`
- Modify: `huahai-market-site/deploy/market.huahainongke.com.conf`
- Modify: `.github/workflows/huahai-market-ci.yml`
- Test: `huahai-market-site/tests/deploy.test.mjs`

**Interfaces:**
- Consumes：数据契约 v1；`tests/fixtures/live-v1/` 两份样例。
- Produces（`fetch_live.py`，只用标准库，语法不高于 Python 3.6：不用海象运算符、`dataclasses`、`from __future__ import annotations`、`str.removeprefix`）：

```python
INDEX_MAX = 262144
POND_MAX = 1048576
def clean_index(raw):            # -> dict；违反契约任何一条（包括多出任何键）抛 ValueError
def clean_pond(raw, code, keys): # -> dict；keys 是索引里这口塘的读数 key 集合；series 里出现集合之外的 key 也抛 ValueError
def run(source, dest, host=None): # -> int 退出码；source 是以 / 结尾的 URL 前缀（http:// 或测试用的 file://），dest 是已存在的目录；host 非空时作为 Host 请求头发出
def main(argv=None):             # 参数 --source、--dest 必填，--host 对 file:// 测试源可选，对共用 18081 的 http 源必填（market-live.internal）
```

- `run` 的规定：
  - 先取 `index.json`（超时 10 秒，读到 `INDEX_MAX + 1` 字节即判超长）→ `clean_index`。失败：标准错误输出一行原因，**什么都不改**，返回 1。
  - 成功后逐口塘取 `pond-<代号>.json` → `clean_pond`。某口塘失败：保留它原来的文件，记一行原因，继续下一口，最终返回 1。
  - 写文件：内容是清洗后重新序列化的 JSON（`ensure_ascii=False`、紧凑分隔符），先写同目录的 `.<名字>.tmp` 再 `os.replace`，权限 `0o644`。
  - 索引写入成功后，删除 `dest` 里所有不在本次索引中的 `pond-*.json`（取消公开的塘不能留文件）。只删匹配 `^pond-[a-z0-9]{1,12}-[a-z0-9]{1,12}\.json$` 的普通文件。
  - `dest` 不存在或不是目录：返回 1，不创建。
  - 全部成功返回 0。不改写 `generated_at`（网页靠它判断过期）。
- nginx：在 `server`（443）块里、`location / {` 之前加入下面两段，并把该块 CSP 的 `connect-src 'none'` 改成 `connect-src 'self'`。第二段不能写成 `^~`，否则正则那段不会被匹配。

```nginx
    location ~ ^/live/v1/(index|pond-[a-z0-9]+-[a-z0-9]+)\.json$ {
        alias /var/www/huahai-market-live/v1/$1.json;
        limit_except GET HEAD { deny all; }
        types { }
        default_type application/json;
        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options DENY always;
        add_header Referrer-Policy no-referrer always;
        add_header X-Robots-Tag "noindex, nofollow" always;
        add_header Cache-Control "public, max-age=60" always;
        add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none'" always;
    }
    location /live/ { return 404; }
```

- 定时器：`OnCalendar=*:1/5`（每 5 分钟、错开 1 分钟，排在物联网导出之后），`AccuracySec=10s`。服务单元 `Type=oneshot`，`User=huahai-live`，`EnvironmentFile=/etc/huahai-market-live.env`（内含 `LIVE_SOURCE=`、`LIVE_HOST=`），`ExecStart=/usr/bin/python3 /opt/huahai-market-live/fetch_live.py --source ${LIVE_SOURCE} --host ${LIVE_HOST} --dest /var/www/huahai-market-live/v1`，并加 `NoNewPrivileges=yes`、`ProtectSystem=strict`、`ProtectHome=yes`、`PrivateTmp=yes`、`ReadWritePaths=/var/www/huahai-market-live/v1`。`huahai-market-live.env.example` 里两项只写占位说明；真实值以物联网侧计划为准（内网地址加 `/market-live/v1/`，`LIVE_HOST=market-live.internal`），不写进仓库。物联网服务器按 Host 名区分这个只读站点，所以取回时必须带这个请求头。

- [ ] **Step 1: 写失败的测试** `deploy/live-fetch/test_fetch_live.py`（`unittest`；源目录和目标目录都用 `tempfile.TemporaryDirectory`，`source` 用 `pathlib.Path(src).as_uri() + '/'`；样例从 `../../tests/fixtures/live-v1/` 读）

```python
class FetchLiveTest(unittest.TestCase):
    def test_ok_writes_cleaned_files(self):            # 返回 0；两份文件 json.loads 后等于样例；dest 里没有 .tmp 残留；权限 0o644
    def test_index_extra_key_rejected_keeps_old(self):  # 索引里加 bases[0]["manager"]="张三" → 返回 1；dest 里旧 index.json 字节不变，旧 pond 文件也不变
    def test_reading_extra_key_rejected(self):          # readings[0]["device_sn"] → clean_index 抛 ValueError
    def test_contract_violations(self):                 # schema=2、generated_at 无 Z、塘代号大写、value 为字符串、value 有数但 observed_at 为 None、readings 25 项、塘代号重复 → 逐个 assertRaises(ValueError)
    def test_truncated_and_oversize_index(self):        # 半截 JSON → 1；index.json 填充到 INDEX_MAX+1 字节 → 1；旧文件都不变
    def test_bad_pond_keeps_old_pond_but_updates_index(self):  # pond 文件点数 301 → 返回 1；index.json 已更新；pond 文件仍是旧内容
    def test_pond_series_unknown_key_rejected(self):    # series 里出现索引没有的 "r9" → clean_pond 抛 ValueError
    def test_pond_missing_is_reported(self):            # 源里没有 pond 文件 → 返回 1；index.json 已更新
    def test_unpublished_pond_file_removed(self):       # dest 预先放 pond-yx-07.json 和 notes.txt，索引里只有 yx-00 → pond-yx-07.json 被删，notes.txt 还在
    def test_dest_missing(self):                        # dest 指向不存在的目录 → 返回 1，目录没被创建
    def test_nan_rejected(self):                        # 文件内容含 NaN / Infinity → 返回 1
    def test_host_header_sent(self):                    # 本机起一个 http.server 线程提供样例并记录请求头；run(url, dest, host='market-live.internal') 返回 0 且每个请求的 Host 都是它
```

  以及 `tests/deploy.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const conf = readFileSync(new URL('../deploy/market.huahainongke.com.conf', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
test('nginx 与页面的安全策略一致，且只多放开本站请求', () => {
  const page = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const site = conf.match(/add_header Content-Security-Policy "(default-src 'self'[^"]+)"/)[1];
  assert.equal(site, page + "; frame-ancestors 'none'");
  assert.match(page, /connect-src 'self'/);
});
test('/live/ 只提供两种文件名，其他一律 404', () => {
  assert.match(conf, /location ~ \^\/live\/v1\/\(index\|pond-\[a-z0-9\]\+-\[a-z0-9\]\+\)\\\.json\$ \{\s+alias \/var\/www\/huahai-market-live\/v1\/\$1\.json;/);
  assert.match(conf, /location \/live\/ \{ return 404; \}/);
  assert.equal(conf.includes('location ^~ /live/'), false);
  assert.ok(conf.indexOf('location ~ ^/live/v1/') < conf.indexOf('location / {'));
});
```

- [ ] **Step 2: 运行确认失败** — `cd huahai-market-site && python3 -m unittest discover -s deploy/live-fetch -p 'test_*.py'`（找不到模块）；`npm test`（deploy 测试失败）。
- [ ] **Step 3: 实现 `fetch_live.py`、两份 systemd 单元、env 样例，改 nginx 配置。** 解析用 `json.loads(text, parse_constant=…)` 让 `NaN` / `Infinity` 直接报错；布尔值不能当数字通过（`isinstance(v, bool)` 先排除）。
- [ ] **Step 4: 运行确认通过** — 上面两条命令都通过。
- [ ] **Step 5: CI 加一步** — 在 `.github/workflows/huahai-market-ci.yml` 的 “Typecheck, build and test market portal” 之后加：

```yaml
      - name: Test edge live-data fetcher
        run: python3 -m unittest discover -s deploy/live-fetch -p 'test_*.py'
        working-directory: huahai-market-site
```

- [ ] **Step 6: 提交** — `git add huahai-market-site/deploy huahai-market-site/tests/deploy.test.mjs .github/workflows/huahai-market-ci.yml && git commit -m "feat(market): 官网服务器取回脚本、定时器与 /live/ 对外配置"`

### Task 7: 文档同步与收尾验证

**Files:**
- Modify: `docs/features/huahai-market-portal.md`
- Modify: `docs/README.md`
- Modify: `plan.md`

- [ ] **Step 1: `docs/features/huahai-market-portal.md` 新增“真实养殖环境数据”一节**，写清：
  - 数据从哪来、网页读哪两个文件、过期与取不到时的表现（引用设计稿 6.5，不重抄）。
  - **官网服务器安装步骤（执行前要用户放行）**：确认 `python3 --version` 不低于 3.6；建用户 `huahai-live`（无登录）；建目录 `/var/www/huahai-market-live/v1`（属主 `huahai-live`，其他人可读）和 `/opt/huahai-market-live/`；放脚本、两份单元文件、`/etc/huahai-market-live.env`；`systemctl enable --now huahai-market-live-fetch.timer`；手动跑一次服务并看 `journalctl -u huahai-market-live-fetch`；改 nginx 配置后 `nginx -t` 再重载；`curl -I https://market.huahainongke.com/live/v1/index.json` 应为 200 且 `Content-Type: application/json`，`/live/v1/other.json`、`/live/` 应为 404。
  - **发布顺序**：物联网导出 → 官网服务器取回与 nginx → 确认文件正常 → 网站走 PR → main → `huahai-market` 发布。
  - **回退**：网站用上次发布的回退方式；停数据只需 `systemctl disable --now huahai-market-live-fetch.timer` 并清空 `/var/www/huahai-market-live/v1/`，网页会自动回到演示内容。
- [ ] **Step 2: `docs/README.md` 登记本计划；`plan.md` 新增“2026-11-26 AI 农贸市场接入真实养殖环境数据”一节**，列出：设计已定稿 [x]、网站侧实现、物联网侧导出、服务器安装、上线后核对读数一致，后四项未完成。
- [ ] **Step 3: 全量验证** — `cd huahai-market-site && npm test && python3 -m unittest discover -s deploy/live-fetch -p 'test_*.py'`，再跑一遍 Task 5 的浏览器检查；`git status` 确认 `dist/`、`.qa/` 没被提交。
- [ ] **Step 4: 独立只读审查**（项目规定）：起一个只读审查子代理（Sonnet，effort high）对照设计稿和本计划检查全部改动，重点是 Review Focus 五条和“绝不能出现”清单；High / Critical 全修，Medium 说明取舍。
- [ ] **Step 5: 提交** — `git commit -am "docs(market): 真实数据接入的安装步骤、发布顺序与进度"`。不推送；向用户说明改动并询问是否推送。
