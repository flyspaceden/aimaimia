# Buyer Public ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add buyer-only public IDs in the `AIMM` + 14 digit format, show and copy them in App/Admin/Seller surfaces, and support searching by them without changing internal `User.id`.

**Architecture:** Keep `User.id` as the internal `cuid()` primary key and add nullable unique `User.buyerNo`. A shared backend utility formats, validates, generates, and resolves buyer numbers; API layers expose `buyerNo` while preserving existing `userId` routing and permission checks.

**Tech Stack:** NestJS, Prisma, PostgreSQL sequence, Jest, Expo React Native, Vite React, Ant Design.

---

## File Structure

- `backend/prisma/schema.prisma`: add nullable unique `buyerNo` to `User`.
- `backend/prisma/migrations/20260615010000_add_buyer_no/migration.sql`: add `buyerNo` column, unique index, and `buyer_no_seq`.
- `backend/src/common/utils/buyer-no.util.ts`: shared buyer number regex, formatting, generation, and lookup helpers.
- `backend/src/common/utils/buyer-no.util.spec.ts`: unit tests for format/regex/lookup/generation helpers.
- `backend/scripts/backfill-buyer-no.ts`: dry-run and execute historical buyer backfill.
- `backend/package.json`: add `buyer-no:backfill` script.
- `backend/src/modules/auth/auth.service.ts`: generate or ensure `buyerNo` on buyer registration and buyer login.
- `backend/src/modules/auth/auth.service.spec.ts`: registration and existing-user buyer login tests.
- `backend/src/modules/user/user.service.ts`: return `buyerNo` in `GET /me`.
- `backend/src/modules/user/user.service.spec.ts`: `GET /me` contract test.
- `src/types/domain/UserProfile.ts`, `src/mocks/userProfile.ts`, `app/(tabs)/me.tsx`: App display and copy button.
- `backend/src/modules/admin/**`: include `buyerNo` in buyer-facing API responses and searches.
- `admin/src/components/BuyerIdentityText.tsx`: shared Admin display/copy component for `buyerNo` + internal ID.
- `admin/src/types/index.ts`, `admin/src/pages/**`: render and search `buyerNo` in buyer-related pages.
- `backend/src/modules/seller/orders/**`, `backend/src/modules/seller/after-sale/**`: return and search buyer numbers under merchant permissions.
- `seller/src/types/index.ts`, `seller/src/api/**`, `seller/src/pages/**`: show and search buyer numbers without exposing internal `User.id`.
- `docs/architecture/frontend.md`, `docs/architecture/seller.md`, `plan.md`: document completed frontend/seller-facing behavior after implementation.

---

### Task 1: Schema, Utility, And Backfill

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260615010000_add_buyer_no/migration.sql`
- Create: `backend/src/common/utils/buyer-no.util.ts`
- Create: `backend/src/common/utils/buyer-no.util.spec.ts`
- Create: `backend/scripts/backfill-buyer-no.ts`
- Modify: `backend/package.json`

- [x] **Step 1: Write the failing utility tests**

Create `backend/src/common/utils/buyer-no.util.spec.ts`:

```ts
import {
  BUYER_NO_REGEX,
  formatBuyerNo,
  isBuyerNo,
  nextBuyerNo,
  resolveBuyerUserId,
} from './buyer-no.util';

describe('buyer-no.util', () => {
  it('formats AIMM + 14 digit buyer numbers', () => {
    expect(formatBuyerNo(1)).toBe('AIMM00000000000001');
    expect(formatBuyerNo(99999999999999)).toBe('AIMM99999999999999');
  });

  it('rejects out-of-range sequence values', () => {
    expect(() => formatBuyerNo(0)).toThrow('buyerNo sequence out of range');
    expect(() => formatBuyerNo(100000000000000)).toThrow('buyerNo sequence out of range');
  });

  it('detects only canonical buyer numbers', () => {
    expect(BUYER_NO_REGEX.test('AIMM00000000000001')).toBe(true);
    expect(isBuyerNo('AIMM00000000000001')).toBe(true);
    expect(isBuyerNo('aimm00000000000001')).toBe(true);
    expect(isBuyerNo('AIMM000000000001')).toBe(false);
    expect(isBuyerNo('cmqc65zt2003rt7ki4i0e89cx')).toBe(false);
  });

  it('generates the next buyer number from PostgreSQL sequence output', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(42) }]),
    } as any;

    await expect(nextBuyerNo(tx)).resolves.toBe('AIMM00000000000042');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('resolves AIMM input to internal User.id and leaves internal ids unchanged', async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-internal-1' }),
      },
    } as any;

    await expect(resolveBuyerUserId(tx, 'AIMM00000000000042')).resolves.toBe('user-internal-1');
    await expect(resolveBuyerUserId(tx, 'cmqc65zt2003rt7ki4i0e89cx')).resolves.toBe('cmqc65zt2003rt7ki4i0e89cx');
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { buyerNo: 'AIMM00000000000042' },
      select: { id: true },
    });
  });
});
```

- [x] **Step 2: Run the failing utility tests**

Run:

```bash
cd backend
npx jest src/common/utils/buyer-no.util.spec.ts --runInBand
```

Expected: FAIL with module not found for `./buyer-no.util`.

- [x] **Step 3: Implement buyer number utility**

Create `backend/src/common/utils/buyer-no.util.ts`:

```ts
import { Prisma } from '@prisma/client';

