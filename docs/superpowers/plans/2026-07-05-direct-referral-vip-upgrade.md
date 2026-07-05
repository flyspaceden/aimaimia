# Direct Referral VIP Upgrade Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build unified ordinary/VIP direct referral attribution, configurable direct commission rates, automatic VIP upgrade by cumulative spend, and matching App/admin UX.

**Architecture:** Keep ordinary share codes and VIP referral codes as separate entry channels, but resolve them into a single effective direct-referral relationship for order commissions and VIP upgrade decisions. Back-end changes own all money, attribution, and VIP tree state; admin changes expose configuration and audit; App changes only explain and display the active rules. Existing VIP purchase flow remains intact.

**Tech Stack:** NestJS + Prisma + PostgreSQL + Jest; React Native Expo + TanStack Query; React 19 admin + Ant Design Pro Components.

---

## Chunk 1: Backend Data Model And Config

### Task 1: Add Referral Relation Audit State

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_direct_referral_vip_upgrade/migration.sql`
- Test: `backend/src/modules/normal-share/normal-share.service.spec.ts`
- Test: `backend/src/modules/bonus/bonus.service.spec.ts`

- [ ] **Step 1: Add schema enum and fields**

Add an enum near existing normal share enums:

```prisma
enum DirectReferralRelationStatus {
  ACTIVE
  INVALIDATED_BY_INVITEE_VIP_UPGRADE
  SUPERSEDED_BY_VIP_TREE
  ADMIN_VOIDED
}
```

Extend `NormalShareBinding` with audit fields, without removing existing reward fields:

```prisma
relationStatus     DirectReferralRelationStatus @default(ACTIVE)
relationInvalidAt  DateTime?
relationInvalidReason String?
effectiveInviterUserId String?
```

Keep `inviteeUserId` unique. `effectiveInviterUserId` mirrors the inviter while active; it becomes `null` when the relation is invalidated.

- [ ] **Step 2: Write migration SQL**

Migration must:

```sql
CREATE TYPE "DirectReferralRelationStatus" AS ENUM (
  'ACTIVE',
  'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
  'SUPERSEDED_BY_VIP_TREE',
  'ADMIN_VOIDED'
);

ALTER TABLE "NormalShareBinding"
  ADD COLUMN "relationStatus" "DirectReferralRelationStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "relationInvalidAt" TIMESTAMP(3),
  ADD COLUMN "relationInvalidReason" TEXT,
  ADD COLUMN "effectiveInviterUserId" TEXT;

UPDATE "NormalShareBinding"
SET "effectiveInviterUserId" = "inviterUserId"
WHERE "effectiveInviterUserId" IS NULL;

CREATE INDEX "NormalShareBinding_relationStatus_createdAt_idx"
  ON "NormalShareBinding"("relationStatus", "createdAt");

CREATE INDEX "NormalShareBinding_effectiveInviterUserId_createdAt_idx"
  ON "NormalShareBinding"("effectiveInviterUserId", "createdAt");
```

- [ ] **Step 3: Run Prisma validation**

Run:

```bash
cd backend
npx prisma validate
```

Expected: schema validates.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/<timestamp>_direct_referral_vip_upgrade/migration.sql
git commit -m "feat: add direct referral relation state"
```

### Task 2: Add Config Keys For Direct Referral And Auto VIP

**Files:**
- Modify: `backend/src/modules/bonus/engine/bonus-config.service.ts`
- Modify: `backend/prisma/seed.ts`
- Modify: `backend/prisma/production-bootstrap.ts`
- Modify: `backend/prisma/migrations/<timestamp>_direct_referral_vip_upgrade/migration.sql`
- Test: `backend/src/modules/bonus/engine/bonus-config.service.spec.ts`

- [ ] **Step 1: Write config tests**

Add tests for:

```ts
it('loads normal direct referral and auto VIP defaults', async () => {
  prisma.ruleConfig.findMany.mockResolvedValue([]);
  const config = await service.getConfig();
  expect(config.normalDirectReferralPercent).toBe(0.01);
  expect(config.autoVipBySpendEnabled).toBe(true);
  expect(config.autoVipCumulativeSpendThreshold).toBe(399);
});

it('validates normal seven-way ratio with direct referral percent', async () => {
  prisma.ruleConfig.findMany.mockResolvedValue([
    { key: 'NORMAL_PLATFORM_PERCENT', value: { value: 0.49 } },
    { key: 'NORMAL_REWARD_PERCENT', value: { value: 0.16 } },
    { key: 'NORMAL_DIRECT_REFERRAL_PERCENT', value: { value: 0.01 } },
    { key: 'NORMAL_INDUSTRY_FUND_PERCENT', value: { value: 0.16 } },
    { key: 'NORMAL_CHARITY_PERCENT', value: { value: 0.08 } },
    { key: 'NORMAL_TECH_PERCENT', value: { value: 0.08 } },
    { key: 'NORMAL_RESERVE_PERCENT', value: { value: 0.02 } },
  ]);
  await expect(service.validateRatioUpdate('NORMAL_DIRECT_REFERRAL_PERCENT', 0.01)).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Implement config fields**

Update `NormalBonusConfig`:

```ts
normalDirectReferralPercent: number;
```

Update `SystemConfig` or `BonusConfig`:

```ts
autoVipBySpendEnabled: boolean;
autoVipCumulativeSpendThreshold: number;
```

Add keys:

```ts
NORMAL_DIRECT_REFERRAL_PERCENT: 'normalDirectReferralPercent',
AUTO_VIP_BY_SPEND_ENABLED: 'autoVipBySpendEnabled',
AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD: 'autoVipCumulativeSpendThreshold',
```

Defaults:

```ts
normalPlatformPercent: 0.49,
normalDirectReferralPercent: 0.01,
autoVipBySpendEnabled: true,
autoVipCumulativeSpendThreshold: 399,
```

Normal ratio validation must sum:

```ts
NORMAL_PLATFORM_PERCENT
+ NORMAL_REWARD_PERCENT
+ NORMAL_DIRECT_REFERRAL_PERCENT
+ NORMAL_INDUSTRY_FUND_PERCENT
+ NORMAL_CHARITY_PERCENT
+ NORMAL_TECH_PERCENT
+ NORMAL_RESERVE_PERCENT
```

- [ ] **Step 3: Seed and bootstrap**

Add RuleConfig rows:

```ts
{ key: 'NORMAL_DIRECT_REFERRAL_PERCENT', value: 0.01, desc: '普通用户利润-直推持续佣金比例' },
{ key: 'AUTO_VIP_BY_SPEND_ENABLED', value: true, desc: '是否启用累计消费自动成为VIP' },
{ key: 'AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD', value: 399, desc: '累计普通商品有效消费达到多少元自动成为VIP' },
```

Adjust `NORMAL_PLATFORM_PERCENT` default from `0.50` to `0.49`.

- [ ] **Step 4: Run tests**

Run:

```bash
cd backend
npx jest src/modules/bonus/engine/bonus-config.service.spec.ts --runInBand
npx prisma validate
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/bonus/engine/bonus-config.service.ts backend/src/modules/bonus/engine/bonus-config.service.spec.ts backend/prisma/seed.ts backend/prisma/production-bootstrap.ts backend/prisma/migrations/<timestamp>_direct_referral_vip_upgrade/migration.sql
git commit -m "feat: configure direct referral and auto vip rules"
```

---

## Chunk 2: Backend Referral Binding And VIP Upgrade

### Task 3: Make Normal Share Binding Create Effective Direct Relation

**Files:**
- Modify: `backend/src/modules/normal-share/normal-share.service.ts`
- Modify: `backend/src/modules/normal-share/normal-share.service.spec.ts`
- Modify: `backend/src/modules/bonus/bonus.service.ts`
- Modify: `backend/src/modules/bonus/bonus.service.spec.ts`

- [ ] **Step 1: Write failing tests for no-switch rule**

Add tests:

```ts
it('normal share bind writes MemberProfile.inviterUserId when empty', async () => {
  // existing member has no inviter
  // expect tx.memberProfile.upsert/update sets inviterUserId to inviter-1
});

it('normal share bind rejects when MemberProfile already has a different inviter', async () => {
  // memberProfile.inviterUserId = vip-inviter
  // expect "已绑定推荐关系，不能更换"
});

