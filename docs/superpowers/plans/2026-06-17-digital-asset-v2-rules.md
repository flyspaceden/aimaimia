# 数字资产 V2 规则 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing digital asset cumulative-spend module into V2: VIP-only digital asset balances, seed assets, credit assets, configurable rules, App display, admin management, legal copy, and migration support.

**Architecture:** Keep the existing `digital-asset` module as the system boundary. Extend the current cumulative spend account with seed/credit balances and subject-aware ledgers, then route all writes through `DigitalAssetService`. VIP activation grants seed assets and one-time historical credit assets inside the existing VIP activation transaction, while normal order receive/refund flows continue to record cumulative spend and only grant/reverse credit assets for VIP users.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest, Expo 54 / React Native 0.81, React Query, Vite React 19, Ant Design 5.

---

## Reference Documents

- Spec: `docs/superpowers/specs/2026-06-17-digital-asset-v2-rules-design.md`
- Existing V1 spec: `docs/superpowers/specs/2026-06-14-digital-asset-cumulative-spend-design.md`
- Data authority: `docs/architecture/data-system.md`
- Buyer App authority: `docs/architecture/frontend.md`
- App responsive authority: `docs/architecture/responsive-design.md`
- Admin frontend authority: `docs/architecture/admin-frontend.md`
- Safety checklist: `docs/issues/tofix-safe.md`
- Project task board: `plan.md`

## Scope Check

This is one feature plan because every slice depends on one shared ledger/account contract. The plan is chunked so each layer can be tested independently:

1. Schema and pure rule calculators.
2. Backend write paths and migration scripts.
3. Admin backend APIs and VIP package configuration.
4. Buyer App screens.
5. Admin frontend screens.
6. Legal/documentation/verification.

## File Structure Map

### Backend Schema And Seed

- Modify: `backend/prisma/schema.prisma`
  - Extend `DigitalAssetAccount` with `seedAssetBalance`, `creditAssetBalance`, `historicalCreditGrantedAt`, `historicalCreditGrantLedgerId`.
  - Add enum `DigitalAssetLedgerSubjectType`.
  - Extend `DigitalAssetLedgerType` with V2 source types while keeping V1 values.
  - Add `subjectType`, `assetAmount`, `cumulativeSpendAfter`, `seedAssetBalanceAfter`, `creditAssetBalanceAfter`, `ruleSnapshot`.
  - Extend `VipPackage` with `selfSeedAssetAmount` and `referralSeedAssetAmount`.
- Create: `backend/prisma/migrations/20260617090000_digital_asset_v2_rules/migration.sql`
- Modify: `backend/prisma/seed.ts`
  - Seed default VIP seed asset values for 399/699/999 packages.
  - Seed `DIGITAL_ASSET_CREDIT_TIERS`.

### Backend Digital Asset Module

- Create: `backend/src/modules/digital-asset/digital-asset-credit-calculator.ts`
- Create: `backend/src/modules/digital-asset/digital-asset-v2.types.ts`
- Modify: `backend/src/modules/digital-asset/digital-asset-ledger-calculator.ts`
- Modify: `backend/src/modules/digital-asset/digital-asset.service.ts`
- Modify: `backend/src/modules/digital-asset/digital-asset.controller.ts`
- Modify: `backend/src/modules/digital-asset/dto/digital-asset-query.dto.ts`
- Modify: `backend/src/modules/digital-asset/dto/admin-adjust-digital-asset.dto.ts`
- Create: `backend/src/modules/digital-asset/dto/update-digital-asset-rules.dto.ts`
- Create tests:
  - `backend/src/modules/digital-asset/digital-asset-credit-calculator.spec.ts`
  - `backend/src/modules/digital-asset/digital-asset-v2.service.spec.ts`

### Backend Flow Hooks And Migration

- Modify: `backend/src/modules/bonus/bonus.module.ts`
- Modify: `backend/src/modules/bonus/bonus.service.ts`
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/order/order-auto-confirm.service.ts`
- Modify: `backend/src/modules/order/order.module.ts`
- Create: `backend/scripts/backfill-digital-asset-v2.ts`
- Create tests:
  - `backend/src/modules/bonus/bonus.service.digital-asset-v2.spec.ts`
  - `backend/src/modules/order/order.service.digital-asset-v2.spec.ts`
  - `backend/src/modules/order/order-auto-confirm.digital-asset-v2.spec.ts`
  - `backend/src/modules/digital-asset/digital-asset-v2-backfill.spec.ts`

### Backend Admin APIs And VIP Package APIs

- Modify: `backend/src/modules/admin/vip-package/vip-package.dto.ts`
- Modify: `backend/src/modules/admin/vip-package/vip-package.service.ts`
- Modify: `backend/src/modules/admin/digital-asset/admin-digital-asset.controller.ts`
- Modify: `backend/src/modules/admin/digital-asset/admin-digital-asset.service.ts`
- Modify: `backend/src/modules/admin/digital-asset/dto/admin-digital-asset.dto.ts`
- Create tests:
  - `backend/src/modules/admin/vip-package/vip-package.service.digital-asset.spec.ts`
  - `backend/src/modules/admin/digital-asset/admin-digital-asset-v2.service.spec.ts`
  - `backend/src/modules/admin/digital-asset/admin-digital-asset-v2.controller.spec.ts`

### Buyer App

- Modify: `src/types/domain/DigitalAsset.ts`
- Modify: `src/repos/DigitalAssetRepo.ts`
- Modify: `app/me/digital-assets.tsx`
- Create: `app/me/consumption-records.tsx`
- Modify docs after UI work: `docs/architecture/frontend.md`, `plan.md`

### Admin Frontend

- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/api/digital-assets.ts`
- Modify: `admin/src/api/vip-gifts.ts`
- Modify: `admin/src/pages/digital-assets/index.tsx`
- Modify: `admin/src/pages/vip-gifts/index.tsx`
- Modify: `admin/src/constants/permissions.ts` only if new permission keys are introduced.
- Modify docs after UI work: `docs/architecture/admin-frontend.md`, `plan.md`