export const BUYER_NO_PREFIX = 'AIMM';
export const BUYER_NO_DIGITS = 14;
export const BUYER_NO_MAX = 99_999_999_999_999;
export const BUYER_NO_REGEX = /^AIMM\d{14}$/;

type BuyerNoTx = {
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Promise<T>;
  user: {
    findUnique(args: { where: { buyerNo: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
};

export function formatBuyerNo(value: number | bigint): string {
  const n = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 1 || n > BUYER_NO_MAX) {
    throw new Error('buyerNo sequence out of range');
  }
  return `${BUYER_NO_PREFIX}${String(n).padStart(BUYER_NO_DIGITS, '0')}`;
}

export function normalizeBuyerNo(value: string): string {
  return value.trim().toUpperCase();
}

export function isBuyerNo(value: string | null | undefined): boolean {
  if (!value) return false;
  return BUYER_NO_REGEX.test(normalizeBuyerNo(value));
}

export async function nextBuyerNo(tx: Pick<BuyerNoTx, '$queryRaw'>): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ nextval: bigint | number | string }>>`
    SELECT nextval('buyer_no_seq') AS nextval
  `;
  const raw = rows[0]?.nextval;
  return formatBuyerNo(typeof raw === 'bigint' ? raw : Number(raw));
}

export async function resolveBuyerUserId<T extends BuyerNoTx>(
  tx: T,
  userIdOrBuyerNo: string,
): Promise<string> {
  const normalized = normalizeBuyerNo(userIdOrBuyerNo);
  if (!isBuyerNo(normalized)) return userIdOrBuyerNo;
  const user = await tx.user.findUnique({
    where: { buyerNo: normalized },
    select: { id: true },
  });
  return user?.id ?? userIdOrBuyerNo;
}
```

- [x] **Step 4: Add schema field and migration**

Modify `backend/prisma/schema.prisma` in `model User`:

```prisma
model User {
  id                     String     @id @default(cuid())
  buyerNo                String?    @unique
  status                 UserStatus @default(ACTIVE)
```

Create `backend/prisma/migrations/20260615010000_add_buyer_no/migration.sql`:

```sql
-- Buyer public number. Internal User.id remains the primary key.
ALTER TABLE "User" ADD COLUMN "buyerNo" TEXT;

CREATE UNIQUE INDEX "User_buyerNo_key" ON "User"("buyerNo");

CREATE SEQUENCE IF NOT EXISTS buyer_no_seq
  AS BIGINT
  MINVALUE 1
  MAXVALUE 99999999999999
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;
```

- [x] **Step 5: Write historical backfill script**

Create `backend/scripts/backfill-buyer-no.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { formatBuyerNo } from '../src/common/utils/buyer-no.util';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

type BuyerCandidate = {
  id: string;
  createdAt: Date;
};

async function getCandidates(): Promise<BuyerCandidate[]> {
  return prisma.$queryRaw<BuyerCandidate[]>`
    SELECT DISTINCT u.id, u."createdAt"
    FROM "User" u
    WHERE u."buyerNo" IS NULL
      AND (
        EXISTS (SELECT 1 FROM "Order" o WHERE o."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "Cart" c WHERE c."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "Address" a WHERE a."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "InvoiceProfile" ip WHERE ip."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "CouponInstance" ci WHERE ci."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "LotteryRecord" lr WHERE lr."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "CsSession" cs WHERE cs."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "DigitalAssetAccount" da WHERE da."userId" = u.id)
        OR (
          EXISTS (SELECT 1 FROM "AuthIdentity" ai WHERE ai."userId" = u.id)
          AND NOT EXISTS (SELECT 1 FROM "CompanyStaff" st WHERE st."userId" = u.id)
        )
      )
    ORDER BY u."createdAt" ASC, u.id ASC
  `;
}

async function getCurrentMax(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ max_no: bigint | number | null }>>`
    SELECT COALESCE(MAX(REPLACE("buyerNo", 'AIMM', '')::BIGINT), 0) AS max_no
    FROM "User"
    WHERE "buyerNo" ~ '^AIMM[0-9]{14}$'
  `;
  return Number(rows[0]?.max_no ?? 0);
}

async function syncSequence(maxNo: number) {
  await prisma.$executeRawUnsafe(
    `SELECT setval('buyer_no_seq', ${Math.max(maxNo, 1)}, ${maxNo > 0 ? 'true' : 'false'})`,
  );
}

async function main() {
  const candidates = await getCandidates();
  const currentMax = await getCurrentMax();
  console.log(`[buyer-no] dryRun=${dryRun} candidates=${candidates.length} currentMax=${currentMax}`);

  if (candidates.length === 0) {
    await syncSequence(currentMax);
    console.log(`[buyer-no] no candidates, sequence synced to max=${currentMax}`);
    return;
  }

  const firstNo = formatBuyerNo(currentMax + 1);
  const lastNo = formatBuyerNo(currentMax + candidates.length);
  console.log(`[buyer-no] first=${firstNo} last=${lastNo}`);

  if (dryRun) return;

  await prisma.$transaction(async (tx) => {
    let next = currentMax + 1;
    for (const candidate of candidates) {
      await tx.user.updateMany({
        where: { id: candidate.id, buyerNo: null },
        data: { buyerNo: formatBuyerNo(next) },
      });
      next += 1;
    }
  }, { timeout: 120_000 });

  await syncSequence(currentMax + candidates.length);
  console.log(`[buyer-no] backfill complete updated=${candidates.length}`);
}

main()
  .catch((err) => {
    console.error('[buyer-no] backfill failed', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

Modify `backend/package.json`:

```json
{
  "scripts": {
    "buyer-no:backfill": "ts-node scripts/backfill-buyer-no.ts"
  }
}
```

Keep existing scripts and add the new key next to `digital-asset:backfill`.

- [x] **Step 6: Run schema and utility verification**

Run:

```bash
cd backend
npx prisma validate
npx jest src/common/utils/buyer-no.util.spec.ts --runInBand
npx ts-node scripts/backfill-buyer-no.ts --dry-run
```

Expected: `prisma validate` exits 0, Jest PASS, dry-run prints `dryRun=true`.

- [x] **Step 7: Commit Task 1**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260615010000_add_buyer_no/migration.sql backend/src/common/utils/buyer-no.util.ts backend/src/common/utils/buyer-no.util.spec.ts backend/scripts/backfill-buyer-no.ts backend/package.json
git commit -m "feat(backend): add buyer public id schema"
```

---

### Task 2: Buyer Auth Generation And `/me` Contract

**Files:**
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/auth/auth.service.spec.ts`
- Modify: `backend/src/modules/user/user.service.ts`
- Create: `backend/src/modules/user/user.service.spec.ts`

- [x] **Step 1: Write failing AuthService tests**

Append to `backend/src/modules/auth/auth.service.spec.ts`:

```ts
describe('AuthService — buyerNo generation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('generates buyerNo during phone registration', async () => {
    const prisma = makePrisma({
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1) }]),
    });
    const bcrypt = require('bcrypt');
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash: bcrypt.hashSync('123456', 4), usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const { service } = makeService(prisma);

    await service.register({ phone: PHONE, code: '123456', name: '新用户' } as any);

    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ buyerNo: 'AIMM00000000000001' }),
    }));
  });

  it('generates buyerNo during SMS auto-registration', async () => {
    const prisma = makePrisma({
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(2) }]),
    });
    const bcrypt = require('bcrypt');
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash: bcrypt.hashSync('123456', 4), usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const { service } = makeService(prisma);

    await service.login({ phone: PHONE, mode: 'code', code: '123456' } as any);

    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ buyerNo: 'AIMM00000000000002' }),
    }));
  });

  it('backfills buyerNo when an existing seller-created user logs into buyer app', async () => {
    const prisma = makePrisma({
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(3) }]),
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ buyerNo: null })
          .mockResolvedValue({ status: UserStatus.ACTIVE, deletionExecutedAt: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const bcrypt = require('bcrypt');
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash: bcrypt.hashSync('123456', 4), usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    prisma.authIdentity.findFirst.mockResolvedValue({
      id: 'identity-phone',
      userId: 'seller-then-buyer',
      provider: 'PHONE',
      identifier: PHONE,
      user: { status: UserStatus.ACTIVE },
    });
    const { service } = makeService(prisma);

    await service.login({ phone: PHONE, mode: 'code', code: '123456' } as any);

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'seller-then-buyer', buyerNo: null },
      data: { buyerNo: 'AIMM00000000000003' },
    });
  });
});
```

- [x] **Step 2: Write failing UserService test**

Create `backend/src/modules/user/user.service.spec.ts`:

```ts
import { UserService } from './user.service';

function makePrisma(profileOverrides: Record<string, any> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        buyerNo: 'AIMM00000000000001',
        hasAgreedReturnPolicy: false,
        profile: {
          nickname: '林青禾',
          avatarUrl: 'preset://sprout',
          gender: 'UNKNOWN',
          birthday: null,
          level: '新芽会员',
          levelProgress: 0,
          growthPoints: 0,
          nextLevelPoints: 100,
          points: 0,
          city: '',
          interests: [],
          avatarFrameType: null,
          avatarFrameLabel: null,
          avatarFrameExpiresAt: null,
          ...profileOverrides,
        },
        authIdentities: [],
      }),
    },
    userProfile: {
      create: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  } as any;
}

describe('UserService buyerNo contract', () => {
  it('returns buyerNo in GET /me profile shape', async () => {
    const prisma = makePrisma();
    const service = new UserService(prisma, {} as any);

    const profile = await service.getProfile('user-1');

    expect(profile).toMatchObject({
      id: 'user-1',
      buyerNo: 'AIMM00000000000001',
      name: '林青禾',
    });
  });
});
```

- [x] **Step 3: Run failing backend contract tests**

Run:

```bash
cd backend
npx jest src/modules/auth/auth.service.spec.ts src/modules/user/user.service.spec.ts --runInBand
```

Expected: FAIL because `buyerNo` is not generated or returned.

- [x] **Step 4: Implement AuthService buyerNo generation**

Modify imports in `backend/src/modules/auth/auth.service.ts`:

```ts
import { nextBuyerNo } from '../../common/utils/buyer-no.util';
```

Add method inside `AuthService`:

```ts
  private async ensureBuyerNoForBuyer(userId: string): Promise<string | null> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { buyerNo: true },
    });
    if (existing?.buyerNo) return existing.buyerNo;

    const buyerNo = await nextBuyerNo(this.prisma);
    const updated = await this.prisma.user.updateMany({
      where: { id: userId, buyerNo: null },
      data: { buyerNo },
    });
    if (updated.count > 0) return buyerNo;

    const raced = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { buyerNo: true },
    });
    return raced?.buyerNo ?? null;
  }
```

In phone register `user.create`, add:

```ts
      buyerNo: await nextBuyerNo(this.prisma),
```

In SMS auto-registration `newUser = await this.prisma.user.create`, add:

```ts
              buyerNo: await nextBuyerNo(this.prisma),
```

In WeChat first login `user.create`, add:

```ts
        buyerNo: await nextBuyerNo(this.prisma),
```

Before issuing tokens for existing buyer-login identities, call `ensureBuyerNoForBuyer`:

```ts
      await this.ensureBuyerNoForBuyer(identity.userId);
      return this.issueTokens(identity.userId, 'phone');
```

Apply that for existing SMS login, existing password login after password succeeds, and existing WeChat login before `issueTokens`.

- [x] **Step 5: Return buyerNo from `/me`**

Modify `backend/src/modules/user/user.service.ts` select/include to read `buyerNo`:

```ts
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true, authIdentities: true },
    });
```

The existing include already returns scalar fields; add to return object:

```ts
      buyerNo: user.buyerNo,
```

Place it after `id: user.id`.

- [x] **Step 6: Run backend contract tests**

Run:

```bash
cd backend
npx jest src/modules/auth/auth.service.spec.ts src/modules/user/user.service.spec.ts --runInBand
```

Expected: PASS.

- [x] **Step 7: Commit Task 2**

```bash
git add backend/src/modules/auth/auth.service.ts backend/src/modules/auth/auth.service.spec.ts backend/src/modules/user/user.service.ts backend/src/modules/user/user.service.spec.ts
git commit -m "feat(backend): generate buyer public ids"
```

---

### Task 3: Buyer App "Me" Display And Copy

**Files:**
- Modify: `src/types/domain/UserProfile.ts`
- Modify: `src/mocks/userProfile.ts`
- Modify: `app/(tabs)/me.tsx`
- Modify: `docs/architecture/frontend.md`
- Modify: `plan.md`

- [x] **Step 1: Add frontend type and mock**

Modify `src/types/domain/UserProfile.ts`:

```ts
export type UserProfile = {
  id: string;
  buyerNo?: string | null;
  name: string;
```

Modify `src/mocks/userProfile.ts`:

```ts
export const mockUserProfile: UserProfile = {
  id: 'u-001',
  buyerNo: 'AIMM00000000000001',
  name: '林青禾',
```

- [x] **Step 2: Add buyerNo copy handler**

In `app/(tabs)/me.tsx`, add after `handleCopyReferral`:

```tsx
  const handleCopyBuyerNo = async () => {
    if (!profile?.buyerNo) {
      show({ message: '用户编号生成中', type: 'info' });
      return;
    }
    await Clipboard.setStringAsync(profile.buyerNo);
    show({ message: '用户编号已复制', type: 'success' });
  };
```

- [x] **Step 3: Replace level badge with buyer number chip**

Replace the `vipBadge` block in `app/(tabs)/me.tsx` that renders `{profile.level}` with:

```tsx
                  <Pressable
                    onPress={handleCopyBuyerNo}
                    style={[styles.buyerNoChip, { backgroundColor: colors.gold.light, borderRadius: radius.pill }]}
                    accessibilityRole="button"
                    accessibilityLabel="复制用户编号"
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.72}
                      style={[typography.captionSm, { color: colors.gold.primary, fontFamily: monoFamily }]}
                    >
                      {profile.buyerNo || '用户编号生成中'}
                    </Text>
                    <MaterialCommunityIcons
                      name="content-copy"
                      size={13}
                      color={colors.gold.primary}
                      style={{ marginLeft: 4 }}
                    />
                  </Pressable>
```

Add style:

```tsx
  buyerNoChip: {
    maxWidth: 176,
    minHeight: 24,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
```

Keep `vipBadge` style only if another block still uses it; otherwise remove unused `vipBadge`.

- [x] **Step 4: Run App type/test verification**

Run:

```bash
npx tsc --noEmit
npm test -- --runInBand
```

Expected: TypeScript exits 0; Jest/legal tests exit 0.

- [x] **Step 5: Update frontend docs**

Append to the relevant `/me` section in `docs/architecture/frontend.md`:

```md
- `/me` 身份卡头像右侧显示买家公开编号 `buyerNo`（`AIMM` + 14 位数字），替代原成长等级展示位；编号旁提供复制按钮，复制成功提示「用户编号已复制」。若后端暂未返回编号，显示「用户编号生成中」，不得展示内部 `User.id`。
```

Update `plan.md` with a checked line under the current frontend/admin batch:

```md
- [x] 买家公开编号：App「我的」页展示并复制 `buyerNo`，管理后台/卖家中心改造进入实施批次。
```

- [x] **Step 6: Commit Task 3**

```bash
git add src/types/domain/UserProfile.ts src/mocks/userProfile.ts "app/(tabs)/me.tsx" docs/architecture/frontend.md plan.md
git commit -m "feat(app): show buyer public id on me page"
```

---

### Task 4: Admin Backend And Admin UI Coverage

**Files:**
- Modify: `backend/src/modules/admin/app-users/admin-app-users.service.ts`
- Modify: `backend/src/modules/admin/orders/admin-orders.service.ts`
- Modify: `backend/src/modules/admin/orders/dto/admin-order.dto.ts`
- Modify: `backend/src/modules/admin/after-sale/admin-after-sale.service.ts`
- Modify: `backend/src/modules/admin/coupon/admin-coupon.controller.ts`
- Modify: `backend/src/modules/admin/lottery/admin-lottery.service.ts`
- Modify: `backend/src/modules/admin/bonus/admin-bonus.service.ts`
- Modify: `backend/src/modules/admin/digital-asset/admin-digital-asset.service.ts`
- Modify: `backend/src/modules/admin/invoices/admin-invoices.service.ts`
- Create: `backend/src/modules/admin/app-users/admin-app-users.service.spec.ts`
- Modify or create focused specs for changed admin services when an existing spec is present.
- Create: `admin/src/components/BuyerIdentityText.tsx`
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/pages/users/index.tsx`
- Modify: `admin/src/pages/users/detail.tsx`
- Modify: `admin/src/pages/orders/index.tsx`
- Modify: `admin/src/pages/orders/detail.tsx`
- Modify: `admin/src/pages/after-sale/index.tsx`
- Modify: `admin/src/pages/coupons/instances.tsx`
- Modify: `admin/src/pages/lottery/index.tsx`
- Modify: `admin/src/pages/cs/workstation.tsx`
- Modify: `admin/src/pages/bonus/members.tsx`
- Modify: `admin/src/pages/bonus/member-detail.tsx`
- Modify: `admin/src/pages/bonus/components/TreeNode.tsx`
- Modify: `admin/src/pages/bonus/components/NodeDetail.tsx`
- Modify: `admin/src/pages/digital-assets/index.tsx`

- [x] **Step 1: Write failing AdminAppUsersService tests**

Create `backend/src/modules/admin/app-users/admin-app-users.service.spec.ts`:

```ts
import { AdminAppUsersService } from './admin-app-users.service';

function makePrisma() {
  return {
    user: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'user-1',
          buyerNo: 'AIMM00000000000001',
          profile: { nickname: '林青禾', avatarUrl: null },
          authIdentities: [{ identifier: '13800001234' }],
          memberProfile: { tier: 'NORMAL' },
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          _count: { orders: 1 },
        },
      ]),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        buyerNo: 'AIMM00000000000001',
        profile: { nickname: '林青禾', avatarUrl: null, level: '新芽会员', growthPoints: 0, points: 0, gender: null, birthday: null, city: null },
        authIdentities: [],
        memberProfile: { tier: 'NORMAL' },
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        _count: { orders: 1, addresses: 0, followsGiven: 0 },
      }),
    },
  } as any;
}