it('VIP referral bind rejects existing normal inviter from different user', async () => {
  // normalShareBinding exists for inviteeUserId with inviterUserId normal-a
  // using VIP code from vip-b should reject
});
```

- [ ] **Step 2: Implement canonical bind check**

In `NormalShareService.bind()`:

1. Load invitee `MemberProfile`.
2. If `inviterUserId` exists and differs from `inviterProfile.userId`, reject.
3. If no `inviterUserId`, upsert/update `MemberProfile.inviterUserId`.
4. Create `NormalShareBinding` with:

```ts
relationStatus: 'ACTIVE',
effectiveInviterUserId: inviterProfile.userId,
```

Remove the old hard block that rejects inviter if inviter later became VIP for existing normal share codes. For new normal share binds, the normal share profile can remain valid only if source code belongs to a user whose share profile is active; inviter VIP status should not break historical links.

- [ ] **Step 3: Change VIP referral no-switch behavior**

In `BonusService.useReferralCode()`:

- Remove “VIP 前允许更换推荐人” behavior.
- If `MemberProfile.inviterUserId` exists and differs from VIP inviter, reject.
- If `NormalShareBinding` exists with different active inviter, reject.
- If same inviter, return idempotent success.
- Only create `ReferralLink` if no conflicting relation exists.

- [ ] **Step 4: Run binding tests**

Run:

```bash
cd backend
npx jest src/modules/normal-share/normal-share.service.spec.ts src/modules/bonus/bonus.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/normal-share/normal-share.service.ts backend/src/modules/normal-share/normal-share.service.spec.ts backend/src/modules/bonus/bonus.service.ts backend/src/modules/bonus/bonus.service.spec.ts
git commit -m "feat: lock direct referral binding"
```

### Task 4: Resolve VIP Tree Inviter During Upgrade

**Files:**
- Modify: `backend/src/modules/bonus/bonus.service.ts`
- Modify: `backend/src/modules/bonus/bonus.service.spec.ts`
- Modify: `backend/src/modules/bonus/bonus.service.digital-asset-v2.spec.ts`

- [ ] **Step 1: Write tests for all upgrade branches**

Add tests:

```ts
it('invalidates ordinary inviter when invitee becomes VIP and inviter is still normal', async () => {
  // A normal, B has inviterUserId=A
  // activate VIP for B
  // expect normalShareBinding relationStatus INVALIDATED...
  // expect MemberProfile.inviterUserId cleared or ignored for VIP tree
  // expect assignVipTreeNode uses system path
});

it('keeps relation and inserts under inviter when inviter is already VIP', async () => {
  // A VIP with vipNodeId, B has inviterUserId=A
  // expect B inserted under A subtree
  // expect normalShareBinding relationStatus SUPERSEDED_BY_VIP_TREE
});