### Legal And Operations Docs

- Modify: `src/content/legal/termsOfService.ts`
- Modify: `src/content/legal/privacyPolicy.ts`
- Modify: `src/content/legal/memberServiceAgreement.ts`
- Regenerate if existing legal export flow requires it: `docs/legal/爱买买法律文本审核稿.docx`
- Modify: `docs/architecture/data-system.md`
- Modify: `docs/issues/tofix-safe.md`
- Modify: `plan.md`

## Cross-Cutting Rules

- All account writes must go through `DigitalAssetService`.
- All writes that change cumulative spend, seed asset balance, credit asset balance, VIP activation asset grants, admin adjustments, or account clearing must run under `Prisma.TransactionIsolationLevel.Serializable`.
- Keep V1 enum values readable for historical ledgers; do not break existing production ledger rows.
- Digital assets are integers. Currency fields remain Float yuan values.
- `VIP_PACKAGE` orders do not increase cumulative spend and do not grant credit assets.
- Ordinary user accounts may have cumulative spend, but must not expose digital asset balances in buyer APIs.
- Use explicit path staging; do not stage unrelated untracked files.

---

## Chunk 1: Schema And Pure Rule Calculators

### Task 1.1: Add V2 Prisma Schema And Migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260617090000_digital_asset_v2_rules/migration.sql`

- [ ] **Step 1: Add schema regression check**

Run:

```bash
cd backend
rg -n "seedAssetBalance|DigitalAssetLedgerSubjectType|selfSeedAssetAmount|DIGITAL_ASSET_CREDIT_TIERS" prisma src
```

Expected before implementation: no schema fields or credit tier config found.

- [ ] **Step 2: Extend `schema.prisma`**

Add:

```prisma
enum DigitalAssetLedgerSubjectType {
  CUMULATIVE_SPEND
  SEED_ASSET
  CREDIT_ASSET
}
```

Extend `DigitalAssetLedgerType` with:

```prisma
CONSUMPTION_CONFIRMED
SELF_VIP_PURCHASE
REFERRAL_VIP_PURCHASE
HISTORICAL_CONSUMPTION_GRANT
```

Keep old values:

```prisma
ORDER_RECEIVED
REFUND_REVERSAL
ADMIN_ADJUSTMENT
BACKFILL
```

Extend `DigitalAssetAccount`:

```prisma
seedAssetBalance             Int      @default(0)
creditAssetBalance           Int      @default(0)
historicalCreditGrantedAt    DateTime?
historicalCreditGrantLedgerId String?

@@index([seedAssetBalance])
@@index([creditAssetBalance])
```

Extend `DigitalAssetLedger`:

```prisma
subjectType              DigitalAssetLedgerSubjectType @default(CUMULATIVE_SPEND)
assetAmount              Int?
cumulativeSpendAfter     Float?
seedAssetBalanceAfter    Int?
creditAssetBalanceAfter  Int?
ruleSnapshot             Json?
vipPurchaseId            String?
vipPurchase              VipPurchase? @relation(fields: [vipPurchaseId], references: [id], onDelete: Restrict)

@@index([subjectType, createdAt])
@@index([vipPurchaseId])
```

Extend `VipPackage`:

```prisma
selfSeedAssetAmount     Int @default(0)
referralSeedAssetAmount Int @default(0)
```

Add reverse relation on `VipPurchase`:

```prisma
digitalAssetLedgers DigitalAssetLedger[]
```

- [ ] **Step 3: Create migration SQL**

Use Prisma migration tooling or write SQL matching the schema. Include backfill defaults:

```sql
ALTER TABLE "DigitalAssetAccount" ADD COLUMN "seedAssetBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DigitalAssetAccount" ADD COLUMN "creditAssetBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DigitalAssetAccount" ADD COLUMN "historicalCreditGrantedAt" TIMESTAMP(3);
ALTER TABLE "DigitalAssetAccount" ADD COLUMN "historicalCreditGrantLedgerId" TEXT;
ALTER TABLE "VipPackage" ADD COLUMN "selfSeedAssetAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VipPackage" ADD COLUMN "referralSeedAssetAmount" INTEGER NOT NULL DEFAULT 0;
```

Set default VIP seed values:

```sql
UPDATE "VipPackage" SET "selfSeedAssetAmount" = 1000, "referralSeedAssetAmount" = 2000 WHERE "price" = 399;
UPDATE "VipPackage" SET "selfSeedAssetAmount" = 2000, "referralSeedAssetAmount" = 4000 WHERE "price" = 699;
UPDATE "VipPackage" SET "selfSeedAssetAmount" = 3000, "referralSeedAssetAmount" = 8000 WHERE "price" = 999;
```

- [ ] **Step 4: Validate schema**

Run:

```bash
cd backend
npx prisma validate
```

Expected: schema validates.

