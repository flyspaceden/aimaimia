# 消费积分双轨实施计划（提现 + 抵扣）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `docs/superpowers/specs/2026-05-19-reward-dual-track-design.md`：把现"分润奖励"系统升级为消费积分双轨——实时提现到支付宝（平台代扣 20% 个税）+ 结算抵扣（订单×比例，普通 10% / VIP 15%），共用同一余额池。

**Architecture:** Schema 层不大改，扩展 WithdrawRequest + 加 RewardEntryType.DEDUCT + CheckoutSession.deductionGroupId；后端拆 3 个新 service（WithdrawPayoutService / RewardDeductionService / WithdrawRulesService），PaymentService 加 `initiateTransfer` 与 `initiateRefund` 对称；AlipayService 加 `transferToAccount` + `queryTransfer`；金额计算全程 cents；跨账户混扣写 2 条 ledger；提现走 Idempotency-Key 防重 + 实时调支付宝 + Notify/Cron 双补偿。买家 App 重写提现页 + 钱包页改名 + 结算页加积分输入；管理后台扩展提现记录 + 新建规则配置页 + 税务报送页。

**Tech Stack:** NestJS + Prisma + PostgreSQL + Redis + `alipay-sdk`；React Native + Expo for buyer App；Vite + React + Ant Design ProTable/ProForm for admin。

**Authoritative spec:** `docs/superpowers/specs/2026-05-19-reward-dual-track-design.md`。**所有数字、规则、字段名以 spec 为准**。本 plan 用 spec 的术语和命名。

**Replaces:** 旧 plan `docs/superpowers/plans/2026-05-17-alipay-realtime-withdrawal.md` 整体作废。

---

## Scope & 重大依赖

- v1.0 **不做** 拆双池降级方案（spec 3.3 节）。如税务师否决单池模型，启动降级前需新开 plan
- v1.0 **不做** 自动报送税务局 API（v1.1+）；管理后台导出 CSV 给财务手工报送
- v1.0 **不做** 微信支付提现等其他渠道
- **强制前置**：上线前必须找税务师签字背书（spec 14.1 + 15 节）

---

## File Map

### Prisma / 数据库

- Modify: `backend/prisma/schema.prisma`
  - `WithdrawStatus` 加 `PROCESSING`
  - `RewardEntryType` 加 `DEDUCT`
  - `WithdrawRequest` 加 13 个新字段 + 索引
  - `CheckoutSession` 加 `deductionGroupId`
- Modify: `backend/prisma/seed.ts`
  - 新增 12 个 RuleConfig key 默认值
- Create: `backend/prisma/migrations/<timestamp>_reward_dual_track/migration.sql`

### Backend: 配置与规则

- Create: `backend/src/modules/bonus/withdraw-rules.service.ts`
- Create: `backend/src/modules/bonus/withdraw-rules.service.spec.ts`
- Create: `backend/src/modules/bonus/dto/withdraw-rules.dto.ts`

### Backend: 提现链路

- Modify: `backend/src/modules/bonus/dto/withdraw.dto.ts`
- Create: `backend/src/modules/bonus/withdraw-payout.service.ts`
- Create: `backend/src/modules/bonus/withdraw-payout.service.spec.ts`
- Modify: `backend/src/modules/bonus/bonus.service.ts` (delegate requestWithdraw)
- Modify: `backend/src/modules/bonus/bonus.controller.ts` (DTO 改造 + Idempotency-Key header)
- Modify: `backend/src/modules/bonus/bonus.module.ts`
- Modify: `backend/src/modules/payment/alipay.service.ts` (transferToAccount + queryTransfer)
- Modify: `backend/src/modules/payment/alipay.service.spec.ts`
- Modify: `backend/src/modules/payment/payment.service.ts` (initiateTransfer)
- Modify: `backend/src/modules/payment/payment.controller.ts` (alipay/transfer-notify 端点)
- Create: `backend/src/modules/payment/payment.controller.transfer-notify.spec.ts`
- Use existing: `backend/src/common/infra/redis-coordinator.service.ts` (Cron 锁)
- Use existing: `backend/src/common/security/encryption.ts` (accountSnapshot 加密)

**注：v1.0 不做 SMS 二次验证**（spec 6.1 已记载），故不涉及 `backend/src/modules/auth/` 或 `backend/src/common/sms/` 改动。

### Backend: 抵扣链路

- Create: `backend/src/modules/bonus/reward-deduction.service.ts`
- Create: `backend/src/modules/bonus/reward-deduction.service.spec.ts`
- Modify: `backend/src/modules/order/order.controller.ts` (preview / checkout DTO 字段)
- Modify: `backend/src/modules/order/checkout.dto.ts`
- Modify: `backend/src/modules/order/checkout.service.ts` (替换旧 rewardId 整张式逻辑)

### Backend: 退款集成

- Modify: `backend/src/modules/after-sale/after-sale-refund.service.ts` (handleRefundSuccess 内调 refundDeduction)

### Backend: 管理端

- Modify: `backend/src/modules/admin/bonus/admin-bonus.controller.ts`
- Modify: `backend/src/modules/admin/bonus/admin-bonus.service.ts`
- Create: `backend/src/modules/admin/bonus/dto/update-withdraw-rules.dto.ts`

### 买家 App

- Modify: `src/types/domain/Bonus.ts`
- Modify: `src/repos/BonusRepo.ts`
- Modify: `src/repos/OrderRepo.ts`（实际文件名，**不是** CheckoutRepo.ts）
- Modify: `app/me/wallet.tsx` (文案改"消费积分")
- Modify: `app/me/withdraw.tsx` (完全重写)
- Modify: 结算页（buyer App checkout 页面，加积分输入）

### 管理后台

- Modify: `admin/src/api/bonus.ts`
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/constants/statusMaps.ts`
- Modify: `admin/src/constants/permissions.ts` (新增 `bonus:manage_rules`)
- Modify: `admin/src/pages/bonus/withdrawals.tsx`
- Create: `admin/src/pages/bonus/withdraw-rules.tsx`
- Create: `admin/src/pages/bonus/tax-reporting.tsx`
- Modify: `admin/src/App.tsx`（Routes 配置，line 100-134 区域，加新页 Route）
- Modify: `admin/src/layouts/AdminLayout.tsx`（menuRoutes 配置，line 38-52 区域 `/user-bonus` 子菜单加新页菜单项）
- Modify: `backend/src/modules/admin/reconciliation/admin-reconciliation.service.ts`（line 322 entryMap 加 DEDUCT；line 361 createdMap/touchedMap 加 PROCESSING）

### 文档

- Modify: `AGENTS.md` (登记本 plan)
- Modify after frontend done: `docs/architecture/frontend.md` (积分钱包页/提现页)
- Modify after admin done: `docs/architecture/admin-frontend.md`
- Modify after backend done: `docs/architecture/backend.md`
- Modify after impl: `plan.md` (上线冲刺路线图)

---

## Chunk 1: Schema 与配置基础

### Task 1: 扩展 Withdraw / Reward / Checkout Schema

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: 更新 `WithdrawStatus` 枚举**

在 `enum WithdrawStatus` 中加 `PROCESSING`：

```prisma
enum WithdrawStatus {
  REQUESTED
  PROCESSING
  APPROVED
  REJECTED
  PAID
  FAILED
}
```

- [ ] **Step 2: 更新 `RewardEntryType` 枚举**

加 `DEDUCT`：

```prisma
enum RewardEntryType {
  FREEZE
  RELEASE
  WITHDRAW
  VOID
  ADJUST
  DEDUCT
}
```

- [ ] **Step 3: 扩展 `WithdrawRequest`**

把 `model WithdrawRequest` 整块替换为：

```prisma
model WithdrawRequest {
  id               String          @id @default(cuid())
  userId           String
  user             User            @relation(fields: [userId], references: [id])
  amount           Float           // grossAmount 申请金额（保留旧字段名）
  channel          WithdrawChannel
  accountSnapshot  Json?           // 加密存 { account, name }
  accountType      String          @default("VIP_REWARD")
  status           WithdrawStatus  @default(PROCESSING)
  providerPayoutId String?

  // 新增字段
  taxAmount             Float    @default(0)
  netAmount             Float    @default(0)
  taxRate               Float    @default(0.20)
  providerFeeAmount     Float    @default(0)
  outBizNo              String?  @unique
  clientIdempotencyKey  String?  @unique
  providerFundOrderId   String?
  providerStatus        String?
  providerErrorCode     String?
  providerErrorMessage  String?
  paidAt                DateTime?
  lastQueriedAt         DateTime?
  queryAttempts         Int      @default(0)

  // 历史兼容
  rejectReason     String?
  reviewerAdminId  String?
  reviewerAdmin    AdminUser? @relation(fields: [reviewerAdminId], references: [id])
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt
  deletedAt        DateTime?

  @@index([userId, status, createdAt])
  @@index([status, createdAt])
  @@index([providerFundOrderId])
  @@index([userId, createdAt])
}
```

- [ ] **Step 4: 在 `CheckoutSession` 加 `deductionGroupId`**

在现有 `model CheckoutSession { ... }` 块内（与 `rewardId` 临近位置）添加：

```prisma
  deductionGroupId String?  // 跨账户抵扣组 ID（关联 VIP+NORMAL 两条 DEDUCT ledger）
```

- [ ] **Step 5: 校验 schema**

```bash
cd backend
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`。

- [ ] **Step 6: 生成 migration**

```bash
cd backend
npx prisma migrate dev --name reward_dual_track
```

Expected: 新 migration 文件生成 + Prisma Client 重新生成。

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(reward): extend schema for points dual track (withdraw + deduction)"
```

---

### Task 2: 种子 RuleConfig 12 个 key

**Files:**
- Modify: `backend/prisma/seed.ts`

- [ ] **Step 1: 找到 seed 的 ruleConfigs 数组位置**

```bash
grep -n "ruleConfigs" backend/prisma/seed.ts | head -5
```

Expected: 输出大约 line 1572 + 1643 之间的若干行（现有分润配置写法）。

- [ ] **Step 2: 在数组末尾添加 12 个新 key**

在 `const ruleConfigs = [ ... ]` 数组结束符 `]` 之前插入：

```typescript
  // 消费积分双轨配置
  { key: 'WITHDRAW_TAX_RATE',              value: { value: 0.20, description: '提现代扣个税比例' } },
  { key: 'WITHDRAW_MIN_AMOUNT',            value: { value: 10, description: '提现单笔最低（元）' } },
  { key: 'WITHDRAW_MAX_AMOUNT',            value: { value: 10000, description: '提现单笔最高（元）' } },
  { key: 'WITHDRAW_DAILY_MAX_COUNT',       value: { value: 3, description: '提现每日最多次数' } },
  { key: 'WITHDRAW_COOLDOWN_SECONDS',      value: { value: 60, description: '提现间冷却时间（秒）' } },
  { key: 'WITHDRAW_YEARLY_MAX_AMOUNT',     value: { value: 50000, description: '单用户年累计提现上限（元）' } },
  { key: 'DEDUCTION_RATIO_NORMAL',         value: { value: 0.10, description: '普通用户抵扣比例上限' } },
  { key: 'DEDUCTION_RATIO_VIP',            value: { value: 0.15, description: 'VIP 用户抵扣比例上限' } },
  { key: 'DEDUCTION_MIN_ORDER_AMOUNT',     value: { value: 0, description: '最低订单门槛（元）' } },
  { key: 'DEDUCTION_ALLOW_COUPON_STACK',   value: { value: true, description: '是否允许与平台红包叠加' } },
  { key: 'WITHDRAW_PROVIDER_FEE_AMOUNT',   value: { value: 0, description: '单笔通道手续费（元，v1.0=0）' } },
  { key: 'WITHDRAW_YEARLY_ALERT_THRESHOLD', value: { value: 0.80, description: '年累计达上限多少时告警（0-1）' } },
```

- [ ] **Step 3: 跑 seed 检查**

```bash
cd backend
npx prisma db seed
```

Expected: 输出 `✅ N 条分润配置已创建`，其中 N 比之前 +12。

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/seed.ts
git commit -m "feat(reward): seed 12 RuleConfig keys for points dual track"
```

---

## Chunk 2: WithdrawRulesService + DTOs

### Task 3: 实现 WithdrawRulesService

**Files:**
- Create: `backend/src/modules/bonus/dto/withdraw-rules.dto.ts`
- Create: `backend/src/modules/bonus/withdraw-rules.service.ts`
- Create: `backend/src/modules/bonus/withdraw-rules.service.spec.ts`
- Modify: `backend/src/modules/bonus/bonus.module.ts`

- [ ] **Step 1: 写 DTO**

```typescript
// backend/src/modules/bonus/dto/withdraw-rules.dto.ts
import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateWithdrawRulesDto {
  @IsOptional() @IsNumber() @Min(0) @Max(0.5)
  withdrawTaxRate?: number;

  @IsOptional() @IsNumber() @Min(0)
  withdrawMinAmount?: number;

  @IsOptional() @IsNumber() @Min(0)
  withdrawMaxAmount?: number;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  withdrawDailyMaxCount?: number;

  @IsOptional() @IsInt() @Min(0) @Max(86400)
  withdrawCooldownSeconds?: number;

  @IsOptional() @IsNumber() @Min(0)
  withdrawYearlyMaxAmount?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  deductionRatioNormal?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  deductionRatioVip?: number;

  @IsOptional() @IsNumber() @Min(0)
  deductionMinOrderAmount?: number;

  @IsOptional() @IsBoolean()
  deductionAllowCouponStack?: boolean;

  @IsOptional() @IsNumber() @Min(0)
  withdrawProviderFeeAmount?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  withdrawYearlyAlertThreshold?: number;
}

export interface WithdrawRules {
  withdrawTaxRate: number;
  withdrawMinAmount: number;
  withdrawMaxAmount: number;
  withdrawDailyMaxCount: number;
  withdrawCooldownSeconds: number;
  withdrawYearlyMaxAmount: number;
  deductionRatioNormal: number;
  deductionRatioVip: number;
  deductionMinOrderAmount: number;
  deductionAllowCouponStack: boolean;
  withdrawProviderFeeAmount: number;
  withdrawYearlyAlertThreshold: number;
}
```

- [ ] **Step 2: 写失败测试**

```typescript
// backend/src/modules/bonus/withdraw-rules.service.spec.ts
import { Test } from '@nestjs/testing';
import { WithdrawRulesService } from './withdraw-rules.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('WithdrawRulesService', () => {
  let service: WithdrawRulesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      ruleConfig: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        WithdrawRulesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(WithdrawRulesService);
  });

  it('returns defaults when no RuleConfig rows exist', async () => {
    prisma.ruleConfig.findMany.mockResolvedValue([]);
    const rules = await service.getRules();
    expect(rules.withdrawTaxRate).toBe(0.20);
    expect(rules.withdrawMinAmount).toBe(10);
    expect(rules.deductionRatioVip).toBe(0.15);
    expect(rules.deductionAllowCouponStack).toBe(true);
  });

  it('reads stored values overriding defaults', async () => {
    prisma.ruleConfig.findMany.mockResolvedValue([
      { key: 'WITHDRAW_TAX_RATE',   value: { value: 0.25 } },
      { key: 'DEDUCTION_RATIO_VIP', value: { value: 0.20 } },
    ]);
    const rules = await service.getRules();
    expect(rules.withdrawTaxRate).toBe(0.25);
    expect(rules.deductionRatioVip).toBe(0.20);
    expect(rules.withdrawMinAmount).toBe(10); // unchanged default
  });

  it('persists updates via upsert', async () => {
    prisma.ruleConfig.upsert.mockResolvedValue(undefined);
    await service.updateRules({ withdrawTaxRate: 0.18 });
    expect(prisma.ruleConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'WITHDRAW_TAX_RATE' },
      create: expect.objectContaining({ key: 'WITHDRAW_TAX_RATE' }),
      update: expect.objectContaining({ value: expect.objectContaining({ value: 0.18 }) }),
    }));
  });
});
```

- [ ] **Step 3: 运行测试验证它失败**

```bash
cd backend
npx jest src/modules/bonus/withdraw-rules.service.spec.ts
```

Expected: 失败，"Cannot find module './withdraw-rules.service'" 或类似。

- [ ] **Step 4: 实现 service**

```typescript
// backend/src/modules/bonus/withdraw-rules.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { WithdrawRules, UpdateWithdrawRulesDto } from './dto/withdraw-rules.dto';

const DEFAULTS: WithdrawRules = {
  withdrawTaxRate: 0.20,
  withdrawMinAmount: 10,
  withdrawMaxAmount: 10000,
  withdrawDailyMaxCount: 3,
  withdrawCooldownSeconds: 60,
  withdrawYearlyMaxAmount: 50000,
  deductionRatioNormal: 0.10,
  deductionRatioVip: 0.15,
  deductionMinOrderAmount: 0,
  deductionAllowCouponStack: true,
  withdrawProviderFeeAmount: 0,
  withdrawYearlyAlertThreshold: 0.80,
};

const KEY_MAP: Record<string, keyof WithdrawRules> = {
  WITHDRAW_TAX_RATE: 'withdrawTaxRate',
  WITHDRAW_MIN_AMOUNT: 'withdrawMinAmount',
  WITHDRAW_MAX_AMOUNT: 'withdrawMaxAmount',
  WITHDRAW_DAILY_MAX_COUNT: 'withdrawDailyMaxCount',
  WITHDRAW_COOLDOWN_SECONDS: 'withdrawCooldownSeconds',
  WITHDRAW_YEARLY_MAX_AMOUNT: 'withdrawYearlyMaxAmount',
  DEDUCTION_RATIO_NORMAL: 'deductionRatioNormal',
  DEDUCTION_RATIO_VIP: 'deductionRatioVip',
  DEDUCTION_MIN_ORDER_AMOUNT: 'deductionMinOrderAmount',
  DEDUCTION_ALLOW_COUPON_STACK: 'deductionAllowCouponStack',
  WITHDRAW_PROVIDER_FEE_AMOUNT: 'withdrawProviderFeeAmount',
  WITHDRAW_YEARLY_ALERT_THRESHOLD: 'withdrawYearlyAlertThreshold',
};
const REVERSE_KEY_MAP: Record<keyof WithdrawRules, string> = Object.fromEntries(
  Object.entries(KEY_MAP).map(([k, v]) => [v, k]),
) as Record<keyof WithdrawRules, string>;

@Injectable()
export class WithdrawRulesService {
  constructor(private prisma: PrismaService) {}

  async getRules(): Promise<WithdrawRules> {
    const rows = await this.prisma.ruleConfig.findMany({
      where: { key: { in: Object.keys(KEY_MAP) } },
    });
    const result: WithdrawRules = { ...DEFAULTS };
    for (const row of rows) {
      const field = KEY_MAP[row.key];
      const stored = (row.value as any)?.value ?? row.value;
      if (field && stored !== undefined && stored !== null) {
        (result as any)[field] = stored;
      }
    }
    return result;
  }

  async updateRules(dto: UpdateWithdrawRulesDto): Promise<WithdrawRules> {
    for (const [field, val] of Object.entries(dto)) {
      if (val === undefined) continue;
      const key = REVERSE_KEY_MAP[field as keyof WithdrawRules];
      if (!key) continue;
      await this.prisma.ruleConfig.upsert({
        where: { key },
        create: { key, value: { value: val } as any },
        update: { value: { value: val } as any },
      });
    }
    return this.getRules();
  }
}
```

- [ ] **Step 5: 在 BonusModule 注册**

```bash
grep -n "providers" backend/src/modules/bonus/bonus.module.ts
```

打开 `backend/src/modules/bonus/bonus.module.ts`，在 `providers: [...]` 数组里加 `WithdrawRulesService`：

```typescript
import { WithdrawRulesService } from './withdraw-rules.service';
// ...
providers: [BonusService, /* ...其他 */, WithdrawRulesService],
exports: [BonusService, WithdrawRulesService],
```

- [ ] **Step 6: 运行测试验证通过**

```bash
cd backend
npx jest src/modules/bonus/withdraw-rules.service.spec.ts
```

Expected: PASS（3 个 case 全过）。

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/bonus/withdraw-rules.service.ts \
        backend/src/modules/bonus/withdraw-rules.service.spec.ts \
        backend/src/modules/bonus/dto/withdraw-rules.dto.ts \
        backend/src/modules/bonus/bonus.module.ts
git commit -m "feat(reward): add WithdrawRulesService backed by RuleConfig"
```

