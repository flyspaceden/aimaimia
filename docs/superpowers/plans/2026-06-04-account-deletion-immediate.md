# Account Deletion Immediate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement immediate, irrevocable buyer account deletion with payment/withdraw blockers, atomic asset forfeiture, identity release, legal text updates, and a buyer App deletion flow.
**Architecture:** Add a focused backend deletion module under `backend/src/modules/me/deletion/` that owns preview, deletion SMS, and execute endpoints. The service composes existing Prisma data and runs irreversible cleanup in one Serializable transaction. Payment and withdrawal records are blockers only; paid orders and audit records are retained with privacy-safe account state. The buyer App consumes typed repository methods and logs out immediately after success.
**Tech Stack:** NestJS + Prisma + PostgreSQL Serializable transactions, React Native + Expo Router + TypeScript, Zustand auth store, Jest, Prisma CLI, root TypeScript verification.

---

## Source Of Truth

- Spec: `docs/superpowers/specs/2026-06-04-account-deletion-immediate-design.md`
- Data model authority: `docs/architecture/data-system.md`
- Auth/security context: `docs/security/security-audit.md`
- App account UI context: `app/account-security.tsx`

## Implementation Rules

- Do not implement a recovery window. Deletion succeeds immediately after the final confirmation.
- Block deletion when the user is not active, is an active company owner, has an active checkout, has processing payment records, or has processing withdrawal records.
- Do not block deletion for paid orders or active after-sale records. Those records remain retained and continue through their own fulfillment, refund, invoice, and audit paths.
- Do not delete paid orders, payment transactions, payout records, refund records, after-sale records, invoices, or login events.
- Execute irreversible asset handling and account status mutation in one database transaction with `Serializable` isolation.
- Use `User.status = DELETED` plus deletion timestamps to reject old JWTs and old identity mutation paths.
- Release phone and WeChat login identifiers by rewriting identity values to tombstoned values instead of deleting identity audit history.
- Buyer-facing copy must clearly state that rewards, coupons, VIP rights, lottery prizes, and wallet balances are forfeited and cannot be recovered.

## File Map

Backend:
- Modify `backend/prisma/schema.prisma`
- Create generated Prisma migration with `cd backend && npx prisma migrate dev --name account_deletion_immediate`
- Create `backend/src/modules/me/deletion/dto/deletion.dto.ts`
- Create `backend/src/modules/me/deletion/deletion.controller.ts`
- Create `backend/src/modules/me/deletion/deletion.service.ts`
- Create `backend/src/modules/me/deletion/deletion.module.ts`
- Create `backend/src/modules/me/deletion/deletion.service.spec.ts`
- Modify `backend/src/app.module.ts`
- Modify `backend/src/modules/address/address.service.ts`
- Create `backend/src/modules/address/address.service.spec.ts` if no address service spec covers soft delete
- Modify `backend/src/modules/auth/jwt.strategy.ts`
- Create or extend `backend/src/modules/auth/jwt.strategy.spec.ts`
- Modify `backend/src/modules/auth/auth.service.ts`
- Modify `backend/src/modules/bonus/bonus.service.ts`
- Modify `backend/src/modules/deferred-link/deferred-link.service.ts`
- Create or extend tests for referral and deferred-link deletion behavior

Buyer App:
- Create `src/types/domain/AccountDeletion.ts`
- Create `src/repos/AccountDeletionRepo.ts`
- Modify `src/repos/index.ts`
- Modify `app/account-security.tsx`
- Create `app/me/deletion.tsx`
- Modify `src/content/legal/privacyPolicy.ts`
- Modify `src/content/legal/termsOfService.ts`

Docs:
- Modify `docs/architecture/frontend.md`
- Modify `plan.md`
- Modify `AGENTS.md`
- Modify `docs/operations/app-发布与OTA手册.md` only after a real OTA or native build command is executed

---

## Task 1: Schema And Address Soft Delete

- [ ] Add account deletion fields and deletion SMS purpose in `backend/prisma/schema.prisma`.