- [ ] **Step 5: Commit schema chunk**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260617090000_digital_asset_v2_rules/migration.sql
git commit -m "feat(digital-asset): add v2 asset schema"
```

### Task 1.2: Seed Default Rules

**Files:**
- Modify: `backend/prisma/seed.ts`

- [ ] **Step 1: Add seed assertions**

Inspect existing seed style:

```bash
cd backend
rg -n "VipPackage|RuleConfig|DIGITAL_ASSET" prisma/seed.ts
```

- [ ] **Step 2: Seed VIP package asset defaults**

Ensure seeded packages include:

```ts
selfSeedAssetAmount: price === 399 ? 1000 : price === 699 ? 2000 : price === 999 ? 3000 : 0,
referralSeedAssetAmount: price === 399 ? 2000 : price === 699 ? 4000 : price === 999 ? 8000 : 0,
```

- [ ] **Step 3: Seed credit tiers**

Upsert `RuleConfig` key `DIGITAL_ASSET_CREDIT_TIERS` with:

```ts
{
  tiers: [
    { minAmount: 0, maxAmount: 500, multiplier: 3 },
    { minAmount: 500, maxAmount: 5000, multiplier: 5 },
    { minAmount: 5000, maxAmount: null, multiplier: 10 },
  ],
}
```

- [ ] **Step 4: Validate TypeScript**

Run:

```bash
cd backend
npx tsc --noEmit
```

Expected: no seed typing errors.

- [ ] **Step 5: Commit seed changes**

```bash
git add backend/prisma/seed.ts
git commit -m "feat(digital-asset): seed v2 default rules"
```

### Task 1.3: Add Credit Asset Calculator

**Files:**
- Create: `backend/src/modules/digital-asset/digital-asset-v2.types.ts`
- Create: `backend/src/modules/digital-asset/digital-asset-credit-calculator.ts`
- Create: `backend/src/modules/digital-asset/digital-asset-credit-calculator.spec.ts`

- [ ] **Step 1: Write failing calculator tests**

Cover:

```ts
expect(calculateCreditAsset({
  previousCumulativeSpend: 480,
  addedSpend: 100,
  tiers: defaultTiers,
}).assetAmount).toBe(460);

expect(calculateCreditAsset({
  previousCumulativeSpend: 0,
  addedSpend: 5800,
  tiers: defaultTiers,
}).assetAmount).toBe(32000);

expect(() => validateCreditTiers([
  { minAmount: 0, maxAmount: 500, multiplier: 3 },
  { minAmount: 600, maxAmount: null, multiplier: 5 },
])).toThrow('信用资产倍率档位不能断档');
```

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
cd backend
npx jest src/modules/digital-asset/digital-asset-credit-calculator.spec.ts --runInBand
```

Expected: fail because calculator does not exist.

- [ ] **Step 3: Implement calculator**

Create shared V2 types:

```ts
export type DigitalAssetSubjectType = 'CUMULATIVE_SPEND' | 'SEED_ASSET' | 'CREDIT_ASSET';
export type DigitalAssetSourceType =
  | 'CONSUMPTION_CONFIRMED'
  | 'REFUND_REVERSAL'
  | 'SELF_VIP_PURCHASE'
  | 'REFERRAL_VIP_PURCHASE'
  | 'HISTORICAL_CONSUMPTION_GRANT'
  | 'ADMIN_ADJUSTMENT'
  | 'BACKFILL';
```

Export:

```ts
export type CreditAssetTier = {
  minAmount: number;
  maxAmount: number | null;
  multiplier: number;
};

export function validateCreditTiers(tiers: CreditAssetTier[]): CreditAssetTier[];
export function calculateCreditAsset(params: {
  previousCumulativeSpend: number;
  addedSpend: number;
  tiers: CreditAssetTier[];
}): {
  assetAmount: number;
  segments: Array<{ from: number; to: number; spendAmount: number; multiplier: number; rawAssetAmount: number }>;
  rawAssetAmount: number;
};
```

Rules:

- Sort tiers by `minAmount`.
- First tier must start at 0.
- Adjacent tier `maxAmount` must equal next tier `minAmount`.
- Last tier may have `maxAmount: null`.
- `assetAmount = Math.round(sum(raw segment assets))`.

- [ ] **Step 4: Run calculator tests**

Run:

```bash
cd backend
npx jest src/modules/digital-asset/digital-asset-credit-calculator.spec.ts --runInBand
```

Expected: pass.

- [ ] **Step 5: Commit calculator**

```bash
git add backend/src/modules/digital-asset/digital-asset-v2.types.ts backend/src/modules/digital-asset/digital-asset-credit-calculator.ts backend/src/modules/digital-asset/digital-asset-credit-calculator.spec.ts
git commit -m "feat(digital-asset): add credit asset calculator"
```

---

## Chunk 2: Backend Service And Business Hooks

### Task 2.1: Refactor DigitalAssetService To V2 Account Semantics