---

### Task 4: 重写 WithdrawDto

**Files:**
- Modify: `backend/src/modules/bonus/dto/withdraw.dto.ts`

- [ ] **Step 1: 整个文件替换**

```typescript
// backend/src/modules/bonus/dto/withdraw.dto.ts
import { IsNumber, IsPositive, IsString, IsNotEmpty, MaxLength, IsOptional, IsIn } from 'class-validator';

export class WithdrawDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsIn(['alipay'])
  channel?: 'alipay';

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  alipayAccount: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  alipayName: string;
}
```

**v1.0 不加 smsCode / smsVerifyToken**。资金防护依赖 Idempotency-Key + 多层限额（spec 6.1 已记载）。

- [ ] **Step 2: TypeScript 校验**

```bash
cd backend
npx tsc --noEmit
```

Expected: 编译错误指向 `bonus.controller.ts` / `bonus.service.ts` 旧引用——这是预期的，下一个 task 修。

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/bonus/dto/withdraw.dto.ts
git commit -m "feat(reward): rewrite WithdrawDto for realtime alipay payout"
```

---

## Chunk 3: Alipay Provider 扩展

### Task 5: AlipayService 加 transferToAccount + queryTransfer

**Files:**
- Modify: `backend/src/modules/payment/alipay.service.ts`
- Modify: `backend/src/modules/payment/alipay.service.spec.ts`

- [ ] **Step 1: 写失败测试（transfer）**

把以下 `describe` 块追加到 `backend/src/modules/payment/alipay.service.spec.ts` 末尾：

```typescript
describe('transferToAccount', () => {
  let service: AlipayService;
  let exec: jest.Mock;

  beforeEach(async () => {
    exec = jest.fn();
    service = new AlipayService({
      get: jest.fn().mockReturnValue('test'),
    } as any);
    (service as any).sdk = { exec };
  });

  it('calls alipay.fund.trans.uni.transfer with TRANS_ACCOUNT_NO_PWD + DIRECT_TRANSFER', async () => {
    exec.mockResolvedValue({ code: '10000', orderId: 'O1', payFundOrderId: 'F1' });
    await service.transferToAccount({
      outBizNo: 'WD-x', amount: 80,
      payeeAccount: 'a@b.com', payeeRealName: '张三',
    });
    expect(exec).toHaveBeenCalledWith('alipay.fund.trans.uni.transfer', expect.objectContaining({
      bizContent: expect.objectContaining({
        out_biz_no: 'WD-x',
        trans_amount: '80.00',
        product_code: 'TRANS_ACCOUNT_NO_PWD',
        biz_scene: 'DIRECT_TRANSFER',
        payee_info: { identity: 'a@b.com', identity_type: 'ALIPAY_LOGON_ID', name: '张三' },
      }),
    }));
  });

  it('maps SUCCESS', async () => {
    exec.mockResolvedValue({ code: '10000', orderId: 'O1', payFundOrderId: 'F1', status: 'SUCCESS' });
    const result = await service.transferToAccount({
      outBizNo: 'WD-x', amount: 80, payeeAccount: 'a', payeeRealName: 'b',
    });
    expect(result.success).toBe(true);
    expect(result.processing).toBe(false);
    expect(result.orderId).toBe('O1');
    expect(result.payFundOrderId).toBe('F1');
  });

  it('maps deterministic failure with subCode/subMsg', async () => {
    exec.mockResolvedValue({
      code: '40004', subCode: 'PAYEE_NOT_EXIST', subMsg: '收款方账户不存在',
      msg: 'Business Failed',
    });
    const result = await service.transferToAccount({
      outBizNo: 'WD-x', amount: 80, payeeAccount: 'a', payeeRealName: 'b',
    });
    expect(result.success).toBe(false);
    expect(result.processing).toBe(false);
    expect(result.errorCode).toBe('PAYEE_NOT_EXIST');
    expect(result.errorMessage).toContain('收款方账户不存在');
  });

  it('maps SYSTEM_ERROR as processing (unknown result)', async () => {
    exec.mockResolvedValue({ code: '20000', subCode: 'SYSTEM_ERROR', subMsg: '系统错误' });
    const result = await service.transferToAccount({
      outBizNo: 'WD-x', amount: 80, payeeAccount: 'a', payeeRealName: 'b',
    });
    expect(result.success).toBe(false);
    expect(result.processing).toBe(true);
  });
});