```prisma
enum SmsPurpose {
  LOGIN
  BIND
  RESET
  BUYER_RESET
  SELLER_RESET
  DELETION
}

enum UserStatus {
  ACTIVE
  BANNED
  DELETED
}

model User {
  deletionExecutedAt    DateTime?
  deletionConfirmMethod String?
  deletionMeta          Json?

  @@index([deletionExecutedAt])
}

model Address {
  deletedAt DateTime?

  @@index([userId, deletedAt])
}
```

- [ ] Generate and review the migration.

```bash
cd backend
npx prisma migrate dev --name account_deletion_immediate
```

Expected output includes:

```text
Applying migration
Your database is now in sync with your schema.
```

- [ ] Update `backend/src/modules/address/address.service.ts` so every user-facing address read/count/update path uses `deletedAt: null`.

```ts
const where = { userId, deletedAt: null };

await this.prisma.address.update({
  where: { id: addressId, userId },
  data: { deletedAt: new Date(), isDefault: false },
});
```

- [ ] Ensure default-address reassignment only considers non-deleted addresses.

```ts
const nextDefault = await this.prisma.address.findFirst({
  where: { userId, deletedAt: null },
  orderBy: { createdAt: 'desc' },
});
```

- [ ] Add or extend address service tests for:
  - `list` excludes deleted addresses
  - `create` limit counts only non-deleted addresses
  - `remove` soft-deletes the address
  - default reassignment ignores deleted addresses

Verification:

```bash
cd backend
npx prisma validate
npx jest src/modules/address/address.service.spec.ts --runInBand
```

Expected output:

```text
The Prisma schema is valid
PASS src/modules/address/address.service.spec.ts
```

---

## Task 2: Account Deletion Backend Module

- [ ] Create `backend/src/modules/me/deletion/dto/deletion.dto.ts`.

```ts
import { Equals, IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export enum AccountDeletionConfirmMethod {
  SMS = 'SMS',
  WECHAT_MODAL = 'WECHAT_MODAL',
}

export class SendDeletionCodeDto {}

export class ExecuteDeletionDto {
  @IsEnum(AccountDeletionConfirmMethod)
  confirmationMethod!: AccountDeletionConfirmMethod;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(8)
  smsCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  modalConfirmText?: string;

  @IsBoolean()
  @Equals(true)
  acknowledgedNotice!: true;

}
```

- [ ] Create `backend/src/modules/me/deletion/deletion.controller.ts` with three authenticated endpoints.

```ts
@Controller('me/deletion')
@UseGuards(JwtAuthGuard)
export class DeletionController {
  constructor(private readonly deletionService: DeletionService) {}

  @Get('preview')
  preview(@CurrentUser() user: JwtUser) {
    return this.deletionService.preview(user.id);
  }

  @Post('sms-code')
  sendCode(@CurrentUser() user: JwtUser) {
    return this.deletionService.sendCode(user.id);
  }

  @Post('execute')
  execute(@CurrentUser() user: JwtUser, @Body() dto: ExecuteDeletionDto) {
    return this.deletionService.execute(user.id, dto);
  }
}
```

- [ ] Create `backend/src/modules/me/deletion/deletion.service.ts` with blocker calculation isolated in one method.