**Files:**
- Modify: `backend/src/modules/digital-asset/digital-asset.service.ts`
- Modify: `backend/src/modules/digital-asset/digital-asset-ledger-calculator.ts`
- Modify: `backend/src/modules/digital-asset/digital-asset.controller.ts`
- Modify: `backend/src/modules/digital-asset/dto/digital-asset-query.dto.ts`
- Create: `backend/src/modules/digital-asset/digital-asset-v2.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Test cases:

- Normal user received normal order increases `cumulativeSpendAmount` only.
- VIP user received normal order increases `cumulativeSpendAmount` and `creditAssetBalance`.
- `VIP_PACKAGE` order is ignored for cumulative spend and credit assets.
- Refund reverses cumulative spend and credit assets from original ledger snapshot.
- Admin adjustment can target `SEED_ASSET` or `CREDIT_ASSET`, not total.

- [ ] **Step 2: Run service tests to confirm failure**

Run:

```bash
cd backend
npx jest src/modules/digital-asset/digital-asset-v2.service.spec.ts --runInBand
```

Expected: fail because V2 methods and fields do not exist.

- [ ] **Step 3: Add V2 methods**

Add or refactor methods:

```ts
recordOrderReceived(orderId: string, source: 'ORDER_RECEIVED' | 'BACKFILL'): Promise<void>
reverseRefund(refundId: string): Promise<void>
grantVipActivationAssets(tx: Prisma.TransactionClient, params: {
  userId: string;
  vipPurchaseId: string;
  packageId: string | null;
  vipAmount: number;
  inviterUserId: string | null;
}): Promise<void>
adjustByAdmin(params: {
  targetUserId: string;
  adminUserId: string;
  subjectType: 'SEED_ASSET' | 'CREDIT_ASSET';
  amount: number;
  direction: 'CREDIT' | 'DEBIT';
  reason: string;
  clientIdempotencyKey?: string;
}): Promise<void>
```

Keep `creditOrderReceived()` as a wrapper if existing order code still calls it:

```ts
async creditOrderReceived(orderId: string, source: CreditSource) {
  return this.recordOrderReceived(orderId, source);
}
```

- [ ] **Step 4: Implement summary mapping**

`getSummary(userId)` returns:

```ts
{
  isVip: boolean;
  totalAssetBalance: number;
  seedAssetBalance: number;
  creditAssetBalance: number;
  cumulativeSpendAmount: number;
  currentCreditTier: ...;
  nextCreditTier: ...;
  vipSeedRules: ...;
  recentRecords: ...;
  modules: ...
}
```

For non-VIP users, return `isVip: false`, `totalAssetBalance: 0`, `seedAssetBalance: 0`, `creditAssetBalance: 0`, and VIP activation copy fields.

- [ ] **Step 5: Implement ledger list mapping**

`listLedgers()` supports:

```ts
subjectType?: 'CUMULATIVE_SPEND' | 'SEED_ASSET' | 'CREDIT_ASSET'
sourceType?: string
```

Map user-facing titles:

```ts
SELF_VIP_PURCHASE -> 自购 VIP 种子资产
REFERRAL_VIP_PURCHASE -> 推荐 VIP 种子资产
HISTORICAL_CONSUMPTION_GRANT -> 历史消费转入
CONSUMPTION_CONFIRMED + CUMULATIVE_SPEND -> 消费累计
CONSUMPTION_CONFIRMED + CREDIT_ASSET -> 信用资产入账
REFUND_REVERSAL -> 退款扣回
ADMIN_ADJUSTMENT -> 后台调整
```

- [ ] **Step 6: Update buyer controller and query DTO**

Keep routes:

```ts
GET /me/digital-assets/summary
GET /me/digital-assets/ledgers
```

Extend query DTO:

```ts
subjectType?: 'CUMULATIVE_SPEND' | 'SEED_ASSET' | 'CREDIT_ASSET';
sourceType?: DigitalAssetSourceType;
```

The summary endpoint should include `recentRecords` limited to 5 records so the App does not need to fetch a full first page for the digital assets screen.

- [ ] **Step 7: Run service tests**

Run:

```bash
cd backend
npx jest src/modules/digital-asset/digital-asset-v2.service.spec.ts src/modules/digital-asset/digital-asset.service.spec.ts --runInBand
```

Expected: all pass.

- [ ] **Step 8: Commit service refactor**

```bash
git add backend/src/modules/digital-asset/digital-asset.service.ts backend/src/modules/digital-asset/digital-asset-ledger-calculator.ts backend/src/modules/digital-asset/digital-asset.controller.ts backend/src/modules/digital-asset/dto/digital-asset-query.dto.ts backend/src/modules/digital-asset/digital-asset-v2.service.spec.ts
git commit -m "feat(digital-asset): implement v2 ledger semantics"
```

### Task 2.2: Wire VIP Activation Asset Grants

**Files:**
- Modify: `backend/src/modules/bonus/bonus.module.ts`
- Modify: `backend/src/modules/bonus/bonus.service.ts`
- Create: `backend/src/modules/bonus/bonus.service.digital-asset-v2.spec.ts`

- [ ] **Step 1: Write failing VIP activation tests**

Cover:

- New VIP receives self seed asset and historical credit asset before activation is marked `SUCCESS`.
- Direct inviter receives referral seed asset.
- Existing retry does not duplicate self/referral/historical ledgers.
- If digital asset grant throws, `VipPurchase.activationStatus` becomes `FAILED`.

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
cd backend
npx jest src/modules/bonus/bonus.service.digital-asset-v2.spec.ts --runInBand
```

Expected: fail because BonusService does not call DigitalAssetService.

- [ ] **Step 3: Import DigitalAssetModule**

In `bonus.module.ts`, import `DigitalAssetModule` so `BonusService` can receive `DigitalAssetService`.

- [ ] **Step 4: Inject and call service inside activation transaction**

In `activateVipAfterPayment()` after `updatedMember` and before final `vipPurchase.update(...SUCCESS...)`, call:

```ts
await this.digitalAssetService.grantVipActivationAssets(tx, {
  userId,
  vipPurchaseId: vipPurchase.id,
  packageId: vipPurchase.packageId,
  vipAmount: vipPurchase.amount,
  inviterUserId: updatedMember.inviterUserId || member?.inviterUserId || null,
});
```

Keep it inside the Serializable activation transaction so asset failures keep activation retryable.

- [ ] **Step 5: Run VIP tests**

Run:

```bash
cd backend
npx jest src/modules/bonus/bonus.service.digital-asset-v2.spec.ts src/modules/bonus/bonus.service.spec.ts --runInBand
```

Expected: pass.

