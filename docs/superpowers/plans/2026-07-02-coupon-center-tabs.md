# Coupon Center Tabs Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Split the buyer App coupon center into “可领取 / 已领取 / 进行中” views so sold-out and already-claimed coupons no longer pollute the default claimable list while claimed campaign history remains visible.

**Architecture:** Backend owns coupon-center view filtering and status calculation through a new `GET /coupons/center?view=` endpoint. The App treats the endpoint as the source of truth, renders inner tabs, and refreshes all coupon-center views after claim success or claim-state race failures. Existing `/coupons/available` remains compatible by delegating to the claimable view.

**Tech Stack:** NestJS, Prisma, PostgreSQL, React Native Expo, TanStack Query, Jest, node:test, TypeScript.

---

## Chunk 1: Backend Coupon Center Views

### Files

- Modify: `backend/src/modules/coupon/coupon.service.ts` — source of truth for coupon-center filtering, status calculation, claimed summaries, and legacy `/available` compatibility.
- Modify: `backend/src/modules/coupon/coupon.controller.ts` — exposes `GET /coupons/center`.
- Modify: `backend/src/modules/coupon/coupon-campaign-rules.spec.ts` — backend behavior regression coverage.
- Modify: `scripts/__tests__/coupon-campaign-rules.test.mjs` — static cross-layer regression coverage.

### Task 1: Backend failing tests

- [x] **Step 1: Add Jest tests for coupon-center view filtering**

Add a `describe('CouponService coupon center views', ...)` block in `backend/src/modules/coupon/coupon-campaign-rules.spec.ts`.

Cover these behaviors with mocked Prisma:

- `getCouponCenterCampaigns(userId, 'claimable')` returns only `distributionMode=CLAIM`, `status=ACTIVE`, in-window, in-stock, eligible campaigns where `userClaimedCount < maxPerUser`.
- Sold-out campaigns disappear from `claimable` but remain in `active` with `displayStatus='SOLD_OUT'`.
- User-claimed campaigns disappear from `claimable` once `userClaimedCount >= maxPerUser`, appear in `claimed`, and appear in `active` with `displayStatus='CLAIMED'`.
- `maxPerUser > 1` and `userClaimedCount < maxPerUser` appears in both `claimable` and `claimed`; `claimed` item is read-only with `displayStatus='CLAIMED'`.
- Ended/paused campaigns claimed by the user appear only in `claimed`.
- `AUTO`, `MANUAL`, and `DRAFT` campaigns are excluded from all views.
- `PAUSED` campaigns are excluded from `claimable` and `active`, but included in `claimed` when the user has claimed them.
- Claimed summary counts `AVAILABLE`, `RESERVED`, `USED`, `EXPIRED`, and `REVOKED`, and `nearestExpiresAt` is the nearest future `AVAILABLE` expiration.
- Sorting is deterministic for all three views: `claimable` by `createdAt desc`, `active` by status rank then `createdAt desc`, `claimed` by latest user `issuedAt desc`.
- Invalid view throws `BadRequestException('领券中心分类无效')`.

- [x] **Step 2: Add static regression checks**

In `scripts/__tests__/coupon-campaign-rules.test.mjs`, add assertions for:

- `getCouponCenterCampaigns`
- `/coupons/center`
- `CouponCenterView`
- `CouponCenterCampaignDto`
- inner App tabs labels `可领取`, `已领取`, `进行中`
- display status labels `立即领取`, `已领取`, `已领完`, `已结束`
- `claimedSummary.available`
- success invalidations for `coupon-center-campaigns`, `coupon-claimable-alert`, `my-coupons`, `checkout-eligible-coupons`
- known claim-state failure invalidations for the same query keys
- generic failure copy `领取失败，请稍后重试`
- empty state copy for each center tab

- [x] **Step 3: Run tests and verify RED**

Run:

```bash
(cd backend && npm test -- coupon-campaign-rules.spec.ts --runInBand)
node --test scripts/__tests__/coupon-campaign-rules.test.mjs
```

Expected: fail because `getCouponCenterCampaigns`, `/coupons/center`, and frontend types/UI are not implemented yet.

### Task 2: Backend implementation

- [x] **Step 1: Add backend view types and helpers**

In `backend/src/modules/coupon/coupon.service.ts`, add local types:

```ts
type CouponCenterView = 'claimable' | 'claimed' | 'active';
type CouponCenterDisplayStatus = 'CLAIMABLE' | 'CLAIMED' | 'SOLD_OUT' | 'NOT_ELIGIBLE' | 'ENDED';
```

Add helpers:

- `parseCouponCenterView(view?: string): CouponCenterView`
- `buildClaimedSummary(instances, now)`
- `buildCouponCenterCampaignDto({ campaign, userClaimedCount, claimedSummary, eligibility, view, now })`
- `sortCouponCenterCampaigns(items, view, campaignMeta)`

