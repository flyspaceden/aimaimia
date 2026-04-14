# AI Voice Operation Lane Convergence v1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 AI 语音入口收敛为“操作型语音主线”，保证高频语音请求默认列表优先、执行边界可控、操作链路在线预算固定为 `0 或 1` 次轻模型调用。

**Architecture:** 保留现有 `/ai/voice-intent` 入口和 Nest `AiModule`，但把运行时逻辑收敛为 `router -> normalizer -> resolver -> execution policy`。第一阶段采用**增量接线**：`OperationRouter` 先作为现有分类链路的前置短路层，命中快路时直接返回，未命中时继续回退到当前 `AiService` 分类路径；前端只消费结构化动作，不再根据自然语言残句推断详情页或搜索词。

**Tech Stack:** NestJS / Prisma / Jest / TypeScript / Expo Router / React Native / Expo AV

**Spec:** `docs/superpowers/specs/2026-04-03-ai-voice-operation-lane-design.md`

---

## Scope Check

这份 spec 涉及后端执行链路、前端动作执行、观测与回放，但它们共享一套 `voice-intent` 协议和同一条操作主链路，拆成多份 plan 会让契约改动失去同步性。因此本次保持为一份 plan，按 chunk 分阶段落地。

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `backend/src/modules/ai/voice-intent.types.ts` | 扩展后端操作型语音 contract、structured action、细分 timing 字段 |
| Create | `backend/src/modules/ai/operation-router.service.ts` | 规则快路与“是否进入 normalize”判断 |
| Create | `backend/src/modules/ai/operation-router.service.spec.ts` | 路由规则单测（页面 / 订单 / 商品搜索 / 企业列表 / 非操作请求） |
| Create | `backend/src/modules/ai/execution-policy.service.ts` | 默认列表优先、详情阈值、加购与订单直达规则 |
| Create | `backend/src/modules/ai/execution-policy.service.spec.ts` | 执行策略单测（list/detail/add-to-cart/order） |
| Create | `backend/src/modules/ai/entity-resolver.service.ts` | 商品 / 企业 / 订单 / 页面解析与 list/detail 资格判断的薄封装与 delegation |
| Modify | `backend/src/modules/ai/ai.service.ts` | 编排主链路，注入 router/resolver/policy，收紧 `Flash -> Plus` 在线路径，记录 richer timing |
| Modify | `backend/src/modules/ai/ai.module.ts` | 注册新 service provider |
| Modify | `backend/src/modules/ai/ai.service.company-voice.spec.ts` | 保留并补强企业列表优先回归用例 |
| Create | `backend/src/modules/ai/ai.service.operation-lane.spec.ts` | 端到端编排层回归（list-first、chat short-circuit、timing/model metadata） |
| Create | `backend/scripts/export-operation-lane-replay.ts` | 从真实 `AiUtterance` 导出操作型语音回放样本 |
| Modify | `backend/package.json` | 增加 replay 导出脚本 |
| Modify | `src/types/domain/Ai.ts` | 同步前端操作型语音 contract 与 structured action 字段 |
| Modify | `src/utils/navigateByIntent.ts` | 从“半个解释器”收敛为结构化动作执行器 |
| Modify | `src/hooks/useVoiceRecording.ts` | 对接新的 structured action/clarify/fallback 行为 |
| Modify | `src/repos/AiAssistantRepo.ts` | 如需补充 voice-intent response typing，在 Repo 层统一处理 |
| Modify | `app/search.tsx` | 商品列表页按 structured params 执行，避免详情误跳 |
| Modify | `app/company/search.tsx` | 企业列表页继续清理脏 `q`，保持 `location/industry/type/tags` 优先 |
| Reference | `docs/superpowers/specs/2026-04-03-ai-voice-operation-lane-design.md` | 设计依据 |
| Reference | `ai.md` | 当前主线、性能预算、候选增强项说明 |