- [ ] **Step 6: Commit VIP hook**

```bash
git add backend/src/modules/bonus/bonus.module.ts backend/src/modules/bonus/bonus.service.ts backend/src/modules/bonus/bonus.service.digital-asset-v2.spec.ts
git commit -m "feat(digital-asset): grant assets on vip activation"
```

### Task 2.3: Keep Order Receive And Refund Hooks Non-Blocking

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/order/order-auto-confirm.service.ts`
- Modify: `backend/src/modules/order/order.module.ts`
- Create: `backend/src/modules/order/order.service.digital-asset-v2.spec.ts`
- Create: `backend/src/modules/order/order-auto-confirm.digital-asset-v2.spec.ts`

- [ ] **Step 1: Write failing hook tests**

Cover:

- Manual confirm receive calls `recordOrderReceived(orderId, 'ORDER_RECEIVED')`.
- Auto confirm receive calls the same method.
- V2 service rejection writes the same dead-letter/error path as V1 and does not fail order terminal status.
- `VIP_PACKAGE` receive path does not create spend or credit ledgers.

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
cd backend
npx jest src/modules/order/order.service.digital-asset-v2.spec.ts src/modules/order/order-auto-confirm.digital-asset-v2.spec.ts --runInBand
```

Expected: fail on method name/behavior.

- [ ] **Step 3: Update service calls**

Replace direct V1 wording internally with:

```ts
this.digitalAssetService?.recordOrderReceived(orderId, 'ORDER_RECEIVED').catch(...)
```

Keep compatibility wrapper if fewer changes are safer.

- [ ] **Step 4: Run order tests**

Run:

```bash
cd backend
npx jest src/modules/order/order.service.digital-asset-v2.spec.ts src/modules/order/order-auto-confirm.digital-asset-v2.spec.ts src/modules/order/order.service.digital-asset.spec.ts --runInBand
```

Expected: pass.

- [ ] **Step 5: Commit order hooks**

```bash
git add backend/src/modules/order/order.service.ts backend/src/modules/order/order-auto-confirm.service.ts backend/src/modules/order/order.module.ts backend/src/modules/order/order.service.digital-asset-v2.spec.ts backend/src/modules/order/order-auto-confirm.digital-asset-v2.spec.ts
git commit -m "feat(digital-asset): update order hooks for v2"
```

### Task 2.4: Add V2 Backfill Script For Existing VIP Users

**Files:**
- Create: `backend/scripts/backfill-digital-asset-v2.ts`
- Create: `backend/src/modules/digital-asset/digital-asset-v2-backfill.spec.ts`

- [ ] **Step 1: Write failing backfill tests**

Cover:

- Dry run reports existing VIP with package match as `wouldCredit`.
- Missing `packageId` falls back to `VipPurchase.amount`.
- Missing package and amount match enters `invalidPackage`.
- Re-running after ledgers exist reports `alreadyCredited`.

- [ ] **Step 2: Implement dry-run first script**

CLI behavior:

```bash
tsx backend/scripts/backfill-digital-asset-v2.ts
tsx backend/scripts/backfill-digital-asset-v2.ts --execute
```

Default dry-run prints:

```text
wouldCredit=<integer>
alreadyCredited=<integer>
invalidPackage=<integer>
errors=<integer>
```

- [ ] **Step 3: Implement execute mode**

For each existing VIP:

```ts
await digitalAssetService.backfillExistingVipAssets({
  userId,
  vipPurchaseId,
  packageId,
  vipAmount,
});
```

The service should grant self seed and historical credit assets only. It must not backfill historical referral seed assets.

- [ ] **Step 4: Run backfill tests**

Run:

```bash
cd backend
npx jest src/modules/digital-asset/digital-asset-v2-backfill.spec.ts --runInBand
```

Expected: pass.

- [ ] **Step 5: Commit backfill script**

```bash
git add backend/scripts/backfill-digital-asset-v2.ts backend/src/modules/digital-asset/digital-asset-v2-backfill.spec.ts
git commit -m "feat(digital-asset): add v2 vip backfill"
```

---

## Chunk 3: Backend Admin APIs And Rule Configuration

### Task 3.1: Extend VIP Package Admin API

**Files:**
- Modify: `backend/src/modules/admin/vip-package/vip-package.dto.ts`
- Modify: `backend/src/modules/admin/vip-package/vip-package.service.ts`
- Create: `backend/src/modules/admin/vip-package/vip-package.service.digital-asset.spec.ts`

- [ ] **Step 1: Write failing tests**

Cover:

- Create package accepts `selfSeedAssetAmount` and `referralSeedAssetAmount`.
- Update package can change both fields.
- Negative values are rejected.
- `findAll()` returns both fields.

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
cd backend
npx jest src/modules/admin/vip-package/vip-package.service.digital-asset.spec.ts --runInBand
```

- [ ] **Step 3: Update DTOs**

Add optional integer fields:

```ts
@IsOptional()
@Type(() => Number)
@IsInt()
@Min(0)
@Max(999999999)
selfSeedAssetAmount?: number;