describe('AdminAppUsersService buyerNo', () => {
  it('returns buyerNo in list and detail responses', async () => {
    const service = new AdminAppUsersService(makePrisma());

    await expect(service.findAll()).resolves.toMatchObject({
      items: [{ id: 'user-1', buyerNo: 'AIMM00000000000001' }],
    });
    await expect(service.findById('user-1')).resolves.toMatchObject({
      id: 'user-1',
      buyerNo: 'AIMM00000000000001',
    });
  });

  it('adds buyerNo to keyword search OR conditions', async () => {
    const prisma = makePrisma();
    const service = new AdminAppUsersService(prisma);

    await service.findAll(1, 20, undefined, 'AIMM00000000000001');

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{ buyerNo: 'AIMM00000000000001' }]),
      }),
    }));
  });
});
```

- [x] **Step 2: Run failing admin service test**

Run:

```bash
cd backend
npx jest src/modules/admin/app-users/admin-app-users.service.spec.ts --runInBand
```

Expected: FAIL because admin app user responses do not contain `buyerNo`.

- [x] **Step 3: Add buyerNo to Admin app users**

In `backend/src/modules/admin/app-users/admin-app-users.service.ts`:

```ts
import { isBuyerNo, normalizeBuyerNo, resolveBuyerUserId } from '../../../common/utils/buyer-no.util';
```

Add keyword search condition:

```ts
        ...(isBuyerNo(keyword) ? [{ buyerNo: normalizeBuyerNo(keyword) }] : []),
