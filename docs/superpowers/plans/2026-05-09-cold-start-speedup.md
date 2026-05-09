# 冷启动加速实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解决"用户首次安装 APK 后看到旧版本"问题，让冷启动尽可能在第一次打开就显示最新代码 + 缩短 `/resolve` 阶段卡顿。

**Architecture:**
1. **app.json 加 `updates.fallbackToCacheTimeout: 5000`**：APK native splash 启动时阻塞最多 5 秒等 OTA 拉取，拉到就用新 bundle 启动（无 reload 闪烁）；超时回退到内嵌 bundle（OTA 异步下载到下次冷启动应用）。
2. **`/resolve` 改纯静态 HTML**：build 时由 Node 脚本从模板生成 `dist/resolve/index.html`，跳过 React 加载，把这一阶段从 1.5–4s 压到 0.5–1.2s。同时给 fetch 加 3s 超时，避免后端卡死时 App 端 5s hard cap 才放行。

**Tech Stack:** Expo 54 (`expo-updates@29`) / Vite 7 SPA / Node 20 (`node:test` 内置) / Nginx `try_files $uri $uri/ /index.html`

---

## File Structure

**Created:**
- `website/scripts/resolveLogic.mjs` — 纯 JS 函数 `decideRedirect(deps): Promise<string>`，把 cookie 解析 + fetch + URL 决策抽离成可单测形态
- `website/scripts/__tests__/resolveLogic.test.mjs` — node:test 覆盖 8 个分支
- `website/scripts/resolve.template.html` — HTML 模板，含 `__API_BASE__` 占位符
- `website/scripts/build-resolve.mjs` — 构建脚本：读模板 → 替换 `__API_BASE__` → 写到 `public/resolve/index.html`
- `docs/superpowers/plans/2026-05-09-cold-start-speedup.md` — 本文件

**Modified:**
- `app.json` — `expo.updates` 段加 `fallbackToCacheTimeout: 5000` 和 `checkAutomatically: "ON_LOAD"`（已默认 ON_LOAD，显式声明防回退）
- `website/package.json` — `scripts.prebuild = "node scripts/build-resolve.mjs"` 让 `npm run build` 自动产出 resolve 静态文件
- `docs/operations/app-发布与OTA手册.md` — 加冷启动加速配置说明 + 必须重打 APK 才生效的提醒

**Unchanged (intentionally):**
- `website/src/pages/Resolve.tsx` — 保留作 Nginx 配置异常时的兜底（如果 `try_files` 没匹配到 `dist/resolve/index.html` 而落到 SPA 路由，React 版本仍能正常工作）
- `website/src/App.tsx` — Resolve 路由保留
- `app/_layout.tsx` — DDL 时序与 `WebBrowser.openAuthSessionAsync` 调用不动，因为 `/resolve` 加速完全发生在网页侧

---

## Task 1: 提取 resolve 逻辑成纯函数 + 写单元测试

**Why first:** TDD。先把测试写完跑通，再有信心同步把模板里的 inline 脚本写正确。

**Files:**
- Create: `website/scripts/resolveLogic.mjs`
- Create: `website/scripts/__tests__/resolveLogic.test.mjs`

- [ ] **Step 1: 写测试文件（先失败）**