- [x] **Step 2: Implement `getCouponCenterCampaigns`**

In `CouponService`, implement:

```ts
async getCouponCenterCampaigns(userId: string, view: string = 'claimable')
```

Rules:

- Invalid view throws `BadRequestException('领券中心分类无效')`.
- Query `CouponCampaign` with `distributionMode='CLAIM'`.
- `claimable` and `active` require `status='ACTIVE'`, `startAt <= now`, and `endAt=null OR endAt>=now`.
- `claimed` starts from user `CouponInstance` rows grouped by campaign, then loads those campaigns regardless of `ACTIVE/PAUSED/ENDED`, excluding `DRAFT` and non-`CLAIM`.
- `userClaimedCount` counts all user instances for that campaign, matching current per-user-limit behavior.
- `claimedSummary.nearestExpiresAt` uses only `AVAILABLE` instances with future `expiresAt`.
- Status precedence:
  1. In `claimed`, out-of-window or `status=ENDED` returns `displayStatus='ENDED'`.
  2. In `claimed`, any claimed non-ended campaign returns `displayStatus='CLAIMED'`, including paused campaigns and `maxPerUser > userClaimedCount`.
  3. In `claimable` / `active`, out-of-window or non-`ACTIVE` campaigns are excluded.
  4. Reached `maxPerUser` returns `CLAIMED`.
  5. `issuedCount >= totalQuota` returns `SOLD_OUT`.
  6. Eligibility failure returns `NOT_ELIGIBLE`.
  7. Otherwise `CLAIMABLE`.
- Sorting:
  - `claimable`: `createdAt desc`.
  - `active`: status rank `CLAIMABLE`, `CLAIMED`, `NOT_ELIGIBLE`, `SOLD_OUT`, then `createdAt desc`.
  - `claimed`: latest user `issuedAt desc`.

- [x] **Step 3: Keep `/coupons/available` compatible**

Refactor `getAvailableCampaigns(userId)` to call `getCouponCenterCampaigns(userId, 'claimable')` and map the result to the existing `AvailableCampaignDto` shape. Do not remove fields currently used by the App.

- [x] **Step 4: Add controller route**

In `backend/src/modules/coupon/coupon.controller.ts`, add:

```ts
@Get('center')
getCouponCenterCampaigns(
  @CurrentUser('sub') userId: string,
  @Query('view') view?: string,
) {
  return this.couponService.getCouponCenterCampaigns(userId, view);
}
```

- [x] **Step 5: Run backend GREEN verification**

Run:

```bash
(cd backend && npm test -- coupon-campaign-rules.spec.ts --runInBand)
```

Expected: all coupon campaign rule tests pass.

---

## Chunk 2: App Types, Repo, and Coupon Center Tabs

### Files

- Modify: `src/types/domain/Coupon.ts` — App-facing coupon-center DTO types.
- Modify: `src/repos/CouponRepo.ts` — new coupon-center endpoint and mock-mode view data.
- Modify: `app/me/coupons.tsx` — inner tabs, status-aware cards, and refresh behavior.
- Modify: `scripts/__tests__/coupon-campaign-rules.test.mjs` — static frontend behavior checks.

### Task 3: App domain and repository

- [x] **Step 1: Add App coupon center types**

In `src/types/domain/Coupon.ts`, add:

```ts
export type CouponCenterView = 'claimable' | 'claimed' | 'active';
export type CouponCenterDisplayStatus = 'CLAIMABLE' | 'CLAIMED' | 'SOLD_OUT' | 'NOT_ELIGIBLE' | 'ENDED';

export interface CouponCenterClaimSummaryDto {
  total: number;
  available: number;
  used: number;
  expired: number;
  reserved: number;
  revoked: number;
  nearestExpiresAt: string | null;
}

export interface CouponCenterCampaignDto extends AvailableCampaignDto {
  distributionMode: 'CLAIM';
  canClaim: boolean;
  displayStatus: CouponCenterDisplayStatus;
  statusLabel: string;
  ineligibleReason: string | null;
  claimedSummary: CouponCenterClaimSummaryDto;
}
```

- [x] **Step 2: Add repository method**

In `src/repos/CouponRepo.ts`, add:

```ts
getCouponCenterCampaigns(view: CouponCenterView = 'claimable'): Promise<Result<CouponCenterCampaignDto[]>>
```

For mock mode, map `mockCampaigns` into `CouponCenterCampaignDto` and add at least one claimed mock campaign with `claimedSummary.available > 0`, one sold-out campaign, and one not-eligible campaign so `claimed` and `active` views exercise status behavior.

- [x] **Step 3: Preserve existing `getAvailableCampaigns`**

Update `getAvailableCampaigns()` to call `/coupons/available` as before or delegate to the new mock logic without changing its public return type.