```

Add `buyerNo` to list map:

```ts
        buyerNo: user.buyerNo || null,
```

In `findById`, resolve route param:

```ts
    const internalId = await resolveBuyerUserId(this.prisma, id);
    const user = await this.prisma.user.findUnique({
      where: { id: internalId },
```

Add to detail return:

```ts
      buyerNo: user.buyerNo || null,
```

- [x] **Step 4: Add buyerNo to Admin orders and query**

In `backend/src/modules/admin/orders/admin-orders.service.ts`, import helpers:

```ts
import { isBuyerNo, normalizeBuyerNo, resolveBuyerUserId } from '../../../common/utils/buyer-no.util';
```

In keyword OR:

```ts
        ...(isBuyerNo(query.keyword)
          ? [{ user: { buyerNo: normalizeBuyerNo(query.keyword) } }]
          : []),
```

Resolve `query.userId` before assigning:

```ts
    if (query.userId) {
      where.userId = await resolveBuyerUserId(this.prisma, query.userId);
    }
```

Add `buyerNo: true` to user selects and mapped user:

```ts
              buyerNo: true,
```

```ts
            buyerNo: o.user?.buyerNo || null,
```

- [x] **Step 5: Add buyerNo to remaining Admin backend services**

Apply the same pattern:

```ts
select: {
  id: true,
  buyerNo: true,
  profile: { select: { nickname: true } },
}
```

and map:

```ts
buyerNo: record.user?.buyerNo ?? null
```

Touch these files and preserve existing privacy masking:

- `backend/src/modules/admin/after-sale/admin-after-sale.service.ts`
- `backend/src/modules/admin/coupon/admin-coupon.controller.ts`
- `backend/src/modules/admin/lottery/admin-lottery.service.ts`
- `backend/src/modules/admin/bonus/admin-bonus.service.ts`
- `backend/src/modules/admin/digital-asset/admin-digital-asset.service.ts`
- `backend/src/modules/admin/invoices/admin-invoices.service.ts`

For any method accepting `userId`, resolve `AIMM...` with:

```ts
const internalUserId = await resolveBuyerUserId(this.prisma, userId);
```

Use `internalUserId` only in Prisma `where` clauses.

- [x] **Step 6: Add shared Admin identity display component**

Create `admin/src/components/BuyerIdentityText.tsx`:

```tsx
import { Space, Tooltip, Typography } from 'antd';

type BuyerIdentityTextProps = {
  buyerNo?: string | null;
  userId?: string | null;
  compact?: boolean;
};

export default function BuyerIdentityText({ buyerNo, userId, compact }: BuyerIdentityTextProps) {
  const visibleBuyerNo = buyerNo || '非买家账号';
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text
        copyable={buyerNo ? { text: buyerNo, tooltips: ['复制用户编号', '已复制'] } : false}
        style={{ fontSize: compact ? 12 : 13, fontFamily: buyerNo ? 'monospace' : undefined }}
        type={buyerNo ? undefined : 'secondary'}
      >
        {visibleBuyerNo}
      </Typography.Text>
      {userId ? (
        <Tooltip title={userId}>
          <Typography.Text
            copyable={{ text: userId, tooltips: ['复制内部ID', '已复制'] }}
            style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}
          >
            内部ID: {compact ? `…${userId.slice(-8)}` : userId}
          </Typography.Text>
        </Tooltip>
      ) : null}
    </Space>
  );
}
```

- [x] **Step 7: Update Admin frontend types**

In `admin/src/types/index.ts`, add `buyerNo?: string | null` to every buyer-bearing type:

```ts
export interface AppUser {
  id: string;
  buyerNo?: string | null;
```

```ts
export interface AppUserDetail {
  id: string;
  buyerNo?: string | null;
```

For nested user objects, use:

```ts
user?: { id: string; buyerNo?: string | null; profile?: { nickname: string | null } | null };
```

For bonus tree node types, add:

```ts
buyerNo?: string | null;
```

- [x] **Step 8: Update Admin pages to render buyerNo**

Use `BuyerIdentityText` in these pages:

```tsx
import BuyerIdentityText from '@/components/BuyerIdentityText';
```

Replace raw buyer user ID blocks with:

```tsx
<BuyerIdentityText buyerNo={r.buyerNo} userId={r.id} compact />
```

For nested order/after-sale/coupon records:

```tsx
<BuyerIdentityText buyerNo={r.user?.buyerNo} userId={r.userId} compact />
```

Apply to:

- `admin/src/pages/users/index.tsx`
- `admin/src/pages/users/detail.tsx`
- `admin/src/pages/orders/index.tsx`
- `admin/src/pages/orders/detail.tsx`
- `admin/src/pages/after-sale/index.tsx`
- `admin/src/pages/coupons/instances.tsx`
- `admin/src/pages/lottery/index.tsx`
- `admin/src/pages/cs/workstation.tsx`
- `admin/src/pages/bonus/members.tsx`
- `admin/src/pages/bonus/member-detail.tsx`
- `admin/src/pages/bonus/components/TreeNode.tsx`
- `admin/src/pages/bonus/components/NodeDetail.tsx`
- `admin/src/pages/digital-assets/index.tsx`

- [x] **Step 9: Run Admin verification**

Run:

```bash
cd backend
npx jest src/modules/admin/app-users/admin-app-users.service.spec.ts src/modules/admin/after-sale/admin-after-sale.service.spec.ts src/modules/admin/digital-asset/admin-digital-asset.service.spec.ts src/modules/admin/invoices/admin-invoices.service.spec.ts src/modules/admin/lottery/admin-lottery.service.spec.ts --runInBand
cd ../admin
npm run build
```

Expected: backend Jest suites PASS; admin TypeScript and Vite build PASS.

- [x] **Step 10: Commit Task 4**

```bash
git add backend/src/modules/admin admin/src/components/BuyerIdentityText.tsx admin/src/types/index.ts admin/src/pages
git commit -m "feat(admin): expose buyer public ids"
```

---

### Task 5: Seller Center Display And Search

**Files:**
- Modify: `backend/src/modules/seller/orders/seller-orders.controller.ts`
- Modify: `backend/src/modules/seller/orders/seller-orders.service.ts`
- Modify: `backend/src/modules/seller/orders/seller-orders.service.spec.ts`
- Modify: `backend/src/modules/seller/after-sale/seller-after-sale.controller.ts`
- Modify: `backend/src/modules/seller/after-sale/seller-after-sale.service.ts`
- Modify: `backend/src/modules/seller/after-sale/seller-after-sale.service.spec.ts`
- Modify: `seller/src/types/index.ts`
- Modify: `seller/src/api/orders.ts`
- Modify: `seller/src/api/after-sale.ts`
- Modify: `seller/src/pages/orders/index.tsx`
- Modify: `seller/src/pages/orders/detail.tsx`
- Modify: `seller/src/pages/after-sale/index.tsx`
- Modify: `seller/src/pages/after-sale/detail.tsx`
- Modify: `docs/architecture/seller.md`
- Modify: `plan.md`

- [x] **Step 1: Write failing seller order tests**

Append to `backend/src/modules/seller/orders/seller-orders.service.spec.ts`:

```ts
it('returns buyerNo without exposing internal userId in seller order detail', async () => {
  prisma.order.findUnique.mockResolvedValue({
    id: 'order-1',
    userId: 'buyer-1',
    status: 'PAID',
    bizType: 'NORMAL_GOODS',
    totalAmount: 100,
    shippingFee: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    addressSnapshot: {},
    items: [{ id: 'item-1', companyId: 'company-1', unitPrice: 100, quantity: 1, isPrize: false, productSnapshot: { title: '苹果' }, sku: { product: { title: '苹果', media: [] } } }],
    shipments: [],
    invoice: null,
    refunds: [],
  });
  prisma.buyerAlias.findMany.mockResolvedValue([{ userId: 'buyer-1', alias: '买家001' }]);
  prisma.user.findMany.mockResolvedValue([{ id: 'buyer-1', buyerNo: 'AIMM00000000000001' }]);

  const out = await service.findById('company-1', 'staff-1', 'order-1');

  expect(out).toMatchObject({ buyerAlias: '买家001', buyerNo: 'AIMM00000000000001' });
  expect(JSON.stringify(out)).not.toContain('"userId"');
});
```

- [x] **Step 2: Add seller backend buyerNo map and search**

In `backend/src/modules/seller/orders/seller-orders.service.ts`, import:

```ts
import { isBuyerNo, normalizeBuyerNo } from '../../../common/utils/buyer-no.util';
```

Add helper:

```ts
  private async getBuyerNoMap(userIds: string[]): Promise<Map<string, string | null>> {
    if (userIds.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, buyerNo: true },
    });
    return new Map(users.map((u) => [u.id, u.buyerNo]));
  }