@IsOptional()
@Type(() => Number)
@IsInt()
@Min(0)
@Max(999999999)
referralSeedAssetAmount?: number;
```

- [ ] **Step 4: Update service create defaults**

Default by price:

```ts
function defaultSelfSeed(price: number) {
  if (price === 399) return 1000;
  if (price === 699) return 2000;
  if (price === 999) return 3000;
  return 0;
}
```

Referral defaults: `399 -> 2000`, `699 -> 4000`, `999 -> 8000`, otherwise 0.

- [ ] **Step 5: Run package tests**

Run:

```bash
cd backend
npx jest src/modules/admin/vip-package/vip-package.service.digital-asset.spec.ts --runInBand
```

Expected: pass.

- [ ] **Step 6: Commit package API**

```bash
git add backend/src/modules/admin/vip-package/vip-package.dto.ts backend/src/modules/admin/vip-package/vip-package.service.ts backend/src/modules/admin/vip-package/vip-package.service.digital-asset.spec.ts
git commit -m "feat(admin): expose vip seed asset config"
```

### Task 3.2: Add Digital Asset Rule APIs

**Files:**
- Modify: `backend/src/modules/admin/digital-asset/admin-digital-asset.controller.ts`
- Modify: `backend/src/modules/admin/digital-asset/admin-digital-asset.service.ts`
- Create: `backend/src/modules/digital-asset/dto/update-digital-asset-rules.dto.ts`
- Create: `backend/src/modules/admin/digital-asset/admin-digital-asset-v2.service.spec.ts`
- Create: `backend/src/modules/admin/digital-asset/admin-digital-asset-v2.controller.spec.ts`

- [ ] **Step 1: Write failing admin tests**

Cover:

- `GET /admin/digital-assets/rules` returns credit tiers and module settings.
- `PUT /admin/digital-assets/rules` validates no gaps/overlaps.
- Overview returns total asset, seed asset, credit asset, cumulative spend totals.
- Account list returns VIP status and all V2 balances.
- Admin adjustment requires `subjectType` of `SEED_ASSET` or `CREDIT_ASSET`.

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
cd backend
npx jest src/modules/admin/digital-asset/admin-digital-asset-v2.service.spec.ts src/modules/admin/digital-asset/admin-digital-asset-v2.controller.spec.ts --runInBand
```

- [ ] **Step 3: Add rule DTO**

DTO shape:

```ts
export class DigitalAssetCreditTierDto {
  minAmount!: number;
  maxAmount!: number | null;
  multiplier!: number;
}

export class UpdateDigitalAssetRulesDto {
  tiers!: DigitalAssetCreditTierDto[];
  modules!: DigitalAssetModuleSettingDto[];
}
```

- [ ] **Step 4: Add endpoints**

In controller:

```ts
@Get('rules')
@RequirePermission('digital_assets:settings')
getRules()

@Put('rules')
@RequirePermission('digital_assets:settings')
updateRules(@Body() dto: UpdateDigitalAssetRulesDto)
```

Keep existing `/settings` temporarily or make it delegate to `/rules` for backward compatibility.

- [ ] **Step 5: Update overview/list/detail/export**

CSV headers become:

```text
买家编号,用户ID,昵称,手机号,VIP状态,数字资产总额,种子资产,信用资产,累计消费,账户更新时间
```

- [ ] **Step 6: Run admin tests**

Run:

```bash
cd backend
npx jest src/modules/admin/digital-asset/admin-digital-asset-v2.service.spec.ts src/modules/admin/digital-asset/admin-digital-asset-v2.controller.spec.ts --runInBand
```

Expected: pass.

- [ ] **Step 7: Commit admin API**

```bash
git add backend/src/modules/admin/digital-asset backend/src/modules/digital-asset/dto/update-digital-asset-rules.dto.ts
git commit -m "feat(admin): add digital asset v2 rules api"
```

### Task 3.3: Backend Full Verification

**Files:**
- No source edits unless failures reveal implementation defects.

- [ ] **Step 1: Run Prisma validate**

```bash
cd backend
npx prisma validate
```

Expected: pass.

- [ ] **Step 2: Run targeted Jest suite**

```bash
cd backend
npx jest \
  src/modules/digital-asset/digital-asset-credit-calculator.spec.ts \
  src/modules/digital-asset/digital-asset-v2.service.spec.ts \
  src/modules/digital-asset/digital-asset-v2-backfill.spec.ts \
  src/modules/bonus/bonus.service.digital-asset-v2.spec.ts \
  src/modules/order/order.service.digital-asset-v2.spec.ts \
  src/modules/admin/digital-asset/admin-digital-asset-v2.service.spec.ts \
  src/modules/admin/vip-package/vip-package.service.digital-asset.spec.ts \
  --runInBand
```

Expected: pass.

- [ ] **Step 3: Run backend build**

```bash
cd backend
npm run build
```

Expected: pass.

- [ ] **Step 4: Commit fixes if needed**

Only if verification required code changes:

```bash
git add <changed-files>
git commit -m "fix(digital-asset): stabilize v2 backend verification"
```

---

## Chunk 4: Buyer App

Before this chunk, invoke frontend design guidance required by project rules.

### Task 4.1: Update App Types And Repo

**Files:**
- Modify: `src/types/domain/DigitalAsset.ts`
- Modify: `src/repos/DigitalAssetRepo.ts`

- [ ] **Step 1: Update types**

Add:

```ts
export type DigitalAssetSubjectType = 'CUMULATIVE_SPEND' | 'SEED_ASSET' | 'CREDIT_ASSET';
export type DigitalAssetSourceType =
  | 'CONSUMPTION_CONFIRMED'
  | 'REFUND_REVERSAL'
  | 'SELF_VIP_PURCHASE'
  | 'REFERRAL_VIP_PURCHASE'
  | 'HISTORICAL_CONSUMPTION_GRANT'
  | 'ADMIN_ADJUSTMENT'
  | 'BACKFILL';

export interface DigitalAssetSummary {
  isVip: boolean;
  totalAssetBalance: number;
  seedAssetBalance: number;
  creditAssetBalance: number;
  cumulativeSpendAmount: number;
  activationPrompt?: { title: string; description: string; actionLabel: string };
  currentCreditTier?: DigitalAssetCreditTierInfo;
  nextCreditTier?: DigitalAssetCreditTierInfo | null;
  vipSeedRules: DigitalAssetVipSeedRule[];
  recentRecords: DigitalAssetLedger[];
  modules: DigitalAssetModuleInfo[];
}
```