```ts
type DeletionBlockerCode =
  | 'IS_COMPANY_OWNER'
  | 'USER_NOT_ACTIVE'
  | 'ACTIVE_CHECKOUT_EXISTS'
  | 'PENDING_PAYMENT_EXISTS'
  | 'WITHDRAW_PROCESSING_EXISTS';

type DeletionBlocker = {
  code: DeletionBlockerCode;
  message: string;
  count: number;
};

private async getBlockers(userId: string, tx: Prisma.TransactionClient = this.prisma): Promise<DeletionBlocker[]> {
  const blockers: DeletionBlocker[] = [];

  const [user, ownerCount, activeCheckoutCount, pendingPaymentCount, pendingPaymentGroupCount, withdrawProcessingCount] =
    await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        select: { status: true, deletionExecutedAt: true },
      }),
      tx.companyStaff.count({
        where: { userId, role: CompanyStaffRole.OWNER, status: CompanyStaffStatus.ACTIVE },
      }),
      tx.checkoutSession.count({
        where: { userId, status: { in: [CheckoutSessionStatus.ACTIVE, CheckoutSessionStatus.PAID] } },
      }),
      tx.payment.count({
        where: { status: { in: [PaymentStatus.INIT, PaymentStatus.PENDING] }, order: { userId } },
      }),
      tx.paymentGroup.count({
        where: { userId, status: { in: [PaymentStatus.INIT, PaymentStatus.PENDING] } },
      }),
      tx.withdrawRequest.count({
        where: { userId, status: { in: [WithdrawStatus.PROCESSING, WithdrawStatus.APPROVED] } },
      }),
    ]);

  if (!user || user.status !== UserStatus.ACTIVE || user.deletionExecutedAt) {
    blockers.push({ code: 'USER_NOT_ACTIVE', message: '账号状态不支持注销', count: 1 });
  }
  if (ownerCount > 0) {
    blockers.push({ code: 'IS_COMPANY_OWNER', message: '您是企业创始人，请先转让或注销企业', count: ownerCount });
  }
  if (activeCheckoutCount > 0) {
    blockers.push({ code: 'ACTIVE_CHECKOUT_EXISTS', message: '您有正在支付或确认中的订单，请先完成或取消', count: activeCheckoutCount });
  }
  if (pendingPaymentCount + pendingPaymentGroupCount > 0) {
    blockers.push({ code: 'PENDING_PAYMENT_EXISTS', message: '您有支付处理中记录，请稍后再试', count: pendingPaymentCount + pendingPaymentGroupCount });
  }
  if (withdrawProcessingCount > 0) {
    blockers.push({ code: 'WITHDRAW_PROCESSING_EXISTS', message: '您有提现处理中记录，请到账或失败后再注销', count: withdrawProcessingCount });
  }

  return blockers;
}
```

- [ ] Implement `preview(userId)` to return blockers and forfeiture summary.

```ts
return {
  canDelete: blockers.length === 0,
  blockers,
  assets: {
    points,
    coupons,
    withdrawableRewards,
    frozenRewards,
    lotteryQuota,
    pendingWithdrawAmount,
    activeCheckoutCount,
  },
  pending: { paidOrders, activeAfterSales },
  identityVerify,
  maskedPhone,
};
```

- [ ] Implement `sendCode(userId, dto)` for endpoint `POST /me/deletion/sms-code` with `SmsPurpose.DELETION`, rate limiting matching existing SMS OTP behavior, and a blocker check before sending. If the account has no phone identity, reject SMS sending because preview already returned `identityVerify = WECHAT_MODAL`.

```ts
if (blockers.length > 0) {
  throw new ConflictException({ code: 'ACCOUNT_DELETION_BLOCKED', blockers });
}
```

- [ ] Implement `execute(userId, dto)` in a Serializable transaction and re-check blockers inside that transaction.

```ts
return this.prisma.$transaction(
  async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`AD-${userId}`}))`;

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        deletionExecutedAt: true,
        authIdentities: {
          select: { id: true, provider: true, identifier: true, appId: true, verified: true },
        },
      },
    });

    if (user.status === UserStatus.DELETED || user.deletionExecutedAt) {
      throw new ConflictException('账号已注销');
    }

    const blockers = await this.getBlockers(userId, tx);
    if (blockers.length > 0) {
      throw new ConflictException({ code: 'ACCOUNT_DELETION_BLOCKED', blockers });
    }

    await this.verifyDeletionConfirmation(tx, userId, dto);
    await this.executeIrreversibleCleanup(tx, userId, dto);

    return { ok: true, message: '账号已注销' };
  },
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
);
```

- [ ] Implement `executeIrreversibleCleanup(tx, userId, dto)` with these operations in this order:
  1. Build the asset and evidence snapshot before mutating balances or identities
  2. Mark reward accounts as zero balance and zero frozen amount
  3. Insert reward ledger rows with `RewardEntryType.VOID`, `RewardLedgerStatus.VOIDED`, and `meta.reason = 'ACCOUNT_DELETION'`
  4. Void unused coupons
  5. Mark eligible lottery records/prizes as forfeited with the closest existing enum state
  6. Soft-delete addresses with `deletedAt`
  7. Delete cart, follow, AI session, search history, notification preference data that has no legal retention requirement
  8. Rewrite auth identities to tombstones
  9. Revoke refresh/session tokens
  10. Write the pre-cleanup snapshot to `User.deletionMeta`
  11. Update `User.status = DELETED`, `deletionExecutedAt`, and `deletionConfirmMethod`
  12. Insert `LoginEvent` audit row with `meta.action = 'DELETION_EXECUTED'`

Use raw SQL with parameter binding for the tombstone identifier because it depends on each row's `provider` and `id`.

```ts
await tx.$executeRaw`
  UPDATE "AuthIdentity"
  SET "identifier" = concat('deleted:', "provider", ':', ${userId}, ':', "id"),
      "unionId" = null,
      "meta" = null,
      "verified" = false,
      "updatedAt" = now()
  WHERE "userId" = ${userId}
`;
```

- [ ] Register `DeletionModule` in `backend/src/app.module.ts`.

```ts
import { DeletionModule } from './modules/me/deletion/deletion.module';