it('does not grant one-time VIP referral bonus on VIP purchase', async () => {
  // vipPurchase.referralBonusRate > 0
  // expect grantVipReferralBonus not called / no VIP_REFERRAL ledger
});
```

- [ ] **Step 2: Extract VIP upgrade context helper**

Add private helper:

```ts
private async resolveVipUpgradeReferralContext(tx: Prisma.TransactionClient, inviteeUserId: string) {
  const member = await tx.memberProfile.findUnique({ where: { userId: inviteeUserId } });
  const inviterUserId = member?.inviterUserId ?? null;
  if (!inviterUserId) return { vipTreeInviterUserId: null, directInviterUserId: null, invalidated: false };

  const inviterMember = await tx.memberProfile.findUnique({ where: { userId: inviterUserId } });
  const inviterCanCarryVip = inviterMember?.tier === 'VIP' && !!inviterMember.vipNodeId;
  if (inviterCanCarryVip) {
    await tx.normalShareBinding.updateMany({
      where: { inviteeUserId, inviterUserId, relationStatus: 'ACTIVE' },
      data: { relationStatus: 'SUPERSEDED_BY_VIP_TREE' },
    });
    return { vipTreeInviterUserId: inviterUserId, directInviterUserId: inviterUserId, invalidated: false };
  }

  await tx.normalShareBinding.updateMany({
    where: { inviteeUserId, inviterUserId, relationStatus: 'ACTIVE' },
    data: {
      relationStatus: 'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
      relationInvalidAt: new Date(),
      relationInvalidReason: 'INVITER_NOT_VIP_AT_INVITEE_UPGRADE',
      effectiveInviterUserId: null,
    },
  });
  await tx.memberProfile.updateMany({
    where: { userId: inviteeUserId, inviterUserId },
    data: { inviterUserId: null },
  });
  return { vipTreeInviterUserId: null, directInviterUserId: null, invalidated: true };
}
```

- [ ] **Step 3: Change `assignVipTreeNode` signature**

Change:

```ts
private async assignVipTreeNode(tx: any, userId: string)
```

to:

```ts
private async assignVipTreeNode(tx: any, userId: string, vipTreeInviterUserId?: string | null)
```

Use `vipTreeInviterUserId` instead of `member.inviterUserId` for VIP tree placement.

- [ ] **Step 4: Remove one-time A reward from B VIP purchase**

Delete or bypass this block in `activateVipAfterPayment()`:

```ts
const referralBonus = Math.floor(vipPurchase.amount * referralBonusRateSnapshot * 100) / 100;
if (inviterUserId && referralBonus > 0) {
  await this.grantVipReferralBonus(...)
}
```

Keep historical helper methods if other admin/manual flows still reference them, but VIP package activation should not grant A a one-time recommendation reward.

- [ ] **Step 5: Run VIP activation tests**

Run:

```bash
cd backend
npx jest src/modules/bonus/bonus.service.spec.ts src/modules/bonus/bonus.service.digital-asset-v2.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/bonus/bonus.service.ts backend/src/modules/bonus/bonus.service.spec.ts backend/src/modules/bonus/bonus.service.digital-asset-v2.spec.ts
git commit -m "feat: resolve vip upgrade referral placement"
```

### Task 5: Add Auto VIP Upgrade By Cumulative Spend

**Files:**
- Modify: `backend/src/modules/bonus/bonus.service.ts`
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/order/order-auto-confirm.service.ts`
- Test: `backend/src/modules/order/order.service.digital-asset.spec.ts`
- Test: `backend/src/modules/order/order-auto-confirm.digital-asset.spec.ts`
- Test: `backend/src/modules/bonus/bonus.service.spec.ts`

- [ ] **Step 1: Add tests**

Test manual confirm receive:

```ts
it('auto upgrades ordinary buyer to VIP when cumulative spend reaches configured threshold', async () => {
  // after receive cumulativeSpendAmount >= 399
  // expect bonusService.activateVipByCumulativeSpend called once
});
```

Test auto confirm receive:

```ts
it('auto confirm path also checks cumulative VIP upgrade threshold', async () => {
  // same expectation for order-auto-confirm
});
```

Test `BonusService.activateVipByCumulativeSpend()`:

```ts
it('activates VIP without VIP purchase, gift, or one-time referral bonus', async () => {
  // expect member tier VIP, vipNode assigned, no VipPurchase required
});
```

- [ ] **Step 2: Implement BonusService public method**

Add:

```ts
async activateVipByCumulativeSpend(userId: string, sourceOrderId: string) {
  return this.prisma.$transaction(async (tx) => {
    const config = await this.configService.getConfig();
    if (!config.autoVipBySpendEnabled) return { status: 'DISABLED' };
    const account = await tx.digitalAssetAccount.findUnique({ where: { userId } });
    if ((account?.cumulativeSpendAmount ?? 0) < config.autoVipCumulativeSpendThreshold) {
      return { status: 'NOT_ELIGIBLE' };
    }
    // If already VIP, idempotent success.
    // Resolve VIP upgrade referral context.
    // Set MemberProfile tier VIP, vipPurchasedAt now if absent, referralCode if missing.
    // Create VipProgress.
    // Assign VIP tree node using resolved vipTreeInviterUserId.
    // Freeze normalProgress.
    // Write audit ledger/event in meta, but no VipPurchase and no gift.
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
```

Use an idempotency guard. If no new model is introduced, idempotency can be based on `MemberProfile.tier === 'VIP'` plus a `vipPurchasedAt` already set. If an audit model is added, key it by `AUTO_VIP_BY_SPEND:{userId}`.

- [ ] **Step 3: Inject BonusService into order receive paths**

In `OrderService`, after digital asset cumulative spend credit succeeds and before async coupon trigger is acceptable, call:

```ts
this.bonusService?.activateVipByCumulativeSpend(order.userId, order.id).catch(...)
```

Use the existing setter pattern if direct injection would create a module cycle.