```javascript
// website/scripts/__tests__/resolveLogic.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideRedirect } from '../resolveLogic.mjs'

const FALLBACK = 'aimaimai://referral?code=none'
const API = 'https://test-api.ai-maimai.com/api/v1'

function mockFetcher(handler) {
  return async (url, opts) => handler({ url, opts })
}

test('cookieId 缺失 → 立即 fallback', async () => {
  const url = await decideRedirect({
    cookieId: null,
    fetcher: () => assert.fail('不应调用 fetch'),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('cookieId 空字符串 → 立即 fallback', async () => {
  const url = await decideRedirect({
    cookieId: '',
    fetcher: () => assert.fail('不应调用 fetch'),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('cookieId 有效 + API 返回推荐码 → redirect 带 code', async () => {
  const url = await decideRedirect({
    cookieId: 'abc123',
    fetcher: mockFetcher(({ url }) => {
      assert.match(url, /cookieId=abc123/)
      return {
        ok: true,
        json: async () => ({ data: { referralCode: 'REF7777' } }),
      }
    }),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, 'aimaimai://referral?code=REF7777')
})

test('API 返回 referralCode=null → fallback', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: mockFetcher(() => ({
      ok: true,
      json: async () => ({ data: { referralCode: null } }),
    })),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('API 返回 4xx → fallback', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: mockFetcher(() => ({ ok: false, status: 404, json: async () => ({}) })),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('fetch 抛错（网络断）→ fallback', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: () => Promise.reject(new Error('Network error')),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('fetch 超时（超过 timeoutMs 仍未 resolve）→ fallback', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: (url, opts) =>
      new Promise((resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    timeoutMs: 50,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('cookieId 含特殊字符 → URL encode 正确', async () => {
  const url = await decideRedirect({
    cookieId: 'abc 中文+/',
    fetcher: mockFetcher(({ url }) => {
      assert.match(url, /cookieId=abc%20%E4%B8%AD%E6%96%87%2B%2F/)
      return {
        ok: true,
        json: async () => ({ data: { referralCode: 'OK' } }),
      }
    }),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, 'aimaimai://referral?code=OK')
})

test('referralCode 含特殊字符 → URL encode 正确', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: mockFetcher(() => ({
      ok: true,
      json: async () => ({ data: { referralCode: 'ABC&xss=1' } }),
    })),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, 'aimaimai://referral?code=ABC%26xss%3D1')
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd website && node --test scripts/__tests__/resolveLogic.test.mjs`
Expected: FAIL with "Cannot find module '../resolveLogic.mjs'"

- [ ] **Step 3: 写 resolveLogic.mjs 让测试通过**

```javascript
// website/scripts/resolveLogic.mjs
/**
 * 把 cookieId 解析为 deep link URL，供静态 /resolve 页面与单元测试共用。
 * @param {object} deps
 * @param {string|null|undefined} deps.cookieId
 * @param {(url: string, opts?: any) => Promise<{ok: boolean, json: () => Promise<any>}>} deps.fetcher
 * @param {number} deps.timeoutMs
 * @param {string} deps.apiBase
 * @returns {Promise<string>} 应跳转的 deep link URL
 */
export async function decideRedirect({ cookieId, fetcher, timeoutMs, apiBase }) {
  const FALLBACK = 'aimaimai://referral?code=none'
  if (!cookieId) return FALLBACK

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetcher(
      `${apiBase}/deferred-link/resolve?cookieId=${encodeURIComponent(cookieId)}`,
      { signal: ctrl.signal },
    )
    clearTimeout(timer)
    if (!res.ok) return FALLBACK
    const data = await res.json()
    const code = data?.data?.referralCode
    return code ? `aimaimai://referral?code=${encodeURIComponent(code)}` : FALLBACK
  } catch {
    clearTimeout(timer)
    return FALLBACK
  }
}
```

- [ ] **Step 4: 跑测试确认 8 个用例全 pass**

Run: `cd website && node --test scripts/__tests__/resolveLogic.test.mjs`
Expected: `# pass 9`（含 file-level subtest）

- [ ] **Step 5: Sub-agent 审查 Task 1**

主 Agent 启动 Explore subagent，传入：
- 改动文件列表：`website/scripts/resolveLogic.mjs`、`website/scripts/__tests__/resolveLogic.test.mjs`
- 审查重点：函数签名一致性 / 边界条件 / 命名 / 异常吞吐 / 测试覆盖完整性（是否漏了关键路径）
- 输出：High/Medium/Low 问题清单 + 测试 gap 列表

主 Agent 修复 High/Critical，记录 Medium 决策。

---

## Task 2: 写 /resolve HTML 模板 + 构建脚本

**Files:**
- Create: `website/scripts/resolve.template.html`
- Create: `website/scripts/build-resolve.mjs`

- [ ] **Step 1: 写 resolve.template.html**