@Module({
  imports: [
    DeletionModule,
  ],
})
export class AppModule {}
```

- [ ] Add `backend/src/modules/me/deletion/deletion.service.spec.ts` covering:
  - non-active account returns `USER_NOT_ACTIVE`
  - active merchant owner returns `IS_COMPANY_OWNER`
  - active checkout returns `ACTIVE_CHECKOUT_EXISTS`
  - processing payment returns `PENDING_PAYMENT_EXISTS`
  - processing withdrawal returns `WITHDRAW_PROCESSING_EXISTS`
  - paid order and active after-sale are returned in `pending` and do not block
  - execute re-checks blockers after preview
  - execute rejects wrong SMS code
  - execute accepts exact WeChat modal confirmation text
  - execute zeroes reward balances and voids coupons
  - execute rewrites phone and WeChat identity identifiers
  - execute writes `deletionMeta`
  - execute creates deletion audit event

Verification:

```bash
cd backend
npx jest src/modules/me/deletion/deletion.service.spec.ts --runInBand
```

Expected output:

```text
PASS src/modules/me/deletion/deletion.service.spec.ts
```

---

## Task 3: Reject Deleted Accounts In Auth And Identity Mutation Paths

- [ ] Modify `backend/src/modules/auth/jwt.strategy.ts` so any non-active account is rejected.

```ts
if (!user) {
  throw new UnauthorizedException('账号不存在');
}

if (user.status === UserStatus.BANNED) {
  throw new ForbiddenException('账号已被封禁');
}

if (user.status === UserStatus.DELETED) {
  throw new ForbiddenException('账号已注销');
}

if (user.status !== UserStatus.ACTIVE) {
  throw new ForbiddenException('账号不可用');
}
```

- [ ] Add `assertActiveUserForIdentityMutation(userId)` in `backend/src/modules/auth/auth.service.ts` and call it before bind phone, bind WeChat, unbind WeChat, and any password/identity mutation for buyer users.

```ts
private async assertActiveUserForIdentityMutation(userId: string) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, deletionExecutedAt: true },
  });

  if (!user || user.status !== UserStatus.ACTIVE || user.deletionExecutedAt) {
    throw new ForbiddenException('账号已注销，不能修改登录身份');
  }
}
```

- [ ] Ensure login and registration paths ignore tombstoned `AuthIdentity.identifier` values and never attach a new session to `User.status = DELETED`.

```ts
if (identity.user.status !== UserStatus.ACTIVE) {
  throw new ForbiddenException('账号不可用');
}
```

- [ ] Add tests in `backend/src/modules/auth/jwt.strategy.spec.ts` and the auth service spec file covering:
  - old JWT for deleted user is rejected
  - deleted user cannot bind phone
  - deleted user cannot bind WeChat
  - released phone can register a new account
  - released WeChat identity can bind/register a new account

Verification:

```bash
cd backend
npx jest src/modules/auth/jwt.strategy.spec.ts --runInBand
```

Expected output:

```text
PASS src/modules/auth/jwt.strategy.spec.ts
```

---

## Task 4: Referral And Deferred Link Guards

- [ ] Modify `backend/src/modules/bonus/bonus.service.ts` so deleted VIP users cannot be used as new recommenders.

```ts
const inviter = await tx.user.findUnique({
  where: { id: inviterUserId },
  select: { status: true, deletionExecutedAt: true },
});