**Testing note:** 仓库当前只有后端 Jest 测试基础设施，没有前端单测 runner。本计划坚持 TDD 于后端执行链路；前端部分以纯函数重构、TypeScript 编译和真机 smoke 测试为主，不在本次计划里引入新的前端测试框架。性能目标中的 `<= 2s` 口径按 spec 执行，**只计算 ASR 最终文本出来之后到前端收到 structured action 之间的链路延迟**。

---

## Chunk 1: Backend Contract And Control Services

### Task 1: Define the operation-lane contract and execution policy

**Files:**
- Modify: `backend/src/modules/ai/voice-intent.types.ts`
- Create: `backend/src/modules/ai/execution-policy.service.ts`
- Create: `backend/src/modules/ai/execution-policy.service.spec.ts`
- Reference: `docs/superpowers/specs/2026-04-03-ai-voice-operation-lane-design.md`

**Outcome:** 后端先拥有明确的 structured action contract 和 list-first 执行规则，后续 router/resolver/前端都围绕同一契约实现。

- [ ] **Step 1: Write the failing execution-policy tests**

```typescript
describe('ExecutionPolicyService', () => {
  it('商品搜索即使命中单商品，默认仍回结果页，除非明确 detail 语气', () => {
    const result = service.decideSearchAction({
      transcript: '找苹果',
      confidence: 0.95,
      resolved: { query: '苹果', matchedProductId: 'p-1', matchedProductName: '烟台苹果' },
      explicitDetail: false,
      explicitAddToCart: false,
    });

    expect(result).toMatchObject({
      actionType: 'open_search_results',
      route: '/search',
      params: { q: '苹果', source: 'voice' },
    });
  });

  it('企业请求默认进入列表页，只有明确 detail 且唯一命中时才进详情', () => {
    const result = service.decideCompanyAction({
      transcript: '帮我找武汉的企业',
      confidence: 0.96,
      resolved: { companyMode: 'list', companyLocation: '武汉' },
      explicitDetail: false,
    });

    expect(result).toMatchObject({
      actionType: 'open_company_results',
      route: '/company/search',
      params: { location: '武汉', source: 'voice' },
    });
  });

  it('加购物车只有动作明确且唯一商品高置信时才允许直接执行', () => {
    const result = service.decideSearchAction({
      transcript: '把土鸡蛋加入购物车',
      confidence: 0.97,
      resolved: { query: '土鸡蛋', matchedProductId: 'p-egg-1', matchedProductName: '土鸡蛋' },
      explicitDetail: false,
      explicitAddToCart: true,
    });

    expect(result.actionType).toBe('add_to_cart');
  });
});
```

- [ ] **Step 2: Run the policy tests to verify they fail**

Run:

```bash
cd backend && npx jest --runInBand src/modules/ai/execution-policy.service.spec.ts
```

Expected: FAIL because `ExecutionPolicyService` and new action fields do not exist yet.

- [ ] **Step 3: Add contract types and implement the minimal policy service**

In `backend/src/modules/ai/voice-intent.types.ts`, add a structured action payload owned by the backend:

```typescript
export type AiVoiceActionType =
  | 'open_search_results'
  | 'open_company_results'
  | 'open_product_detail'
  | 'open_company_detail'
  | 'open_orders'
  | 'open_order_detail'
  | 'open_route'
  | 'add_to_cart'
  | 'show_feedback';

export interface AiVoiceExecutionAction {
  actionType: AiVoiceActionType;
  route?: string;
  params?: Record<string, string>;
  requiresAuth?: boolean;
}
```

Implement `ExecutionPolicyService` with narrow public methods:

```typescript
decideSearchAction(input: SearchExecutionInput): AiVoiceExecutionAction
decideCompanyAction(input: CompanyExecutionInput): AiVoiceExecutionAction
decideTransactionAction(input: TransactionExecutionInput): AiVoiceExecutionAction
decideNavigateAction(input: NavigateExecutionInput): AiVoiceExecutionAction
```

Hard rules:
- 默认结果页/列表页
- detail 需要 `explicitDetail === true` + 单对象命中 + `confidence >= DETAIL_THRESHOLD`
- add-to-cart 需要 `explicitAddToCart === true` + 单商品命中 + `confidence >= CART_THRESHOLD`
- 订单默认列表，只有单订单高置信时才进详情