注意：HTML 里的 inline IIFE 必须**与 `resolveLogic.mjs::decideRedirect` 的逻辑等价**（不能 import ES module，浏览器原生支持但增加请求次数没必要）。模板含中文域名重定向兜底（与 `Resolve.tsx::redirectToCanonicalDomainIfNeeded` 等价）。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>正在处理</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #0a1628; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
  .wrap { display: flex; align-items: center; justify-content: center; height: 100%; color: rgba(255,255,255,0.3); font-size: 14px; }
</style>
</head>
<body>
<div class="wrap"><p>正在处理...</p></div>
<script>
(function () {
  // 1) 中文域名 → 强制重定向到英文域，否则跨域 cookie 读不到
  var host = location.hostname;
  if (host.indexOf('xn--ckqa175y') >= 0 || host.indexOf('爱买买') >= 0) {
    location.replace(location.href.replace(/\/\/([^/]*\.)?(xn--ckqa175y|爱买买)\.com/, '//app.ai-maimai.com'));
    return;
  }

  // 2) 读 _ddl_id cookie
  var m = document.cookie.match(/(?:^|; )_ddl_id=([^;]*)/);
  var id = m ? decodeURIComponent(m[1]) : null;

  function fallback() { location.href = 'aimaimai://referral?code=none'; }

  if (!id) { fallback(); return; }

  // 3) 调 API（3s AbortController 超时）
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 3000);

  fetch('__API_BASE__/deferred-link/resolve?cookieId=' + encodeURIComponent(id), { signal: ctrl.signal })
    .then(function (r) {
      clearTimeout(timer);
      if (!r.ok) { fallback(); return null; }
      return r.json();
    })
    .then(function (data) {
      if (!data) return;
      var code = data && data.data && data.data.referralCode;
      if (code) location.href = 'aimaimai://referral?code=' + encodeURIComponent(code);
      else fallback();
    })
    .catch(function () { clearTimeout(timer); fallback(); });
})();
</script>
</body>
</html>
```

- [ ] **Step 2: 写 build-resolve.mjs**

```javascript
// website/scripts/build-resolve.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolvePath(__dirname, '..')

// API_BASE 优先级与 src/lib/apiBase.ts 对齐：VITE_API_BASE_URL > 默认生产
const apiBase = (process.env.VITE_API_BASE_URL || '').trim() || 'https://api.ai-maimai.com/api/v1'

const templatePath = resolvePath(projectRoot, 'scripts/resolve.template.html')
const outDir = resolvePath(projectRoot, 'public/resolve')
const outPath = resolvePath(outDir, 'index.html')

const template = readFileSync(templatePath, 'utf-8')

// 校验：模板必须含 __API_BASE__ 占位，且 apiBase 不能含会破坏字符串字面量的字符
if (!template.includes('__API_BASE__')) {
  console.error('build-resolve: 模板缺少 __API_BASE__ 占位')
  process.exit(1)
}
if (apiBase.includes("'") || apiBase.includes('"') || apiBase.includes('\n')) {
  console.error('build-resolve: VITE_API_BASE_URL 含非法字符')
  process.exit(1)
}

const output = template.replace(/__API_BASE__/g, apiBase)

mkdirSync(outDir, { recursive: true })
writeFileSync(outPath, output, 'utf-8')

console.log(`✓ 已生成 ${outPath}`)
console.log(`  API_BASE = ${apiBase}`)
```

- [ ] **Step 3: 跑构建脚本验证**

Run: `cd website && VITE_API_BASE_URL=https://test-api.ai-maimai.com/api/v1 node scripts/build-resolve.mjs`
Expected stdout:
```
✓ 已生成 .../website/public/resolve/index.html
  API_BASE = https://test-api.ai-maimai.com/api/v1
```

- [ ] **Step 4: 检查产物正确替换**

Run: `grep -c '__API_BASE__' website/public/resolve/index.html && grep -c 'test-api.ai-maimai.com' website/public/resolve/index.html`
Expected: 第一个 `0`（占位都已替换），第二个 `≥1`（替换成功）。