### Task 4: App UI tabs

- [x] **Step 1: Add inner tab state**

In `app/me/coupons.tsx`, add:

```ts
type CenterTabKey = CouponCenterView;
const CENTER_TABS = [
  { key: 'claimable', label: '可领取' },
  { key: 'claimed', label: '已领取' },
  { key: 'active', label: '进行中' },
] as const;
```

Default `centerTab` to `claimable`.

- [x] **Step 2: Replace center query**

Replace the current `CouponRepo.getAvailableCampaigns()` center query with:

```ts
queryKey: ['coupon-center-campaigns', centerTab],
queryFn: () => CouponRepo.getCouponCenterCampaigns(centerTab),
```

Keep the query enabled only when `mainTab === 'center'`.

- [x] **Step 3: Render inner tabs**

Inside the center view, render a compact segmented tab row above the list. Avoid nested cards. Keep dimensions stable and text concise.

- [x] **Step 4: Render status-aware campaign cards**

Use `item.displayStatus`, `item.statusLabel`, `item.canClaim`, and `item.claimedSummary` instead of locally recomputing `reachedLimit/depleted`.

Button behavior:

- `CLAIMABLE`: button “立即领取”, enabled only outside `claimed` tab.
- `CLAIMED`: button “已领取”; show claimed summary text such as `已领 X 张 · 可用 Y 张 · 已用 Z 张 · 已过期 W 张`; if `claimedSummary.available > 0`, show an auxiliary “去使用” action or compact link that navigates the user toward usable coupons/products without enabling another claim from the claimed tab.
- `SOLD_OUT`: button “已领完”, disabled.
- `NOT_ELIGIBLE`: button uses `statusLabel`, disabled.
- `ENDED`: button “已结束”, disabled.

- [x] **Step 5: Refresh all relevant queries after claim**

On successful claim, invalidate:

- `['coupon-center-campaigns']`
- `['coupon-claimable-alert']`
- `['my-coupons']`
- `['checkout-eligible-coupons']`

On known claim-state failure, also invalidate the same list. On generic network/server failure, show the current generic error and keep current list until refetch succeeds.

Known claim-state failures include backend messages for stock depleted, campaign ended, campaign paused, and per-user limit reached.

- [x] **Step 6: Run App/static GREEN verification**

Run:

```bash
node --test scripts/__tests__/coupon-campaign-rules.test.mjs
npx tsc --noEmit
```

Expected: static regression tests and App TypeScript pass.

---

## Chunk 3: Docs, Integration Verification, and Review

### Files

- Modify: `docs/features/redpocket.md` — product/API behavior documentation.
- Modify: `docs/architecture/frontend.md` — App frontend changelog.
- Modify: `plan.md` — project progress record.
- Modify: `docs/superpowers/plans/2026-07-02-coupon-center-tabs.md` — mark completed steps during execution.

### Task 5: Documentation

- [x] **Step 1: Update feature documentation**

In `docs/features/redpocket.md`, add the new buyer API:

- `GET /coupons/center?view=claimable|claimed|active`

Document the three buyer App center tabs and the sold-out / claimed behavior.

- [x] **Step 2: Update frontend architecture changelog**

In `docs/architecture/frontend.md`, add a row for buyer App coupon center tabs.

- [x] **Step 3: Update `plan.md`**

Add a completed recent item for “领券中心分类 Tab”.

### Task 6: Final verification

- [x] **Step 1: Run focused tests**

```bash
node --test scripts/__tests__/coupon-campaign-rules.test.mjs
(cd backend && npm test -- coupon-campaign-rules.spec.ts notification.registry.spec.ts --runInBand)
```

Expected:

- node:test reports all `coupon-campaign-rules.test.mjs` tests pass.
- Jest reports `coupon-campaign-rules.spec.ts` and `notification.registry.spec.ts` pass with 0 failed tests.

- [x] **Step 2: Run schema/build/type checks**

```bash
(cd backend && DATABASE_URL='postgresql://user:pass@localhost:5432/aimaimai_validate' npx prisma validate)
(cd backend && DATABASE_URL='postgresql://user:pass@localhost:5432/aimaimai_validate' npm run build)
(cd admin && npm run build)
npx tsc --noEmit
git diff --check
```

Expected:

- Prisma reports schema valid.
- Backend Nest build exits 0.
- Admin Vite build exits 0.
- App TypeScript exits 0.
- `git diff --check` prints no whitespace errors.

- [x] **Step 3: Request review**

Dispatch one code/spec reviewer subagent with the final diff and spec path. The main agent must inspect reviewer feedback and either fix valid issues or explain why advisory feedback is not applied.

- [x] **Step 4: Final status**

Report changed files, verification results, and remind that changes are uncommitted unless the user asks to commit/push.
