# 华海 AI 农贸市场产销溯源演示版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `huahai-market-site` 升级为深色科技风、多页面的产销溯源演示站，买家可从商品一路看到公司›基地›塘›批次的养殖数据。

**Architecture:** 保持无框架静态站：`src/*.ts` 经 `tsc` 编译到 `dist/assets/*.js`，hash 路由单页应用；全部演示数据在 `src/data.ts` 中确定性生成；图表、插画、图标为内联 SVG 字符串；无网络请求、无存储。

**Tech Stack:** TypeScript 5.9.2、原生 DOM、CSS、node:test、Playwright（本机已有模块，仅测试用）。

**Spec:** `docs/superpowers/specs/2026-11-24-huahai-market-trace-demo-design.md`

**执行方式：** Native（主会话实现，完成后一次独立只读审查）。理由：各页面共享同一份数据类型和样式，跨文件耦合高，逐任务拆给不同子代理容易风格不一致。

## Global Constraints

- CSP 不放宽：`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; form-action 'none'`。因此**禁止 HTML `style=""` 属性**（会被 CSP 拦截），动态尺寸用 SVG 或 `element.style.setProperty`。
- 不新增运行时依赖；不引入外部字体/脚本/图片。
- 所有用户输入经 `escapeHtml` 或文本节点输出。
- 页面持续标注“演示版”；不出现“已上链”“认证”。
- 不展示用药、施肥、称重生长曲线。
- 水质数据确定性生成（同输入同输出），不使用 `Math.random`。
- 375 / 768 / 1024 / 1440 宽度无横向溢出；`prefers-reduced-motion` 关闭动画。

## Review Focus

1. 未知/输错的批次码、商品 id、基地 id（`#trace/XXX`、`#product/nope`）→ 显示友好空态和返回入口，不抛错。
2. 浏览器前进/后退、刷新深链 `#trace/<码>` → 页面完整恢复。
3. 购物车数量边界（0、超过可售量、删除最后一件）→ 数量限制在 1..库存，空购物车有空态。
4. 窄屏（375px）下溯源档案的图表与表格 → 不横向溢出（表格自身可滚动）。
5. AI 助手在无商品上下文（首页打开）时 → 给出通用问题而非报错。

---

### Task 1: 演示数据与纯函数

**Files:**
- Create: `huahai-market-site/src/data.ts`（类型 + 演示数据 + 生成器）
- Modify: `huahai-market-site/src/model.ts`（路由解析 `parseRoute(hash): Route`，`Route = { name: RouteName; id?: string; params }`；保留 `escapeHtml`）
- Test: `huahai-market-site/tests/model.test.mjs`（重写）

**Interfaces (Produces):**
- `companies, bases, ponds, batches, products` 数组；`findProduct(id)`, `findBatch(code)`, `findBase(id)`, `pondsOfBase(id)`；
- `waterSeries(batchCode, metric: 'do'|'temp'|'ph', days): {day:string; value:number}[]`（确定性）；
- `complianceRate(series, range): number`；`traceCompleteness(batch): number`；
- `liveReading(pondId, tick): Reading`（确定性小幅波动）；
- `aiAnswers(batch)`: `{q:string;a:string}[]`。

- [ ] 测试：`parseRoute('#trace/HH-YJ-2611-03')` → `{name:'trace', id:'HH-YJ-2611-03'}`；未知路由 → `home`；`waterSeries` 两次调用结果相等且长度=天数；6 个商品都能 `findBatch` 到批次；每个批次 `feed` 投喂量之和等于其汇总字段；转塘批次的 `lineage` 至少 2 个塘。
- [ ] 实现并 `npm test` 通过；提交。

### Task 2: 视觉基础（样式、图标、图表、插画）

**Files:**
- Rewrite: `huahai-market-site/public/assets/style.css`
- Create: `huahai-market-site/src/svg.ts`：`icon(name)`, `fishArt(kind, palette)`, `lineChart(series, opts)`, `barChart`, `donut`, `sparkline`, `qrLike(code)`, `pondMap(ponds)`

- [ ] 建立设计令牌（颜色、圆角、间距、阴影、z-index 10/20/30/50）、深色玻璃卡片、网格背景、等宽数字、按钮/标签/表格/时间轴/空态组件类、减少动画偏好。
- [ ] `lineChart` 输出含标准区间带、越线点标记和 `<title>`/表格替代的 SVG。
- [ ] typecheck 通过；提交。

### Task 3: 页面外壳与路由

**Files:** Rewrite `public/index.html`（头部导航、页面容器、页脚、AI 助手浮层、对话框）、`src/app.ts`（路由分发、焦点管理、标题、购物车内存状态）。

- [ ] 导航：首页 / 买好货 / 产地基地 / 溯源查询 / 产地采购 / 工作台 / 购物车（带数量）。
- [ ] 每次路由渲染后聚焦页面标题；未知 id 走空态。
- [ ] 提交。

### Task 4: C 端页面

**Files:** Create `src/pages/home.ts`, `src/pages/shop.ts`, `src/pages/product.ts`, `src/pages/cart.ts`（含 checkout 和 order）。

- [ ] 首页、商品网格（筛选/排序）、商品详情（溯源摘要 + AI 解读 + 加购）、购物车→确认订单→模拟支付→订单详情。
- [ ] 提交。

### Task 5: 溯源档案与基地

**Files:** Create `src/pages/trace.ts`, `src/pages/bases.ts`。

- [ ] 溯源档案十个区块（见 spec §4）；批次码查询页；基地列表与基地详情（塘口图、实时读数每 3 秒刷新、减少动画时不跳动）。
- [ ] 提交。

### Task 6: B 端页面与 AI 助手

**Files:** Create `src/pages/source.ts`, `src/pages/work.ts`, `src/assistant.ts`。

- [ ] 货源大厅（在塘存量/预计起捕/批次链接）、采购需求、8 周供货日历、工作台、询价/发布表单预览（沿用原安全处理）。
- [ ] AI 助手：按当前路由上下文给问题列表，点击后逐字显示预设回答。
- [ ] 提交。

### Task 7: 验证、审查、文档

- [ ] `npm test` 通过；重写 `tests/browser-check.mjs` 覆盖 Review Focus 1–5、每页无控制台错误、无非 GET/跨域请求、4 个宽度无横向溢出，并截图。
- [ ] 独立只读审查（Sonnet，effort high），修复 High/Critical。
- [ ] 更新 `docs/features/huahai-market-portal.md`、`docs/README.md`、`plan.md`；提交。