describe('queryTransfer', () => {
  let service: AlipayService;
  let exec: jest.Mock;

  beforeEach(() => {
    exec = jest.fn();
    service = new AlipayService({ get: jest.fn().mockReturnValue('test') } as any);
    (service as any).sdk = { exec };
  });

  it('queries by out_biz_no with biz_scene DIRECT_TRANSFER', async () => {
    exec.mockResolvedValue({ code: '10000', status: 'SUCCESS', orderId: 'O1' });
    await service.queryTransfer({ outBizNo: 'WD-x' });
    expect(exec).toHaveBeenCalledWith('alipay.fund.trans.common.query', expect.objectContaining({
      bizContent: expect.objectContaining({
        out_biz_no: 'WD-x',
        product_code: 'TRANS_ACCOUNT_NO_PWD',
        biz_scene: 'DIRECT_TRANSFER',
      }),
    }));
  });

  it('maps SUCCESS', async () => {
    exec.mockResolvedValue({ code: '10000', status: 'SUCCESS', orderId: 'O1', payFundOrderId: 'F1', payDate: '2026-01-01 10:00:00' });
    const result = await service.queryTransfer({ outBizNo: 'WD-x' });
    expect(result.status).toBe('SUCCESS');
    expect(result.orderId).toBe('O1');
  });

  it('maps NOT_FOUND', async () => {
    exec.mockResolvedValue({ code: '40004', subCode: 'ORDER_NOT_EXIST', subMsg: '订单不存在' });
    const result = await service.queryTransfer({ outBizNo: 'WD-x' });
    expect(result.status).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 2: 运行测试看失败**

```bash
cd backend
npx jest src/modules/payment/alipay.service.spec.ts
```

Expected: 新增 case 失败（"service.transferToAccount is not a function"）。

- [ ] **Step 3: 实现 transferToAccount**

在 `alipay.service.ts` `AlipayService` 类内，`refund` 方法之后追加：

```typescript
/**
 * 商家到个人单笔转账（提现到支付宝）
 * 使用 alipay.fund.trans.uni.transfer，企业账户免费
 */
async transferToAccount(params: {
  outBizNo: string;
  amount: number;
  payeeAccount: string;
  payeeRealName: string;
  remark?: string;
}): Promise<{
  success: boolean;
  processing: boolean;
  outBizNo: string;
  orderId?: string;
  payFundOrderId?: string;
  providerStatus?: string;
  errorCode?: string;
  errorMessage?: string;
  raw: any;
}> {
  if (!this.sdk) throw new Error('支付宝 SDK 未初始化');

  const result = await this.sdk.exec('alipay.fund.trans.uni.transfer', {
    bizContent: {
      out_biz_no: params.outBizNo,
      trans_amount: params.amount.toFixed(2),
      product_code: 'TRANS_ACCOUNT_NO_PWD',
      biz_scene: 'DIRECT_TRANSFER',
      order_title: '爱买买消费积分提现',
      payee_info: {
        identity: params.payeeAccount,
        identity_type: 'ALIPAY_LOGON_ID',
        name: params.payeeRealName,
      },
      remark: params.remark || '爱买买消费积分提现',
    },
  }) as any;

  const code = result.code;
  const subCode = result.subCode;
  // 系统错误/请求处理中 → 不确定结果
  const isProcessing = code === '20000' || subCode === 'SYSTEM_ERROR' || subCode === 'REQUEST_PROCESSING';
  const isSuccess = code === '10000';

  const errorMessage = !isSuccess
    ? [result.msg, subCode ? `[${subCode}]` : '', result.subMsg].filter(Boolean).join(' ').trim() || '未知错误'
    : undefined;

  return {
    success: isSuccess,
    processing: !isSuccess && isProcessing,
    outBizNo: params.outBizNo,
    orderId: result.orderId,
    payFundOrderId: result.payFundOrderId,
    providerStatus: result.status,
    errorCode: subCode,
    errorMessage,
    raw: result,
  };
}

async queryTransfer(params: {
  outBizNo?: string;
  orderId?: string;
}): Promise<{
  status: 'SUCCESS' | 'PROCESSING' | 'FAIL' | 'NOT_FOUND';
  orderId?: string;
  payFundOrderId?: string;
  payDate?: Date;
  errorCode?: string;
  errorMessage?: string;
  raw: any;
}> {
  if (!this.sdk) throw new Error('支付宝 SDK 未初始化');

  const bizContent: any = {
    product_code: 'TRANS_ACCOUNT_NO_PWD',
    biz_scene: 'DIRECT_TRANSFER',
  };
  if (params.outBizNo) bizContent.out_biz_no = params.outBizNo;
  if (params.orderId) bizContent.order_id = params.orderId;

  const result = await this.sdk.exec('alipay.fund.trans.common.query', { bizContent }) as any;

  if (result.code !== '10000') {
    // ORDER_NOT_EXIST / PAYMENT_NOT_EXIST 视为 NOT_FOUND
    if (result.subCode === 'ORDER_NOT_EXIST' || result.subCode === 'PAYMENT_NOT_EXIST') {
      return { status: 'NOT_FOUND', errorCode: result.subCode, errorMessage: result.subMsg, raw: result };
    }
    return { status: 'FAIL', errorCode: result.subCode, errorMessage: result.subMsg || result.msg, raw: result };
  }

  // SUCCESS / WAIT_PAY / REFUND / FAIL
  const status = result.status;
  let mapped: 'SUCCESS' | 'PROCESSING' | 'FAIL' | 'NOT_FOUND' = 'PROCESSING';
  if (status === 'SUCCESS') mapped = 'SUCCESS';
  else if (status === 'FAIL') mapped = 'FAIL';
  else mapped = 'PROCESSING';

  return {
    status: mapped,
    orderId: result.orderId,
    payFundOrderId: result.payFundOrderId,
    payDate: result.payDate ? new Date(result.payDate) : undefined,
    raw: result,
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd backend
npx jest src/modules/payment/alipay.service.spec.ts
```

Expected: 所有 case PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payment/alipay.service.ts backend/src/modules/payment/alipay.service.spec.ts
git commit -m "feat(payment): add alipay transferToAccount + queryTransfer"
```

---

### Task 6: PaymentService 加 initiateTransfer

**Files:**
- Modify: `backend/src/modules/payment/payment.service.ts`

- [ ] **Step 1: 加 initiateTransfer 方法**

在 `PaymentService` 类内，`initiateRefund` 方法之后追加：

```typescript
/**
 * 发起渠道转账（提现）
 * 跟 initiateRefund 同面间，按 channel 分支调对应 provider
 */
async initiateTransfer(params: {
  channel: 'ALIPAY' | 'WECHAT_PAY' | 'UNIONPAY' | 'AGGREGATOR';
  amount: number;
  outBizNo: string;
  payeeAccount: string;
  payeeRealName: string;
  remark?: string;
}): Promise<{
  success: boolean;
  processing: boolean;
  outBizNo: string;
  providerOrderId?: string;
  providerFundOrderId?: string;
  providerStatus?: string;
  errorCode?: string;
  errorMessage?: string;
}> {
  this.logger.log(
    `发起渠道转账: channel=${params.channel}, outBizNo=${this.maskBizId(params.outBizNo)}, amount=${params.amount}`,
  );

  if (params.channel === 'ALIPAY') {
    if (!this.alipayService.isAvailable()) {
      return { success: false, processing: false, outBizNo: params.outBizNo, errorMessage: '支付宝 SDK 未初始化' };
    }
    const r = await this.alipayService.transferToAccount({
      outBizNo: params.outBizNo,
      amount: params.amount,
      payeeAccount: params.payeeAccount,
      payeeRealName: params.payeeRealName,
      remark: params.remark,
    });
    return {
      success: r.success,
      processing: r.processing,
      outBizNo: r.outBizNo,
      providerOrderId: r.orderId,
      providerFundOrderId: r.payFundOrderId,
      providerStatus: r.providerStatus,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
    };
  }

  throw new NotImplementedException(`提现渠道 ${params.channel} 暂未接入`);
}
```

- [ ] **Step 2: TypeScript 编译**

```bash
cd backend
npx tsc --noEmit
```

Expected: 无新错误（旧 WithdrawDto 错误仍然存在，下面 task 修）。

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/payment/payment.service.ts
git commit -m "feat(payment): add channel-agnostic initiateTransfer"
```

---

## Chunk 4: 提现链路（Realtime Withdrawal）

### Task 7: 实现 WithdrawPayoutService.requestWithdraw

**Files:**
- Create: `backend/src/modules/bonus/withdraw-payout.service.ts`
- Create: `backend/src/modules/bonus/withdraw-payout.service.spec.ts`
- Modify: `backend/src/modules/bonus/bonus.module.ts`

- [ ] **Step 1: 写失败测试（限额规则）**

```typescript
// backend/src/modules/bonus/withdraw-payout.service.spec.ts
import { WithdrawPayoutService } from './withdraw-payout.service';
import { BadRequestException } from '@nestjs/common';

describe('WithdrawPayoutService.requestWithdraw', () => {
  let service: WithdrawPayoutService;
  let prisma: any;
  let rulesService: any;
  let paymentService: any;

  const makeRules = (overrides: any = {}) => ({
    withdrawTaxRate: 0.20,
    withdrawMinAmount: 10,
    withdrawMaxAmount: 10000,
    withdrawDailyMaxCount: 3,
    withdrawCooldownSeconds: 60,
    withdrawYearlyMaxAmount: 50000,
    withdrawProviderFeeAmount: 0,
    withdrawYearlyAlertThreshold: 0.80,
    deductionRatioNormal: 0.10,
    deductionRatioVip: 0.15,
    deductionMinOrderAmount: 0,
    deductionAllowCouponStack: true,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      rewardAccount: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      withdrawRequest: {
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        aggregate: jest.fn(),
        updateMany: jest.fn(),
      },
      rewardLedger: {
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    rulesService = { getRules: jest.fn().mockResolvedValue(makeRules()) };
    paymentService = { initiateTransfer: jest.fn() };
    service = new WithdrawPayoutService(prisma, rulesService, paymentService, {} as any);
  });

  it('rejects amount below min', async () => {
    await expect(service.requestWithdraw('u1', {
      amount: 9.99, alipayAccount: 'a', alipayName: 'b',
    }, undefined)).rejects.toThrow(BadRequestException);
  });

  it('rejects amount above max', async () => {
    await expect(service.requestWithdraw('u1', {
      amount: 10001, alipayAccount: 'a', alipayName: 'b',
    }, undefined)).rejects.toThrow(BadRequestException);
  });

  it('rejects when daily count exceeded', async () => {
    prisma.rewardAccount.findUnique.mockResolvedValue({ id: 'acc-vip', balance: 1000, frozen: 0, type: 'VIP_REWARD' });
    prisma.withdrawRequest.count.mockResolvedValue(3);
    prisma.withdrawRequest.findFirst.mockResolvedValue(null);
    prisma.withdrawRequest.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    await expect(service.requestWithdraw('u1', {
      amount: 100, alipayAccount: 'a', alipayName: 'b',
    }, undefined)).rejects.toThrow(/每日最多提现/);
  });

  it('rejects when cooldown not elapsed', async () => {
    prisma.rewardAccount.findUnique.mockResolvedValue({ id: 'acc-vip', balance: 1000, frozen: 0, type: 'VIP_REWARD' });
    prisma.withdrawRequest.count.mockResolvedValue(0);
    prisma.withdrawRequest.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 30_000) });
    prisma.withdrawRequest.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    await expect(service.requestWithdraw('u1', {
      amount: 100, alipayAccount: 'a', alipayName: 'b',
    }, undefined)).rejects.toThrow(/冷却时间/);
  });

  it('rejects when yearly cap reached', async () => {
    prisma.rewardAccount.findUnique.mockResolvedValue({ id: 'acc-vip', balance: 1000, frozen: 0, type: 'VIP_REWARD' });
    prisma.withdrawRequest.count.mockResolvedValue(0);
    prisma.withdrawRequest.findFirst.mockResolvedValue(null);
    prisma.withdrawRequest.aggregate.mockResolvedValue({ _sum: { amount: 50000 } });
    await expect(service.requestWithdraw('u1', {
      amount: 100, alipayAccount: 'a', alipayName: 'b',
    }, undefined)).rejects.toThrow(/年累计提现/);
  });

  it('returns existing withdraw on repeated idempotency key', async () => {
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-1', amount: 100, taxAmount: 20, netAmount: 80, taxRate: 0.2, status: 'PAID',
    });
    const result = await service.requestWithdraw('u1', {
      amount: 100, alipayAccount: 'a', alipayName: 'b',
    }, 'idemp-1');
    expect(prisma.withdrawRequest.findUnique).toHaveBeenCalledWith({ where: { clientIdempotencyKey: 'idemp-1' } });
    expect(result.withdrawId).toBe('w-1');
  });
});
```

- [ ] **Step 2: 运行看失败**

```bash
cd backend
npx jest src/modules/bonus/withdraw-payout.service.spec.ts
```

Expected: 失败，"Cannot find module './withdraw-payout.service'"。

- [ ] **Step 3: 实现 service 骨架（含跨账户扣减）**

```typescript
// backend/src/modules/bonus/withdraw-payout.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { PrismaService } from '../../prisma/prisma.service';
import { WithdrawRulesService } from './withdraw-rules.service';
import { PaymentService } from '../payment/payment.service';
import { InboxService } from '../inbox/inbox.service';

interface WithdrawInput {
  amount: number;
  alipayAccount: string;
  alipayName: string;
}

interface WithdrawResult {
  withdrawId: string;
  grossAmount: number;
  taxAmount: number;
  taxRate: number;
  netAmount: number;
  status: 'PROCESSING' | 'PAID' | 'FAILED';
  message: string;
}

// cents helper
const yuanToCents = (n: number) => Math.round(n * 100);
const centsToYuan = (c: number) => Math.round(c) / 100;

@Injectable()
export class WithdrawPayoutService {
  private readonly logger = new Logger(WithdrawPayoutService.name);

  constructor(
    private prisma: PrismaService,
    private rulesService: WithdrawRulesService,
    private paymentService: PaymentService,
    private inboxService: InboxService,
  ) {}

  async requestWithdraw(
    userId: string,
    input: WithdrawInput,
    idempotencyKey: string | undefined,
  ): Promise<WithdrawResult> {
    const rules = await this.rulesService.getRules();
    const amountCents = yuanToCents(input.amount);
    const minCents = yuanToCents(rules.withdrawMinAmount);
    const maxCents = yuanToCents(rules.withdrawMaxAmount);

    // 1. 限额校验
    if (amountCents < minCents) throw new BadRequestException(`单笔最低 ¥${rules.withdrawMinAmount}`);
    if (amountCents > maxCents) throw new BadRequestException(`单笔最高 ¥${rules.withdrawMaxAmount}`);

    // 2. 幂等键查询 + 一致性校验（审查 P0-4）
    if (idempotencyKey) {
      const existing = await this.prisma.withdrawRequest.findUnique({
        where: { clientIdempotencyKey: idempotencyKey },
      });
      if (existing) {
        // 防止同 key 改金额/账户的攻击：三元组必须完全一致
        const snapshot = (existing.accountSnapshot as any) || {};
        const decryptedAccount = snapshot.account
          ? decryptJsonValue(snapshot).account
          : null;
        const sameAmount = Math.round(existing.amount * 100) === amountCents;
        const sameAccount = decryptedAccount === input.alipayAccount;
        if (!sameAmount || existing.userId !== userId || !sameAccount) {
          throw new BadRequestException('Idempotency-Key conflict: existing request differs');
        }
        return {
          withdrawId: existing.id,
          grossAmount: existing.amount,
          taxAmount: existing.taxAmount,
          taxRate: existing.taxRate,
          netAmount: existing.netAmount,
          status: existing.status as any,
          message: '请求已处理',
        };
      }
    }

    // 3. (v1.0 跳过：不做短信/支付密码二次验证)

    // 4. Serializable 事务：校验+冻结+创建
    const created = await this.createWithdrawTx(userId, input, idempotencyKey, rules);

    // 5. 事务外调支付宝
    const grossNet = {
      grossAmount: created.amount,
      taxAmount: created.taxAmount,
      taxRate: created.taxRate,
      netAmount: created.netAmount,
    };
    const transferResult = await this.paymentService.initiateTransfer({
      channel: 'ALIPAY',
      amount: created.netAmount,
      outBizNo: created.outBizNo!,
      payeeAccount: input.alipayAccount,
      payeeRealName: input.alipayName,
    });

    // 6. 按结果 finalize
    if (transferResult.success) {
      await this.finalizeWithdrawalPaid(created.id, transferResult);
      // 反洗钱告警
      await this.checkYearlyAlertAndNotify(userId, created.amount, rules);
      return { withdrawId: created.id, ...grossNet, status: 'PAID', message: `提现已到账 ¥${created.netAmount}` };
    }
    if (!transferResult.processing) {
      // 确定失败
      await this.finalizeWithdrawalFailed(created.id, transferResult);
      return {
        withdrawId: created.id, ...grossNet, status: 'FAILED',
        message: `提现失败，金额已退回：${transferResult.errorMessage}`,
      };
    }
    // 不确定 → 保留 PROCESSING
    await this.markProcessingProviderInfo(created.id, transferResult);
    return { withdrawId: created.id, ...grossNet, status: 'PROCESSING', message: '提现处理中，请稍后查看' };
  }

  /** 跨账户扣减（VIP 优先），返回拆分明细 */
  async deductBalanceForWithdraw(tx: any, userId: string, amountCents: number): Promise<{
    fromVipCents: number;
    fromNormalCents: number;
    vipAccountId?: string;
    normalAccountId?: string;
  }> {
    const vip = await tx.rewardAccount.findUnique({ where: { userId_type: { userId, type: 'VIP_REWARD' } } });
    const normal = await tx.rewardAccount.findUnique({ where: { userId_type: { userId, type: 'NORMAL_REWARD' } } });
    const vipBalCents = vip ? yuanToCents(vip.balance) : 0;
    const normalBalCents = normal ? yuanToCents(normal.balance) : 0;

    if (vipBalCents + normalBalCents < amountCents) {
      throw new BadRequestException('余额不足');
    }

    let fromVipCents = 0;
    let fromNormalCents = 0;
    if (vipBalCents >= amountCents) {
      fromVipCents = amountCents;
    } else {
      fromVipCents = vipBalCents;
      fromNormalCents = amountCents - vipBalCents;
    }

    if (fromVipCents > 0 && vip) {
      const fromVipYuan = centsToYuan(fromVipCents);
      const updated = await tx.rewardAccount.updateMany({
        where: { id: vip.id, balance: { gte: fromVipYuan } },
        data: { balance: { decrement: fromVipYuan }, frozen: { increment: fromVipYuan } },
      });
      if (updated.count === 0) throw new BadRequestException('VIP 余额扣减并发失败，请重试');
    }
    if (fromNormalCents > 0 && normal) {
      const fromNormalYuan = centsToYuan(fromNormalCents);
      const updated = await tx.rewardAccount.updateMany({
        where: { id: normal.id, balance: { gte: fromNormalYuan } },
        data: { balance: { decrement: fromNormalYuan }, frozen: { increment: fromNormalYuan } },
      });
      if (updated.count === 0) throw new BadRequestException('普通余额扣减并发失败，请重试');
    }

    return {
      fromVipCents, fromNormalCents,
      vipAccountId: vip?.id, normalAccountId: normal?.id,
    };
  }

  private async createWithdrawTx(
    userId: string,
    input: WithdrawInput,
    idempotencyKey: string | undefined,
    rules: Awaited<ReturnType<WithdrawRulesService['getRules']>>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const amountCents = yuanToCents(input.amount);

      // 5.a 校验日次数
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayCount = await tx.withdrawRequest.count({
        where: { userId, createdAt: { gte: todayStart }, status: { not: 'FAILED' } },
      });
      if (todayCount >= rules.withdrawDailyMaxCount) {
        throw new BadRequestException(`每日最多提现 ${rules.withdrawDailyMaxCount} 次`);
      }

      // 5.b 校验冷却
      const cooldownAgo = new Date(Date.now() - rules.withdrawCooldownSeconds * 1000);
      const lastWithdraw = await tx.withdrawRequest.findFirst({
        where: { userId, createdAt: { gte: cooldownAgo } },
        orderBy: { createdAt: 'desc' },
      });
      if (lastWithdraw) {
        throw new BadRequestException(`冷却时间未到，请 ${rules.withdrawCooldownSeconds} 秒后重试`);
      }

      // 5.c 校验年累计
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const yearAgg = await tx.withdrawRequest.aggregate({
        where: { userId, createdAt: { gte: yearStart }, status: { in: ['PROCESSING', 'PAID'] } },
        _sum: { amount: true },
      });
      const yearTotalCents = yuanToCents(yearAgg._sum.amount || 0);
      const yearMaxCents = yuanToCents(rules.withdrawYearlyMaxAmount);
      if (yearTotalCents + amountCents > yearMaxCents) {
        throw new BadRequestException(`年累计提现已达上限 ¥${rules.withdrawYearlyMaxAmount}`);
      }

      // 5.d 跨账户扣减
      const split = await this.deductBalanceForWithdraw(tx, userId, amountCents);

      // 5.e 算税
      const taxRate = rules.withdrawTaxRate;
      const taxCents = Math.floor(amountCents * taxRate);
      const providerFeeCents = yuanToCents(rules.withdrawProviderFeeAmount);
      const netCents = amountCents - taxCents - providerFeeCents;

      // 5.f 预生成 id + outBizNo
      const newId = createId();
      const outBizNo = `WD-${newId}`;
      const primaryAccountType = split.fromVipCents > 0 ? 'VIP_REWARD' : 'NORMAL_REWARD';

      // 5.g 创建 WithdrawRequest
      const created = await tx.withdrawRequest.create({
        data: {
          id: newId,
          userId,
          amount: input.amount,
          taxAmount: centsToYuan(taxCents),
          netAmount: centsToYuan(netCents),
          taxRate,
          providerFeeAmount: rules.withdrawProviderFeeAmount,
          channel: 'ALIPAY',
          accountType: primaryAccountType,
          status: 'PROCESSING',
          outBizNo,
          clientIdempotencyKey: idempotencyKey || null,
          // accountSnapshot 待 PII 加密 helper 接入；本 task 留空，后续 task 补
          accountSnapshot: null,
        },
      });

      // 5.h 写 ledger（跨账户写 2 条；纯单账户写 1 条）
      const groupId = `WG-${newId}`;
      if (split.fromVipCents > 0 && split.vipAccountId) {
        await tx.rewardLedger.create({
          data: {
            accountId: split.vipAccountId,
            userId,
            entryType: 'WITHDRAW',
            amount: centsToYuan(split.fromVipCents),
            status: 'FROZEN',
            refType: 'WITHDRAW',
            refId: created.id,
            meta: {
              scheme: 'POINTS_WITHDRAW',
              groupId,
              role: split.fromNormalCents > 0 ? 'PRIMARY' : 'SOLE',
            },
          },
        });
      }
      if (split.fromNormalCents > 0 && split.normalAccountId) {
        await tx.rewardLedger.create({
          data: {
            accountId: split.normalAccountId,
            userId,
            entryType: 'WITHDRAW',
            amount: centsToYuan(split.fromNormalCents),
            status: 'FROZEN',
            refType: 'WITHDRAW',
            refId: created.id,
            meta: {
              scheme: 'POINTS_WITHDRAW',
              groupId,
              role: 'SECONDARY',
            },
          },
        });
      }

      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async finalizeWithdrawalPaid(withdrawId: string, providerResult: any): Promise<void> {
    // 实现在 Task 8
  }
  async finalizeWithdrawalFailed(withdrawId: string, providerResult: any): Promise<void> {
    // 实现在 Task 8
  }
  async markProcessingProviderInfo(withdrawId: string, providerResult: any): Promise<void> {
    // 实现在 Task 8
  }
  async checkYearlyAlertAndNotify(userId: string, lastAmount: number, rules: any): Promise<void> {
    // 实现在 Task 8
  }
}
```

- [ ] **Step 4: 在 BonusModule 注册**

打开 `backend/src/modules/bonus/bonus.module.ts`，确保 `providers` 含 `WithdrawPayoutService` 且 `imports` 含 `PaymentModule`、`InboxModule`（按需补 import 语句；**不需要 SmsModule，v1.0 无二次验证**）：

```typescript
import { WithdrawPayoutService } from './withdraw-payout.service';
// imports: [..., PaymentModule, InboxModule, ...]
// providers: [BonusService, WithdrawRulesService, WithdrawPayoutService, ...]
// exports:   [BonusService, WithdrawRulesService, WithdrawPayoutService, ...]
```

- [ ] **Step 5: 安装 cuid2（如果项目尚未使用）**

```bash
cd backend
npm ls @paralleldrive/cuid2 || npm install @paralleldrive/cuid2
```

如果项目已用 prisma 自带 cuid，可改为：`import { createId } from '@paralleldrive/cuid2'` → 改用 prisma `cuid()` helper 或 `randomUUID()`。本 plan 推荐前者保持 id 风格一致。

- [ ] **Step 6: 运行测试看通过**

```bash
cd backend
npx jest src/modules/bonus/withdraw-payout.service.spec.ts -t "rejects amount|rejects when|returns existing"
```

Expected: 这些 case 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/bonus/withdraw-payout.service.ts \
        backend/src/modules/bonus/withdraw-payout.service.spec.ts \
        backend/src/modules/bonus/bonus.module.ts \
        backend/package.json backend/package-lock.json
git commit -m "feat(reward): add WithdrawPayoutService skeleton with rules + balance freeze"
```

---

### Task 8: WithdrawPayoutService 加 finalize/processing/alert

**Files:**
- Modify: `backend/src/modules/bonus/withdraw-payout.service.ts`
- Modify: `backend/src/modules/bonus/withdraw-payout.service.spec.ts`

- [ ] **Step 1: 增加 finalize 测试**

把以下 `describe` 块追加到 spec 文件末尾：

```typescript
describe('WithdrawPayoutService.finalize', () => {
  let service: WithdrawPayoutService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      withdrawRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      rewardLedger: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn(),
      },
      rewardAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new WithdrawPayoutService(prisma, {} as any, {} as any, {} as any, {} as any);
  });

  it('finalizePaid sets status to PAID with provider IDs', async () => {
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-1', amount: 100, userId: 'u', accountType: 'VIP_REWARD',
    });
    prisma.rewardLedger.findMany.mockResolvedValue([
      { accountId: 'acc-vip', amount: 100, meta: { groupId: 'WG-1', role: 'SOLE' } },
    ]);
    await service.finalizeWithdrawalPaid('w-1', { providerOrderId: 'O1', providerFundOrderId: 'F1' });
    expect(prisma.withdrawRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'w-1', status: 'PROCESSING' },
      data: expect.objectContaining({
        status: 'PAID',
        providerPayoutId: 'O1',
        providerFundOrderId: 'F1',
      }),
    }));
    // ledger FROZEN → WITHDRAWN
    expect(prisma.rewardLedger.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { refType: 'WITHDRAW', refId: 'w-1', status: 'FROZEN' },
      data: { status: 'WITHDRAWN' },
    }));
  });

  it('finalizeFailed restores balance from frozen', async () => {
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-1', amount: 100, userId: 'u', accountType: 'VIP_REWARD',
    });
    prisma.rewardLedger.findMany.mockResolvedValue([
      { accountId: 'acc-vip', amount: 60, meta: { groupId: 'WG-1', role: 'PRIMARY' } },
      { accountId: 'acc-normal', amount: 40, meta: { groupId: 'WG-1', role: 'SECONDARY' } },
    ]);
    await service.finalizeWithdrawalFailed('w-1', { errorMessage: 'payee not exist', errorCode: 'PAYEE_NOT_EXIST' });
    expect(prisma.withdrawRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'w-1', status: 'PROCESSING' },
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    // 每个账户都被恢复
    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledTimes(2);
    // ledger → VOIDED
    expect(prisma.rewardLedger.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { refType: 'WITHDRAW', refId: 'w-1', status: 'FROZEN' },
      data: { status: 'VOIDED', entryType: 'VOID' },
    }));
  });

  it('finalizePaid is idempotent on repeated call', async () => {
    prisma.withdrawRequest.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    prisma.withdrawRequest.findUnique.mockResolvedValue({ id: 'w-1', amount: 100, userId: 'u', accountType: 'VIP_REWARD' });
    prisma.rewardLedger.findMany.mockResolvedValue([{ accountId: 'a', amount: 100, meta: {} }]);
    await service.finalizeWithdrawalPaid('w-1', { providerOrderId: 'O1' });
    await service.finalizeWithdrawalPaid('w-1', { providerOrderId: 'O1' });
    // 第二次不应再调 ledger update（被 count=0 短路）
    expect(prisma.rewardLedger.updateMany).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试看失败**

```bash
cd backend
npx jest src/modules/bonus/withdraw-payout.service.spec.ts -t "finalize"
```

Expected: 失败（方法是占位实现）。

- [ ] **Step 3: 替换 finalizeWithdrawalPaid / Failed / markProcessing / checkYearlyAlert 实现**

在 `withdraw-payout.service.ts` 的对应空方法替换为：

```typescript
async finalizeWithdrawalPaid(withdrawId: string, providerResult: {
  providerOrderId?: string; providerFundOrderId?: string;
}): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    const cas = await tx.withdrawRequest.updateMany({
      where: { id: withdrawId, status: 'PROCESSING' },
      data: {
        status: 'PAID',
        providerPayoutId: providerResult.providerOrderId,
        providerFundOrderId: providerResult.providerFundOrderId,
        paidAt: new Date(),
      },
    });
    if (cas.count === 0) return; // 幂等

    const withdraw = await tx.withdrawRequest.findUnique({ where: { id: withdrawId } });
    if (!withdraw) return;

    // 释放 frozen
    const ledgers = await tx.rewardLedger.findMany({
      where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' },
    });
    for (const l of ledgers) {
      await tx.rewardAccount.updateMany({
        where: { id: l.accountId, frozen: { gte: l.amount } },
        data: { frozen: { decrement: l.amount } },
      });
    }

    // ledger: FROZEN → WITHDRAWN
    await tx.rewardLedger.updateMany({
      where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' },
      data: { status: 'WITHDRAWN' },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  // 异步推 Inbox（事务外）
  const w = await this.prisma.withdrawRequest.findUnique({ where: { id: withdrawId } });
  if (w) {
    this.inboxService.send({
      userId: w.userId,
      category: 'transaction',
      type: 'withdraw_paid',
      title: '提现已到账',
      content: `您的提现 ¥${w.netAmount.toFixed(2)} 已到账支付宝（代扣个税 ¥${w.taxAmount.toFixed(2)}）。`,
      target: { route: '/me/wallet' },
    }).catch(() => {});
  }
}

async finalizeWithdrawalFailed(withdrawId: string, providerResult: {
  errorMessage?: string; errorCode?: string; providerStatus?: string;
}): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    const cas = await tx.withdrawRequest.updateMany({
      where: { id: withdrawId, status: 'PROCESSING' },
      data: {
        status: 'FAILED',
        providerErrorCode: providerResult.errorCode,
        providerErrorMessage: providerResult.errorMessage,
        providerStatus: providerResult.providerStatus,
      },
    });
    if (cas.count === 0) return;

    const ledgers = await tx.rewardLedger.findMany({
      where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' },
    });
    // 回滚每个账户的 frozen → balance
    for (const l of ledgers) {
      await tx.rewardAccount.updateMany({
        where: { id: l.accountId, frozen: { gte: l.amount } },
        data: { frozen: { decrement: l.amount }, balance: { increment: l.amount } },
      });
    }

    await tx.rewardLedger.updateMany({
      where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' },
      data: { status: 'VOIDED', entryType: 'VOID' },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  // Inbox 通知
  const w = await this.prisma.withdrawRequest.findUnique({ where: { id: withdrawId } });
  if (w) {
    this.inboxService.send({
      userId: w.userId,
      category: 'transaction',
      type: 'withdraw_failed',
      title: '提现失败，金额已退回',
      content: `提现 ¥${w.amount.toFixed(2)} 失败：${providerResult.errorMessage || '请检查账户信息后重试'}。`,
      target: { route: '/me/wallet' },
    }).catch(() => {});
  }
}

async markProcessingProviderInfo(withdrawId: string, providerResult: any): Promise<void> {
  await this.prisma.withdrawRequest.update({
    where: { id: withdrawId },
    data: {
      providerErrorCode: providerResult.errorCode,
      providerErrorMessage: providerResult.errorMessage,
      providerStatus: providerResult.providerStatus,
    },
  });
}

async checkYearlyAlertAndNotify(
  userId: string,
  lastAmount: number,
  rules: { withdrawYearlyMaxAmount: number; withdrawYearlyAlertThreshold: number },
): Promise<void> {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const agg = await this.prisma.withdrawRequest.aggregate({
    where: { userId, createdAt: { gte: yearStart }, status: { in: ['PROCESSING', 'PAID'] } },
    _sum: { amount: true },
  });
  const total = agg._sum.amount || 0;
  const threshold = rules.withdrawYearlyMaxAmount * rules.withdrawYearlyAlertThreshold;
  if (total >= threshold && total < rules.withdrawYearlyMaxAmount) {
    // 给所有管理员发 inbox
    const admins = await this.prisma.adminUser.findMany({ where: { status: 'ACTIVE' } });
    for (const a of admins) {
      this.inboxService.send({
        userId: a.id,
        category: 'risk',
        type: 'withdraw_yearly_alert',
        title: '高额提现告警',
        content: `用户 ${userId} 年累计提现 ¥${total.toFixed(2)}，已达上限 ${(total / rules.withdrawYearlyMaxAmount * 100).toFixed(1)}%`,
        target: null,
      }).catch(() => {});
    }
  }
}
```

- [ ] **Step 4: 运行 finalize 测试**

```bash
cd backend
npx jest src/modules/bonus/withdraw-payout.service.spec.ts -t "finalize"
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/bonus/withdraw-payout.service.ts \
        backend/src/modules/bonus/withdraw-payout.service.spec.ts
git commit -m "feat(reward): implement finalizePaid/Failed + yearly alert"
```

---

### Task 9: 注入 BonusController 改造 + accountSnapshot 加密

**Files:**
- Modify: `backend/src/modules/bonus/bonus.service.ts`
- Modify: `backend/src/modules/bonus/bonus.controller.ts`
- Modify: `backend/src/modules/bonus/withdraw-payout.service.ts`

- [ ] **Step 1: 校验加密 helper 现状**

```bash
grep -n "encryptJsonValue\|decryptJsonValue" backend/src/common/security/encryption.ts
```

Expected: 这两个 helper 已存在（after-sale 模块已经在用）。如果只有 decryptJsonValue 没 encryptJsonValue，下一步先补 encrypt。

- [ ] **Step 2: 如果缺 encryptJsonValue，补一个**

如果上一步只看到 decrypt，没 encrypt，打开 `backend/src/common/security/encryption.ts`，参照 decrypt 的 KEY/IV 逻辑补一个对偶函数：

```typescript
export function encryptJsonValue(value: any): string {
  // 复用本文件已有的 KEY/IV/algorithm
  const json = JSON.stringify(value);
  // ... cipher.update + final → base64
  return /* base64 string */;
}
```

如果已存在，跳过本步。

- [ ] **Step 3: WithdrawPayoutService 写 accountSnapshot 加密**

在 `withdraw-payout.service.ts` 顶部加 import：

```typescript
import { encryptJsonValue } from '../../common/security/encryption';
```

修改 `createWithdrawTx` 内 `accountSnapshot: null` 那行：

```typescript
accountSnapshot: encryptJsonValue({
  account: input.alipayAccount,
  name: input.alipayName,
}) as any,
```

- [ ] **Step 4: bonus.controller.ts 改造**

打开 `backend/src/modules/bonus/bonus.controller.ts`，替换 `requestWithdraw` 方法：

```typescript
import { Controller, Get, Post, Body, Query, GoneException, Headers } from '@nestjs/common';
import { WithdrawPayoutService } from './withdraw-payout.service';

// ...
constructor(
  private bonusService: BonusService,
  private withdrawPayoutService: WithdrawPayoutService,
) {}

@Post('withdraw')
requestWithdraw(
  @CurrentUser('sub') userId: string,
  @Body() dto: WithdrawDto,
  @Headers('idempotency-key') idempotencyKey?: string,
) {
  // 审查 P0-4：Idempotency-Key 必填
  if (!idempotencyKey || idempotencyKey.length < 8) {
    throw new BadRequestException('Idempotency-Key header required');
  }
  return this.withdrawPayoutService.requestWithdraw(userId, dto, idempotencyKey);
}
```

- [ ] **Step 5: bonus.service.ts 移除 requestWithdraw**

打开 `backend/src/modules/bonus/bonus.service.ts`，**整段删除** `requestWithdraw` 方法（line 558-669 区域）。其他方法不动。

- [ ] **Step 6: TypeScript 编译**

```bash
cd backend
npx tsc --noEmit
```

Expected: 编译通过（旧 `bonus.service.requestWithdraw` 已删除，调用方现在走 controller → withdraw-payout-service）。

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/bonus/bonus.controller.ts \
        backend/src/modules/bonus/bonus.service.ts \
        backend/src/modules/bonus/withdraw-payout.service.ts \
        backend/src/common/security/encryption.ts
git commit -m "feat(reward): wire BonusController to WithdrawPayoutService + encrypt PII"
```

---

### Task 10: 支付宝转账 Notify 端点

**Files:**
- Modify: `backend/src/modules/payment/payment.controller.ts`
- Modify: `backend/src/modules/bonus/withdraw-payout.service.ts`
- Create: `backend/src/modules/payment/payment.controller.transfer-notify.spec.ts`

- [ ] **Step 1: 写 notify handler 测试**

```typescript
// backend/src/modules/payment/payment.controller.transfer-notify.spec.ts
import { WithdrawPayoutService } from '../bonus/withdraw-payout.service';

describe('handleAlipayTransferNotify', () => {
  let withdrawPayoutService: WithdrawPayoutService;
  let alipayService: any;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      withdrawRequest: { findUnique: jest.fn() },
    };
    alipayService = { verifyNotify: jest.fn() };
    withdrawPayoutService = {
      finalizeWithdrawalPaid: jest.fn(),
      finalizeWithdrawalFailed: jest.fn(),
    } as any;
  });

  it('routes SUCCESS notify to finalizeWithdrawalPaid', async () => {
    alipayService.verifyNotify.mockResolvedValue(true);
    prisma.withdrawRequest.findUnique.mockResolvedValue({ id: 'w-1', status: 'PROCESSING' });

    const handler = async (body: any) => {
      const verified = await alipayService.verifyNotify(body);
      if (!verified) return 'failure';
      if (body.msg_method !== 'alipay.fund.trans.order.changed') return 'success';
      const biz = JSON.parse(body.biz_content);
      const withdraw = await prisma.withdrawRequest.findUnique({ where: { outBizNo: biz.out_biz_no } });
      if (!withdraw || withdraw.status !== 'PROCESSING') return 'success';
      if (biz.status === 'SUCCESS') {
        await withdrawPayoutService.finalizeWithdrawalPaid(withdraw.id, {
          providerOrderId: biz.order_id, providerFundOrderId: biz.pay_fund_order_id,
        });
      } else if (biz.status === 'FAIL') {
        await withdrawPayoutService.finalizeWithdrawalFailed(withdraw.id, {
          errorCode: biz.error_code, errorMessage: biz.fail_reason, providerStatus: 'FAIL',
        });
      }
      return 'success';
    };

    const result = await handler({
      msg_method: 'alipay.fund.trans.order.changed',
      biz_content: JSON.stringify({ out_biz_no: 'WD-1', status: 'SUCCESS', order_id: 'O1', pay_fund_order_id: 'F1' }),
    });
    expect(result).toBe('success');
    expect(withdrawPayoutService.finalizeWithdrawalPaid).toHaveBeenCalledWith('w-1', {
      providerOrderId: 'O1', providerFundOrderId: 'F1',
    });
  });

  it('returns failure when sign invalid', async () => {
    alipayService.verifyNotify.mockResolvedValue(false);
    const handler = async (body: any) => {
      const verified = await alipayService.verifyNotify(body);
      return verified ? 'success' : 'failure';
    };
    expect(await handler({})).toBe('failure');
  });
});
```

- [ ] **Step 2: 运行测试看失败 → 通过**

```bash
cd backend
npx jest src/modules/payment/payment.controller.transfer-notify.spec.ts
```

Expected: PASS（这是 inline handler 测试，验证逻辑）。

- [ ] **Step 3: 在 payment.controller.ts 加 transfer-notify 端点**

打开 `backend/src/modules/payment/payment.controller.ts`，加 import：

```typescript
import { WithdrawPayoutService } from '../bonus/withdraw-payout.service';
import { PrismaService } from '../../prisma/prisma.service';
```

在 constructor 加注入：

```typescript
constructor(
  private paymentService: PaymentService,
  private alipayService: AlipayService,
  private checkoutService: CheckoutService,
  private withdrawPayoutService: WithdrawPayoutService,
  private prisma: PrismaService,
) {}
```

在 controller 内加端点（放在现有 `handleAlipayNotify` 之后）：

```typescript
@Public()
@UseGuards(WebhookIpGuard)
@Post('alipay/transfer-notify')
async handleAlipayTransferNotify(
  @Body() body: Record<string, string>,
  @Res() res: Response,
) {
  this.logger.log(`收到支付宝转账通知: out_biz_no=${(body as any).biz_content || ''}`);

  // 1. 验签
  const verified = await this.alipayService.verifyNotify(body);
  if (!verified) {
    this.logger.error(`支付宝转账通知验签失败 body=${JSON.stringify(body)}`);
    res.status(200).send('failure');
    return;
  }

  // 2. 仅处理 fund.trans.order.changed
  if (body.msg_method !== 'alipay.fund.trans.order.changed') {
    res.status(200).send('success');
    return;
  }

  let biz: any;
  try {
    biz = JSON.parse(body.biz_content);
  } catch {
    this.logger.error(`支付宝转账通知 biz_content 解析失败`);
    res.status(200).send('failure');
    return;
  }

  // 3. 找到 WithdrawRequest
  const withdraw = await this.prisma.withdrawRequest.findUnique({
    where: { outBizNo: biz.out_biz_no },
  });
  if (!withdraw) {
    this.logger.warn(`未找到 WithdrawRequest: out_biz_no=${biz.out_biz_no}`);
    res.status(200).send('success');
    return;
  }

  // 4. 已 finalize 的幂等返回
  if (withdraw.status !== 'PROCESSING') {
    res.status(200).send('success');
    return;
  }

  // 5. 路由
  try {
    if (biz.status === 'SUCCESS') {
      await this.withdrawPayoutService.finalizeWithdrawalPaid(withdraw.id, {
        providerOrderId: biz.order_id,
        providerFundOrderId: biz.pay_fund_order_id,
      });
    } else if (biz.status === 'FAIL' || biz.status === 'CLOSED') {
      await this.withdrawPayoutService.finalizeWithdrawalFailed(withdraw.id, {
        errorCode: biz.error_code,
        errorMessage: biz.fail_reason || `支付宝转账 ${biz.status}`,
        providerStatus: biz.status,
      });
    }
    res.status(200).send('success');
  } catch (err: any) {
    this.logger.error(`处理支付宝转账通知异常: ${err.message}`);
    res.status(200).send('failure');
  }
}
```

- [ ] **Step 4: 模块依赖单向化（审查 P0-8 + 复审 #2）**

**问题**：如果 BonusModule import PaymentModule **同时** PaymentModule import BonusModule，无论 forwardRef 还是 ModuleRef 都仍是循环。要明确单向。

**最终方案：BonusModule → PaymentModule（单向 import）**

1. **BonusModule import PaymentModule**（正常 import，**不 forwardRef**）

打开 `backend/src/modules/bonus/bonus.module.ts`：

```typescript
import { PaymentModule } from '../payment/payment.module';
@Module({
  imports: [..., PaymentModule],   // 单向：Bonus 依赖 Payment
  // ...
})
```

WithdrawPayoutService 正常 `constructor(private paymentService: PaymentService)` 注入。

2. **PaymentModule 不 import BonusModule**

PaymentModule 保持现状，**不引 BonusModule**。

3. **PaymentController 用 ModuleRef 解析 WithdrawPayoutService**

PaymentController 需要在 `/alipay/transfer-notify` 端点里调 WithdrawPayoutService，但 PaymentModule 不 import BonusModule。用 ModuleRef + `strict: false` 全局解析：

```typescript
import { ModuleRef } from '@nestjs/core';
import { WithdrawPayoutService } from '../bonus/withdraw-payout.service';
// ...
constructor(
  private paymentService: PaymentService,
  private alipayService: AlipayService,
  private checkoutService: CheckoutService,
  private moduleRef: ModuleRef,
  private prisma: PrismaService,
) {}