```

Change `findAll` signature:

```ts
    buyerNo?: string,
```

Before querying orders, add:

```ts
    const buyerNoQuery = buyerNo?.trim();
    if (buyerNoQuery && isBuyerNo(buyerNoQuery)) {
      where.user = { buyerNo: normalizeBuyerNo(buyerNoQuery) };
    }
```

After alias lookup:

```ts
    const buyerNoMap = await this.getBuyerNoMap(userIds);
```

Return in list/detail:

```ts
buyerNo: buyerNoMap.get(order.userId) || null,
```

In detail, use:

```ts
const buyerNoMap = await this.getBuyerNoMap([order.userId]);
```

- [x] **Step 3: Wire seller order controller query**

In `backend/src/modules/seller/orders/seller-orders.controller.ts`, add query param:

```ts
    @Query('buyerNo') buyerNo?: string,
```

Pass to service:

```ts
      buyerNo,
```

- [x] **Step 4: Add seller after-sale buyerNo support**

In `backend/src/modules/seller/after-sale/seller-after-sale.service.ts`, add the same `getBuyerNoMap` helper and `buyerNo?: string` parameter. Filter within merchant scope:

```ts
    const buyerNoQuery = buyerNo?.trim();
    if (buyerNoQuery && isBuyerNo(buyerNoQuery)) {
      where.user = { buyerNo: normalizeBuyerNo(buyerNoQuery) };
    }