- [ ] **Step 5: 不带环境变量跑一次测默认值**

Run: `cd website && unset VITE_API_BASE_URL && node scripts/build-resolve.mjs && grep 'api.ai-maimai.com' website/public/resolve/index.html | head -1`
Expected: 输出含 `https://api.ai-maimai.com/api/v1`（生产默认），不含 `test-api`。

- [ ] **Step 6: Sub-agent 审查 Task 2**

主 Agent 启动 Explore subagent，传入：
- 改动文件列表：`website/scripts/resolve.template.html`、`website/scripts/build-resolve.mjs`
- 审查重点：
  - 模板里的 inline IIFE 与 `decideRedirect` 行为是否一致（参数顺序、超时、fallback 时机）
  - HTML 转义安全性（中文 unicode、特殊字符）
  - 构建脚本对 VITE_API_BASE_URL 的优先级是否与 `website/src/lib/apiBase.ts` 一致
  - 防注入校验是否充分
- 输出：问题清单

---

## Task 3: 接入 build pipeline + 端到端验证

**Files:**
- Modify: `website/package.json`

- [ ] **Step 1: 加 prebuild 脚本**

```json
{
  "scripts": {
    "dev": "vite",
    "prebuild": "node scripts/build-resolve.mjs",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  }
}
```

`prebuild` 是 npm 约定钩子，`npm run build` 会自动先跑它。

- [ ] **Step 2: 验证 npm run build 一条龙跑通**

Run: `cd website && rm -rf dist public/resolve && VITE_API_BASE_URL=https://test-api.ai-maimai.com/api/v1 npm run build 2>&1 | tail -20`
Expected:
- 第一行类似 `✓ 已生成 .../public/resolve/index.html`
- 后面是 vite build 输出
- 退出码 0

- [ ] **Step 3: 验证 dist 产物结构**

Run: `ls -la website/dist/resolve/`
Expected: 含 `index.html` 文件，大小约 1.5-2KB（纯 HTML+JS 无 React）。

Run: `grep -c 'test-api.ai-maimai.com' website/dist/resolve/index.html`
Expected: `≥ 1`

Run: `grep -c '__API_BASE__' website/dist/resolve/index.html`
Expected: `0`

- [ ] **Step 4: 验证 dist/index.html (SPA) 仍存在**

Run: `ls website/dist/index.html`
Expected: 文件存在（SPA 没被破坏）

- [ ] **Step 5: 浏览器 smoke test（人工）**

启动本地预览：`cd website && npm run preview`

打开浏览器访问 `http://localhost:4173/resolve`：
- 应看到深蓝背景 + "正在处理..." 文字
- DevTools Network 看到对 `/api/v1/deferred-link/resolve` 的 OPTIONS / GET（跨域可能 fail，但 fallback 路径会让浏览器跳 `aimaimai://...` 失败 = 此处暂时不要求跳成功，只要求能渲染 + 调 API + 回退）

打开 `http://localhost:4173/resolve/`（带尾斜杠）：
- 行为相同（Vite preview 通常自动处理）

- [ ] **Step 6: Sub-agent 审查 Task 3**

主 Agent 启动 Explore subagent：
- 改动文件：`website/package.json`
- 审查重点：
  - prebuild 钩子是否会被 `npm ci` / `npm install` 触发（prebuild 只在 `npm run build` 触发，不影响 install）
  - dist/resolve/index.html 在 Nginx `try_files $uri $uri/ /index.html` 下的命中路径
  - 是否破坏了 GitHub Actions deploy-website workflow（workflow 已传 VITE_API_BASE_URL，prebuild 自动消费）

---

## Task 4: 改 app.json 加 fallbackToCacheTimeout

**Files:**
- Modify: `app.json`

- [ ] **Step 1: 在 expo.updates 段加配置**

当前：
```json
"updates": {
  "url": "https://u.expo.dev/d76ba8ac-06f3-45d2-b674-afec17737029"
}
```