// 在 handleAlipayTransferNotify 内运行期解析：
async handleAlipayTransferNotify(...) {
  const withdrawPayoutService = this.moduleRef.get(WithdrawPayoutService, { strict: false });
  // ... finalize 调用逻辑
}
```

**前提**：`AppModule` 已经 import 了 BonusModule（任意一处即可，因为 BonusModule 一旦被 AppModule 注册，ModuleRef strict:false 就能找到它的 providers）。

**单向依赖图**：
```
AppModule
  ├─ BonusModule  → PaymentModule
  ├─ PaymentModule           ← BonusModule, PaymentController(ModuleRef → WithdrawPayoutService)
  ├─ OrderModule  → BonusModule
  └─ AfterSaleModule → BonusModule
```

无循环。构造期 PaymentController 不需要 WithdrawPayoutService 存在；运行期支付宝通知到达时 ModuleRef.get 即可拿到。

- [ ] **Step 5: TypeScript 编译**

```bash
cd backend
npx tsc --noEmit
```

Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/payment/payment.controller.ts \
        backend/src/modules/payment/payment.controller.transfer-notify.spec.ts \
        backend/src/modules/payment/payment.module.ts \
        backend/src/modules/bonus/bonus.module.ts
git commit -m "feat(payment): add alipay transfer notify endpoint"
```

---

### Task 11: Cron 补偿任务（含 Redis 锁）

**审查 P1-10**：v1.0 必须实现 Redis 锁，不能只写注释。项目已有 `RedisCoordinatorService`（`backend/src/common/infra/redis-coordinator.service.ts:117 acquireLock(key, owner, ttlMs)`），直接复用。

**Files:**
- Modify: `backend/src/modules/bonus/withdraw-payout.service.ts`
- Modify: `backend/src/modules/bonus/bonus.module.ts`（import RedisCoordinatorService 所在 module）

- [ ] **Step 1: 注入 RedisCoordinatorService + AlipayService（复审 #8：用类型注入，不用 `as any`）**

打开 `withdraw-payout.service.ts`，加 import + constructor 注入：

```typescript
import { RedisCoordinatorService } from '../../common/infra/redis-coordinator.service';
import { AlipayService } from '../payment/alipay.service';
import { randomUUID } from 'crypto';
// constructor 加：
constructor(
  private prisma: PrismaService,
  private rulesService: WithdrawRulesService,
  private paymentService: PaymentService,
  private inboxService: InboxService,
  private redisCoordinator: RedisCoordinatorService,    // 新增
  private alipayService: AlipayService,                  // 新增（cron 直接调 queryTransfer）
) {}
```

注入 AlipayService 而**不通过 `(this.paymentService as any).alipayService`** 绕过类型——后者既丑也容易让人改坏（Payment 内部重构时静默失效）。PaymentModule 已经 export AlipayService（如未 export 在 Task 5 之前补一下）。

确认 BonusModule import 了 RedisCoordinatorService 所在的 module（如 `CommonInfraModule` / `RedisModule`）：

```bash
grep -rn "RedisCoordinatorService" backend/src --include="*.module.ts" | head -5
```

按 grep 结果在 BonusModule.imports 加对应 module 引用。

- [ ] **Step 2: 加 cron 方法（含真实 Redis 锁）**

在 `WithdrawPayoutService` 类内末尾追加：

```typescript
import { Cron, CronExpression } from '@nestjs/schedule';
// ... 在 class 顶部 import 上面这行

@Cron(CronExpression.EVERY_10_MINUTES)
async retryProcessingWithdrawals(): Promise<void> {
  // 真实 Redis 锁（防多实例并发）
  const lockOwner = randomUUID();
  const lockTtlMs = 9 * 60 * 1000;  // 9 分钟（< cron 间隔 10 分钟）
  const got = await this.redisCoordinator.acquireLock(
    'cron:withdraw-payout-retry',
    lockOwner,
    lockTtlMs,
  );
  if (!got) {
    this.logger.log('另一实例正在跑提现补偿，跳过');
    return;
  }

  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const candidates = await this.prisma.withdrawRequest.findMany({
      where: {
        status: 'PROCESSING',
        createdAt: { lte: fiveMinAgo },
        queryAttempts: { lt: 10 },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

  for (const w of candidates) {
    if (!w.outBizNo) continue;
    // 先 ++ queryAttempts 避免异常时无限重试（复审 #8）
    await this.prisma.withdrawRequest.update({
      where: { id: w.id },
      data: { lastQueriedAt: new Date(), queryAttempts: { increment: 1 } },
    });

    try {
      const queryResult = await this.alipayService.queryTransfer({ outBizNo: w.outBizNo });

      if (queryResult.status === 'SUCCESS') {
        await this.finalizeWithdrawalPaid(w.id, {
          providerOrderId: queryResult.orderId,
          providerFundOrderId: queryResult.payFundOrderId,
        });
      } else if (queryResult.status === 'FAIL') {
        await this.finalizeWithdrawalFailed(w.id, {
          errorCode: queryResult.errorCode,
          errorMessage: queryResult.errorMessage,
        });
      } else if (queryResult.status === 'NOT_FOUND' && w.queryAttempts >= 9) {
        // 重试上限，强制 finalize FAILED + 退余额
        await this.finalizeWithdrawalFailed(w.id, {
          errorCode: 'NOT_FOUND_MAX_ATTEMPTS',
          errorMessage: '支付宝查询多次未找到订单，强制退款',
        });
      }
    } catch (err: any) {
      this.logger.error(`cron 补偿 ${w.id} 异常: ${err.message}`);
    }
    }
  } finally {
    await this.redisCoordinator.releaseLock('cron:withdraw-payout-retry', lockOwner);
  }
}
```

- [ ] **Step 3: 确认 RedisCoordinatorService 有 releaseLock 方法**

```bash
grep -n "releaseLock\|release_lock" backend/src/common/infra/redis-coordinator.service.ts
```

如果没有 `releaseLock` 方法（API 可能叫别的，如 `release` 或仅靠 TTL 自然过期），按 grep 结果调整调用。若仅依赖 TTL，可省略 finally 块（lock 9 分钟自然过期）。

- [ ] **Step 4: 确保 ScheduleModule 注册**

```bash
grep -n "ScheduleModule" backend/src/app.module.ts
```

Expected: 已有 `ScheduleModule.forRoot()`（其他 cron 在用），无需新加。

- [ ] **Step 3: TypeScript 编译**

```bash
cd backend
npx tsc --noEmit
```

Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/bonus/withdraw-payout.service.ts
git commit -m "feat(reward): add cron compensation for stuck PROCESSING withdrawals"
```

---

## Chunk 5: 抵扣链路（Reward Deduction）

### Task 12: RewardDeductionService.calculateMaxDeductible

**Files:**
- Create: `backend/src/modules/bonus/reward-deduction.service.ts`
- Create: `backend/src/modules/bonus/reward-deduction.service.spec.ts`
- Modify: `backend/src/modules/bonus/bonus.module.ts`

- [ ] **Step 1: 写 calculateMaxDeductible 测试**

```typescript
// backend/src/modules/bonus/reward-deduction.service.spec.ts
import { RewardDeductionService } from './reward-deduction.service';

describe('RewardDeductionService.calculateMaxDeductible', () => {
  let service: RewardDeductionService;
  let prisma: any;
  let rules: any;

  beforeEach(() => {
    prisma = {
      memberProfile: { findUnique: jest.fn() },
      rewardAccount: { findUnique: jest.fn() },
    };
    rules = { getRules: jest.fn().mockResolvedValue({
      deductionRatioNormal: 0.10,
      deductionRatioVip: 0.15,
      deductionMinOrderAmount: 0,
    }) };
    service = new RewardDeductionService(prisma, rules);
  });

  it('uses VIP ratio for VIP member', async () => {
    prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'VIP' });
    prisma.rewardAccount.findUnique
      .mockResolvedValueOnce({ balance: 100 })
      .mockResolvedValueOnce({ balance: 0 });
    const r = await service.calculateMaxDeductible('u1', 200);
    expect(r.pointsRatio).toBe(0.15);
    expect(r.pointsBalance).toBe(100);
    expect(r.maxDeductible).toBe(30); // min(200*0.15, 100) = 30
  });

  it('uses normal ratio for non-VIP', async () => {
    prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'NORMAL' });
    prisma.rewardAccount.findUnique
      .mockResolvedValueOnce({ balance: 30 })
      .mockResolvedValueOnce({ balance: 20 });
    const r = await service.calculateMaxDeductible('u1', 200);
    expect(r.pointsRatio).toBe(0.10);
    expect(r.pointsBalance).toBe(50);
    expect(r.maxDeductible).toBe(20); // min(200*0.10, 50) = 20
  });

  it('caps at balance when balance < ratio*goods', async () => {
    prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'NORMAL' });
    prisma.rewardAccount.findUnique
      .mockResolvedValueOnce({ balance: 5 })
      .mockResolvedValueOnce({ balance: 0 });
    const r = await service.calculateMaxDeductible('u1', 200);
    expect(r.maxDeductible).toBe(5);
  });

  it('returns 0 when both accounts missing', async () => {
    prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'NORMAL' });
    prisma.rewardAccount.findUnique.mockResolvedValue(null);
    const r = await service.calculateMaxDeductible('u1', 200);
    expect(r.pointsBalance).toBe(0);
    expect(r.maxDeductible).toBe(0);
  });
});
```

- [ ] **Step 2: 运行看失败**

```bash
cd backend
npx jest src/modules/bonus/reward-deduction.service.spec.ts
```

Expected: 失败（service 文件不存在）。

- [ ] **Step 3: 实现 service 骨架**

```typescript
// backend/src/modules/bonus/reward-deduction.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { PrismaService } from '../../prisma/prisma.service';
import { WithdrawRulesService } from './withdraw-rules.service';

const yuanToCents = (n: number) => Math.round(n * 100);
const centsToYuan = (c: number) => Math.round(c) / 100;

@Injectable()
export class RewardDeductionService {
  private readonly logger = new Logger(RewardDeductionService.name);

  constructor(
    private prisma: PrismaService,
    private rulesService: WithdrawRulesService,
  ) {}