- [ ] **Step 4: Re-run the policy tests and keep the implementation minimal**

Run:

```bash
cd backend && npx jest --runInBand src/modules/ai/execution-policy.service.spec.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/voice-intent.types.ts \
  backend/src/modules/ai/execution-policy.service.ts \
  backend/src/modules/ai/execution-policy.service.spec.ts
git commit -m "feat(ai): add operation execution policy"
```

### Task 2: Extract the fast operation router

**Files:**
- Create: `backend/src/modules/ai/operation-router.service.ts`
- Create: `backend/src/modules/ai/operation-router.service.spec.ts`
- Modify: `backend/src/modules/ai/ai.service.company-voice.spec.ts`
- Reference: `backend/src/modules/ai/ai.service.ts`

**Outcome:** 高频明确请求先在规则层被分类成 `fast-rule / semantic-normalize / reject`，不再默认掉入大而全的 `AiService` 分支。

- [ ] **Step 1: Write failing router tests for fast-route coverage**

```typescript
describe('OperationRouterService', () => {
  it('打开购物车 -> fast-rule navigate', () => {
    expect(service.route('打开购物车')).toMatchObject({
      routeMode: 'fast-rule',
      intent: 'navigate',
      pipeline: 'rule',
    });
  });

  it('帮我找武汉的企业 -> fast-rule company list', () => {
    expect(service.route('帮我找武汉的企业')).toMatchObject({
      routeMode: 'fast-rule',
      intent: 'company',
      params: { mode: 'list', location: '武汉' },
    });
  });

  it('今天几号 -> reject from operation lane', () => {
    expect(service.route('今天几号')).toMatchObject({
      routeMode: 'reject',
      reason: 'out-of-scope',
    });
  });
});
```

- [ ] **Step 2: Run the router tests to verify they fail**

Run:

```bash
cd backend && npx jest --runInBand src/modules/ai/operation-router.service.spec.ts
```

Expected: FAIL because `OperationRouterService` does not exist yet.

- [ ] **Step 3: Implement `OperationRouterService` using existing rule helpers, not a second rule engine**

Implementation approach:
- move or wrap current `classifyIntentByRules()` usage into a focused service
- expose a single return shape:

```typescript
type OperationRouteDecision = {
  routeMode: 'fast-rule' | 'semantic-normalize' | 'reject';
  intent?: VoiceIntentClassificationType;
  params?: Record<string, unknown>;
  pipeline?: 'rule' | 'flash';
  reason?: 'out-of-scope' | 'need-normalize';
};
```

Keep scope narrow:
- page navigation
- order lookup
- obvious product search
- obvious company list/search
- reject chat/open-ended queries at operation entry

Migration constraint:
- `OperationRouter` 在第一版里只做**前置短路**
- 命中 `fast-rule` 时提前返回
- 未命中时继续回落到现有 `classifyIntent()` / `dispatchClassification()` 链路
- 不在这个任务里替换整条旧分类链

- [ ] **Step 4: Re-run router specs and existing company regression**

Run:

```bash
cd backend && npx jest --runInBand \
  src/modules/ai/operation-router.service.spec.ts \
  src/modules/ai/ai.service.company-voice.spec.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/operation-router.service.ts \
  backend/src/modules/ai/operation-router.service.spec.ts \
  backend/src/modules/ai/ai.service.company-voice.spec.ts
git commit -m "feat(ai): add operation fast router"
```

### Task 3: Add entity resolution orchestration and wire `AiService`

**Files:**
- Create: `backend/src/modules/ai/entity-resolver.service.ts`
- Modify: `backend/src/modules/ai/ai.service.ts`
- Modify: `backend/src/modules/ai/ai.module.ts`
- Create: `backend/src/modules/ai/ai.service.operation-lane.spec.ts`

**Outcome:** `AiService` 变成编排层，真正的运行时顺序清晰为 `router -> normalizer -> resolver -> execution policy`，并记录 richer timing。

- [ ] **Step 1: Write a failing orchestration spec for the list-first chain**