Repeat for `OrderAutoConfirmService`.

- [ ] **Step 4: Run tests**

Run:

```bash
cd backend
npx jest src/modules/order/order.service.digital-asset.spec.ts src/modules/order/order-auto-confirm.digital-asset.spec.ts src/modules/bonus/bonus.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/bonus/bonus.service.ts backend/src/modules/order/order.service.ts backend/src/modules/order/order-auto-confirm.service.ts backend/src/modules/order/order.service.digital-asset.spec.ts backend/src/modules/order/order-auto-confirm.digital-asset.spec.ts backend/src/modules/bonus/bonus.service.spec.ts
git commit -m "feat: auto upgrade vip by spend threshold"
```

---

## Chunk 3: Backend Direct Referral Commission

### Task 6: Generalize VIP Direct Commission Into Direct Referral Commission

**Files:**
- Rename/Modify: `backend/src/modules/bonus/engine/vip-direct-referral-commission.service.ts`
- Modify: `backend/src/modules/bonus/engine/vip-direct-referral-commission.service.spec.ts`
- Modify: `backend/src/modules/order/checkout.service.ts`
- Modify: `backend/src/modules/order/checkout-vip-direct-referral.spec.ts`
- Modify: `backend/src/modules/bonus/bonus.module.ts`
- Modify: `backend/src/modules/order/order.module.ts`

- [ ] **Step 1: Write tests for normal and VIP inviter**

Add cases:

```ts
it('credits normal inviter from normal buyer order using NORMAL_REWARD and normal direct percent', async () => {
  // buyer member tier NORMAL, inviter member tier NORMAL
  // expect account type NORMAL_REWARD
  // expect scheme NORMAL_DIRECT_REFERRAL
  // expect ratio normalDirectReferralPercent
});

it('credits VIP inviter from normal buyer order using VIP_REWARD and vip direct percent', async () => {
  // buyer can be NORMAL or VIP
  // inviter member tier VIP
  // expect account type VIP_REWARD
  // expect scheme VIP_DIRECT_REFERRAL
});

it('skips when ordinary relation was invalidated by invitee VIP upgrade', async () => {
  // no effective inviter
  // expect skipped or platform based on existing policy
});
```

- [ ] **Step 2: Implement relation resolution**

Service method should:

1. Load order with buyer `MemberProfile.inviterUserId`.
2. If missing, fallback to active `NormalShareBinding.effectiveInviterUserId`.
3. Load inviter member tier and active user status.
4. Select:

```ts
const accountType = inviterTier === 'VIP' ? 'VIP_REWARD' : 'NORMAL_REWARD';
const ratio = inviterTier === 'VIP'
  ? config.vipDirectReferralPercent
  : config.normalDirectReferralPercent;
const scheme = inviterTier === 'VIP'
  ? 'VIP_DIRECT_REFERRAL'
  : 'NORMAL_DIRECT_REFERRAL';
```

5. Calculate profit from non-prize order items.
6. Create `RewardAllocation` and `RewardLedger` with `FROZEN`.
7. Snapshot `inviterTierAtOrder`, `inviteeTierAtOrder`, `ratio`, `profit`, `sourceRelation`.

- [ ] **Step 3: Preserve existing VIP release compatibility**

Keep `VIP_DIRECT_REFERRAL` scheme for VIP inviter ledgers so existing wallet labels do not regress. Add `NORMAL_DIRECT_REFERRAL` to wallet labels.

- [ ] **Step 4: Run tests**

Run:

```bash
cd backend
npx jest src/modules/bonus/engine/vip-direct-referral-commission.service.spec.ts src/modules/order/checkout-vip-direct-referral.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/bonus/engine/vip-direct-referral-commission.service.ts backend/src/modules/bonus/engine/vip-direct-referral-commission.service.spec.ts backend/src/modules/order/checkout.service.ts backend/src/modules/order/checkout-vip-direct-referral.spec.ts backend/src/modules/bonus/bonus.module.ts backend/src/modules/order/order.module.ts
git commit -m "feat: add unified direct referral commission"
```

### Task 7: Release And Void Normal Direct Referral Ledgers