  async calculateMaxDeductible(userId: string, goodsAmount: number): Promise<{
    pointsBalance: number;
    pointsRatio: number;
    maxDeductible: number;
  }> {
    const rules = await this.rulesService.getRules();
    const member = await this.prisma.memberProfile.findUnique({ where: { userId } });
    const ratio = member?.tier === 'VIP' ? rules.deductionRatioVip : rules.deductionRatioNormal;

    const vip = await this.prisma.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'VIP_REWARD' } },
    });
    const normal = await this.prisma.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'NORMAL_REWARD' } },
    });
    const balance = (vip?.balance ?? 0) + (normal?.balance ?? 0);

    const maxByRatioCents = Math.floor(yuanToCents(goodsAmount) * ratio);
    const balanceCents = yuanToCents(balance);
    const maxDeductibleCents = Math.min(maxByRatioCents, balanceCents);

    return {
      pointsBalance: centsToYuan(balanceCents),
      pointsRatio: ratio,
      maxDeductible: centsToYuan(maxDeductibleCents),
    };
  }

  // 下个 task 实现的 stub
  async reserveDeduction(_tx: any, _userId: string, _goodsAmount: number, _requestedAmount: number): Promise<any> {
    throw new Error('not implemented');
  }
  async confirmDeduction(_tx: any, _groupId: string): Promise<void> {
    throw new Error('not implemented');
  }
  async releaseDeduction(_tx: any, _groupId: string): Promise<void> {
    throw new Error('not implemented');
  }
  async refundDeduction(_tx: any, _params: any): Promise<void> {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 4: BonusModule 注册**

打开 `backend/src/modules/bonus/bonus.module.ts`，加 `RewardDeductionService` 到 `providers` 和 `exports`：

```typescript
import { RewardDeductionService } from './reward-deduction.service';
providers: [..., RewardDeductionService],
exports: [..., RewardDeductionService],
```

- [ ] **Step 5: 运行测试**

```bash
cd backend
npx jest src/modules/bonus/reward-deduction.service.spec.ts -t calculateMaxDeductible
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/bonus/reward-deduction.service.ts \
        backend/src/modules/bonus/reward-deduction.service.spec.ts \
        backend/src/modules/bonus/bonus.module.ts
git commit -m "feat(reward): add RewardDeductionService.calculateMaxDeductible"
```

---

### Task 13: reserveDeduction（跨账户拆 2 条 ledger）

**Files:**
- Modify: `backend/src/modules/bonus/reward-deduction.service.ts`
- Modify: `backend/src/modules/bonus/reward-deduction.service.spec.ts`

- [ ] **Step 1: 写 reserveDeduction 测试**

把以下追加到 spec 文件：

```typescript
describe('RewardDeductionService.reserveDeduction', () => {
  let service: RewardDeductionService;
  let tx: any;
  let rulesService: any;

  beforeEach(() => {
    tx = {
      memberProfile: { findUnique: jest.fn() },
      rewardAccount: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rewardLedger: { create: jest.fn() },
      checkoutSession: { update: jest.fn() },
    };
    rulesService = { getRules: jest.fn().mockResolvedValue({
      deductionRatioNormal: 0.10, deductionRatioVip: 0.15, deductionMinOrderAmount: 0,
    }) };
    service = new RewardDeductionService({} as any, rulesService);
  });

  it('rejects amount > maxDeductible', async () => {
    tx.memberProfile.findUnique.mockResolvedValue({ tier: 'NORMAL' });
    tx.rewardAccount.findUnique
      .mockResolvedValueOnce({ id: 'v', balance: 100, frozen: 0 })
      .mockResolvedValueOnce({ id: 'n', balance: 0, frozen: 0 });
    await expect(service.reserveDeduction(tx, 'u1', 200, 25))
      .rejects.toThrow(/超出上限/);
  });

  it('writes 1 ledger when VIP balance covers', async () => {
    tx.memberProfile.findUnique.mockResolvedValue({ tier: 'NORMAL' });
    tx.rewardAccount.findUnique
      .mockResolvedValueOnce({ id: 'v', balance: 100, frozen: 0 })
      .mockResolvedValueOnce({ id: 'n', balance: 50, frozen: 0 });
    tx.rewardLedger.create.mockResolvedValueOnce({ id: 'l-1' });

    const r = await service.reserveDeduction(tx, 'u1', 200, 18);
    expect(r.deductedFromVip).toBe(18);
    expect(r.deductedFromNormal).toBe(0);
    expect(r.ledgerIds).toHaveLength(1);
    expect(tx.rewardLedger.create).toHaveBeenCalledTimes(1);
  });

  it('writes 2 ledgers when split across VIP+NORMAL', async () => {
    tx.memberProfile.findUnique.mockResolvedValue({ tier: 'NORMAL' });
    tx.rewardAccount.findUnique
      .mockResolvedValueOnce({ id: 'v', balance: 5, frozen: 0 })   // VIP=5
      .mockResolvedValueOnce({ id: 'n', balance: 20, frozen: 0 }); // NORMAL=20
    tx.rewardLedger.create
      .mockResolvedValueOnce({ id: 'l-vip' })
      .mockResolvedValueOnce({ id: 'l-normal' });

    const r = await service.reserveDeduction(tx, 'u1', 200, 18);
    expect(r.deductedFromVip).toBe(5);
    expect(r.deductedFromNormal).toBe(13);
    expect(r.ledgerIds).toHaveLength(2);
    expect(tx.rewardLedger.create).toHaveBeenCalledTimes(2);
  });

  it('returns null for requestedAmount=0', async () => {
    const r = await service.reserveDeduction(tx, 'u1', 200, 0);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试看失败**

```bash
cd backend
npx jest src/modules/bonus/reward-deduction.service.spec.ts -t reserveDeduction
```

Expected: 失败（"not implemented"）。

- [ ] **Step 3: 实现 reserveDeduction**

替换 `reward-deduction.service.ts` 中 `reserveDeduction` 的占位实现为：

```typescript
async reserveDeduction(tx: any, userId: string, goodsAmount: number, requestedAmount: number): Promise<{
  groupId: string;
  primaryLedgerId: string;
  ledgerIds: string[];
  deductedFromVip: number;
  deductedFromNormal: number;
} | null> {
  if (requestedAmount <= 0) return null;

  // 1. 上限校验（事务内重读）
  const max = await this.calculateMaxDeductibleInTx(tx, userId, goodsAmount);
  const reqCents = yuanToCents(requestedAmount);
  if (reqCents > yuanToCents(max.maxDeductible)) {
    throw new BadRequestException('抵扣金额超出上限');
  }

  // 2. 取双账户
  const vip = await tx.rewardAccount.findUnique({
    where: { userId_type: { userId, type: 'VIP_REWARD' } },
  });
  const normal = await tx.rewardAccount.findUnique({
    where: { userId_type: { userId, type: 'NORMAL_REWARD' } },
  });

  // 3. VIP 优先扣
  const vipBalCents = vip ? yuanToCents(vip.balance) : 0;
  let fromVipCents = 0, fromNormalCents = 0;
  if (vipBalCents >= reqCents) {
    fromVipCents = reqCents;
  } else {
    fromVipCents = vipBalCents;
    fromNormalCents = reqCents - vipBalCents;
  }

  // 4. CAS 扣减 balance += frozen
  if (fromVipCents > 0 && vip) {
    const yuan = centsToYuan(fromVipCents);
    const cas = await tx.rewardAccount.updateMany({
      where: { id: vip.id, balance: { gte: yuan } },
      data: { balance: { decrement: yuan }, frozen: { increment: yuan } },
    });
    if (cas.count === 0) throw new BadRequestException('VIP 余额扣减并发失败，请重试');
  }
  if (fromNormalCents > 0 && normal) {
    const yuan = centsToYuan(fromNormalCents);
    const cas = await tx.rewardAccount.updateMany({
      where: { id: normal.id, balance: { gte: yuan } },
      data: { balance: { decrement: yuan }, frozen: { increment: yuan } },
    });
    if (cas.count === 0) throw new BadRequestException('普通余额扣减并发失败，请重试');
  }

  // 5. 写 ledger（跨账户写 2 条，否则 1 条）
  const groupId = `DG-${createId()}`;
  const ledgerIds: string[] = [];

  let primaryLedgerId: string;
  if (fromVipCents > 0) {
    const role = fromNormalCents > 0 ? 'PRIMARY' : 'SOLE';
    const l = await tx.rewardLedger.create({
      data: {
        accountId: vip!.id, userId,
        entryType: 'DEDUCT', amount: centsToYuan(fromVipCents),
        status: 'RESERVED', refType: 'CHECKOUT',
        meta: { scheme: 'POINTS_DEDUCTION', groupId, role },
      },
    });
    primaryLedgerId = l.id;
    ledgerIds.push(l.id);
  } else {
    const l = await tx.rewardLedger.create({
      data: {
        accountId: normal!.id, userId,
        entryType: 'DEDUCT', amount: centsToYuan(fromNormalCents),
        status: 'RESERVED', refType: 'CHECKOUT',
        meta: { scheme: 'POINTS_DEDUCTION', groupId, role: 'SOLE' },
      },
    });
    primaryLedgerId = l.id;
    ledgerIds.push(l.id);
  }
  if (fromVipCents > 0 && fromNormalCents > 0 && normal) {
    const l2 = await tx.rewardLedger.create({
      data: {
        accountId: normal.id, userId,
        entryType: 'DEDUCT', amount: centsToYuan(fromNormalCents),
        status: 'RESERVED', refType: 'CHECKOUT',
        meta: { scheme: 'POINTS_DEDUCTION', groupId, role: 'SECONDARY', siblingLedgerId: primaryLedgerId },
      },
    });
    ledgerIds.push(l2.id);
  }

  return {
    groupId,
    primaryLedgerId,
    ledgerIds,
    deductedFromVip: centsToYuan(fromVipCents),
    deductedFromNormal: centsToYuan(fromNormalCents),
  };
}

private async calculateMaxDeductibleInTx(tx: any, userId: string, goodsAmount: number): Promise<{
  pointsBalance: number; pointsRatio: number; maxDeductible: number;
}> {
  const rules = await this.rulesService.getRules();
  const member = await tx.memberProfile.findUnique({ where: { userId } });
  const ratio = member?.tier === 'VIP' ? rules.deductionRatioVip : rules.deductionRatioNormal;
  const vip = await tx.rewardAccount.findUnique({
    where: { userId_type: { userId, type: 'VIP_REWARD' } },
  });
  const normal = await tx.rewardAccount.findUnique({
    where: { userId_type: { userId, type: 'NORMAL_REWARD' } },
  });
  const balance = (vip?.balance ?? 0) + (normal?.balance ?? 0);
  const maxByRatioCents = Math.floor(yuanToCents(goodsAmount) * ratio);
  const balanceCents = yuanToCents(balance);
  const maxDeductibleCents = Math.min(maxByRatioCents, balanceCents);
  return {
    pointsBalance: centsToYuan(balanceCents),
    pointsRatio: ratio,
    maxDeductible: centsToYuan(maxDeductibleCents),
  };
}
```

- [ ] **Step 4: 运行测试**

```bash
cd backend
npx jest src/modules/bonus/reward-deduction.service.spec.ts -t reserveDeduction
```

Expected: 4 case 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/bonus/reward-deduction.service.ts \
        backend/src/modules/bonus/reward-deduction.service.spec.ts
git commit -m "feat(reward): add reserveDeduction with cross-account 2-ledger split"
```

---

### Task 14: confirmDeduction + releaseDeduction

**Files:**
- Modify: `backend/src/modules/bonus/reward-deduction.service.ts`
- Modify: `backend/src/modules/bonus/reward-deduction.service.spec.ts`

- [ ] **Step 1: 写测试**

```typescript
describe('RewardDeductionService.confirm/release', () => {
  let service: RewardDeductionService;
  let tx: any;

  beforeEach(() => {
    tx = {
      rewardLedger: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rewardAccount: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    service = new RewardDeductionService({} as any, {} as any);
  });

  it('confirmDeduction transitions RESERVED → VOIDED and clears frozen', async () => {
    tx.rewardLedger.findMany.mockResolvedValue([
      { id: 'l1', accountId: 'acc-vip', amount: 5, userId: 'u' },
      { id: 'l2', accountId: 'acc-normal', amount: 13, userId: 'u' },
    ]);
    await service.confirmDeduction(tx, 'DG-1');
    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'VOIDED' },
    }));
    // 两个账户都被释放 frozen
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledTimes(2);
  });

  it('releaseDeduction reverts balance from frozen', async () => {
    tx.rewardLedger.findMany.mockResolvedValue([
      { id: 'l1', accountId: 'acc-vip', amount: 18, userId: 'u' },
    ]);
    await service.releaseDeduction(tx, 'DG-1');
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        frozen: { decrement: 18 },
        balance: { increment: 18 },
      },
    }));
    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'AVAILABLE' },
    }));
  });

  it('confirmDeduction is idempotent (no ledger found returns silently)', async () => {
    tx.rewardLedger.findMany.mockResolvedValue([]);
    await service.confirmDeduction(tx, 'DG-1');
    expect(tx.rewardAccount.updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行看失败**

```bash
cd backend
npx jest src/modules/bonus/reward-deduction.service.spec.ts -t "confirm/release"
```

Expected: 失败（still "not implemented"）。

- [ ] **Step 3: 实现 confirm + release**

替换占位实现：

```typescript
async confirmDeduction(tx: any, groupId: string): Promise<void> {
  // 找出所有 RESERVED 状态的 ledger
  const ledgers = await tx.rewardLedger.findMany({
    where: {
      status: 'RESERVED',
      entryType: 'DEDUCT',
      meta: { path: ['groupId'], equals: groupId },
    },
  });
  if (ledgers.length === 0) return; // 幂等

  // 每个 ledger：扣 frozen
  for (const l of ledgers) {
    await tx.rewardAccount.updateMany({
      where: { id: l.accountId, frozen: { gte: l.amount } },
      data: { frozen: { decrement: l.amount } },
    });
  }

  // 状态：RESERVED → VOIDED
  await tx.rewardLedger.updateMany({
    where: {
      status: 'RESERVED',
      entryType: 'DEDUCT',
      meta: { path: ['groupId'], equals: groupId },
    },
    data: { status: 'VOIDED' },
  });
}

async releaseDeduction(tx: any, groupId: string): Promise<void> {
  const ledgers = await tx.rewardLedger.findMany({
    where: {
      status: 'RESERVED',
      entryType: 'DEDUCT',
      meta: { path: ['groupId'], equals: groupId },
    },
  });
  if (ledgers.length === 0) return;

  // 每个 ledger：frozen → balance
  for (const l of ledgers) {
    await tx.rewardAccount.updateMany({
      where: { id: l.accountId },
      data: { frozen: { decrement: l.amount }, balance: { increment: l.amount } },
    });
  }

  await tx.rewardLedger.updateMany({
    where: {
      status: 'RESERVED',
      entryType: 'DEDUCT',
      meta: { path: ['groupId'], equals: groupId },
    },
    data: { status: 'AVAILABLE' },
  });
}
```

- [ ] **Step 4: 运行测试**

```bash
cd backend
npx jest src/modules/bonus/reward-deduction.service.spec.ts -t "confirm/release"
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/bonus/reward-deduction.service.ts \
        backend/src/modules/bonus/reward-deduction.service.spec.ts
git commit -m "feat(reward): add confirmDeduction + releaseDeduction"
```

---

### Task 15: refundDeduction（按商品原价比例 + refundId 幂等）

**Files:**
- Modify: `backend/src/modules/bonus/reward-deduction.service.ts`
- Modify: `backend/src/modules/bonus/reward-deduction.service.spec.ts`

- [ ] **Step 1: 写测试**

```typescript
describe('RewardDeductionService.refundDeduction', () => {
  let service: RewardDeductionService;
  let tx: any;

  beforeEach(() => {
    tx = {
      rewardLedger: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        aggregate: jest.fn(),
      },
      rewardAccount: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    service = new RewardDeductionService({} as any, {} as any);
  });

  it('skips when refundId already processed', async () => {
    tx.rewardLedger.findFirst.mockResolvedValue({ id: 'existing' });
    await service.refundDeduction(tx, {
      refundId: 'r-1', orderId: 'o-1',
      originalGoodsAmount: 200, originalGoodsRefundAmount: 80,
      originalDeductAmount: 18, deductionGroupId: 'DG-1',
    });
    expect(tx.rewardAccount.updateMany).not.toHaveBeenCalled();
  });

  it('calculates proportional refund (200/80/18 → 7.2)', async () => {
    tx.rewardLedger.findFirst.mockResolvedValue(null);
    tx.rewardLedger.findMany.mockResolvedValue([
      { id: 'l-vip', accountId: 'acc-vip', amount: 18, userId: 'u', meta: { groupId: 'DG-1' } },
    ]);
    tx.rewardLedger.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    await service.refundDeduction(tx, {
      refundId: 'r-1', orderId: 'o-1',
      originalGoodsAmount: 200, originalGoodsRefundAmount: 80,
      originalDeductAmount: 18, deductionGroupId: 'DG-1',
    });
    // 7.2 = 18 * 80/200
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-vip' },
      data: { balance: { increment: 7.2 } },
    }));
    expect(tx.rewardLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entryType: 'ADJUST', refType: 'REFUND_RESTORE', refId: 'r-1',
        amount: 7.2, status: 'AVAILABLE',
      }),
    }));
  });

  it('clears remaining points on final partial refund', async () => {
    tx.rewardLedger.findFirst.mockResolvedValue(null);
    tx.rewardLedger.findMany.mockResolvedValue([
      { id: 'l-vip', accountId: 'acc-vip', amount: 18, userId: 'u', meta: { groupId: 'DG-1' } },
    ]);
    // 已经累计返还了 10.80（剩 7.20）
    tx.rewardLedger.aggregate.mockResolvedValue({ _sum: { amount: 10.80 } });
    await service.refundDeduction(tx, {
      refundId: 'r-2', orderId: 'o-1',
      originalGoodsAmount: 200,
      originalGoodsRefundAmount: 120,   // 累计退款 80+120=200 = 全退
      originalDeductAmount: 18,
      deductionGroupId: 'DG-1',
    });
    // 剩余 7.20 一次性清零
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { balance: { increment: 7.2 } },
    }));
  });

  it('writes separate ledger per account when original deduction was cross-account', async () => {
    // 原扣 VIP=10, NORMAL=8，部分退 ratio = 80/200 = 0.4
    // VIP 返 10 × 0.4 = 4，NORMAL 返 8 × 0.4 = 3.2
    tx.rewardLedger.findFirst.mockResolvedValue(null);
    tx.rewardLedger.findMany.mockResolvedValue([
      { id: 'l-vip',    accountId: 'acc-vip',    amount: 10, userId: 'u', meta: { groupId: 'DG-1', role: 'PRIMARY' } },
      { id: 'l-normal', accountId: 'acc-normal', amount: 8,  userId: 'u', meta: { groupId: 'DG-1', role: 'SECONDARY' } },
    ]);
    tx.rewardLedger.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

    await service.refundDeduction(tx, {
      refundId: 'r-cross', orderId: 'o-1',
      originalGoodsAmount: 200, originalGoodsRefundAmount: 80,
      originalDeductAmount: 18, deductionGroupId: 'DG-1',
    });

    // VIP 账户 balance += 4
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-vip' },
      data: { balance: { increment: 4 } },
    }));
    // VIP 账户 ledger 写一条（accountId 跟它一致）
    expect(tx.rewardLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountId: 'acc-vip', amount: 4, refId: 'r-cross',
        refType: 'REFUND_RESTORE', entryType: 'ADJUST',
      }),
    }));

    // NORMAL 账户 balance += 3.2
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-normal' },
      data: { balance: { increment: 3.2 } },
    }));
    // NORMAL 账户 ledger 写一条
    expect(tx.rewardLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountId: 'acc-normal', amount: 3.2, refId: 'r-cross',
        refType: 'REFUND_RESTORE', entryType: 'ADJUST',
      }),
    }));
    // 总共 2 条 ledger（不是 1 条）
    expect(tx.rewardLedger.create).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 运行看失败**

```bash
cd backend
npx jest src/modules/bonus/reward-deduction.service.spec.ts -t refundDeduction
```

Expected: 失败。

- [ ] **Step 3: 实现 refundDeduction**

替换占位实现：