- [ ] **Step 2: Add repo method**

Add:

```ts
getConsumptionRecords(page = 1, pageSize = 20)
```

It calls `/me/digital-assets/ledgers`.

- [ ] **Step 3: Run TypeScript**

Run:

```bash
npx tsc -b
```

Expected: type errors remain only in pages not yet migrated, or pass if compatible fields are optional.

### Task 4.2: Redesign Digital Asset Page

**Files:**
- Modify: `app/me/digital-assets.tsx`

- [ ] **Step 1: Replace top summary logic**

VIP state shows:

```text
数字资产总额
种子资产
信用资产
累计消费金额
```

Non-VIP state shows:

```text
累计消费金额
让每一次消费，都成为你的数字资产基础
成为 VIP 后，累计消费可按规则转化为信用资产。
开通 VIP 激活资产
```

- [ ] **Step 2: Limit records to 5**

Use `summary.recentRecords` or fetch `getLedgers(1, 5)`.

Add button:

```text
查看全部消费记录
```

Route:

```ts
router.push('/me/consumption-records');
```

- [ ] **Step 3: Add rule cards**

Show:

- Current credit tier and next tier progress.
- VIP seed rules for latest package config.
- Long-term modules: neutral future-right placeholders, all marked rule pending.

- [ ] **Step 4: Run App TypeScript**

Run:

```bash
npx tsc -b
```

Expected: pass after record page is added in next task.

### Task 4.3: Add Consumption Records Page

**Files:**
- Create: `app/me/consumption-records.tsx`

- [ ] **Step 1: Create page**

Title: `消费记录`.

Use `DigitalAssetRepo.getConsumptionRecords(page, pageSize)` with infinite or paged FlatList.

Record labels:

```ts
CONSUMPTION_CONFIRMED + CUMULATIVE_SPEND -> 消费累计
CONSUMPTION_CONFIRMED + CREDIT_ASSET -> 信用资产入账
SELF_VIP_PURCHASE -> 自购 VIP 种子资产
REFERRAL_VIP_PURCHASE -> 推荐 VIP 种子资产
HISTORICAL_CONSUMPTION_GRANT -> 历史消费转入
REFUND_REVERSAL -> 退款扣回
ADMIN_ADJUSTMENT -> 后台调整
```

- [ ] **Step 2: Format amounts by subject**

Currency cumulative spend uses `¥`.

Digital asset records show integer values without unit.

- [ ] **Step 3: Run App TypeScript**

Run:

```bash
npx tsc -b
```

Expected: pass.

- [ ] **Step 4: Commit App changes**

```bash
git add src/types/domain/DigitalAsset.ts src/repos/DigitalAssetRepo.ts app/me/digital-assets.tsx app/me/consumption-records.tsx
git commit -m "feat(app): add digital asset v2 pages"
```

---

## Chunk 5: Admin Frontend

Before this chunk, invoke frontend design guidance required by project rules.

### Task 5.1: Update Admin API Types