if (!inviter || inviter.status !== UserStatus.ACTIVE || inviter.deletionExecutedAt) {
  throw new BadRequestException('推荐人账号不可用');
}
```

- [ ] Modify `backend/src/modules/deferred-link/deferred-link.service.ts` so `create` and `resolve` reject deleted inviter accounts.

```ts
if (member.user.status !== UserStatus.ACTIVE || member.user.deletionExecutedAt) {
  throw new BadRequestException('推荐人账号不可用');
}
```

- [ ] Keep existing historical referral tree rows for audit. Do not remove tree nodes and do not re-parent children during deletion.

- [ ] Add tests covering:
  - deleted VIP referral code cannot be bound
  - deferred link for deleted inviter resolves as unavailable
  - existing child tree rows remain unchanged after inviter deletion

Verification:

```bash
cd backend
npx jest src/modules/bonus/bonus.service.spec.ts src/modules/deferred-link/deferred-link.service.spec.ts --runInBand
```

Expected output:

```text
PASS src/modules/bonus/bonus.service.spec.ts
PASS src/modules/deferred-link/deferred-link.service.spec.ts
```

---

## Task 5: Reward Allocation Safety For Deleted Ancestors

- [ ] Inspect reward allocation entry points and update the functions that credit upstream users to skip deleted recipients.

Primary files to inspect and modify when they contain credit writes:
- `backend/src/modules/bonus/engine/bonus-allocation.service.ts`
- `backend/src/modules/bonus/engine/vip-upstream.service.ts`
- `backend/src/modules/bonus/engine/normal-upstream.service.ts`
- `backend/src/modules/bonus/engine/vip-platform-split.service.ts`
- `backend/src/modules/bonus/engine/normal-platform-split.service.ts`

- [ ] Add a helper in the allocation service layer to resolve a recipient before writing reward balance.

```ts
private async resolveActiveRewardRecipient(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string | null> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { status: true, deletionExecutedAt: true },
  });

  if (!user || user.status !== UserStatus.ACTIVE || user.deletionExecutedAt) {
    return null;
  }

  return userId;
}
```

- [ ] When a deleted upstream recipient is encountered, route that amount to the platform reserve/audit path already used for unallocated reward amounts. If no dedicated reserve path exists, create a ledger/audit record with `recipientUserId = null` and do not mutate a deleted user reward balance.

```ts
const recipientUserId = await this.resolveActiveRewardRecipient(tx, upstream.userId);
if (!recipientUserId) {
  await this.recordPlatformRetainedReward(tx, {
    sourceOrderId,
    sourceUserId,
    amount,
    reason: 'DELETED_UPSTREAM_RECIPIENT',
  });
  return;
}
```

- [ ] Add tests covering:
  - deleted ancestor receives no new reward ledger row
  - deleted ancestor reward account balance remains zero after a downstream order
  - retained amount is auditable on the platform path

Verification:

```bash
cd backend
npx jest src/modules/bonus --runInBand
```

Expected output:

```text
PASS
```

---

## Task 6: Buyer App Repository And Types

- [ ] Create `src/types/domain/AccountDeletion.ts`.

```ts
export type AccountDeletionBlockerCode =
  | 'IS_COMPANY_OWNER'
  | 'USER_NOT_ACTIVE'
  | 'ACTIVE_CHECKOUT_EXISTS'
  | 'PENDING_PAYMENT_EXISTS'
  | 'WITHDRAW_PROCESSING_EXISTS';

export interface AccountDeletionBlocker {
  code: AccountDeletionBlockerCode;
  message: string;
  count: number;
}

export interface AccountDeletionPreview {
  canDelete: boolean;
  blockers: AccountDeletionBlocker[];
  assets: {
    points: number;
    coupons: number;
    withdrawableRewards: number;
    frozenRewards: number;
    lotteryQuota: number;
    pendingWithdrawAmount: number;
    activeCheckoutCount: number;
  };
  pending: {
    paidOrders: number;
    activeAfterSales: number;
  };
  identityVerify: 'SMS' | 'WECHAT_MODAL';
  maskedPhone?: string;
}