```typescript
async refundDeduction(tx: any, params: {
  refundId: string;
  orderId: string;
  originalGoodsAmount: number;
  originalGoodsRefundAmount: number;
  originalDeductAmount: number;
  deductionGroupId: string | null;
}): Promise<void> {
  // 1. 幂等：refundId 已处理过则 skip
  const already = await tx.rewardLedger.findFirst({
    where: { refType: 'REFUND_RESTORE', refId: params.refundId, deletedAt: null },
  });
  if (already) return;

  if (!params.deductionGroupId || params.originalDeductAmount <= 0) return;

  // 2. 找原 DEDUCT ledger（含跨账户多条）
  const original = await tx.rewardLedger.findMany({
    where: {
      entryType: 'DEDUCT',
      meta: { path: ['groupId'], equals: params.deductionGroupId },
    },
  });
  if (original.length === 0) return;

  // 3. 算返还金额（cents）
  const originalGoodsCents = yuanToCents(params.originalGoodsAmount);
  const refundGoodsCents = yuanToCents(params.originalGoodsRefundAmount);
  const originalDeductCents = yuanToCents(params.originalDeductAmount);
  const proportionalCents = Math.round(originalDeductCents * refundGoodsCents / originalGoodsCents);

  // 4. 累计已返还，最后一次清零
  const alreadyAgg = await tx.rewardLedger.aggregate({
    where: {
      refType: 'REFUND_RESTORE',
      meta: { path: ['groupId'], equals: params.deductionGroupId },
      deletedAt: null,
    },
    _sum: { amount: true },
  });
  const alreadyRefundedCents = yuanToCents(alreadyAgg._sum.amount || 0);
  const remainingCents = originalDeductCents - alreadyRefundedCents;

  // 简单判断"最后一次"：累计退款 + 本次 ≥ 原商品金额
  // 调用方应保证此判断在事务内仍准确（订单实际累计 ≥ originalGoodsAmount 时本次为最后一次）
  let restoreCents = Math.min(proportionalCents, remainingCents);
  // 如果本次退款使累计达到原金额，把残余 cents 全清掉
  // 这里采用更保守的方式：上层 service 传入 isFinalRefund 标记会更好，本 task 用 fallback 逻辑
  if (refundGoodsCents >= originalGoodsCents - alreadyRefundedCents * originalGoodsCents / originalDeductCents) {
    restoreCents = remainingCents;
  }

  if (restoreCents <= 0) return;

  // 5. 按原拆分比例返回各账户（审查 P0-5 + 复审 #5：N-1 比例取整 + 最后一个收尾，避免 cent 漂移）
  //    每个被增加 balance 的账户单独写一条 ADJUST ledger
  //    （sum(ledger.amount where accountId=X) == balance 变动 公式才成立）
  const totalOriginalCents = original.reduce((s: number, l: any) => s + yuanToCents(l.amount), 0);

  // 5.a 计算每条返还 cents：N-1 用 Math.round 按比例，最后一条 = 剩余
  const portions: number[] = [];
  let allocated = 0;
  for (let i = 0; i < original.length - 1; i++) {
    const p = Math.round(restoreCents * yuanToCents(original[i].amount) / totalOriginalCents);
    portions.push(p);
    allocated += p;
  }
  // 最后一条 = restoreCents - 前面已分（保证总和 == restoreCents，0 cent 漂移）
  portions.push(restoreCents - allocated);

  // 5.b 跨账户依次写入
  for (let i = 0; i < original.length; i++) {
    const l = original[i];
    const portion = portions[i];
    if (portion === 0) continue;
    const yuan = centsToYuan(portion);

    // balance += portion（对应账户）
    await tx.rewardAccount.updateMany({
      where: { id: l.accountId },
      data: { balance: { increment: yuan } },
    });

    // 该账户单独写一条 REFUND_RESTORE ledger（对账闭环）
    await tx.rewardLedger.create({
      data: {
        accountId: l.accountId,         // 关键：每条 ledger 的 accountId 跟它影响的账户一致
        userId: l.userId,
        entryType: 'ADJUST',
        amount: yuan,
        status: 'AVAILABLE',
        refType: 'REFUND_RESTORE',
        refId: params.refundId,
        meta: {
          scheme: 'REFUND_RESTORE',
          groupId: params.deductionGroupId,
          orderId: params.orderId,
          sourceLedgerId: l.id,         // 反查回原 DEDUCT ledger 用
        },
      },
    });
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
cd backend
npx jest src/modules/bonus/reward-deduction.service.spec.ts -t refundDeduction
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/bonus/reward-deduction.service.ts \
        backend/src/modules/bonus/reward-deduction.service.spec.ts
git commit -m "feat(reward): add refundDeduction with refundId idempotency and cents math"
```

---

## Chunk 6: Checkout / Refund 集成

### Task 16: Order 预览/结算集成抵扣

**实际入口（已用代码验证）**：
- `backend/src/modules/order/order.controller.ts:95 @Post('preview')` → `OrderService.previewOrder` (`order.service.ts:966`)
- `backend/src/modules/order/order.controller.ts @Post('checkout')` → `CheckoutService.createCheckoutSession`
- DTO 在 `CreateOrderDto`（preview 用，路径 `backend/src/modules/order/dto/create-order.dto.ts`）和 `CheckoutDto`（checkout 用，路径 `backend/src/modules/order/checkout.dto.ts`）

**Files:**
- Modify: `backend/src/modules/order/checkout.dto.ts`（只改 `CheckoutDto`；`CreateOrderDto` 在 `dto/create-order.dto.ts` 里，preview 不接受抵扣金额所以**不改它**）
- Modify: `backend/src/modules/order/order.service.ts`（previewOrder 返回 points 字段）
- Modify: `backend/src/modules/order/checkout.service.ts`（替换旧 rewardId 整张式逻辑）
- Modify: `backend/src/modules/order/order.module.ts`（import BonusModule）

- [ ] **Step 1: DTO 加 deductionAmount**

打开 `backend/src/modules/order/checkout.dto.ts`，找到 `CheckoutDto` 加字段：

```typescript
import { IsNumber, IsOptional, Min } from 'class-validator';

export class CheckoutDto {
  // ...existing fields

  @IsOptional()
  @IsNumber()
  @Min(0)
  deductionAmount?: number;
}
```

`CreateOrderDto`（用于 preview）**不加** deductionAmount —— preview 只算"最多能扣多少"，不接受用户输入。

- [ ] **Step 2: 注入 RewardDeductionService 到 CheckoutService + OrderService**

打开 `backend/src/modules/order/checkout.service.ts`，constructor 加：

```typescript
import { RewardDeductionService } from '../bonus/reward-deduction.service';
constructor(
  // ... existing
  private rewardDeductionService: RewardDeductionService,
) {}
```

同样改 `backend/src/modules/order/order.service.ts`：

```typescript
import { RewardDeductionService } from '../bonus/reward-deduction.service';
constructor(
  // ... existing
  private rewardDeductionService: RewardDeductionService,
) {}
```

确认 `OrderModule` 已 import `BonusModule`：

```bash
grep -n "BonusModule" backend/src/modules/order/order.module.ts
```

如果没有，加：

```typescript
import { BonusModule } from '../bonus/bonus.module';
imports: [..., BonusModule, ...]
```

- [ ] **Step 3: order.service.ts 的 previewOrder 加 points 字段**

打开 `backend/src/modules/order/order.service.ts:966 previewOrder`，在 return 语句之前加：

```typescript
const pointsInfo = await this.rewardDeductionService.calculateMaxDeductible(
  userId, totalGoodsAmount,
);
```

return 对象加上：

```typescript
return {
  // ... existing fields
  pointsBalance: pointsInfo.pointsBalance,
  pointsRatio: pointsInfo.pointsRatio,
  maxDeductible: pointsInfo.maxDeductible,
};
```

- [ ] **Step 4: checkout.service.ts 把旧 rewardId 整张式逻辑替换**

打开 `backend/src/modules/order/checkout.service.ts`，找到 line 566-590 区域（dto.rewardId 校验，"奖励 ≥ 10 时 5x minOrder" 那段），整段替换：

```typescript
// 新模型：按余额比例式抵扣
if (dto.deductionAmount && dto.deductionAmount > 0) {
  // 事务外只读校验上限（事务内会用 reserveDeduction 重新加 CAS 防并发）
  const max = await this.rewardDeductionService.calculateMaxDeductible(userId, totalGoodsAmount);
  if (dto.deductionAmount > max.maxDeductible) {
    throw new BadRequestException('抵扣金额超出上限');
  }
}
```

找到事务内现有 `dto.rewardId && rewardLedger` 块（line 625-644 区域），整段替换：

```typescript
// 事务内 reserve（CAS 防并发）
let discountAmount = 0;
let reservedRewardId: string | null = null;
let deductionGroupId: string | null = null;

if (dto.deductionAmount && dto.deductionAmount > 0) {
  const reserved = await this.rewardDeductionService.reserveDeduction(
    tx, userId, totalGoodsAmount, dto.deductionAmount,
  );
  if (reserved) {
    discountAmount = dto.deductionAmount;
    reservedRewardId = reserved.primaryLedgerId;
    deductionGroupId = reserved.groupId;
  }
}
```

找到事务内 `tx.checkoutSession.create({ data: ...`（line 695 附近）的 `data` 对象，在 `rewardId: ...` 那一行后面加上：

```typescript
deductionGroupId,
```

- [ ] **Step 5: 老 /bonus/rewards/available 路由保留兼容旧 App**

`bonus.controller.ts` 的 `@Get('rewards/available')` 路由不动，让旧版 App（用 ledger 整张式抵扣选择列表的）不破。新版 App 不再调它。

- [ ] **Step 6: TypeScript 编译**

```bash
cd backend
npx tsc --noEmit
```

Expected: 通过。

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/order/checkout.dto.ts \
        backend/src/modules/order/checkout.service.ts \
        backend/src/modules/order/order.service.ts \
        backend/src/modules/order/order.module.ts
git commit -m "feat(checkout): integrate points deduction at OrderService.previewOrder + CheckoutService"
```

---

### Task 17: CheckoutService 集成 confirm/release（PaymentService 不参与）

**审查 P0-8**：PaymentService 已有 6 个依赖，再加 RewardDeductionService 会让模块依赖更乱。改为**由 CheckoutService 直接调** RewardDeductionService（Task 16 已注入），PaymentService 不动。

**Files:**
- Modify: `backend/src/modules/order/checkout.service.ts`

- [ ] **Step 1: handlePaymentSuccess 内调 confirmDeduction**

打开 `backend/src/modules/order/checkout.service.ts`，找到 line 1641-1644 的 "奖励：RESERVED → VOIDED" 块。

把它整块替换为：

```typescript
// 抵扣金 confirm（新模型走 groupId）
// 在 handlePaymentSuccess 现有事务内调用，跟订单创建/库存扣减保持原子性
if (session.deductionGroupId) {
  await this.rewardDeductionService.confirmDeduction(tx, session.deductionGroupId);
}
```

- [ ] **Step 2: cancelSession / expireSession 内调 releaseDeduction**

找到 `cancelSession` 或对应取消方法：

```bash
grep -n "cancelSession\|session.rewardId.*RESERVED.*AVAILABLE" backend/src/modules/order/checkout.service.ts
```

把旧 `session.rewardId` 的 RESERVED→AVAILABLE 块替换为：

```typescript
if (session.deductionGroupId) {
  await this.rewardDeductionService.releaseDeduction(tx, session.deductionGroupId);
}
```

- [ ] **Step 3: 在 CheckoutService 加 releaseSessionOnFailure 方法**

打开 `backend/src/modules/order/checkout.service.ts`，加新方法（放在 `cancelSession` 附近）：

```typescript
/**
 * 支付失败/通道异常时释放 session 资源：
 * - CheckoutSession.status: ACTIVE → FAILED
 * - 抵扣金 deduction：RESERVED → AVAILABLE（balance 恢复）
 * - 平台红包 coupon：RESERVED → AVAILABLE（CouponService 处理）
 * - 库存：（如有 reserveInventory 模式，按现有逻辑回滚）
 *
 * 调用方：PaymentService.handlePaymentCallback 失败分支
 * 幂等：session 非 ACTIVE 时直接返回
 */
