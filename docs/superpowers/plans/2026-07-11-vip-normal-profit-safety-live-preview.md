# VIP/普通配置利润安全实时预检 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 VIP 和普通配置页面对未保存的候选参数执行 500ms 防抖利润安全预检，并复用团长页的安全结果语义与后端硬拦截。

**Architecture:** 前端新增一个无 React 依赖的候选预检工具，负责构造完整变化集、判断预检资格、执行 500ms 防抖并丢弃旧响应；该工具可由 Node 内置测试直接执行。候选预检 hook 只负责把表单状态接入工具并调用既有 `POST /admin/config/profit-safety-preview`。扩展现有 `ProfitSafetyStatus` 以区分已保存状态、候选校验中、候选安全/不安全、比例非法、字段非法和候选请求失败；VIP/普通页只接入该 hook，不修改后端公式或保存事务。

**Tech Stack:** React 19、TypeScript、Ant Design 5、TanStack Query、现有 Axios API client、Node built-in test runner。

## Global Constraints

- 仅使用现有 `previewProfitSafety({ updates })`，预检不得写 RuleConfig、版本历史或审计日志。
- 500ms 防抖；旧响应不得覆盖最新表单状态。
- 每次表单编辑使用新的候选预检版本号；撤销后重新填入相同候选值时，不得复用之前的预检结果。
- 七项比例不等于 100% 或表单存在字段校验错误时不发预检请求，既有保存拦截保持不变。
- 保存仍必须通过后端 `ProfitSafetyService` 的 Serializable + advisory lock 原子硬校验。
- 不改变 VIP 树、普通树、团长配置、订单快照、历史 V2 订单或付款链路。
- 保持当前管理后台颜色、排版、权限和 `ProfitSafetyStatus` 使用方式，不引入依赖。

---

## Chunk 1: Reusable Candidate Preview Layer

### Task 1: Build The Reusable Candidate Preview Hook And Status States

**Files:**
- Create: `admin/src/utils/configProfitSafetyPreview.ts`
- Create: `admin/src/hooks/useConfigProfitSafetyPreview.ts`
- Modify: `admin/src/components/ProfitSafetyStatus.tsx`
- Create: `admin/tests/profit-safety-live-preview.test.mjs`
- Create: `admin/tests/profit-safety-candidate.test.mjs`

**Interfaces:**
- Consumes: `RuleConfig[]`、表单值、`previewProfitSafety({ updates })`。
- Produces: `useConfigProfitSafetyPreview(input): ProfitSafetyPreviewState`。
- Produces: `ProfitSafetyStatus` optional candidate props without changing callers that only provide the saved server summary.
- Produces: testable `buildProfitSafetyCandidateUpdates`、`getProfitSafetyPreviewEligibility`、`createProfitSafetyPreviewScheduler` and `getProfitSafetyStatusPresentation` utility functions.
- The direct Node candidate test self-prepares and cleans its temporary CommonJS compilation artifact under `admin/.tmp/profit-safety-preview-test`.

- [x] **Step 1: Write failing executable and source-contract tests**

Create `admin/tests/profit-safety-candidate.test.mjs`. It must import the temporary CommonJS compilation of `src/utils/configProfitSafetyPreview.ts` with `createRequire`, then include these executable tests:

```js
const require = createRequire(import.meta.url);
const {
  buildProfitSafetyCandidateUpdates,
  getProfitSafetyPreviewEligibility,
  createProfitSafetyPreviewScheduler,
  getProfitSafetyStatusPresentation,
} = require('../.tmp/profit-safety-preview-test/configProfitSafetyPreview.js');

const schema = [
  { key: 'VIP_PLATFORM_PERCENT' },
  { key: 'VIP_REWARD_PERCENT' },
];
const configs = [
  { key: 'VIP_PLATFORM_PERCENT', value: { value: 0.50, description: '已保存平台占比' } },
  { key: 'VIP_REWARD_PERCENT', value: { value: 0.25, description: '已保存奖励占比' } },
];
const values = {
  VIP_PLATFORM_PERCENT: 0.45,
  VIP_REWARD_PERCENT: 0.30,
};
const updates = buildProfitSafetyCandidateUpdates(configs, values, schema);

test('builds every changed schema value as one complete candidate update set', () => {
  assert.deepEqual(buildProfitSafetyCandidateUpdates(configs, values, schema), [
    { key: 'VIP_PLATFORM_PERCENT', value: { value: 0.45 } },
    { key: 'VIP_REWARD_PERCENT', value: { value: 0.30 } },
  ]);
});

test('blocks previews for incomplete forms, invalid ratio totals, and field errors', () => {
  assert.equal(getProfitSafetyPreviewEligibility({ enabled: true, valuesReady: false, updates, sumValid: true, hasValidationErrors: false }), 'saved');
  assert.equal(getProfitSafetyPreviewEligibility({ enabled: true, valuesReady: true, updates, sumValid: false, hasValidationErrors: false }), 'invalid-ratio');
  assert.equal(getProfitSafetyPreviewEligibility({ enabled: true, valuesReady: true, updates, sumValid: true, hasValidationErrors: true }), 'invalid-form');
});

test('debounces to the latest updates and discards an older response', async () => {
  const pendingTimers = new Map();
  let nextTimerId = 0;
  const timers = {
    set(callback, delayMs) {
      const id = ++nextTimerId;
      pendingTimers.set(id, { callback, delayMs });
      return id;
    },
    clear(id) {
      pendingTimers.delete(id);
    },
  };
  const runOnlyTimer = () => {
    assert.equal(pendingTimers.size, 1);
    const [id, timer] = pendingTimers.entries().next().value;
    assert.equal(timer.delayMs, 500);
    pendingTimers.delete(id);
    timer.callback();
  };
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
  };
  const first = deferred();
  const second = deferred();
  const requests = [];
  const candidates = [];
  const scheduler = createProfitSafetyPreviewScheduler({
    delayMs: 500,
    timers,
    preview: (updates) => {
      requests.push(updates);
      return requests.length === 1 ? first.promise : second.promise;
    },
    onChecking: () => undefined,
    onCandidate: (summary) => candidates.push(summary),
    onError: (error) => { throw error; },
  });
  scheduler.schedule([{ key: 'A', value: { value: 0.2 } }]);
  runOnlyTimer();
  scheduler.schedule([{ key: 'B', value: { value: 0.3 } }]);
  runOnlyTimer();
  second.resolve({ id: 'new' });
  await Promise.resolve();
  first.resolve({ id: 'old' });
  await Promise.resolve();
  assert.deepEqual(requests, [
    [{ key: 'A', value: { value: 0.2 } }],
    [{ key: 'B', value: { value: 0.3 } }],
  ]);
  assert.deepEqual(candidates, [{ id: 'new' }]);
});

test('maps every candidate status to its visible presentation and captain action', () => {
  assert.deepEqual(getProfitSafetyStatusPresentation({ preview: { mode: 'checking' } }), {
    kind: 'message', type: 'info', message: '正在校验未保存参数', showCaptainLink: false,
  });
  assert.deepEqual(getProfitSafetyStatusPresentation({ preview: { mode: 'candidate', safe: false }, linkCaptain: true }), {
    kind: 'summary', source: 'candidate', type: 'error', message: '未保存参数未通过利润安全校验', showCaptainLink: true,
  });
  assert.deepEqual(getProfitSafetyStatusPresentation({ preview: { mode: 'candidate', safe: true } }), {
    kind: 'summary', source: 'candidate', type: 'success', message: '未保存参数通过利润安全校验', showCaptainLink: false,
  });
  assert.equal(getProfitSafetyStatusPresentation({ preview: { mode: 'invalid-form' } }).message, '请先修正存在校验错误的参数再校验利润安全');
  assert.equal(getProfitSafetyStatusPresentation({ preview: { mode: 'error', errorMessage: '网络超时' } }).message, '未保存参数的利润安全校验失败');
  assert.deepEqual(getProfitSafetyStatusPresentation({ saved: { safe: true } }), {
    kind: 'summary', source: 'saved', type: 'success', message: '服务器利润安全校验通过', showCaptainLink: false,
  });
  assert.deepEqual(getProfitSafetyStatusPresentation({ saved: { safe: false }, linkCaptain: true }), {
    kind: 'summary', source: 'saved', type: 'error', message: '服务器利润安全校验未通过', showCaptainLink: true,
  });
  assert.deepEqual(getProfitSafetyStatusPresentation({ loading: true }), {
    kind: 'message', type: 'info', message: '正在读取服务器利润安全状态', showCaptainLink: false,
  });
  assert.deepEqual(getProfitSafetyStatusPresentation({ errorMessage: '请求超时' }), {
    kind: 'message', type: 'warning', message: '利润安全状态暂不可用', description: '请求超时', showCaptainLink: false,
  });
});
```