```typescript
describe('AiService operation lane', () => {
  it('company list 请求应走 fast-rule -> resolver -> execution policy，不触发 plus', async () => {
    const result = await service.parseIntent('帮我找武汉的企业', 'voice');

    expect(result.resolved?.actionType).toBe('open_company_results');
    expect(result.resolved?.route).toBe('/company/search');
    expect(result.resolved?.params).toMatchObject({ location: '武汉', source: 'voice' });
    expect(result.timing?.router_ms).toBeDefined();
    expect(result.timing?.execution_ms).toBeDefined();
    expect(result.modelInfo?.modelUsed).not.toBe('qwen-plus');
  });

  it('非操作请求应安全反馈，不借用操作主链路预算', async () => {
    const result = await service.parseIntent('今天几号', 'voice');

    expect(result.type).toBe('chat');
    expect(result.fallbackReason).toBe('out-of-scope');
  });
});
```

- [ ] **Step 2: Run the orchestration spec to verify it fails**

Run:

```bash
cd backend && npx jest --runInBand src/modules/ai/ai.service.operation-lane.spec.ts
```

Expected: FAIL because `AiService` does not yet emit route-stage timing or structured action payloads.

- [ ] **Step 3: Implement the orchestration refactor in minimal slices**

Inside `AiService.parseIntent()` and `parseVoiceIntent()`:
- measure `router_ms / normalize_ms / resolve_ms / execution_ms / total_ms`
- call `OperationRouterService` first
- only call semantic normalization when `routeMode === 'semantic-normalize'`
- use `EntityResolverService` to turn slots into real list/detail candidates
- call `ExecutionPolicyService` for final `actionType / route / params`
- write `modelInfo.modelUsed`, `modelInfo.fastRouteHit`, `modelInfo.wasUpgraded`

EntityResolver constraint:
- `EntityResolverService` 第一版只做薄封装和 delegation
- 优先复用现有商品搜索、企业匹配、订单查询辅助逻辑
- 不要在这个任务里复制或重写完整的 `ProductService / CompanyService / OrderService` 解析树

Target shape returned to frontend:

```typescript
return this.enrichIntent(baseIntent, {
  resolved: {
    ...resolvedSlots,
    actionType: action.actionType,
    route: action.route,
    params: action.params,
  },
  timing: {
    router_ms,
    normalize_ms,
    resolve_ms,
    execution_ms,
    total_ms,
  },
});
```

Do **not** try to fully delete existing legacy branches in the same task. Keep old helpers behind the new orchestrator until all tests pass.

Incremental wiring rule:
- `OperationRouterService` 作为 `AiService` 的前置拦截
- fast-route 命中时直接进入 resolver/policy
- miss 时回落到现有分类链，再把结果接到 resolver/policy
- 先证明新编排不退化，再考虑进一步缩减 legacy 分支

- [ ] **Step 4: Run backend operation-lane suite and build**

Run:

```bash
cd backend && npx jest --runInBand \
  src/modules/ai/execution-policy.service.spec.ts \
  src/modules/ai/operation-router.service.spec.ts \
  src/modules/ai/ai.service.company-voice.spec.ts \
  src/modules/ai/ai.service.operation-lane.spec.ts
cd backend && npm run build
```

Expected:
- all listed Jest specs PASS
- Nest build succeeds

- [ ] **Step 5: Run the explicit regression gate before touching frontend**

Run:

```bash
cd backend && npx jest --runInBand \
  src/modules/ai/ai.service.company-voice.spec.ts \
  src/modules/ai/semantic-slot.constants.spec.ts \
  src/modules/ai/execution-policy.service.spec.ts \
  src/modules/ai/operation-router.service.spec.ts \
  src/modules/ai/ai.service.operation-lane.spec.ts
```

Manual smoke:

```text
1. 打开购物车
2. 查看订单
3. 找苹果
4. 帮我找武汉的企业
5. 打开青禾农场
6. 把土鸡蛋加入购物车
7. 今天几号
```