export interface AccountDeletionExecuteResult {
  ok: true;
  message: string;
}
```

- [ ] Create `src/repos/AccountDeletionRepo.ts`.

```ts
import { apiClient } from './http/ApiClient';
import type { AccountDeletionExecuteResult, AccountDeletionPreview } from '@/src/types/domain/AccountDeletion';

export const AccountDeletionRepo = {
  preview() {
    return apiClient.get<AccountDeletionPreview>('/me/deletion/preview');
  },

  sendCode() {
    return apiClient.post<{ sent: boolean; phoneMasked?: string; requiresWechatModal?: boolean }>(
      '/me/deletion/sms-code',
      {},
    );
  },

  execute(payload: {
    confirmationMethod: 'SMS' | 'WECHAT_MODAL';
    smsCode?: string;
    modalConfirmText?: string;
    acknowledgedNotice: true;
  }) {
    return apiClient.post<AccountDeletionExecuteResult>('/me/deletion/execute', payload);
  },
};
```

- [ ] Export the repo from `src/repos/index.ts`.

```ts
export { AccountDeletionRepo } from './AccountDeletionRepo';
```

- [ ] Remove or deprecate the old `/auth/delete-account` call from `src/repos/AuthRepo.ts` so no UI uses the old endpoint.

Verification:

```bash
npx tsc --noEmit
```

Expected output:

```text
no TypeScript errors
```

---

## Task 7: Buyer App Account Deletion UI

- [ ] Before editing App UI files, invoke the project UI design guidance required by `AGENTS.md` for buyer App frontend work.

- [ ] Modify `app/account-security.tsx` to show a visible account deletion entry.

```tsx
<SettingRow
  icon="trash-2"
  title="注销账号"
  subtitle="立即注销且不可恢复"
  danger
  onPress={() => router.push('/me/deletion')}