Create `admin/tests/profit-safety-live-preview.test.mjs` with source-contract assertions that the hook uses the tested scheduler, calls `previewProfitSafety({ updates })`, invalidates stale requests on every effect change and cleanup, and that `ProfitSafetyStatus` contains all required candidate messages.

- [x] **Step 2: Run the new test to verify RED**

Run:

```bash
cd admin
rm -rf .tmp/profit-safety-preview-test
mkdir -p .tmp/profit-safety-preview-test
printf '{"type":"commonjs"}' > .tmp/profit-safety-preview-test/package.json
npx tsc --target ES2022 --module commonjs --moduleResolution node --strict --skipLibCheck --rootDir src/utils --outDir .tmp/profit-safety-preview-test src/utils/configProfitSafetyPreview.ts
node --test tests/profit-safety-candidate.test.mjs tests/profit-safety-live-preview.test.mjs
```

Expected: the TypeScript compile fails with `TS6053` because the new utility file does not yet exist; therefore the test command does not run and the complete command block exits nonzero.

- [x] **Step 3: Implement the tested candidate utility**

Create `admin/src/utils/configProfitSafetyPreview.ts`; it must not import React, Ant Design, the API client, or application aliases, so the test can compile it in isolation. Define these public interfaces and functions:

```ts
export interface ProfitSafetyPreviewConfigMeta { key: string }
export type ProfitSafetyPreviewMode = 'saved' | 'ready' | 'invalid-ratio' | 'invalid-form';

export function buildProfitSafetyCandidateUpdates(
  configs: Array<{ key: string; value: unknown }>,
  values: Record<string, unknown>,
  schema: readonly ProfitSafetyPreviewConfigMeta[],
): Array<{ key: string; value: { value: unknown } }>;

export function getProfitSafetyPreviewEligibility(input: {
  enabled: boolean;
  valuesReady: boolean;
  updates: Array<{ key: string; value: { value: unknown } }>;
  sumValid: boolean;
  hasValidationErrors: boolean;
}): ProfitSafetyPreviewMode;

export function createProfitSafetyPreviewScheduler<TSummary>(input: {
  delayMs: number;
  preview: (updates: Array<{ key: string; value: { value: unknown } }>) => Promise<TSummary>;
  timers: { set(callback: () => void, delayMs: number): unknown; clear(handle: unknown): void };
  onChecking(): void;
  onCandidate(summary: TSummary): void;
  onError(error: Error): void;
}): { schedule(updates: Array<{ key: string; value: { value: unknown } }>): void; invalidate(): void };

export function getProfitSafetyStatusPresentation(input: {
  preview?: { mode: 'checking' | 'candidate' | 'invalid-ratio' | 'invalid-form' | 'error'; safe?: boolean; errorMessage?: string };
  saved?: { safe: boolean };
  loading?: boolean;
  errorMessage?: string;
  linkCaptain?: boolean;
}): { kind: 'none' | 'message' | 'summary'; type?: 'info' | 'warning' | 'success' | 'error'; source?: 'candidate' | 'saved'; message?: string; description?: string; showCaptainLink: boolean };
```