改为：
```json
"updates": {
  "url": "https://u.expo.dev/d76ba8ac-06f3-45d2-b674-afec17737029",
  "fallbackToCacheTimeout": 5000,
  "checkAutomatically": "ON_LOAD"
}
```

参数解释：
- `fallbackToCacheTimeout: 5000` — native 启动时阻塞 splash 最多 5000ms 等 OTA 拉取，拉到就用新版启动；超时回退到内嵌 bundle（原有行为）
- `checkAutomatically: "ON_LOAD"` — 显式声明每次冷启动都查 OTA（默认值，写出来防回退）

- [ ] **Step 2: 验证 app.json 语法正确**

Run: `cat app.json | python3 -m json.tool > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: 验证 expo prebuild 能读到这个配置**

Run: `npx expo config --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print('fallbackToCacheTimeout:', d['updates'].get('fallbackToCacheTimeout', 'MISSING')); print('checkAutomatically:', d['updates'].get('checkAutomatically', 'MISSING'))"`
Expected:
```
fallbackToCacheTimeout: 5000
checkAutomatically: ON_LOAD
```

- [ ] **Step 4: 文档说明此改动需要重打 APK 才生效**

更新 `docs/operations/app-发布与OTA手册.md`，加一节"冷启动 OTA 加速"，说明：
- 配置位置（app.json）
- 生效条件（必须重新 `eas build` 才进 AndroidManifest，OTA 推不过去）
- 弱网 fallback 行为
- 决策记录：选择 5000ms 是平衡"等 OTA"和"白屏焦虑"的折中

- [ ] **Step 5: Sub-agent 审查 Task 4**

主 Agent 启动 Explore subagent：
- 改动文件：`app.json`、`docs/operations/app-发布与OTA手册.md`
- 审查重点：
  - JSON 格式正确性
  - expo-updates 29.x 文档对这两个 key 的支持（`fallbackToCacheTimeout` 在 expo-updates 29 起仍受支持，应在 app.json `updates` 而不是 `expo.updates.requestHeaders`）
  - 5000ms 是否合理（参考 Expo 官方推荐 0-30000ms，超过 30s 强制 timeout）
  - 是否影响现有 `EXPO_PUBLIC_ALIPAY_SANDBOX` 等其他 OTA 行为
  - 文档更新是否充分

---

## Task 5: 最终跨任务 Sub-agent Review

**File scope:** 所有上述新增/修改文件

- [ ] **Step 1: 启动一个全新 Explore subagent**

Prompt 要包含：
- Goal 描述（解决"用户首次安装 APK 看到旧版本"问题，砍 /resolve 慢）
- 完整改动文件清单
- 审查维度：
  - **跨文件一致性**：`resolveLogic.mjs::decideRedirect` 与 `resolve.template.html` inline IIFE 行为是否完全等价（cookie 解析正则、超时分支、fallback 时机、URL encode）
  - **构建链路**：GitHub Actions `deploy-website.yml` 对 `npm run build` 的调用是否触发新 prebuild + VITE_API_BASE_URL 是否正确传入
  - **Nginx 兼容**：`try_files $uri $uri/ /index.html` 在 `/resolve` 路径下的命中流程（验证 `dist/resolve/index.html` 会优先于 `index.html` SPA fallback）
  - **OTA 配置**：`fallbackToCacheTimeout: 5000` 与现有 `eas.json` 的 channel preview / 现有 `expo-updates@29.0.16` 兼容性
  - **降级路径**：如果 prebuild 失败，npm run build 应整体失败而不是产出空 dist
  - **测试 gap**：是否漏了某个 cookie 边界（超长 / 含 ; / 含换行）
  - **隐私合规**：纯 HTML 版本不再走 React 的中文域名 redirect util，但已在 inline IIFE 复刻，需确认正则匹配
- 输出：分级问题清单 + 改进建议

- [ ] **Step 2: 主 Agent 处理审查结果**

- High/Critical → 立即修
- Medium → 决策（修 / 保留 + 原因）
- Low → 记录到 plan.md 或 followup
- 修完所有 High 后再次跑测试 + 构建验证