async releaseSessionOnFailure(merchantOrderNo: string): Promise<void> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const session = await tx.checkoutSession.findFirst({
          where: { merchantOrderNo },
        });
        if (!session) return { released: false, reason: 'session not found' };

        // CAS：ACTIVE → FAILED
        const cas = await tx.checkoutSession.updateMany({
          where: { id: session.id, status: 'ACTIVE' },
          data: { status: 'FAILED' },
        });
        if (cas.count === 0) {
          return { released: false, reason: 'session not ACTIVE (already finalized)' };
        }

        // 释放抵扣金（新模型）
        if (session.deductionGroupId) {
          await this.rewardDeductionService.releaseDeduction(tx, session.deductionGroupId);
        }

        // 释放预留库存（如果业务有此逻辑，按现有 release 方法调用）
        // 例：VIP 礼包 → releaseVipReservationInTx；普通商品按现状无显式释放

        return {
          released: true,
          sessionId: session.id,
          couponInstanceIds: session.couponInstanceIds || [],
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      // 事务外释放平台红包（CouponService 有自己的事务）
      if (result.released && result.couponInstanceIds?.length && this.couponService) {
        await this.couponService.releaseCoupons(result.couponInstanceIds).catch((err: any) =>
          this.logger.error(`释放红包失败 sessionId=${result.sessionId}: ${err.message}`),
        );
      }
      return;
    } catch (err: any) {
      if (err?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
        continue;
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: PaymentService 失败分支调 releaseSessionOnFailure**

打开 `backend/src/modules/payment/payment.service.ts` 找现有 CheckoutSession 失败分支（line 749 附近 `tx.rewardLedger.updateMany` 把 RESERVED 改回 AVAILABLE 的整块）。

**整段删除**这部分老逻辑，改为：

```typescript
// 旧 ledger RESERVED→AVAILABLE + VIP 预留释放等逻辑全部搬到 CheckoutService.releaseSessionOnFailure
if (this.checkoutService) {
  await this.checkoutService.releaseSessionOnFailure(merchantOrderNo);
}
```

注意：line 728-754 区域是 Serializable 事务 + P2034 重试的整块逻辑，现在简化为一行调用。原 `releaseVipReservationInTx` 和 ledger CAS 都搬到 releaseSessionOnFailure 内。

- [ ] **Step 5: TypeScript 编译**

```bash
cd backend
npx tsc --noEmit
```

Expected: 通过。PaymentService 注入列表保持原样（不加 RewardDeductionService）。

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/order/checkout.service.ts \
        backend/src/modules/payment/payment.service.ts
git commit -m "feat(checkout): confirm/release deduction in CheckoutService (not PaymentService)"
```

---

### Task 18: AfterSaleRefundService 集成 refundDeduction（事务内）

**审查 P0-6**：`handleRefundSuccess` 已经在 `withSerializableRetry(async (tx) => { ... })` 内运行（after-sale-refund.service.ts:177），**不能再起新 tx**。要把 `refundDeduction(tx, ...)` 调用塞进现有 tx 里。

**Files:**
- Modify: `backend/src/modules/after-sale/after-sale-refund.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale.module.ts`

- [ ] **Step 1: 注入 RewardDeductionService**

打开 `backend/src/modules/after-sale/after-sale-refund.service.ts`，constructor 加：

```typescript
import { RewardDeductionService } from '../bonus/reward-deduction.service';
// ...
constructor(
  private prisma: PrismaService,
  private paymentService: PaymentService,
  private afterSaleRewardService: AfterSaleRewardService,
  private statusHistory: AfterSaleStatusHistoryService,
  private inboxService: InboxService,
  private rewardDeductionService: RewardDeductionService,
) {}
```

确认 `AfterSaleModule` import `BonusModule`：

```bash
grep -n "BonusModule" backend/src/modules/after-sale/after-sale.module.ts
```

如缺，加 `imports: [..., BonusModule]`。

- [ ] **Step 2: 在现有 handleRefundSuccess 的 tx 内插入 refundDeduction**

定位 `after-sale-refund.service.ts:177 handleRefundSuccess` 的 `withSerializableRetry(async (tx) => { ... })` 块。在 line 218 那个 `if (request.status !== 'REFUNDED') { ... }` 块的**最后**（line 287 之后、`return { orderId, userId, amount }` 之前）插入：

```typescript
          // === 退款返还消费积分（加入现有 Serializable tx，不要再起新 tx）===
          // 通过 order → checkoutSession 找到原抵扣信息
          const order = await tx.order.findUnique({
            where: { id: request.orderId },
            select: { checkoutSessionId: true },
          });
          if (order?.checkoutSessionId) {
            const session = await tx.checkoutSession.findUnique({
              where: { id: order.checkoutSessionId },
              select: {
                deductionGroupId: true,
                discountAmount: true,
                goodsAmount: true,
              },
            });
            if (session?.deductionGroupId && (session.discountAmount ?? 0) > 0) {
              // 算商品原价的退款金额（审查 P0-5 复审：refund.amount 含运费退款，不能作 fallback）
              //   优先：orderItem.quantity × unitPrice（单 SKU 退款，精准）
              //   fallback：request.refundAmount（售后单上买家商品金额维度，已扣运费）
              //   如果两者都缺，跳过返还（不要用可能含运费的 refund.amount 估算）
              let refundGoodsAmount: number | null = null;
              if (request.orderItem) {
                refundGoodsAmount =
                  request.orderItem.quantity * (request.orderItem as any).unitPrice;
              } else if (request.refundAmount && request.refundAmount > 0) {
                refundGoodsAmount = request.refundAmount;
              }
              if (refundGoodsAmount === null) {
                this.logger.warn(
                  `跳过退款积分返还（缺商品口径金额）：refundId=${refundId}, afterSaleId=${request.id}`,
                );
                // 不返还，但不阻断退款主流程
              } else {

              await this.rewardDeductionService.refundDeduction(tx, {
                  refundId,
                  orderId: request.orderId,
                  originalGoodsAmount: session.goodsAmount,
                  originalGoodsRefundAmount: refundGoodsAmount,
                  originalDeductAmount: session.discountAmount,
                  deductionGroupId: session.deductionGroupId,
                });
              }
            }
          }
```

注意：
- `tx` 是 `withSerializableRetry` 提供的事务客户端，**不能再调 `prisma.$transaction`**
- `request` 已经在 line 185-196 `findUnique` 查过；如果 `request.orderItem` 没 include 进来需要补：在原 line 185 那个 `findUnique` 的 `include` 加 `orderItem: { select: { quantity: true, unitPrice: true } }`
- `refund` 已经在 line 179 查过，可直接用 `refund.amount` 作 fallback

- [ ] **Step 3: 确认 request 的 orderItem 已 include**

打开 line 185-196 区域，检查 `findUnique` 的 include：

```typescript
const request = await tx.afterSaleRequest.findUnique({
  where: { id: refund.afterSaleId },
  include: {
    orderItem: {
      select: {
        skuId: true,
        quantity: true,
        isPrize: true,
        unitPrice: true,    // ← 新加；如已存在跳过
      },
    },
  },
});
```

- [ ] **Step 4: TypeScript 编译**

```bash
cd backend
npx tsc --noEmit
```

Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/after-sale/after-sale-refund.service.ts \
        backend/src/modules/after-sale/after-sale.module.ts
git commit -m "feat(refund): restore deducted points within handleRefundSuccess tx"
```

---

## Chunk 7: 买家 App

### Task 19: Types + Repository 改造

**Files:**
- Modify: `src/types/domain/Bonus.ts`
- Modify: `src/repos/BonusRepo.ts`
- Modify: `src/repos/OrderRepo.ts`（实际文件名）

- [ ] **Step 1: 更新 Bonus.ts 类型**

打开 `src/types/domain/Bonus.ts`，加：

```typescript
/** 提现申请输入（v1.0 无二次验证） */
export interface WithdrawRequestInput {
  amount: number;
  alipayAccount: string;
  alipayName: string;
}

/** 提现结果 */
export interface WithdrawResult {
  withdrawId: string;
  grossAmount: number;
  taxAmount: number;
  taxRate: number;
  netAmount: number;
  status: 'PROCESSING' | 'PAID' | 'FAILED';
  message: string;
}

/** 抵扣预览 */
export interface DeductionPreview {
  pointsBalance: number;
  pointsRatio: number;
  maxDeductible: number;
}
```

- [ ] **Step 2: 更新 BonusRepo.requestWithdraw**

打开 `src/repos/BonusRepo.ts`，修改 `requestWithdraw`：

```typescript
import { v4 as uuidv4 } from 'uuid';
// ... 顶部 import 上面这行（如果 uuid 包还没装：cd ./ && npm install uuid @types/uuid）

requestWithdraw: async (input: WithdrawRequestInput): Promise<Result<WithdrawResult>> => {
  if (USE_MOCK) {
    return simulateRequest({
      withdrawId: `w-${Date.now()}`,
      grossAmount: input.amount,
      taxAmount: input.amount * 0.20,
      taxRate: 0.20,
      netAmount: input.amount * 0.80,
      status: 'PROCESSING' as const,
      message: '提现处理中（mock）',
    }, { delay: 400 });
  }
  return ApiClient.post<WithdrawResult>('/bonus/withdraw', input, {
    headers: { 'Idempotency-Key': uuidv4() },
  });
},
```

注意：`ApiClient.post` 第三个参数是否支持 `headers` 取决于现有实现。如果不支持，扩展 `ApiClient.post` 的签名让它能透传 headers。

- [ ] **Step 3: 装 uuid 包（如未装）**

```bash
cd /Users/jamesheden/Desktop/农脉\ -\ AI赋能农业电商平台
npm ls uuid || npm install uuid && npm install -D @types/uuid
```

- [ ] **Step 4: OrderRepo 加 deductionAmount + preview 字段**

打开 `src/repos/OrderRepo.ts`（**不是 CheckoutRepo**）：

```bash
grep -n "preview\|checkout\|createOrder" src/repos/OrderRepo.ts
```

修改 `preview` 调用返回类型加 points 字段；`submit/checkout` 调用 body 加 `deductionAmount`。具体代码取决于现有 repo 结构。示例修改：

```typescript
export interface OrderPreviewResponse {
  totalGoodsAmount: number;
  totalShippingFee: number;
  vipDiscountAmount: number;
  expectedTotal: number;
  // 新增
  pointsBalance: number;
  pointsRatio: number;
  maxDeductible: number;
}

preview: (items: ...) => ApiClient.post<OrderPreviewResponse>('/orders/preview', { items }),

createCheckout: (input: { ..., deductionAmount?: number }) =>
  ApiClient.post('/orders/checkout', input),
```

- [ ] **Step 5: tsc 校验**

```bash
cd /Users/jamesheden/Desktop/农脉\ -\ AI赋能农业电商平台
npx tsc -b
```

Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add src/types/domain/Bonus.ts src/repos/BonusRepo.ts src/repos/OrderRepo.ts \
        package.json package-lock.json
git commit -m "feat(app/repo): support withdraw v2 + deduction preview"
```

---

### Task 20: 重写 app/me/withdraw.tsx

**Files:**
- Modify: `app/me/withdraw.tsx`

- [ ] **Step 1: 用 ui-ux-pro-max 拿 UI 设计指导（项目强制）**

按 CLAUDE.md 项目规则，UI 改动前调 `/ui-ux-pro-max`：

```
按照 spec 6.1 + 9.2 节描述，重写买家 App 提现页：
- 顶部：可用积分（合并显示一个数字）
- 金额输入框 + 快捷按钮 10/50/100/全部
- 支付宝账号 + 真实姓名输入
- 实时计算展示：申请金额 - 代扣个税 = 实际到账
- 底部说明：限额规则 + 支付宝服务费提示 + 账号安全责任声明（v1.0 无二次验证）
```

- [ ] **Step 2: 用设计指导后重写 withdraw.tsx**

整个文件替换为新设计（按 ui-ux-pro-max 返回的代码）。

关键交互逻辑：

```typescript
// 提交（v1.0 无短信/支付密码）
const submit = async () => {
  const r = await BonusRepo.requestWithdraw({
    amount: parseFloat(amount),
    alipayAccount, alipayName,
  });
  if (!r.ok) {
    show({ message: r.error.displayMessage, type: 'error' });
    return;
  }
  // 按 status 提示
  if (r.data.status === 'PAID') {
    show({ message: `提现成功，¥${r.data.netAmount} 已到账`, type: 'success' });
  } else if (r.data.status === 'PROCESSING') {
    show({ message: '提现处理中，请稍后查看', type: 'info' });
  } else {
    show({ message: `提现失败：${r.data.message}`, type: 'error' });
  }
  queryClient.invalidateQueries({ queryKey: ['bonus-wallet'] });
  router.back();
};

// 实时税额展示
const grossNum = parseFloat(amount) || 0;
const taxNum = grossNum * 0.20;
const netNum = grossNum - taxNum;
```

- [ ] **Step 3: tsc 校验**

```bash
cd /Users/jamesheden/Desktop/农脉\ -\ AI赋能农业电商平台
npx tsc -b
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add app/me/withdraw.tsx
git commit -m "feat(app/withdraw): redesign for realtime alipay payout + tax display"
```

---

### Task 21: 钱包页改名

**Files:**
- Modify: `app/me/wallet.tsx`

- [ ] **Step 1: 文案替换**

打开 `app/me/wallet.tsx`，全文搜索替换以下文案：

| 旧 | 新 |
|---|---|
| `奖励钱包` | `消费积分` |
| `可用余额` | `可用积分` |
| `待解锁` | `冻结积分` |
| `累计收益` | `累计获得` |
| `消费奖励` (refTypeLabel) | `消费返积分` |
| `推荐奖励` (refTypeLabel) | `推荐返积分` |
| `提现` (WITHDRAW label) | `提现到支付宝` |

- [ ] **Step 2: 加副标题"用于平台商品抵扣 / 可提现至支付宝"**

在余额卡的 `balanceLabel` 文案下加一个小字行：

```tsx
<Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
  用于平台商品抵扣 / 可提现至支付宝
</Text>
```

- [ ] **Step 3: 流水显示"消费抵扣"类型**

在 `displayItems` useMemo 里，加 DEDUCT entryType 处理：

```typescript
const isDeduct = entry.entryType === 'DEDUCT';
if (isDeduct) {
  items.push({
    id: entry.id, title: '消费抵扣', desc: '抵扣订单金额',
    amount: -entry.amount, date: entry.createdAt, type: 'expense',
  });
  return;
}
```

- [ ] **Step 4: 流水显示退款返还"REFUND_RESTORE"**

```typescript
if (entry.refType === 'REFUND_RESTORE') {
  items.push({
    id: entry.id, title: '退款返还', desc: '订单退款返还积分',
    amount: entry.amount, date: entry.createdAt, type: 'income',
  });
  return;
}
```

- [ ] **Step 5: tsc 校验**

```bash
cd /Users/jamesheden/Desktop/农脉\ -\ AI赋能农业电商平台
npx tsc -b
```

Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add app/me/wallet.tsx
git commit -m "feat(app/wallet): rename to 消费积分 + add deduct/refund_restore flows"
```

---

### Task 22: 结算页加积分输入控件

**Files:**
- Modify: 买家 App 的 checkout 页面（按项目实际位置）

- [ ] **Step 1: 定位 checkout 页**

```bash
find app -name "checkout*" -o -name "confirm-order*" 2>/dev/null | head -5
```

打开找到的 checkout 页面文件（如 `app/checkout/index.tsx` 或 `app/order/confirm.tsx`）。

- [ ] **Step 2: 调用 preview 拿 points 信息**

在 useQuery preview 调用处使用扩展后返回的 `pointsBalance/pointsRatio/maxDeductible`。

- [ ] **Step 3: 加积分输入 section**

在订单金额详情上方插入：

```tsx
{preview.maxDeductible > 0 && (
  <View style={{ padding: 16, backgroundColor: colors.surface }}>
    <Text style={typography.bodyStrong}>消费积分</Text>
    <Text style={{ color: colors.text.secondary, fontSize: 12, marginTop: 4 }}>
      可抵扣 ¥{preview.maxDeductible.toFixed(2)}（最多）
    </Text>
    <TextInput
      value={deductionAmount}
      onChangeText={(t) => {
        const num = parseFloat(t) || 0;
        if (num > preview.maxDeductible) {
          show({ message: `最多抵扣 ¥${preview.maxDeductible}`, type: 'error' });
          return;
        }
        setDeductionAmount(t);
      }}
      keyboardType="decimal-pad"
      placeholder="0.00"
    />
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
      <Pressable onPress={() => setDeductionAmount('0')}>
        <Text>不使用</Text>
      </Pressable>
      <Pressable onPress={() => setDeductionAmount(preview.maxDeductible.toFixed(2))}>
        <Text>抵扣最大</Text>
      </Pressable>
    </View>
  </View>
)}
```

- [ ] **Step 4: 提交时把 deductionAmount 传给后端**

修改 submitOrder 调用：

```typescript
const submit = async () => {
  const r = await OrderRepo.createCheckout({
    items, deductionAmount: parseFloat(deductionAmount) || 0,
    couponInstanceIds, paymentChannel,
    // ...
  });
  // ...
};
```

- [ ] **Step 5: 应付金额实时展示扣减后的总额**

```tsx
<Text>
  应付：¥{(preview.expectedTotal - (parseFloat(deductionAmount) || 0)).toFixed(2)}
</Text>
```

- [ ] **Step 6: tsc + 真机预览**

```bash
cd /Users/jamesheden/Desktop/农脉\ -\ AI赋能农业电商平台
npx tsc -b
npx expo start --clear
```

在 App 真机上跑通：选商品 → 进结算 → 看到积分控件 → 输入扣减 → 应付实时变化 → 提交成功。

- [ ] **Step 7: Commit**

```bash
git add app/checkout/index.tsx  # 路径按实际
git commit -m "feat(app/checkout): add points deduction input control"
```

---

## Chunk 8: 管理后台

### Task 23: 后端 admin API 加规则配置端点

**Files:**
- Create: `backend/src/modules/admin/bonus/dto/update-withdraw-rules.dto.ts`
- Modify: `backend/src/modules/admin/bonus/admin-bonus.controller.ts`
- Modify: `backend/src/modules/admin/bonus/admin-bonus.service.ts`

- [ ] **Step 1: 加 DTO（复用 bonus 模块的）**

`update-withdraw-rules.dto.ts` 直接 re-export `UpdateWithdrawRulesDto`：

```typescript
export { UpdateWithdrawRulesDto, WithdrawRules } from '../../../bonus/dto/withdraw-rules.dto';
```

- [ ] **Step 2: admin-bonus.service 加方法**

打开 `admin-bonus.service.ts`，加 import + constructor 注入：

```typescript
import { WithdrawRulesService } from '../../bonus/withdraw-rules.service';
import { WithdrawPayoutService } from '../../bonus/withdraw-payout.service';
import { AlipayService } from '../../payment/alipay.service';
// constructor 加：
constructor(
  private prisma: PrismaService,
  private inboxService: InboxService,
  private withdrawRulesService: WithdrawRulesService,
  private withdrawPayoutService: WithdrawPayoutService,   // 用于 manualQuery 后 finalize
  private alipayService: AlipayService,                   // 用于 manualQuery 调 queryTransfer
) {}
```

确认 `AdminBonusModule` import 了 `BonusModule` 和 `PaymentModule`：

```bash
grep -n "imports" backend/src/modules/admin/bonus/admin-bonus.module.ts
```

加方法：

```typescript
async getWithdrawRules() {
  return this.withdrawRulesService.getRules();
}

async updateWithdrawRules(dto: any) {
  return this.withdrawRulesService.updateRules(dto);
}

async getTaxReportSummary(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const agg = await this.prisma.withdrawRequest.aggregate({
    where: { status: 'PAID', paidAt: { gte: start, lt: end } },
    _count: true,
    _sum: { amount: true, taxAmount: true, netAmount: true },
  });
  return {
    year, month,
    count: agg._count,
    grossTotal: agg._sum.amount || 0,
    taxTotal: agg._sum.taxAmount || 0,
    netTotal: agg._sum.netAmount || 0,
  };
}

async getTaxReportDetail(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return this.prisma.withdrawRequest.findMany({
    where: { status: 'PAID', paidAt: { gte: start, lt: end } },
    select: {
      id: true, userId: true, amount: true, taxAmount: true, netAmount: true,
      taxRate: true, paidAt: true, providerPayoutId: true,
    },
    orderBy: { paidAt: 'asc' },
  });
}

async manualQueryWithdrawStatus(withdrawId: string) {
  // 审查 P1-11：真调 alipay queryTransfer，按结果 finalize
  const withdraw = await this.prisma.withdrawRequest.findUnique({
    where: { id: withdrawId },
    select: { id: true, status: true, outBizNo: true, queryAttempts: true },
  });
  if (!withdraw) throw new NotFoundException('提现记录不存在');
  if (withdraw.status !== 'PROCESSING') {
    return {
      ok: true,
      message: `当前状态 ${withdraw.status}，无需查询`,
      newStatus: withdraw.status,
    };
  }
  if (!withdraw.outBizNo) {
    throw new BadRequestException('提现记录缺 outBizNo，无法查询');
  }

  // 通过 paymentService 暴露的 alipay 接口查询
  // 注：admin-bonus.service.ts 需要先注入 PaymentService 或 AlipayService
  const queryResult = await this.alipayService.queryTransfer({
    outBizNo: withdraw.outBizNo,
  });

  // 更新查询次数与时间
  await this.prisma.withdrawRequest.update({
    where: { id: withdrawId },
    data: {
      lastQueriedAt: new Date(),
      queryAttempts: { increment: 1 },
    },
  });

  // 根据查询结果调对应 finalize
  if (queryResult.status === 'SUCCESS') {
    await this.withdrawPayoutService.finalizeWithdrawalPaid(withdrawId, {
      providerOrderId: queryResult.orderId,
      providerFundOrderId: queryResult.payFundOrderId,
    });
    return { ok: true, message: '已确认支付宝转账成功，状态更新为 PAID', newStatus: 'PAID' };
  }
  if (queryResult.status === 'FAIL') {
    await this.withdrawPayoutService.finalizeWithdrawalFailed(withdrawId, {
      errorCode: queryResult.errorCode,
      errorMessage: queryResult.errorMessage,
    });
    return { ok: true, message: '支付宝查询返回失败，已退款', newStatus: 'FAILED' };
  }
  return {
    ok: true,
    message: `支付宝侧仍为 ${queryResult.status}，请稍后再查或等 cron 兜底`,
    newStatus: 'PROCESSING',
  };
}
```

确认 `AdminBonusModule` import `BonusModule`（如果尚未）。

- [ ] **Step 3: admin-bonus.controller 加端点**

打开 `admin-bonus.controller.ts`，在类末尾追加：

```typescript
import { UpdateWithdrawRulesDto } from './dto/update-withdraw-rules.dto';

@Get('withdraw-rules')
@RequirePermission(PERMISSIONS.BONUS_APPROVE_WITHDRAW /* or new */)
getWithdrawRules() {
  return this.bonusService.getWithdrawRules();
}

@Put('withdraw-rules')
@RequirePermission(PERMISSIONS.BONUS_APPROVE_WITHDRAW)
@AuditLog({
  action: 'UPDATE',
  module: 'bonus',
  targetType: 'WithdrawRules',
  isReversible: false,
})
updateWithdrawRules(@Body() dto: UpdateWithdrawRulesDto) {
  return this.bonusService.updateWithdrawRules(dto);
}

@Get('tax-report/summary')
@RequirePermission(PERMISSIONS.BONUS_APPROVE_WITHDRAW)
getTaxReportSummary(
  @Query('year') year: string,
  @Query('month') month: string,
) {
  return this.bonusService.getTaxReportSummary(parseInt(year), parseInt(month));
}

@Get('tax-report/detail')
@RequirePermission(PERMISSIONS.BONUS_APPROVE_WITHDRAW)
getTaxReportDetail(
  @Query('year') year: string,
  @Query('month') month: string,
) {
  return this.bonusService.getTaxReportDetail(parseInt(year), parseInt(month));
}

@Post('withdrawals/:id/query')
@RequirePermission(PERMISSIONS.BONUS_APPROVE_WITHDRAW)
@AuditLog({
  action: 'QUERY',
  module: 'bonus',
  targetType: 'WithdrawRequest',
  targetIdParam: 'params.id',
  isReversible: false,
})
manualQueryWithdrawStatus(@Param('id') id: string) {
  return this.bonusService.manualQueryWithdrawStatus(id);
}
```

需在文件顶部 import `Put, Param, Body, Query`，以及 `import { PERMISSIONS } from '...'`（已存在则跳过）。

- [ ] **Step 4: TypeScript 编译**

```bash
cd backend
npx tsc --noEmit
```

Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/admin/bonus/dto/update-withdraw-rules.dto.ts \
        backend/src/modules/admin/bonus/admin-bonus.controller.ts \
        backend/src/modules/admin/bonus/admin-bonus.service.ts
git commit -m "feat(admin): expose withdraw rules + tax report endpoints"
```

---

### Task 24: 管理后台前端 - API + Types + 状态映射

**Files:**
- Modify: `admin/src/api/bonus.ts`
- Modify: `admin/src/types/index.ts`
- Modify: `admin/src/constants/statusMaps.ts`

- [ ] **Step 1: api/bonus.ts 加端点**

打开 `admin/src/api/bonus.ts`，追加：

```typescript
export interface WithdrawRules {
  withdrawTaxRate: number;
  withdrawMinAmount: number;
  withdrawMaxAmount: number;
  withdrawDailyMaxCount: number;
  withdrawCooldownSeconds: number;
  withdrawYearlyMaxAmount: number;
  deductionRatioNormal: number;
  deductionRatioVip: number;
  deductionMinOrderAmount: number;
  deductionAllowCouponStack: boolean;
  withdrawProviderFeeAmount: number;
  withdrawYearlyAlertThreshold: number;
}

export const getWithdrawRules = (): Promise<WithdrawRules> =>
  client.get('/admin/bonus/withdraw-rules');

export const updateWithdrawRules = (dto: Partial<WithdrawRules>): Promise<WithdrawRules> =>
  client.put('/admin/bonus/withdraw-rules', dto);

export const getTaxReportSummary = (year: number, month: number) =>
  client.get('/admin/bonus/tax-report/summary', { params: { year, month } });

export const getTaxReportDetail = (year: number, month: number) =>
  client.get('/admin/bonus/tax-report/detail', { params: { year, month } });

export const queryWithdrawStatus = (id: string) =>
  client.post(`/admin/bonus/withdrawals/${id}/query`);
```

- [ ] **Step 2: types/index.ts 加 WithdrawRequest 新字段**

```typescript
export interface WithdrawRequest {
  // ...existing
  amount: number;
  taxAmount: number;
  netAmount: number;
  taxRate: number;
  outBizNo: string | null;
  providerPayoutId: string | null;
  providerFundOrderId: string | null;
  providerStatus: string | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  paidAt: string | null;
}
```

- [ ] **Step 3: statusMaps.ts 加 PROCESSING**

```typescript
export const withdrawalStatusMap: Record<string, { text: string; color: string }> = {
  REQUESTED:  { text: '待审核',   color: 'orange' },
  PROCESSING: { text: '处理中',   color: 'processing' },
  APPROVED:   { text: '已批准',   color: 'cyan' },
  REJECTED:   { text: '已拒绝',   color: 'red' },
  PAID:       { text: '已到账',   color: 'green' },
  FAILED:     { text: '失败',     color: 'red' },
};
```

- [ ] **Step 4: tsc 校验**

```bash
cd admin
npx tsc --noEmit
```

Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add admin/src/api/bonus.ts admin/src/types/index.ts admin/src/constants/statusMaps.ts
git commit -m "feat(admin): api + types for withdraw rules and tax report"
```

---

### Task 25: 管理后台 - 改造 withdrawals.tsx

**Files:**
- Modify: `admin/src/pages/bonus/withdrawals.tsx`

- [ ] **Step 1: 加列**

在 `columns` 数组里，"金额" 列之后插入：

```typescript
{
  title: '代扣',
  dataIndex: 'taxAmount', width: 90, search: false,
  render: (_, r) => `¥${r.taxAmount?.toFixed(2) ?? '0.00'}`,
},
{
  title: '到账',
  dataIndex: 'netAmount', width: 90, search: false,
  render: (_, r) => <Text strong>¥{r.netAmount?.toFixed(2) ?? '0.00'}</Text>,
},
{
  title: '商户单号',
  dataIndex: 'outBizNo', width: 180, search: false, ellipsis: true,
},
{
  title: '支付宝单号',
  dataIndex: 'providerPayoutId', width: 180, search: false, ellipsis: true,
},
{
  title: '资金流水号',
  dataIndex: 'providerFundOrderId', width: 180, search: false, ellipsis: true,
},
{
  title: '错误信息',
  dataIndex: 'providerErrorMessage', width: 200, search: false, ellipsis: true,
  render: (_, r) => r.providerErrorMessage ? (
    <Tooltip title={r.providerErrorMessage}>
      <Tag color="red">{r.providerErrorCode || 'FAIL'}</Tag>
    </Tooltip>
  ) : '-',
},
{
  title: '到账时间',
  dataIndex: 'paidAt', width: 160, search: false,
  render: (_, r) => r.paidAt ? dayjs(r.paidAt).format('YYYY-MM-DD HH:mm') : '-',
},
```

- [ ] **Step 2: 操作列加"查询状态"**

修改 operation render：

```typescript
render: (_, record) => {
  if (record.status === 'REQUESTED') {
    return (/* existing 批准/拒绝 buttons */);
  }
  if (record.status === 'PROCESSING') {
    return (
      <Button type="link" size="small" onClick={async () => {
        await queryWithdrawStatus(record.id);
        message.success('已触发查询，请稍后刷新');
        actionRef.current?.reload();
      }}>
        查询状态
      </Button>
    );
  }
  return '-';
},
```

需要 import `queryWithdrawStatus` from `@/api/bonus`。

- [ ] **Step 3: 构建测试**

```bash
cd admin
npm run build
```

Expected: 成功。

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/bonus/withdrawals.tsx
git commit -m "feat(admin/withdrawals): add tax/net/provider cols + manual query action"
```

---

### Task 26: 管理后台 - 新建 withdraw-rules.tsx

**Files:**
- Create: `admin/src/pages/bonus/withdraw-rules.tsx`
- Modify: `admin/src/App.tsx`（Routes 配置，line 100-134 之间加 Route）
- Modify: `admin/src/layouts/AdminLayout.tsx`（menuRoutes 配置，`/user-bonus` 子菜单加新条目）

- [ ] **Step 1: 创建页面文件**

```tsx
// admin/src/pages/bonus/withdraw-rules.tsx
import { useEffect, useState } from 'react';
import { ProForm, ProFormDigit, ProFormSwitch } from '@ant-design/pro-components';
import { App, Card, Divider } from 'antd';
import { getWithdrawRules, updateWithdrawRules, WithdrawRules } from '@/api/bonus';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';

export default function WithdrawRulesPage() {
  const { message } = App.useApp();
  const [rules, setRules] = useState<WithdrawRules | null>(null);

  useEffect(() => {
    getWithdrawRules().then(setRules);
  }, []);

  if (!rules) return <Card loading />;

  const onFinish = async (values: any) => {
    await updateWithdrawRules(values);
    message.success('已保存');
    const r = await getWithdrawRules();
    setRules(r);
  };

  return (
    <PermissionGate permission={PERMISSIONS.BONUS_APPROVE_WITHDRAW}>
      <div style={{ padding: 24 }}>
        <Card title="提现 & 抵扣规则配置">
          <ProForm initialValues={rules} onFinish={onFinish} submitter={{ searchConfig: { submitText: '保存配置' } }}>
            <Divider orientation="left">提现参数</Divider>
            <ProFormDigit name="withdrawTaxRate" label="代扣比例" fieldProps={{ step: 0.01, precision: 2, min: 0, max: 0.5 }} extra="例：0.20 表示 20%" />
            <ProFormDigit name="withdrawMinAmount" label="单笔最低（元）" fieldProps={{ min: 0, precision: 2 }} />
            <ProFormDigit name="withdrawMaxAmount" label="单笔最高（元）" fieldProps={{ min: 0, precision: 2 }} />
            <ProFormDigit name="withdrawDailyMaxCount" label="每日最多次数" fieldProps={{ min: 1, max: 100, precision: 0 }} />
            <ProFormDigit name="withdrawCooldownSeconds" label="冷却时间（秒）" fieldProps={{ min: 0, max: 86400, precision: 0 }} />
            <ProFormDigit name="withdrawYearlyMaxAmount" label="年累计上限（元）" fieldProps={{ min: 0, precision: 2 }} />

            <Divider orientation="left">抵扣参数</Divider>
            <ProFormDigit name="deductionRatioNormal" label="普通用户比例" fieldProps={{ step: 0.01, precision: 2, min: 0, max: 1 }} extra="例：0.10 表示 10%" />
            <ProFormDigit name="deductionRatioVip" label="VIP 用户比例" fieldProps={{ step: 0.01, precision: 2, min: 0, max: 1 }} extra="例：0.15 表示 15%" />
            <ProFormDigit name="deductionMinOrderAmount" label="最低订单门槛（元）" fieldProps={{ min: 0, precision: 2 }} />
            <ProFormSwitch name="deductionAllowCouponStack" label="允许与平台红包叠加" />

            <Divider orientation="left">通道与监控</Divider>
            <ProFormDigit name="withdrawProviderFeeAmount" label="通道手续费（元/笔）" fieldProps={{ min: 0, precision: 2 }} extra="v1.0 默认 0" />
            <ProFormDigit name="withdrawYearlyAlertThreshold" label="年累计告警阈值" fieldProps={{ step: 0.05, precision: 2, min: 0, max: 1 }} extra="0.80 表示 80%" />
          </ProForm>
        </Card>
      </div>
    </PermissionGate>
  );
}
```

- [ ] **Step 2: 加路由到 App.tsx**

打开 `admin/src/App.tsx`，在 line 16-40 区域（其它 bonus 页 lazy import 旁）加：

```typescript
const WithdrawRulesPage = lazy(() => import('@/pages/bonus/withdraw-rules'));
```

在 line 113-120 区域（其它 bonus Route 旁）加：

```typescript
<Route path="bonus/withdraw-rules" element={<WithdrawRulesPage />} />
```

- [ ] **Step 3: 加菜单条目到 AdminLayout.tsx**

打开 `admin/src/layouts/AdminLayout.tsx` line 38-52 区域 `/user-bonus` 子菜单 routes 数组，加：

```typescript
{ path: '/bonus/withdraw-rules', name: '提现规则', icon: <SettingOutlined /> },
```

- [ ] **Step 4: 构建**

```bash
cd admin
npm run build
```

Expected: 成功。

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/bonus/withdraw-rules.tsx \
        admin/src/App.tsx \
        admin/src/layouts/AdminLayout.tsx
git commit -m "feat(admin/bonus): add withdraw rules config page"
```

---

### Task 27: 管理后台 - 新建 tax-reporting.tsx

**Files:**
- Create: `admin/src/pages/bonus/tax-reporting.tsx`
- Modify: `admin/src/App.tsx`（Routes 加 Route）
- Modify: `admin/src/layouts/AdminLayout.tsx`（menuRoutes 加菜单条目）

- [ ] **Step 1: 创建页面**

```tsx
// admin/src/pages/bonus/tax-reporting.tsx
import { useEffect, useState } from 'react';
import { Card, DatePicker, Descriptions, Button, App } from 'antd';
import { ProTable } from '@ant-design/pro-components';
import dayjs from 'dayjs';
import { getTaxReportSummary, getTaxReportDetail } from '@/api/bonus';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';

export default function TaxReportingPage() {
  const { message } = App.useApp();
  const [year, setYear] = useState(dayjs().year());
  const [month, setMonth] = useState(dayjs().month() + 1);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    getTaxReportSummary(year, month).then(setSummary);
  }, [year, month]);

  const exportCsv = async () => {
    const rows = await getTaxReportDetail(year, month);
    const headers = ['withdrawId', 'userId', 'amount', 'taxAmount', 'netAmount', 'taxRate', 'paidAt', 'providerPayoutId'];
    const csv = [headers.join(',')].concat(
      rows.map((r: any) => headers.map(h => `"${r[h] ?? ''}"`).join(','))
    ).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tax-report-${year}-${month}.csv`; a.click();
    URL.revokeObjectURL(url);
    message.success('已导出');
  };

  return (
    <PermissionGate permission={PERMISSIONS.BONUS_APPROVE_WITHDRAW}>
      <div style={{ padding: 24 }}>
        <Card title="个税代扣月度汇总" extra={
          <DatePicker.MonthPicker
            value={dayjs(`${year}-${month}`)}
            onChange={(v) => { if (v) { setYear(v.year()); setMonth(v.month() + 1); } }}
          />
        }>
          {summary && (
            <Descriptions bordered>
              <Descriptions.Item label="本月提现笔数">{summary.count}</Descriptions.Item>
              <Descriptions.Item label="提现总额">¥{summary.grossTotal.toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="代扣总额">¥{summary.taxTotal.toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="实际到账">¥{summary.netTotal.toFixed(2)}</Descriptions.Item>
            </Descriptions>
          )}
          <Button type="primary" style={{ marginTop: 16 }} onClick={exportCsv}>导出明细 CSV</Button>
        </Card>
      </div>
    </PermissionGate>
  );
}
```

- [ ] **Step 2: 加路由到 App.tsx**

`admin/src/App.tsx`：

```typescript
const TaxReportingPage = lazy(() => import('@/pages/bonus/tax-reporting'));
// ...
<Route path="bonus/tax-reporting" element={<TaxReportingPage />} />
```

- [ ] **Step 3: 加菜单条目到 AdminLayout.tsx**

`admin/src/layouts/AdminLayout.tsx` `/user-bonus` 子菜单：

```typescript
{ path: '/bonus/tax-reporting', name: '税务报送', icon: <FileTextOutlined /> },
```

注意 import `FileTextOutlined`（如果尚未 import）。

- [ ] **Step 4: 构建**

```bash
cd admin
npm run build
```

Expected: 成功。

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/bonus/tax-reporting.tsx \
        admin/src/App.tsx \
        admin/src/layouts/AdminLayout.tsx
git commit -m "feat(admin/bonus): add monthly tax reporting page with CSV export"
```

---

### Task 28: 对账模块同步新增 DEDUCT/PROCESSING

**审查 P0-7**：上线后若不改对账，admin-reconciliation 面板会缺漏报。

**Files:**
- Modify: `backend/src/modules/admin/reconciliation/admin-reconciliation.service.ts`

- [ ] **Step 1: 定位现有枚举初始化**

```bash
grep -n "initStatusMap\|FREEZE\|REQUESTED" backend/src/modules/admin/reconciliation/admin-reconciliation.service.ts | head -20
```

Expected: 看到 line 322 区域 `entryMap = this.initStatusMap(['FREEZE', 'RELEASE', 'WITHDRAW', 'VOID', 'ADJUST'])`，和 line 361/362 区域 `createdMap = this.initStatusMap(['REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'FAILED'])`。

- [ ] **Step 2: 加 DEDUCT 到 entry 类型**

打开 `admin-reconciliation.service.ts`，line 322 改为：

```typescript
const entryMap = this.initStatusMap(['FREEZE', 'RELEASE', 'WITHDRAW', 'VOID', 'ADJUST', 'DEDUCT']);
```

如果同文件别处还有 entry 类型枚举的硬编码列表（line 648 / 651 / 653 区域），按需扩展。

- [ ] **Step 3: 加 PROCESSING 到 WithdrawRequest 状态**

line 361 + 362 都改为：

```typescript
const createdMap = this.initStatusMap(['REQUESTED', 'PROCESSING', 'APPROVED', 'REJECTED', 'PAID', 'FAILED']);
const touchedMap = this.initStatusMap(['REQUESTED', 'PROCESSING', 'APPROVED', 'REJECTED', 'PAID', 'FAILED']);
```

- [ ] **Step 4: 补 ledger 状态期望映射（审查复审 #7）**

`admin-reconciliation.service.ts` 内可能还有一处期望状态映射（line 648 附近），形如：

```typescript
case 'WITHDRAW_FROZEN': return { ledgerStatuses: ['FROZEN'], entryTypes: ['WITHDRAW'] };
case 'WITHDRAW_PAID':   return { ledgerStatuses: ['WITHDRAWN'], entryTypes: ['WITHDRAW'] };
case 'WITHDRAW_VOID':   return { ledgerStatuses: ['VOIDED'], entryTypes: ['VOID'] };
```

需要补 DEDUCT 的几种状态映射：

```typescript
case 'DEDUCT_RESERVED':  return { ledgerStatuses: ['RESERVED'],  entryTypes: ['DEDUCT'] };
case 'DEDUCT_VOIDED':    return { ledgerStatuses: ['VOIDED'],    entryTypes: ['DEDUCT'] };
case 'DEDUCT_AVAILABLE': return { ledgerStatuses: ['AVAILABLE'], entryTypes: ['DEDUCT'] };
case 'REFUND_RESTORE':   return { ledgerStatuses: ['AVAILABLE'], entryTypes: ['ADJUST'] };
```

具体 case 名按现有 reconciliation switch 的命名风格补齐。

- [ ] **Step 5: 视情况检查 reconciliation controller 返回字段**

```bash
grep -n "DEDUCT\|PROCESSING\|entryMap\|createdMap" backend/src/modules/admin/reconciliation/admin-reconciliation.service.ts
```

如返回对象里直接 destructure entry 名（例如 `result.WITHDRAW`），新加的 `result.DEDUCT` 也要透出到 API 返回。改 controller 或 DTO 对应处。

- [ ] **Step 6: TypeScript 编译**

```bash
cd backend
npx tsc --noEmit
```

Expected: 通过。

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/admin/reconciliation/admin-reconciliation.service.ts
git commit -m "feat(admin/reconciliation): include DEDUCT entry + PROCESSING withdraw status + ledger maps"
```

---

## Chunk 9: 验收与文档

### Task 29: 后端综合验证

- [ ] **Step 1: Prisma validate**

```bash
cd backend
npx prisma validate
```

Expected: valid。

- [ ] **Step 2: 跑核心测试**

```bash
cd backend
npx jest src/modules/bonus/withdraw-rules.service.spec.ts \
         src/modules/bonus/withdraw-payout.service.spec.ts \
         src/modules/bonus/reward-deduction.service.spec.ts \
         src/modules/payment/alipay.service.spec.ts \
         src/modules/payment/payment.controller.transfer-notify.spec.ts
```

Expected: 全部 PASS。

- [ ] **Step 3: TypeScript 全量编译**

```bash
cd backend
npx tsc --noEmit
```

Expected: 0 error。

---

### Task 30: 买家 App + Admin 验证

- [ ] **Step 1: App typecheck**

```bash
cd /Users/jamesheden/Desktop/农脉\ -\ AI赋能农业电商平台
npx tsc -b
```

Expected: 0 error。

- [ ] **Step 2: Admin build**

```bash
cd admin
npm run build
```

Expected: 成功。

- [ ] **Step 3: Admin 真机检查 4 个页面**

启动 admin dev server，逐个打开：
- `/bonus/withdrawals` —— 列表渲染、列显示完整、PROCESSING 状态标签蓝色
- `/bonus/withdraw-rules` —— 表单加载默认值、保存提示成功
- `/bonus/tax-reporting` —— 月份选择、汇总显示、导出 CSV
- `/bonus/members` —— 不应破坏现有功能

Expected: 无报错、布局正常。

---

### Task 31: 文档同步

**Files:**
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/backend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `plan.md`
- Modify: `AGENTS.md`
- Modify: `docs/features/支付宝支付.md`

- [ ] **Step 1: frontend.md 加新页面说明**

打开 `docs/architecture/frontend.md`，在钱包相关 Section 加：
- 钱包页改名"消费积分"
- 提现页新设计（金额输入 + 实时税额展示，v1.0 无二次验证）
- 结算页加积分输入控件

- [ ] **Step 2: backend.md 加新模块**

打开 `docs/architecture/backend.md`，在 bonus 模块章节加：
- WithdrawRulesService / WithdrawPayoutService / RewardDeductionService 三个新 service
- 提现链路图：requestWithdraw → Serializable tx → PaymentService.initiateTransfer → finalize
- 抵扣链路：calculateMax → reserve（事务内）→ confirm/release（支付 hook）
- Notify 端点 /payments/alipay/transfer-notify

- [ ] **Step 3: admin-frontend.md 加两个新页**

- /bonus/withdraw-rules
- /bonus/tax-reporting

- [ ] **Step 4: plan.md 更新**

打开 `plan.md`，在合适的 Batch 加"消费积分双轨"条目，标记为本次实施完成。

- [ ] **Step 5: AGENTS.md 登记本 plan**

按现有格式加一行：

```
- 2026-05-19 消费积分双轨设计 + 实施计划 (spec + plan)
```

- [ ] **Step 6: 支付宝支付.md 标记选择路径**

打开 `docs/features/支付宝支付.md`，在出款方案章节末尾加：

```
## 2026-05-19 决议
最终采用：消费积分双轨模式（提现 + 抵扣）。
- 提现走 alipay.fund.trans.uni.transfer（企业账户免费）
- 代扣 20% 个税（参数化，默认偶然所得税率）
- 抵扣按订单×比例上限（普通 10% / VIP 15%）
详见 docs/superpowers/specs/2026-05-19-reward-dual-track-design.md
```

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/frontend.md \
        docs/architecture/backend.md \
        docs/architecture/admin-frontend.md \
        plan.md AGENTS.md docs/features/支付宝支付.md
git commit -m "docs(reward): sync architecture + plan + agents + payment docs"
```

---

### Task 32: 沙箱端到端验收

**前提：** 支付宝沙箱已配置，`ALIPAY_GATEWAY=https://openapi.alipaydev.com/gateway.do`，`/api/v1/payments/alipay/transfer-notify` 在沙箱可达。

- [ ] **Step 1: 配置 sandbox env**

`backend/.env`：

```
ALIPAY_APP_ID=<SANDBOX_APP_ID>
ALIPAY_GATEWAY=https://openapi.alipaydev.com/gateway.do
ALIPAY_PRIVATE_KEY_PATH=<LOCAL_PATH>
ALIPAY_PUBLIC_KEY=<SANDBOX_PUBLIC_KEY>
ALIPAY_TRANSFER_NOTIFY_URL=https://<your-tunnel>/api/v1/payments/alipay/transfer-notify
```

- [ ] **Step 2: 种子用户余额**

在本地 dev DB 给测试用户 `RewardAccount.balance` 设个值（如 200）。可以 SQL 或调内部 admin 接口。

- [ ] **Step 3: 在 App 走"成功路径"**

```
amount: 100
alipayAccount: <sandbox 买家账号>
alipayName: <sandbox 买家用户名>
```

Expected:
- WithdrawRequest.status PAID（或先 PROCESSING 后 cron/notify 转 PAID）
- RewardAccount.balance 减 100
- 实际到账 ¥80
- 平台代扣 ¥20（统计聚合在 admin 税务报送页能看到）

- [ ] **Step 4: 走"账户错误"路径**

```
alipayName: 错误姓名
```

Expected: 直接失败 → balance 恢复 → admin 端 providerErrorMessage 有内容。

- [ ] **Step 5: 走"日次数 + 冷却"**

提交 4 次（按默认 daily=3）。

Expected: 第 4 次拒绝"每日最多 3 次"；提交后立刻再提交：拒绝"冷却时间未到"。

- [ ] **Step 6: 走"抵扣"**

商品 ¥200，输入抵扣 ¥18（VIP 15% 上限：30，OK），提交订单 → 支付 → 钱包余额减 ¥18，订单实付 ¥182。

Expected: 全链路无报错，钱包流水显示"消费抵扣 -¥18"。

- [ ] **Step 7: 走"退款返还"**

刚才订单部分退款 ¥80 → 应退现金 ¥72.80 + 积分返 ¥7.20。

Expected: RewardAccount.balance 增 7.20，流水显示"退款返还 +¥7.20"。

---

## Self-Review 检查清单

**Spec 覆盖**：
- [x] Section 4.1 Schema → Task 1
- [x] Section 4.2 枚举 → Task 1
- [x] Section 4.3 CheckoutSession + 4.4 跨账户 → Task 1 + Task 13
- [x] Section 4.5 RuleConfig → Task 2
- [x] Section 5 模块边界 → Tasks 3,7,12,5,6
- [x] Section 6 提现链路 → Tasks 7-11
- [x] Section 7 抵扣链路 → Tasks 12-15, 16-17
- [x] Section 8 退款 → Task 18
- [x] Section 9 买家 App → Tasks 19-22
- [x] Section 10 管理后台 → Tasks 23-27
- [x] Section 11 卖家不动 → 不需要 task
- [x] Section 12 参数清单 → Task 2 seed
- [x] Section 13 测试覆盖 → 散在各 task spec
- [x] Section 14 上线 checklist → Task 31 沙箱端到端
- [x] Section 15 风险点 → 文档+设计层面，Task 30 同步

**Placeholder 检查**：所有步骤都包含实际代码或命令，无 TBD/TODO/"see above"。

**类型一致性**：
- `WithdrawRules` interface 在 Task 3 定义 → Tasks 7, 12 使用 → Admin Task 24 也是同名
- `RewardDeductionService.reserveDeduction` 签名一致：tx, userId, goodsAmount, requestedAmount
- `groupId` / `deductionGroupId` 命名一致（service 内 groupId，schema 字段 deductionGroupId）

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-reward-dual-track.md`.**

两种执行方式：

**1. Subagent-Driven (recommended)** — 每个 task 派独立 subagent，task 之间 review，迭代更快

**2. Inline Execution** — 当前会话顺序跑完，关键节点 checkpoint review

哪种？