`buildProfitSafetyCandidateUpdates` must read the saved raw value by unwrapping `RuleConfig.value.value` when present. `getProfitSafetyPreviewEligibility` must return `saved` when disabled, form values are incomplete, or no key changed; then `invalid-ratio`; then `invalid-form`; otherwise `ready`. The scheduler must increment a generation on both `schedule` and `invalidate`, clear the previous timer, call `onChecking` only after the delay, and apply success/error only when its generation is current.

`getProfitSafetyStatusPresentation` must return the exact following visible presentation contract; candidate request errors use their error text as `description`, and a saved-summary fetch error uses `errorMessage` as `description`:

| State | `kind` / `type` / `source` | `message` | `showCaptainLink` |
|---|---|---|---|
| Candidate checking | `message` / `info` / none | 正在校验未保存参数 | false |
| Candidate ratio invalid | `message` / `warning` / none | 请先使七项比例合计为 100% 再校验利润安全 | false |
| Candidate form invalid | `message` / `warning` / none | 请先修正存在校验错误的参数再校验利润安全 | false |
| Candidate request error | `message` / `warning` / none | 未保存参数的利润安全校验失败 | false |
| Candidate safe | `summary` / `success` / `candidate` | 未保存参数通过利润安全校验 | false |
| Candidate unsafe | `summary` / `error` / `candidate` | 未保存参数未通过利润安全校验 | `linkCaptain` |
| Saved safe | `summary` / `success` / `saved` | 服务器利润安全校验通过 | false |
| Saved unsafe | `summary` / `error` / `saved` | 服务器利润安全校验未通过 | `linkCaptain` |
| Saved loading | `message` / `info` / none | 正在读取服务器利润安全状态 | false |
| Saved-summary fetch error | `message` / `warning` / none | 利润安全状态暂不可用 | false |

- [x] **Step 4: Implement the hook and status rendering**

Create `useConfigProfitSafetyPreview.ts` with these exact responsibilities:

```ts
export type ProfitSafetyPreviewState =
  | { mode: 'saved' }
  | { mode: 'checking' }
  | { mode: 'candidate'; summary: ProfitSafetySummary }
  | { mode: 'invalid-ratio' }
  | { mode: 'invalid-form' }
  | { mode: 'error'; error: Error };

export function useConfigProfitSafetyPreview({
  configs,
  values,
  schema,
  sumValid,
  hasValidationErrors,
  enabled,
  delayMs = 500,
}: UseConfigProfitSafetyPreviewInput): ProfitSafetyPreviewState;
```

The file must import `RuleConfig` and `ProfitSafetySummary` from `@/types`, import the four utility functions from `@/utils/configProfitSafetyPreview`, and define the exact input interface:

```ts
export interface UseConfigProfitSafetyPreviewInput {
  configs: RuleConfig[];
  values?: Record<string, unknown>;
  schema: readonly ProfitSafetyPreviewConfigMeta[];
  sumValid: boolean;
  hasValidationErrors: boolean;
  enabled: boolean;
  delayMs?: number;
}
```

Use one `useRef` scheduler. Normalize `values` once with `const formValues = values ?? {}` and derive `valuesReady` with `values !== undefined && schema.every(({ key }) => Object.hasOwn(formValues, key))`; never pass optional `values` directly to `Object.hasOwn`. `useEffect` must invalidate the scheduler before evaluating every new input state, then either set `saved` / `invalid-ratio` / `invalid-form` immediately or schedule the ready candidate. Its cleanup must call `invalidate()` so an unmounted page, a saved page, a config reload, a newly invalid field, or an edited value cannot accept an obsolete response. The scheduler API call is exactly `previewProfitSafety({ updates })`; normalize a non-`Error` rejection to `new Error('预检请求失败')`.

Pass `enabled: configs.length > 0 && dirty` from both pages. This makes successful saves (`setDirty(false)`) synchronously return the displayed state to the saved server summary; failed saves do not change `dirty`, form values, or the latest candidate state.

Extend `ProfitSafetyStatus` without duplicating its economics display. Add optional `previewState?: ProfitSafetyPreviewState`; use `getProfitSafetyStatusPresentation` for Alert type/message/source/action, then render its candidate or saved summary through the current failed-scenario, limiting-SKU, shortfall, `summary.errors`, and `shouldLinkCaptainSettings` code path. Candidate unsafe output must retain the existing `处理团长冲突` jump when `showCaptainLink=true`.