```

Return:

```ts
buyerNo: buyerNoMap.get(r.userId) || null,
```

In detail:

```ts
const buyer = await this.prisma.user.findUnique({
  where: { id: request.userId },
  select: { buyerNo: true },
});
```

Return:

```ts
buyerNo: buyer?.buyerNo || null,
```

In `backend/src/modules/seller/after-sale/seller-after-sale.controller.ts`, add `@Query('buyerNo') buyerNo?: string` and pass it to `findAll`.

- [x] **Step 5: Update seller frontend types and pages**

In `seller/src/types/index.ts`, add to `Order`:

```ts
buyerNo?: string | null;
```

In `seller/src/api/after-sale.ts`, add to `AfterSale`:

```ts
buyerNo?: string | null;
```

In `seller/src/pages/orders/index.tsx`, replace buyer column render:

```tsx
render: (_, r) => (
  <div>
    <div style={{ fontSize: 13 }}>{r.buyerAlias}</div>
    {r.buyerNo && (
      <Typography.Text copyable={{ text: r.buyerNo }} type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
        {r.buyerNo}
      </Typography.Text>
    )}
  </div>
)
```

Add a hidden/search field:

```tsx
{
  title: '用户编号',
  dataIndex: 'buyerNo',
  hideInTable: true,
}
```

In `seller/src/pages/orders/detail.tsx`, replace buyer description:

```tsx
<Descriptions.Item label="买家">
  <Space direction="vertical" size={0}>
    <span>{order.buyerAlias}</span>
    {order.buyerNo && <Typography.Text copyable={{ text: order.buyerNo }}>{order.buyerNo}</Typography.Text>}
  </Space>