**Files:**
- Modify: `backend/src/modules/bonus/engine/freeze-expire.service.ts`
- Modify: `backend/src/modules/bonus/engine/freeze-expire.service.spec.ts`
- Modify: `backend/src/modules/bonus/engine/bonus-allocation.service.ts`
- Modify: `backend/src/modules/bonus/engine/bonus-allocation.service.spec.ts`
- Modify: `backend/src/modules/after-sale/after-sale-reward.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale-reward.service.spec.ts`

- [ ] **Step 1: Add tests**

Add release tests for `NORMAL_DIRECT_REFERRAL`:

```ts
it('releases normal direct referral after received and return window', async () => {});
it('voids normal direct referral when after-sale succeeds', async () => {});
it('excludes normal direct referral from generic frozen expiration', async () => {});
```

- [ ] **Step 2: Generalize scheme sets**

Replace VIP-only constants with:

```ts
const DIRECT_REFERRAL_SCHEMES = new Set(['VIP_DIRECT_REFERRAL', 'NORMAL_DIRECT_REFERRAL']);
const DIRECT_REFERRAL_PLATFORM_SCHEMES = new Set(['VIP_DIRECT_REFERRAL_PLATFORM', 'NORMAL_DIRECT_REFERRAL_PLATFORM']);
```

Generic freeze expiration must exclude both direct schemes.

- [ ] **Step 3: Update void mirror metadata**

Void mirrors should preserve `originalScheme` and write:

```ts
scheme: 'DIRECT_REFERRAL_VOID'
```

or keep old VIP scheme and add `NORMAL_DIRECT_REFERRAL_VOID`; choose the option that least disrupts existing reports. If using one generic scheme, update wallet label mapping.

- [ ] **Step 4: Run tests**

Run:

```bash
cd backend
npx jest src/modules/bonus/engine/freeze-expire.service.spec.ts src/modules/bonus/engine/bonus-allocation.service.spec.ts src/modules/after-sale/after-sale-reward.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/bonus/engine/freeze-expire.service.ts backend/src/modules/bonus/engine/freeze-expire.service.spec.ts backend/src/modules/bonus/engine/bonus-allocation.service.ts backend/src/modules/bonus/engine/bonus-allocation.service.spec.ts backend/src/modules/after-sale/after-sale-reward.service.ts backend/src/modules/after-sale/after-sale-reward.service.spec.ts
git commit -m "feat: release and void direct referral commissions"
```

---

## Chunk 4: Admin Backend And Admin Frontend

### Task 8: Expose Relation Status And Auto VIP Config To Admin APIs

**Files:**
- Modify: `backend/src/modules/admin/growth/admin-growth.service.ts`
- Modify: `backend/src/modules/admin/growth/admin-growth.controller.ts`
- Modify: `backend/src/modules/admin/growth/dto/admin-growth.dto.ts`
- Test: `backend/src/modules/admin/growth/admin-growth.service.spec.ts`

- [ ] **Step 1: Add service tests**

Add tests:

```ts
it('lists normal share bindings with relation status and effective inviter', async () => {});
it('growth account rows include direct referral status summary', async () => {});
```

- [ ] **Step 2: Include fields in list APIs**

`listNormalShareBindings()` should include:

```ts
relationStatus
relationInvalidAt
relationInvalidReason
effectiveInviterUserId
```

Account list rows should expose:

```ts
directReferralInviterUserId
directReferralStatus
directReferralSource
```

- [ ] **Step 3: Run tests**

Run:

```bash
cd backend
npx jest src/modules/admin/growth/admin-growth.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/admin/growth/admin-growth.service.ts backend/src/modules/admin/growth/admin-growth.controller.ts backend/src/modules/admin/growth/dto/admin-growth.dto.ts backend/src/modules/admin/growth/admin-growth.service.spec.ts
git commit -m "feat: expose direct referral audit to admin"
```

### Task 9: Add Admin UI Controls And Explanation