/>
```

- [ ] Create `app/me/deletion.tsx` with these states:
  - loading preview
  - blocked deletion with blocker list and action hints
  - forfeiture summary
  - confirmation method selection
  - SMS code input
  - WeChat-only modal text confirmation
  - final destructive confirm button disabled until confirmation is valid
  - success path that calls `useAuthStore.getState().logout()` and redirects to login or home

- [ ] Use exact irreversible confirmation text for WeChat-only modal:

```ts
const WECHAT_CONFIRM_TEXT = '确认注销';
```

- [ ] Use buyer-facing copy for forfeiture:

```ts
const deletionWarnings = [
  '注销后账号立即失效，不能恢复。',
  '消费积分、冻结奖励、优惠券、VIP 权益、抽奖资格和奖品将全部作废。',
  '已完成或依法需要保留的订单、支付、退款、发票和售后记录会继续保存。',
  '注销完成后，当前手机号或微信可以重新注册新账号，但原账号权益不会迁回。',
];
```

- [ ] Handle blocker codes with stable user-facing labels.

```ts
const blockerLabels: Record<AccountDeletionBlockerCode, string> = {
  IS_COMPANY_OWNER: '您是企业创始人，请先转让或注销企业',
  USER_NOT_ACTIVE: '账号状态不支持注销',
  ACTIVE_CHECKOUT_EXISTS: '您有正在支付或确认中的订单，请先完成或取消',
  PENDING_PAYMENT_EXISTS: '您有支付处理中记录，请稍后再试',
  WITHDRAW_PROCESSING_EXISTS: '您有提现处理中记录，请到账或失败后再注销',
};
```

- [ ] Add App tests if the repository already has page/component test setup for Expo Router pages. If no compatible App page test harness exists, verify with TypeScript and manual route loading in Expo.

Verification:

```bash
npx tsc --noEmit
```

Expected output:

```text
no TypeScript errors
```

---

## Task 8: Legal Text And Product Documentation

- [ ] Modify `src/content/legal/privacyPolicy.ts` to expose the account deletion section and match the implemented endpoint behavior.

Required legal statements:
- Path: App `设置 -> 账号与安全 -> 注销账号`
- Identity verification: SMS when phone is bound; WeChat modal confirmation when only WeChat is bound
- Effective time: immediate after final confirmation
- Retained data: orders, payment, refunds, after-sale, invoice, legal audit logs
- Forfeited data: rewards, coupons, VIP rights, lottery prizes, wallet balances
- Re-registration: released phone or WeChat may register again, but forfeited rights are not restored

- [ ] Modify `src/content/legal/termsOfService.ts` to align service terms with immediate account deletion and forfeiture.

- [ ] Modify `docs/architecture/frontend.md` to list the new account deletion route, states, and linked repo.

- [ ] Modify `plan.md` to mark the account deletion compliance work as planned or completed according to the actual implementation state.

- [ ] Do not modify `docs/operations/app-发布与OTA手册.md` until an actual `eas update` or `eas build` command has completed.

Verification:

```bash
rg -n "注销账号|账号注销|AccountDeletionRepo|/me/deletion" src app docs/architecture/frontend.md plan.md
```

Expected output includes:

```text
src/repos/AccountDeletionRepo.ts
app/me/deletion.tsx
src/content/legal/privacyPolicy.ts
src/content/legal/termsOfService.ts
docs/architecture/frontend.md
plan.md
```

---

## Task 9: Backend Build And Integration Verification

- [ ] Run Prisma validation.

```bash
cd backend
npx prisma validate
```

Expected output:

```text
The Prisma schema is valid
```

- [ ] Run focused backend tests.

```bash
cd backend
npx jest src/modules/me/deletion/deletion.service.spec.ts src/modules/address/address.service.spec.ts src/modules/auth/jwt.strategy.spec.ts --runInBand
```

Expected output:

```text
PASS
```

- [ ] Run full backend tests if focused tests pass.

```bash
cd backend
npm test -- --runInBand
```

Expected output:

```text
Test Suites: 0 failed
```

- [ ] Build backend.

```bash
cd backend
npm run build
```

Expected output:

```text
Found 0 errors.
```

- [ ] Run App TypeScript verification.

```bash
npx tsc --noEmit
```

Expected output:

```text
no TypeScript errors
```

If this command exposes pre-existing unrelated TypeScript failures, capture the exact file paths and rerun the narrow validation command used by this repository for buyer App type checks.

---

## Task 10: Security Review And Release Decision

- [ ] Review `docs/issues/tofix-safe.md` before finalizing because this change touches authentication, state transitions, assets, rewards, payments, and withdrawals.

- [ ] Confirm these safety properties in the final review:
  - blocker queries run before SMS send and again inside execute transaction
  - irreversible cleanup uses `Serializable`
  - deleted users cannot pass JWT validation
  - identity mutation paths reject deleted users
  - phone and WeChat identifiers are released by tombstoning old identities
  - reward allocation never credits deleted users
  - paid order/payment/refund/invoice/audit data remains retained

- [ ] Start a read-only review agent after implementation, per `AGENTS.md`, and fix every Critical or High finding.

- [ ] Decide OTA vs native build:
  - JS-only App UI/legal changes can ship by OTA.
  - Prisma schema, backend module, and backend deployment must be deployed before App UI is enabled for testers.
  - No Expo native config changes are expected for this feature.

- [ ] Update `docs/operations/app-发布与OTA手册.md` only if an OTA or build is actually published.

Final verification commands:

```bash
git status --short
git diff -- backend/prisma/schema.prisma backend/src/modules/me/deletion src/repos/AccountDeletionRepo.ts app/me/deletion.tsx src/content/legal/privacyPolicy.ts src/content/legal/termsOfService.ts
```

Expected result:

```text
Only account-deletion implementation files and required documentation are changed by this feature branch.
```

---

## Self-Review Checklist

- [ ] Every blocker from the spec has an implementation task and a test target.
- [ ] Asset forfeiture is irreversible and transaction-scoped.
- [ ] Payment, payout, refund, after-sale, invoice, and audit data are retained.
- [ ] Phone and WeChat release are implemented by tombstoning `AuthIdentity.identifier` values.
- [ ] Deleted accounts cannot authenticate with old JWTs.
- [ ] Deleted upstream reward recipients are skipped.
- [ ] Buyer App copy states immediate deletion and irreversible forfeiture.
- [ ] Legal text matches the backend behavior.
- [ ] `AGENTS.md` registers the spec and this plan.