**Files:**
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/api/digital-assets.ts`
- Modify: `admin/src/api/vip-gifts.ts`

- [ ] **Step 1: Extend digital asset types**

Add V2 fields to overview, row, detail, ledger, adjustment payload, and rules payload.

- [ ] **Step 2: Extend VIP package API types**

Add:

```ts
selfSeedAssetAmount: number;
referralSeedAssetAmount: number;
```

to `VipPackage`, `CreateVipPackageInput`, and `UpdateVipPackageInput`.

- [ ] **Step 3: Add rules API methods**

```ts
getDigitalAssetRules()
updateDigitalAssetRules(data)
```

- [ ] **Step 4: Run admin typecheck/build**

Run:

```bash
cd admin
npm run build
```

Expected: fails until pages are updated, or pass if types are backward compatible.

### Task 5.2: Update VIP Gift Package UI

**Files:**
- Modify: `admin/src/pages/vip-gifts/index.tsx`

- [ ] **Step 1: Add fields in VIP package table**

Show columns:

```text
自购种子资产
推荐种子资产
```

- [ ] **Step 2: Add fields in package modal**

Add integer `InputNumber` fields with min 0:

```text
自购种子资产
推荐种子资产
```

Default helper text:

```text
仅影响未来新支付成功的 VIP，历史流水不追溯。
```

- [ ] **Step 3: Run admin build**

```bash
cd admin
npm run build
```

Expected: any remaining errors should be from digital assets page only.

### Task 5.3: Update Digital Assets Admin Page

**Files:**
- Modify: `admin/src/pages/digital-assets/index.tsx`

- [ ] **Step 1: Update overview cards**

Cards:

```text
数字资产总额
种子资产总额
信用资产总额
累计消费总额
今日入账
今日扣回
```

- [ ] **Step 2: Update account table**

Columns:

```text
用户
VIP 状态
数字资产总额
种子资产
信用资产
累计消费
账户更新时间
```

- [ ] **Step 3: Update detail drawer**

Show asset split, cumulative spend, current tier, next tier progress, and ledger table with subject/source labels.

- [ ] **Step 4: Update adjustment modal**

Require `subjectType` radio:

```text
种子资产
信用资产
```

Do not allow total adjustment.

- [ ] **Step 5: Add rules section**

Add editable credit tier table under the page or a settings modal:

```text
起始累计消费
结束累计消费
倍率
```

Validation client-side mirrors backend: no gaps, no overlaps, first tier starts at 0, final tier may be blank.

- [ ] **Step 6: Run admin build**

```bash
cd admin
npm run build
```

Expected: pass.

- [ ] **Step 7: Commit admin frontend**

```bash
git add admin/src/types/index.ts admin/src/api/digital-assets.ts admin/src/api/vip-gifts.ts admin/src/pages/vip-gifts/index.tsx admin/src/pages/digital-assets/index.tsx
git commit -m "feat(admin): support digital asset v2 rules"
```

---

## Chunk 6: Legal, Docs, Verification, And Release Prep

### Task 6.1: Update Legal Copy

**Files:**
- Modify: `src/content/legal/termsOfService.ts`
- Modify: `src/content/legal/privacyPolicy.ts`
- Modify: `src/content/legal/memberServiceAgreement.ts`
- Regenerate if required: `docs/legal/爱买买法律文本审核稿.docx`

- [ ] **Step 1: Add legal text**

Add wording that states:

- Digital assets are not cash balances.
- Digital assets are not consumption points, securities, or tradable tokens.
- Digital assets cannot be transferred, traded, gifted, or resold.
- Cash exchange, fixed-term income, and future rights conversion are not promised until platform rules are published.
- Account deletion or serious violation clears digital assets while audit records are retained.

- [ ] **Step 2: Avoid prohibited wording**

Run:

```bash
rg -n "固定收益|保证收益|保证兑换|股权分红|现金余额" src/content/legal app src admin
```

Expected: no strong promise wording for digital assets. Existing unrelated legal text may appear and must be reviewed manually.

- [ ] **Step 3: Commit legal copy**

```bash
git add src/content/legal/termsOfService.ts src/content/legal/privacyPolicy.ts src/content/legal/memberServiceAgreement.ts docs/legal/爱买买法律文本审核稿.docx
git commit -m "docs(legal): add digital asset v2 boundaries"
```

If the `.docx` was not regenerated, omit it from `git add` and note why.

### Task 6.2: Sync Architecture And Safety Docs

**Files:**
- Modify: `docs/architecture/data-system.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/issues/tofix-safe.md`
- Modify: `plan.md`

- [ ] **Step 1: Update data-system**

Document:

- `DigitalAssetAccount` V2 fields.
- `DigitalAssetLedgerSubjectType`.
- `VipPackage` seed asset fields.
- VIP package exclusion from cumulative spend.

- [ ] **Step 2: Update frontend docs**

Document:

- Digital assets page normal/VIP states.
- Consumption records page.
- Recent 5 records behavior.

- [ ] **Step 3: Update admin frontend docs**

Document:

- Digital asset V2 admin page.
- VIP package seed asset fields.
- Credit tier rules editor.

- [ ] **Step 4: Update safety checklist**

Add checks for:

- Serializable writes.
- VIP activation retry coupling.
- Backfill dry-run.
- No direct total balance adjustment.
- No promise wording.

- [ ] **Step 5: Update plan.md**

Add digital asset V2 task status and verification checklist.

- [ ] **Step 6: Commit docs**

```bash
git add docs/architecture/data-system.md docs/architecture/frontend.md docs/architecture/admin-frontend.md docs/issues/tofix-safe.md plan.md
git commit -m "docs(digital-asset): sync v2 implementation docs"
```

### Task 6.3: Final Verification

**Files:**
- No source edits unless failures reveal defects.

- [ ] **Step 1: Backend validation**

```bash
cd backend
npx prisma validate
npm run build
```

Expected: both pass.

- [ ] **Step 2: Targeted backend tests**

```bash
cd backend
npx jest \
  src/modules/digital-asset/digital-asset-credit-calculator.spec.ts \
  src/modules/digital-asset/digital-asset-v2.service.spec.ts \
  src/modules/digital-asset/digital-asset-v2-backfill.spec.ts \
  src/modules/bonus/bonus.service.digital-asset-v2.spec.ts \
  src/modules/order/order.service.digital-asset-v2.spec.ts \
  src/modules/order/order-auto-confirm.digital-asset-v2.spec.ts \
  src/modules/admin/digital-asset/admin-digital-asset-v2.service.spec.ts \
  src/modules/admin/digital-asset/admin-digital-asset-v2.controller.spec.ts \
  src/modules/admin/vip-package/vip-package.service.digital-asset.spec.ts \
  --runInBand
```

Expected: pass.

- [ ] **Step 3: Frontend builds**

```bash
npx tsc -b
cd admin && npm run build
```

Expected: pass.

- [ ] **Step 4: Migration dry-run**

Run against a safe environment:

```bash
cd backend
tsx scripts/backfill-digital-asset-v2.ts
```

Expected: prints counts and performs no writes.

- [ ] **Step 5: Audit for old wording**

```bash
rg -n "累计消费金额\"|资产流水|未来权益|VIP 礼包.*计入累计|可提现|固定收益|股权分红" app src admin backend docs -S
```

Expected: any result is either intentionally legal-safe or updated.

- [ ] **Step 6: Commit verification fixes if needed**

Only if verification required code changes:

```bash
git add <changed-files>
git commit -m "fix(digital-asset): complete v2 verification"
```

## Execution Notes

- Start with backend schema/calculators; do not touch UI until backend response shapes are stable.
- Do not run `--execute` backfill against production without explicit user approval after reviewing dry-run output.
- Keep commits narrow by chunk. If a chunk grows too large, split by backend service/admin/App/docs boundaries.
- Existing unrelated untracked files in the worktree must remain untouched unless the user explicitly asks.