Expected:
- 旧行为不退化
- 企业/商品列表请求保持 list-first
- 非操作请求不会被误执行

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ai/entity-resolver.service.ts \
  backend/src/modules/ai/ai.service.ts \
  backend/src/modules/ai/ai.module.ts \
  backend/src/modules/ai/ai.service.operation-lane.spec.ts
git commit -m "refactor(ai): orchestrate operation lane services"
```

---

## Chunk 2: Frontend Executor Convergence

### Task 4: Align frontend domain types with the backend structured action contract

**Files:**
- Modify: `src/types/domain/Ai.ts`
- Modify: `src/repos/AiAssistantRepo.ts`
- Reference: `backend/src/modules/ai/voice-intent.types.ts`

**Outcome:** 前端类型层先知道 `actionType / route / params / modelInfo / richer timing`，避免 UI 层继续围绕 legacy `param` 扩展。

- [ ] **Step 1: Update frontend types to reflect the new action contract**

Add to `src/types/domain/Ai.ts`:

```typescript
export type AiVoiceActionType =
  | 'open_search_results'
  | 'open_company_results'
  | 'open_product_detail'
  | 'open_company_detail'
  | 'open_orders'
  | 'open_order_detail'
  | 'open_route'
  | 'add_to_cart'
  | 'show_feedback';

export type AiVoiceResolved = {
  // existing fields...
  actionType?: AiVoiceActionType;
  route?: string;
  params?: Record<string, string>;
};
```

- [ ] **Step 2: Run a typecheck to verify the new fields break current consumers**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: FAIL in `navigateByIntent.ts` / `useVoiceRecording.ts` because current consumers do not handle the new contract yet.

- [ ] **Step 3: Update Repo typing only, without changing behavior yet**

Keep this task narrow:
- ensure response typing preserves `resolved.actionType/route/params`
- ensure the backend response keeps returning legacy `type / param / search / company / transaction / recommend` fields during migration
- do not rewrite navigation here

- [ ] **Step 4: Re-run the typecheck**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: still FAIL, but now only in execution-layer files (`navigateByIntent.ts`, `useVoiceRecording.ts`, maybe screens)

- [ ] **Step 5: Commit**

```bash
git add src/types/domain/Ai.ts src/repos/AiAssistantRepo.ts
git commit -m "chore(ai): align frontend voice intent types"
```

### Task 5: Refactor `navigateByIntent()` into a structured action executor

**Files:**
- Modify: `src/utils/navigateByIntent.ts`
- Modify: `src/hooks/useVoiceRecording.ts`
- Reference: `src/components/overlay/VoiceOverlay.tsx`

**Outcome:** 前端不再根据残句推断列表/详情，优先执行后端提供的 structured action；clarify、feedback、chat handoff 保持兼容。

- [ ] **Step 1: Write down the expected execution matrix in code comments/tests-in-plan**

Target matrix:

```text
open_search_results  -> /search with params
open_company_results -> /company/search with params
open_product_detail  -> /product/[id]
open_company_detail  -> /company/[id]
open_orders          -> /orders
open_order_detail    -> /orders/[id]
open_route           -> resolved.route
add_to_cart          -> navigate to /search or /product confirmation path for now, then trigger add flow
show_feedback        -> stay on page and show feedback
```

- [ ] **Step 2: Refactor `navigateByIntent.ts` to prefer `resolved.actionType`**

Implementation outline:

```typescript
const actionType = intent.resolved?.actionType;
const actionRoute = intent.resolved?.route;
const actionParams = intent.resolved?.params ?? {};