**Files:**
- Modify: `admin/src/pages/bonus/normal-config.tsx`
- Modify: `admin/src/pages/bonus/vip-config.tsx`
- Modify: `admin/src/pages/growth/index.tsx`
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/api/growth.ts`

- [ ] **Step 1: Add normal config fields**

In `normal-config.tsx`, add:

```ts
{
  key: 'NORMAL_DIRECT_REFERRAL_PERCENT',
  label: '普通直推佣金占比',
  group: 'ratio',
  type: 'percent',
  min: 0,
  max: 1,
  step: 0.01,
  description: '普通用户推荐好友后，从好友普通商品订单利润中获得的持续佣金比例',
  defaultValue: 0.01,
}
```

Set recommended ratio:

```ts
NORMAL_PLATFORM_PERCENT: 0.49,
NORMAL_DIRECT_REFERRAL_PERCENT: 0.01,
```

- [ ] **Step 2: Add auto VIP fields**

Use the normal config page or growth settings panel. Recommended placement: `admin/src/pages/growth/index.tsx` global settings tab, because it is growth conversion, not only normal tree config.

Fields:

```ts
AUTO_VIP_BY_SPEND_ENABLED
AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD
```

Visible copy:

```text
累计普通商品有效消费达到门槛后自动成为 VIP。VIP 礼包购买流程不受影响。
```

- [ ] **Step 3: Update VIP config text**

In `vip-config.tsx`, keep `VIP_DIRECT_REFERRAL_PERCENT`, but clarify:

```text
VIP 推荐人从被推荐人后续普通商品订单利润中获得的持续佣金比例。被推荐人购买 VIP 礼包本身不单独发放推荐奖。
```

- [ ] **Step 4: Update growth relation table**

In `growth/index.tsx`, add relation columns:

- 推荐关系状态
- 有效推荐人
- 失效原因
- 失效时间

Use tags:

```ts
ACTIVE -> 生效中
SUPERSEDED_BY_VIP_TREE -> 已转 VIP 关系
INVALIDATED_BY_INVITEE_VIP_UPGRADE -> 被推荐人成为 VIP，原推荐人未成 VIP，已解绑
ADMIN_VOIDED -> 后台作废
```

- [ ] **Step 5: Build admin**

Run:

```bash
cd admin
npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 6: Commit**

```bash
git add admin/src/pages/bonus/normal-config.tsx admin/src/pages/bonus/vip-config.tsx admin/src/pages/growth/index.tsx admin/src/types/index.ts admin/src/api/growth.ts
git commit -m "feat: manage direct referral growth rules"
```

---

## Chunk 5: App UX

### Task 10: Update Growth And Referral Pages

**Files:**
- Modify: `src/types/domain/Growth.ts`
- Modify: `src/types/domain/Bonus.ts`
- Modify: `src/repos/GrowthRepo.ts`
- Modify: `src/repos/BonusRepo.ts`
- Modify: `app/me/growth.tsx`
- Modify: `app/me/referral.tsx`
- Modify: `src/utils/referralRelation.ts`

- [ ] **Step 1: Add API types**

Extend types with optional fields returned by backend:

```ts
directReferralStatus?: 'ACTIVE' | 'INVALIDATED_BY_INVITEE_VIP_UPGRADE' | 'SUPERSEDED_BY_VIP_TREE' | 'ADMIN_VOIDED' | null;
directReferralInviter?: { id: string; nickname: string | null; buyerNo?: string | null } | null;
autoVipBySpendEnabled?: boolean;
autoVipCumulativeSpendThreshold?: number;
autoVipRemainingSpend?: number | null;
directReferralPercent?: number | null;
```

- [ ] **Step 2: Update ordinary growth copy**

In `app/me/growth.tsx`, ordinary users should see:

```text
邀请好友后，可按后台规则获得好友普通商品订单利润的一定比例。好友成为 VIP 时，如果你还不是 VIP，普通推荐关系会结束；如果你已是 VIP，好友会进入你的 VIP 团队。
```

Show automatic VIP progress when backend returns threshold:

```text
累计普通商品有效消费满 ¥399 可自动成为 VIP
还差 ¥xx
```

- [ ] **Step 3: Update VIP growth copy**

VIP users should see:

```text
你推荐的好友成为 VIP 后会进入你的 VIP 团队；好友后续普通商品订单按 VIP 直推比例结算。
```

- [ ] **Step 4: Update referral page non-VIP copy**

Replace the current “购买 VIP 后将加入该推荐人的 VIP 团队” unconditional copy. It must become conditional:

```text
如果推荐人在你成为 VIP 时已经是 VIP，你将进入 TA 的 VIP 团队；如果 TA 仍是普通用户，普通推荐关系会结束。
```

- [ ] **Step 5: App tests/build**

Run:

```bash
npm test -- --runInBand
npx tsc --noEmit
```