---

## Task 6: 更新文档与记忆

**Files:**
- Modify: `docs/operations/app-发布与OTA手册.md`
- Modify: `/Users/jamesheden/.claude/projects/-Users-jamesheden-Desktop------AI--------/memory/project_app_release_status.md`
- (Optionally) Modify: `plan.md` 在 launch 冲刺章节记一笔

- [ ] **Step 1: app-发布与OTA手册.md 加"冷启动加速"章节**

内容包括：
- 当前 native 配置（`fallbackToCacheTimeout: 5000` / `checkAutomatically: ON_LOAD`）
- 与 OTA 推送的关系（推 OTA 不变，但 native 行为变了，所有新装 APK 第一次启动等最多 5s OTA）
- 重打 APK 的触发条件
- 静态 /resolve 加速说明（website 改动 + 构建链路）

- [ ] **Step 2: memory project_app_release_status.md 加冷启动加速备注**

在文件末尾"待办（影响下次 build 的）"段加：
- `app.json` 已加 `fallbackToCacheTimeout: 5000` + `checkAutomatically: ON_LOAD`，下次 build 进 AndroidManifest（与图标一起生效）
- /resolve 改纯静态 HTML，已通过 staging website 部署生效（不依赖 APK rebuild）

- [ ] **Step 3: CLAUDE.md "相关文档" 是否需要新增链接**

本计划已自动加入 `docs/superpowers/plans/` 目录，CLAUDE.md 的 specs/plans 段没有逐文件枚举，所以不需要新增链接。但需要扫一遍确保 CLAUDE.md 没引用过时配置（如"OTA 默认 0ms 不阻塞 splash"这类描述）。

---

## Task 7: 向用户汇报

- [ ] **Step 1: 汇总改动**

按文件列出每个增删改 + 行数。

- [ ] **Step 2: 汇总测试结果**

`node --test` 输出 + `npm run build` 输出 + Sub-agent 审查发现摘要。

- [ ] **Step 3: 列出决策点**

询问用户：
1. 是否 commit（按 type(scope) 风格分两个 commit：一个 website 改动，一个 app config）
2. 是否推 staging（website 改动会自动部署到 test-api 环境）
3. 是否触发 EAS build 新 APK（让 app.json 改动生效，朋友重新装就是最新版）

---

## Self-Review

**1. Spec coverage:**
- ✅ "OTA 用 fallbackToCacheTimeout=5000" → Task 4
- ✅ "/resolve 改纯 HTML" → Task 1+2+3
- ✅ "每完成一个任务用 subagent 审查" → 每个 Task 末尾 Step 都有
- ✅ "所有任务完成后新 subagent 审查" → Task 5
- ✅ "写测试覆盖所有可能情况" → Task 1 的 9 个 test cases
- ✅ "做测试" → Task 1 Step 4 + Task 3 Step 2

**2. Placeholder scan:**
- 无 TBD / TODO / fill in details
- 所有代码块都是完整可粘贴
- 所有命令都给了 Expected 输出

**3. Type consistency:**
- `decideRedirect(deps)` 在 Task 1 测试与 Task 1 实现签名一致
- `__API_BASE__` 占位符在 template + build script 一致
- VITE_API_BASE_URL 优先级与 `src/lib/apiBase.ts` 一致（env > 默认）

**4. Edge cases covered:**
- 空 cookieId / 空字符串 cookieId → fallback
- API 4xx / 网络断 / fetch 抛错 / 超时 → fallback
- referralCode 含特殊字符 → URI encode
- cookieId 含中文 / + / 空格 → URI encode
- 中文域名 → 重定向到英文域

**5. Risks acknowledged:**
- `fallbackToCacheTimeout: 5000` 弱网仍会回退到内嵌 bundle（已记录为预期行为）
- 现有 build-5-1.apk 已在外发，无法补救（用户朋友需要重装新 APK）
- Nginx `try_files` 命中行为依赖标准配置（如果服务器 Nginx 改过会失效，已在 Task 5 审查项中标出）