Add an optional `previewState?: ProfitSafetyPreviewState` prop to `ProfitSafetyStatus`.

Required visible states:

```tsx
if (previewState?.mode === 'checking') {
  return <Alert type="info" showIcon message="正在校验未保存参数" />;
}
if (previewState?.mode === 'invalid-ratio') {
  return <Alert type="warning" showIcon message="请先使七项比例合计为 100% 再校验利润安全" />;
}
if (previewState?.mode === 'invalid-form') {
  return <Alert type="warning" showIcon message="请先修正存在校验错误的参数再校验利润安全" />;
}
if (previewState?.mode === 'error') {
  return <Alert type="warning" showIcon message="未保存参数的利润安全校验失败" description={previewState.error.message} />;
}
```

For `candidate`, reuse the existing scenario/SKU/shortfall rendering while changing the result heading to `未保存参数通过利润安全校验` or `未保存参数未通过利润安全校验`. For `saved`, preserve current output byte-for-byte where practical.

- [x] **Step 5: Run the hook/status tests to verify GREEN**

Run:

```bash
cd admin
rm -rf .tmp/profit-safety-preview-test
mkdir -p .tmp/profit-safety-preview-test
printf '{"type":"commonjs"}' > .tmp/profit-safety-preview-test/package.json
npx tsc --target ES2022 --module commonjs --moduleResolution node --strict --skipLibCheck --rootDir src/utils --outDir .tmp/profit-safety-preview-test src/utils/configProfitSafetyPreview.ts
node --test tests/profit-safety-candidate.test.mjs tests/profit-safety-live-preview.test.mjs
npx tsc -b --pretty false
```

Expected: the isolated TypeScript compilation, both Node test files, and the admin TypeScript build all exit 0.

- [x] **Step 6: Commit the isolated reusable layer**

```bash
git add admin/src/utils/configProfitSafetyPreview.ts admin/src/hooks/useConfigProfitSafetyPreview.ts admin/src/components/ProfitSafetyStatus.tsx admin/tests/profit-safety-candidate.test.mjs admin/tests/profit-safety-live-preview.test.mjs
git commit -m "feat: add candidate profit safety preview"
```

## Chunk 2: VIP And Normal Configuration Integration

### Task 2: Add Live Candidate Preview To VIP Configuration

**Files:**
- Modify: `admin/src/pages/bonus/vip-config.tsx`
- Modify: `admin/tests/profit-safety-live-preview.test.mjs`

**Interfaces:**
- Consumes: `useConfigProfitSafetyPreview` from Task 1.
- Produces: VIP configuration page candidate preview for every unsaved configuration change while preserving current save confirmation and batch write.

- [x] **Step 1: Write the failing VIP integration source-contract test**

Append:

```js
test('VIP configuration previews complete unsaved changes before save', () => {
  const page = read('../src/pages/bonus/vip-config.tsx');
  assert.match(page, /useConfigProfitSafetyPreview/);
  assert.match(page, /hasValidationErrors/);
  assert.match(page, /enabled: configs\.length > 0 && dirty/);
  assert.match(page, /previewState=\{profitSafetyPreview\}/);
  assert.match(page, /onValuesChange=\{\(\) => setDirty\(true\)\}/);
  assert.match(page, /setDirty\(false\)/);
});
```

- [x] **Step 2: Run the VIP test to verify RED**

Run:

```bash
cd admin
node --test tests/profit-safety-live-preview.test.mjs
```

Expected: FAIL because VIP page does not yet call the hook or pass `previewState`.

- [x] **Step 3: Integrate the hook into VIP configuration**

After `allValues` and `sumValid` are computed, calculate `hasValidationErrors` from `form.getFieldsError()` in a memo keyed by `allValues`, then create:

```ts
const profitSafetyPreview = useConfigProfitSafetyPreview({
  configs,
  values: allValues,
  schema: CONFIG_SCHEMA,
  sumValid,
  hasValidationErrors,
  enabled: configs.length > 0 && dirty && canUpdateConfig,
});
```

Update the existing status component:

```tsx
<ProfitSafetyStatus
  summary={safetyQuery.data}
  loading={safetyQuery.isLoading}
  error={safetyQuery.error}
  previewState={profitSafetyPreview}
/>
```

Do not alter `doSave`, `handleSave`, change confirmation copy, `batchUpdateConfig`, or the seven-ratio save rule. Preserve the existing successful `setDirty(false)` after `batchUpdateConfig`; it is the explicit preview reset. Preserve the catch path without changing `dirty`, so a rejected save retains the form and candidate result.

- [x] **Step 4: Verify VIP GREEN**

Run:

```bash
cd admin
rm -rf .tmp/profit-safety-preview-test
mkdir -p .tmp/profit-safety-preview-test
printf '{"type":"commonjs"}' > .tmp/profit-safety-preview-test/package.json
npx tsc --target ES2022 --module commonjs --moduleResolution node --strict --skipLibCheck --rootDir src/utils --outDir .tmp/profit-safety-preview-test src/utils/configProfitSafetyPreview.ts
node --test tests/profit-safety-candidate.test.mjs tests/profit-safety-live-preview.test.mjs
npx tsc -b --pretty false
npm run build
```

Expected: all commands exit 0.

- [x] **Step 5: Commit VIP integration**

```bash
git add admin/src/pages/bonus/vip-config.tsx admin/tests/profit-safety-live-preview.test.mjs
git commit -m "feat: preview VIP profit safety changes"
```

### Task 3: Add Live Candidate Preview To Normal Configuration

**Files:**
- Modify: `admin/src/pages/bonus/normal-config.tsx`
- Modify: `admin/tests/profit-safety-live-preview.test.mjs`

**Interfaces:**
- Consumes: `useConfigProfitSafetyPreview` from Task 1.
- Produces: Normal configuration page candidate preview matching VIP and captain semantics.

- [x] **Step 1: Write the failing normal integration source-contract test**

Append:

```js
test('normal configuration previews complete unsaved changes before save', () => {
  const page = read('../src/pages/bonus/normal-config.tsx');
  assert.match(page, /useConfigProfitSafetyPreview/);
  assert.match(page, /hasValidationErrors/);
  assert.match(page, /enabled: configs\.length > 0 && dirty/);
  assert.match(page, /previewState=\{profitSafetyPreview\}/);
  assert.match(page, /batchUpdateConfig/);
  assert.match(page, /setDirty\(false\)/);
});
```

- [x] **Step 2: Run the normal test to verify RED**

Run:

```bash
cd admin
node --test tests/profit-safety-live-preview.test.mjs
```

Expected: FAIL because normal page does not yet call the hook or pass `previewState`.

- [x] **Step 3: Integrate the hook into normal configuration**

After `allValues` and `sumValid` are computed, calculate `hasValidationErrors` from `form.getFieldsError()` in a memo keyed by `allValues`. Pass the following exact input:

```ts
const profitSafetyPreview = useConfigProfitSafetyPreview({
  configs,
  values: allValues,
  schema: CONFIG_SCHEMA,
  sumValid,
  hasValidationErrors,
  enabled: configs.length > 0 && dirty && canUpdateConfig,
});
```

```tsx
<ProfitSafetyStatus
  summary={safetyQuery.data}
  loading={safetyQuery.isLoading}
  error={safetyQuery.error}
  previewState={profitSafetyPreview}
/>
```

Do not change normal tree fields, reward expiry fields, the confirmation modal, or the backend batch update path. Keep the successful `setDirty(false)` after `batchUpdateConfig` as the preview reset and keep the error path unchanged so it preserves the candidate result.

- [x] **Step 4: Verify normal GREEN**

Run:

```bash
cd admin
rm -rf .tmp/profit-safety-preview-test
mkdir -p .tmp/profit-safety-preview-test
printf '{"type":"commonjs"}' > .tmp/profit-safety-preview-test/package.json
npx tsc --target ES2022 --module commonjs --moduleResolution node --strict --skipLibCheck --rootDir src/utils --outDir .tmp/profit-safety-preview-test src/utils/configProfitSafetyPreview.ts
node --test tests/profit-safety-candidate.test.mjs tests/profit-safety-live-preview.test.mjs
npx tsc -b --pretty false
npm run build
```

Expected: all commands exit 0.

- [x] **Step 5: Commit normal integration**

```bash
git add admin/src/pages/bonus/normal-config.tsx admin/tests/profit-safety-live-preview.test.mjs
git commit -m "feat: preview normal profit safety changes"
```

## Chunk 3: Documentation And Final Regression

### Task 4: Document And Perform Final Regression

**Files:**
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/superpowers/plans/2026-07-11-vip-normal-profit-safety-live-preview.md`
- Modify: `plan.md`
- Modify: `admin/tests/profit-safety-live-preview.test.mjs`

**Interfaces:**
- Produces: documentation that tells administrators candidate previews are advisory and save-time backend validation remains authoritative.

- [x] **Step 1: Add exact documentation assertions to the source-contract test**

Append this test to `admin/tests/profit-safety-live-preview.test.mjs`:

```js
test('admin architecture documents VIP and normal candidate safety previews', () => {
  const doc = read('../../docs/architecture/admin-frontend.md');
  assert.match(doc, /VIP 系统配置页/);
  assert.match(doc, /普通用户系统配置页/);
  assert.match(doc, /useConfigProfitSafetyPreview/);
  assert.match(doc, /500ms/);
  assert.match(doc, /候选.*不落库/);
  assert.match(doc, /保存.*原子校验/);
});
```

- [x] **Step 2: Run the documentation test to verify RED**

Run:

```bash
cd admin
node --test tests/profit-safety-live-preview.test.mjs
```

Expected: FAIL because the new behavior is not yet documented.

- [x] **Step 3: Update architecture and project plan documentation**

Add a dedicated subsection under the existing configuration-page documentation with the final operational contract:

```text
VIP 系统配置页和普通用户系统配置页均通过 useConfigProfitSafetyPreview 对未保存参数做 500ms 候选预检。仅在配置已加载、表单已变更且管理员具备 config:update 权限、七项比例有效并且没有字段校验错误时运行；比例合计非法或存在字段校验错误时不预检。候选浏览器预检是建议性的只读结果，不写入 RuleConfig、配置版本或审计记录。保存时后端仍在 Serializable 事务和 advisory lock 内重新执行原子硬校验，浏览器预检不能替代保存校验。
```

After and only after every final verification command in Step 4 exits 0, change each checklist item in this plan from `- [ ]` to `- [x]`. Then add a dated completed entry directly under `plan.md` heading `### 近期完成补充`, naming both configuration pages, the 500ms candidate preview, stale-response discard, and the final save-time hard validation.

- [x] **Step 4: Run final verification**

Run:

```bash
cd admin
node --test tests/profit-safety-candidate.test.mjs tests/profit-safety-live-preview.test.mjs tests/profit-reconciliation-ui.test.mjs
npx tsc -b --pretty false
npm run build
cd ..
git diff --check
git status --short
```

Expected: the direct Node candidate test self-prepares and cleans its temporary compilation artifact; all verification commands exit 0; only intended files are modified.

- [x] **Step 5: Commit final documentation and verification state**

```bash
git add admin/tests/profit-safety-live-preview.test.mjs docs/architecture/admin-frontend.md docs/superpowers/plans/2026-07-11-vip-normal-profit-safety-live-preview.md plan.md
git commit -m "docs: complete live profit safety previews"
```

## Plan Self-Review

- Spec coverage: Tasks 1-3 cover debounced candidate preview, stale-response protection, invalid-ratio behavior, candidate status display and both configuration pages. Task 4 covers documentation and complete regression.
- 空白标记扫描：未发现未填内容或未指定的测试命令。
- Type consistency: the hook input, `ProfitSafetyPreviewState` and `previewState` prop use the same names across all tasks.