If root `tsc` is not configured, use the repo's established App validation command and record it in the final implementation notes.

- [ ] **Step 6: Commit**

```bash
git add src/types/domain/Growth.ts src/types/domain/Bonus.ts src/repos/GrowthRepo.ts src/repos/BonusRepo.ts app/me/growth.tsx app/me/referral.tsx src/utils/referralRelation.ts
git commit -m "feat: explain direct referral vip upgrade in app"
```

---

## Chunk 6: Final Integration And Documentation

### Task 11: Backfill Existing Normal Relations

**Files:**
- Create: `backend/scripts/backfill-direct-referral-relations.ts`
- Modify: `backend/package.json`
- Test: optional dry-run output with local/staging DB only after env confirmation

- [ ] **Step 1: Write dry-run capable script**

Script behavior:

```ts
// dry run by default
// for each NormalShareBinding:
// if MemberProfile.inviterUserId is null, set it to binding.inviterUserId
// if MemberProfile.inviterUserId differs, do not overwrite; mark/report conflict
// set effectiveInviterUserId when relationStatus ACTIVE and empty
```

Add command:

```json
"direct-referral:backfill": "ts-node scripts/backfill-direct-referral-relations.ts"
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/backfill-direct-referral-relations.ts backend/package.json
git commit -m "chore: add direct referral backfill script"
```

### Task 12: Update Docs And Run Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-05-direct-referral-vip-upgrade-design.md`
- Modify: `docs/superpowers/plans/2026-07-05-direct-referral-vip-upgrade.md`
- Modify if App UI changes were made: `docs/architecture/frontend.md`
- Modify: `plan.md`
- Modify if security findings are found: `docs/issues/tofix-safe.md`

- [ ] **Step 1: Update docs**

Add an implementation status section to the spec:

```md
## Implementation Status

- Backend data/config: done
- Backend binding and VIP upgrade: done
- Backend direct commission: done
- Admin configuration/audit: done
- App UX: done
```

Update `docs/architecture/frontend.md` for App pages touched and `plan.md` for sprint tracking.

- [ ] **Step 2: Security checklist**

Because this touches funds, rewards, status transitions, and referral attribution:

- Confirm all money/reward writes are inside `Serializable` transactions.
- Confirm idempotency keys exist for order-paid commission creation.
- Confirm refund/after-sale void paths handle both normal and VIP direct referral ledgers.
- Confirm relation invalidation cannot be raced with VIP activation.
- If a new risk is found, append it to `docs/issues/tofix-safe.md`.

- [ ] **Step 3: Run backend verification**

Run:

```bash
cd backend
npx prisma validate
npx jest src/modules/bonus/engine/bonus-config.service.spec.ts src/modules/normal-share/normal-share.service.spec.ts src/modules/bonus/bonus.service.spec.ts src/modules/bonus/engine/vip-direct-referral-commission.service.spec.ts src/modules/bonus/engine/freeze-expire.service.spec.ts src/modules/admin/growth/admin-growth.service.spec.ts --runInBand
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run admin verification**

Run:

```bash
cd admin
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run App verification**

Run:

```bash
npm test -- --runInBand
```

Expected: PASS. Also perform a TypeScript validation if the repo has a working command.

- [ ] **Step 6: Final commit**

```bash
git add docs/superpowers/specs/2026-07-05-direct-referral-vip-upgrade-design.md docs/superpowers/plans/2026-07-05-direct-referral-vip-upgrade.md docs/architecture/frontend.md plan.md docs/issues/tofix-safe.md
git commit -m "docs: update direct referral implementation status"
```

---

## Execution Notes

- Do not change VIP package checkout semantics except removing the one-time recommendation payout to A for B buying VIP.
- Do not pay direct commission on VIP package orders or group-buy orders.
- Direct commission is based on order profit, not order sales amount.
- Direct commission rate is snapshotted at order payment and never recalculated after later identity changes.
- If B becomes VIP while A is ordinary, the A-B relation is invalidated permanently and does not revive when A later becomes VIP.
- If B becomes VIP while A is VIP with a tree node, B enters A's VIP subtree using the existing tree placement algorithm.
- App copy must avoid saying ordinary bound users will always enter the inviter's VIP team; it depends on inviter VIP status at B's VIP activation time.