if (actionType === 'open_company_results' && actionRoute) {
  return { action: 'navigate', route: actionRoute, params: actionParams, toastText: intent.feedback };
}
```

Rules:
- keep legacy fallback only when `actionType` is absent
- assume backend and frontend may deploy out of sync; dual-read is required during migration
- do not auto-promote `matchedProductId` to detail when `actionType` says results
- do not auto-promote `companyId` to detail when `actionType` says results

- [ ] **Step 3: Update `useVoiceRecording.ts` to treat the result as an execution contract**

Changes:
- preserve existing overlay/feedback flow
- let `resolveIntent()` drive route/action
- keep clarify handling unchanged
- keep auth modal behavior, but source it from `IntentResult.needsAuth`

- [ ] **Step 4: Run typecheck**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: PASS or reduce remaining failures to page-level param handling.

- [ ] **Step 5: Commit**

```bash
git add src/utils/navigateByIntent.ts src/hooks/useVoiceRecording.ts
git commit -m "refactor(ai): make frontend execute structured voice actions"
```

### Task 6: Clean up list-result screens so structured filters win over dirty query text

**Files:**
- Modify: `app/search.tsx`
- Modify: `app/company/search.tsx`
- Reference: `src/utils/navigateByIntent.ts`

**Outcome:** 商品/企业列表页在 `source=voice` 下优先相信结构化筛选项，不再让脏 `q` 覆盖 `location / category / constraints`。

- [ ] **Step 1: Document the regression cases as page-level acceptance checks**

Acceptance matrix:

```text
"帮我找武汉的企业"
-> /company/search?location=武汉&source=voice
-> 不包含 q=一找在武汉

"找苹果"
-> /search?q=苹果&source=voice
-> 不直接跳商品详情

"打开青禾农场"
-> 只有 actionType=open_company_detail 时才进入公司详情
```

- [ ] **Step 2: Update `app/company/search.tsx` to sanitize voice-origin query more aggressively**

Keep the existing relative-location cleanup, and add:
- if `source=voice` and there are structured list filters, ignore generic/dirty `q`
- suppress tokens like `找一找 / 一找 / 有没有 / 看看 / 什么公司 / 哪些企业`

- [ ] **Step 3: Update `app/search.tsx` to avoid detail bias from matched product params**

Rules:
- `source=voice` + structured list search stays on `/search`
- explicit detail only when action contract says detail
- add-to-cart path should still allow confirmation or in-page cart action, but not silently bypass list-first rules

- [ ] **Step 4: Run typecheck**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/search.tsx app/company/search.tsx
git commit -m "fix(ai): prefer structured voice filters on result pages"
```

---

## Chunk 3: Observability, Replay, And Verification

### Task 7: Export replay samples and make operation-lane metrics inspectable

**Files:**
- Create: `backend/scripts/export-operation-lane-replay.ts`
- Modify: `backend/package.json`
- Modify: `backend/src/modules/ai/ai.service.ts`

**Outcome:** 可以从真实 `AiUtterance` 中抽样回放集，并从日志/DB 中直接看到 `fastRouteHit / modelUsed / router_ms / normalize_ms / resolve_ms / execution_ms`。

- [ ] **Step 1: Write the export script interface and expected JSON shape**

Target usage:

```bash
cd backend && npx ts-node scripts/export-operation-lane-replay.ts --limit 200 --out ../../tmp/ai-operation-replay.json
```

Expected record shape:

```json
{
  "utteranceId": "utt_123",
  "transcript": "帮我找武汉的企业",
  "storedIntent": "company",
  "storedSlots": { "companyMode": "list", "companyLocation": "武汉" },
  "storedResolved": { "actionType": "open_company_results" },
  "timing": { "router_ms": 1, "normalize_ms": 0, "resolve_ms": 2, "execution_ms": 1, "total_ms": 1200 }
}
```

- [ ] **Step 2: Implement the script and package entry**

Add to `backend/package.json`:

```json
{
  "scripts": {
    "ai:export-operation-lane-replay": "ts-node scripts/export-operation-lane-replay.ts"
  }
}
```

Use Prisma client directly in the script; keep it read-only.

- [ ] **Step 3: Ensure `AiService` persists and logs the richer timing/model fields**

Required fields:
- `router_ms`
- `normalize_ms`
- `resolve_ms`
- `execution_ms`
- `modelUsed`
- `fastRouteHit`
- `wasUpgraded`
- `fallbackReason`

Keep naming aligned across logs, DB payloads, and replay export output.

- [ ] **Step 4: Run the script on a tiny sample and backend tests**

Run:

```bash
cd backend && npx ts-node scripts/export-operation-lane-replay.ts --limit 3 --out ../../tmp/ai-operation-replay.sample.json
cd backend && npx jest --runInBand \
  src/modules/ai/execution-policy.service.spec.ts \
  src/modules/ai/operation-router.service.spec.ts \
  src/modules/ai/ai.service.company-voice.spec.ts \
  src/modules/ai/ai.service.operation-lane.spec.ts
```

Expected:
- sample JSON file generated
- Jest suite PASS

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/export-operation-lane-replay.ts backend/package.json backend/src/modules/ai/ai.service.ts
git commit -m "feat(ai): add operation lane replay export"
```

### Task 8: Run the verification matrix and capture manual smoke results

**Files:**
- Modify: `docs/superpowers/specs/2026-04-03-ai-voice-operation-lane-design.md` (only if implementation notes or follow-up risks must be recorded)
- Reference: `ai.md`

**Outcome:** 实现结束时有一份清晰的 automated + manual verification checklist，能判断这次收敛是否真的达到 Stage 1 目标。

- [ ] **Step 1: Run final automated verification**

Run:

```bash
cd backend && npm run build
cd backend && npx jest --runInBand \
  src/modules/ai/execution-policy.service.spec.ts \
  src/modules/ai/operation-router.service.spec.ts \
  src/modules/ai/ai.service.company-voice.spec.ts \
  src/modules/ai/ai.service.operation-lane.spec.ts \
  src/modules/ai/semantic-slot.constants.spec.ts
npx tsc --noEmit --pretty false
```

Expected: all commands PASS

- [ ] **Step 2: Run manual smoke verification on device/emulator**

Verify these utterances end-to-end:

```text
1. 打开购物车
2. 查看订单
3. 找苹果
4. 帮我找武汉的企业
5. 打开青禾农场
6. 把土鸡蛋加入购物车
7. 今天几号
```

Expected behavior:
- 1/2: direct route
- 3/4: results/list
- 5: detail only if unique + high-confidence
- 6: direct add-to-cart only if unique + explicit
- 7: safe feedback / chat handoff, no operation-lane over-execution

- [ ] **Step 3: Record observed gaps as follow-up, not opportunistic scope creep**

Allowed follow-up categories:
- rule coverage gaps
- detail-threshold tuning
- add-to-cart precision tuning
- replay labeling backlog

Not allowed in this plan:
- RAG
- TTS
- Phase C expansion
- full Phase D geolocation build

- [ ] **Step 4: Commit any doc-only follow-up notes**

```bash
git add docs/superpowers/specs/2026-04-03-ai-voice-operation-lane-design.md ai.md
git commit -m "docs(ai): record operation lane verification notes"
```

- [ ] **Step 5: Hand off for execution review**

Use `@superpowers/verification-before-completion` before claiming success.

---

## Recommended Execution Order

1. Chunk 1 first. Do not touch frontend before the backend action contract exists.
2. Chunk 2 second. Frontend should consume the backend contract, not invent a parallel one.
3. Chunk 3 last. Observability and replay should describe the real shipped chain, not a half-migrated one.

## Rollback Guidance

- If the service split destabilizes `AiService`, keep the new helpers but gate orchestration behind a feature flag or a narrow condition until parity is restored.
- If frontend contract migration reveals too many legacy callers, keep `resolved.actionType` as primary and `param` as temporary fallback, but do not add new behavior to `param`.
- If direct add-to-cart is noisy, downgrade it to result-page confirmation instead of weakening list-first rules elsewhere.

## Definition Of Done

- 操作型语音入口只以 5 类核心任务为主线
- 商品/企业请求默认结果页，详情仅在单对象高置信时触发
- 加购物车仅在动作明确且唯一商品命中时直执
- 操作主链路在线预算固定为 `0 或 1` 次轻模型调用
- richer timing 和 replay export 可用
- 前端不再根据自然语言残句擅自决定详情页

Plan complete and saved to `docs/superpowers/plans/2026-04-03-ai-voice-operation-lane-v1.md`. Ready to execute?