</Descriptions.Item>
```

Apply the same list/detail rendering to `seller/src/pages/after-sale/index.tsx` and `seller/src/pages/after-sale/detail.tsx`.

- [x] **Step 6: Run seller verification**

Run:

```bash
cd backend
npx jest src/modules/seller/orders/seller-orders.service.spec.ts src/modules/seller/after-sale/seller-after-sale.service.spec.ts --runInBand
cd ../seller
npm run build
```

Expected: seller backend specs PASS; seller TypeScript and Vite build PASS.

- [x] **Step 7: Update seller docs and commit**

Append to `docs/architecture/seller.md`:

```md
- 卖家中心订单/售后列表与详情展示买家公开编号 `buyerNo`（`AIMM` + 14 位数字），保留店铺维度 `buyerAlias`，不展示内部 `User.id`，不额外暴露买家手机号或实名信息。卖家可用 `buyerNo` 搜索本商户相关订单/售后/物流记录，后端仍先执行商户数据权限过滤。
```

Update `plan.md`:

```md
- [x] 买家公开编号：卖家中心订单/售后/物流接口展示和搜索 `buyerNo`，不暴露内部 `User.id`。
```

Commit:

```bash
git add backend/src/modules/seller seller/src docs/architecture/seller.md plan.md
git commit -m "feat(seller): show buyer public ids"
```

---

### Task 6: Final Integration, Audit, And Release Docs

**Files:**
- Modify: `docs/operations/app-发布与OTA手册.md`
- Modify: `AGENTS.md` if implementation changes any final architecture wording
- Modify: `docs/superpowers/plans/2026-06-15-buyer-public-id.md` checkboxes as tasks complete

- [x] **Step 1: Run static audit for raw userId display**

Run:

```bash
rg -n "用户ID|用户 ID|userId|内部ID|ID:" admin/src/pages admin/src/components seller/src/pages app src/components src/types backend/src/modules/admin backend/src/modules/seller
```

Expected: every buyer-facing occurrence either displays `buyerNo`, labels raw `User.id` as internal ID in Admin only, or is an internal API/type reference.

- [x] **Step 2: Run full backend validation**

Run:

```bash
cd backend
npx prisma validate
npm test -- --runInBand
npm run build
```

Expected: Prisma schema valid, all backend tests pass, Nest build exits 0.

- [x] **Step 3: Run frontend builds**

Run:

```bash
npx tsc --noEmit
npm test -- --runInBand
cd admin && npm run build
cd ../seller && npm run build
```

Expected: App TypeScript and tests pass; Admin build passes; Seller build passes.

- [ ] **Step 4: Manual smoke checklist**

> Code-level verification is complete in this branch. Manual smoke against local seeded data or staging remains pending because no running API/data environment was used in this session.

Use local API or seeded data to verify:

```text
1. New phone registration returns a user whose GET /me contains buyerNo.
2. New SMS auto-registration returns a user whose GET /me contains buyerNo.
3. New WeChat auto-registration returns a user whose GET /me contains buyerNo.
4. App /me shows AIMM number next to avatar and copy action copies the full value.
5. Admin user list can search AIMM00000000000001 and shows buyerNo with copy.
6. Admin order list accepts userId=AIMM00000000000001 and returns that user's orders.
7. Seller order list accepts buyerNo=AIMM00000000000001 and returns only current merchant orders.
8. Seller UI shows buyerAlias plus buyerNo and never shows internal User.id.
```

- [x] **Step 5: Update OTA/release handoff docs**

Append to `docs/operations/app-发布与OTA手册.md` Chapter 6 current app state:

```md
- 买家公开编号 `buyerNo` 已接入：App「我的」页展示并复制 `AIMM` + 14 位编号；后端新增 `User.buyerNo` 和 `buyer_no_seq`；管理后台/卖家中心支持展示与搜索。此改动包含数据库 migration 和后端接口变更，首次上线必须走服务端部署与数据库迁移；App 展示文案后续微调可 OTA。
```

- [x] **Step 6: Commit final docs**

```bash
git add docs/operations/app-发布与OTA手册.md AGENTS.md docs/superpowers/plans/2026-06-15-buyer-public-id.md
git commit -m "docs: record buyer public id rollout"
```

---

## Deployment Notes

Production order:

1. Deploy database migration `20260615010000_add_buyer_no`.
2. Run `cd backend && npx ts-node scripts/backfill-buyer-no.ts --dry-run`.
3. Review candidate count and first/last number.
4. Run `cd backend && npx ts-node scripts/backfill-buyer-no.ts`.
5. Deploy backend code.
6. Deploy Admin and Seller frontends.
7. Publish App update. Because this feature depends on database/backend fields, the first rollout is not App-only OTA.

Rollback:

1. Roll back backend/frontend code first.
2. Keep `User.buyerNo` and `buyer_no_seq`; do not drop them after production backfill.
3. If display bugs occur, hide frontend buyerNo display while retaining database values.

## Plan Self-Review Checklist

- Spec coverage: covers data model, generation, history backfill, App display/copy, Admin display/search, Seller display/search, privacy, permissions, and rollout docs.
- Scan result: no unresolved markers or unfinished implementation notes remain.
- Type consistency: `buyerNo?: string | null` is used consistently across App, Admin, Seller, and backend response shapes.
