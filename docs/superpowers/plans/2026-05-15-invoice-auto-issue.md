# Invoice Auto-Issue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让买家申请发票后系统自动开票，10 分钟内出票；失败时 cron 重试最多 3 次再降级为 FAILED；管理员只在重试耗尽时人工介入。

**Architecture:**
- 买家 `requestInvoice` 创建 `Invoice REQUESTED` 后，**事务外**用 `Promise.resolve().then(...)` 触发 fire-and-forget 调用 `AdminInvoicesService.issueInvoice(id, { mode: providerMode }, null)`。HTTP 立即返回 REQUESTED，不等开票完成。
- 自动开票失败时 **不降级状态**（沿用 `tofix-safe.md` 售后退款"FAILED 但不降级"的模式）：记录 `failedAttempts++` + `lastAutoIssueAttemptAt` + 一条 SYSTEM operatorType 的状态历史；invoice 仍是 REQUESTED 等待 cron 重试。
- 新增 `InvoiceAutoIssueRetryService`（@Cron 每 10 分钟）扫描 `status=REQUESTED + providerRequestId IS NULL + failedAttempts<MAX + (lastAutoIssueAttemptAt IS NULL OR < now-10min)` 的 invoice 重试；达到 `MAX_ATTEMPTS` 仍失败 → 调 `markProviderIssueFailed` 真正翻 FAILED + 写 admin 警告。
- 买家 App 申请成功后弹「已申请，发票预计 10 分钟内开出，请稍后刷新」；订单详情发票区每次进入自动 refetch。
- 管理后台设置页加「自动开票」开关（默认 ON）和「最大重试次数」（默认 3）。

**Tech Stack:** NestJS + Prisma + @nestjs/schedule（已在用）+ Ant Design ProForm + React Native expo-router

---

## File Structure

新增：
- `backend/prisma/migrations/<timestamp>_invoice_auto_issue/migration.sql` — `failedAttempts` / `lastAutoIssueAttemptAt` 字段 + 索引
- `backend/src/modules/invoice/invoice-auto-issue-retry.service.ts` — cron 重试
- `backend/src/modules/invoice/invoice-auto-issue-retry.service.spec.ts` — 单测

修改：
- `backend/prisma/schema.prisma` — `Invoice` 加字段
- `backend/prisma/seed.ts` — 加 `INVOICE_AUTO_ISSUE` / `INVOICE_AUTO_ISSUE_MAX_ATTEMPTS` 配置
- `backend/src/modules/admin/invoices/admin-invoices.service.ts` — `INVOICE_SETTING_DEFINITIONS` 加 2 个 key、`InvoiceSettings` 类型、`issueInvoice` 支持 `adminId=null` 表示 SYSTEM 触发、`markAutoIssueAttemptFailure` 新方法、`markProviderIssueFailed` 区分软失败/硬失败
- `backend/src/modules/admin/invoices/admin-invoices.module.ts` — `exports: [AdminInvoicesService]`
- `backend/src/modules/admin/invoices/dto/admin-invoice.dto.ts` — `UpdateInvoiceSettingsDto` 加字段
- `backend/src/modules/admin/config/config-validation.ts` — 加两个 key 的校验
- `backend/src/modules/invoice/invoice.module.ts` — `imports: [AdminInvoicesModule]`
- `backend/src/modules/invoice/invoice.service.ts` — `requestInvoice` 末尾触发 fire-and-forget；新增 `triggerAutoIssue` 私有方法
- `backend/src/modules/invoice/invoice.service.spec.ts` — 加 auto-issue 触发单测
- `admin/src/api/invoices.ts` — `InvoiceSettings` 加 `autoIssue` / `autoIssueMaxAttempts`；`Invoice` 加 `failedAttempts` / `lastAutoIssueAttemptAt`
- `admin/src/pages/invoices/settings.tsx` — 设置页加 2 个字段
- `admin/src/pages/invoices/index.tsx` — 列表 REQUESTED 行若 `failedAttempts>0` 显示警示徽章
- `admin/src/pages/invoices/detail.tsx` — 详情显示自动开票失败次数 + 系统状态历史标签
- `app/orders/[id].tsx` — 进入时强制 refetch order
- `app/invoices/[id].tsx` / `app/invoices/index.tsx` — 显示「自动开票中」过渡文案
- `src/components/cards/InvoiceSection.tsx` — REQUESTED 状态文案改为「自动开票中（约 10 分钟内）」
- `src/types/domain/Invoice.ts` — Invoice 类型加新字段
- `docs/features/invoice.md` — 增补自动开票章节
- `docs/architecture/admin-frontend.md` — 增补设置页/列表页变化
- `CLAUDE.md` — 登记本 plan
- `plan.md` — 追加任务条目

---

## Cross-Module Dependency Note

`backend/src/modules/invoice/invoice.module.ts` 将 import `AdminInvoicesModule`。检查 `AdminInvoicesModule` 是否反向依赖 `InvoiceModule`（如果是会出现 circular dep，需要 `forwardRef`）。**Task 0 先验证**。

---

### Task 0: 验证模块依赖方向

**Files:**
- Inspect: `backend/src/modules/admin/invoices/admin-invoices.module.ts`
- Inspect: `backend/src/modules/invoice/invoice.module.ts`

- [ ] **Step 1: 检查 AdminInvoicesModule 的 imports**

```bash
grep -A 30 "@Module" backend/src/modules/admin/invoices/admin-invoices.module.ts
```

Expected: 不应看到 `InvoiceModule` 的 import。如果看到了，本计划下面所有 `imports: [AdminInvoicesModule]` 改为 `imports: [forwardRef(() => AdminInvoicesModule)]` 并配合 `@Inject(forwardRef(...))`。

- [ ] **Step 2: 检查 InvoiceModule 的 imports**

```bash
grep -A 30 "@Module" backend/src/modules/invoice/invoice.module.ts
```

Expected: 不应已经 import AdminInvoicesModule。

无 commit。

---

### Task 1: Prisma Schema 加字段 + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_invoice_auto_issue/migration.sql`

- [ ] **Step 1: 在 `Invoice` 模型加两个字段**

修改 `backend/prisma/schema.prisma` 中 `model Invoice`，在 `requestCount` 后面、`requestedAt` 前加：

```prisma
  failedAttempts         Int           @default(0)
  lastAutoIssueAttemptAt DateTime?
```

并在末尾的 `@@index` 区追加：

```prisma
  @@index([status, failedAttempts, lastAutoIssueAttemptAt])
```

- [ ] **Step 2: 生成 migration**

```bash
cd backend && npx prisma migrate dev --name invoice_auto_issue --create-only
```

Expected: 生成 `prisma/migrations/<timestamp>_invoice_auto_issue/migration.sql`。检查内容包含 `ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0`、`ADD COLUMN "lastAutoIssueAttemptAt" TIMESTAMP(3)`、`CREATE INDEX`。

- [ ] **Step 3: 应用 migration 到本地 dev DB**

```bash
cd backend && npx prisma migrate dev
```

Expected: 已应用，`npx prisma validate` 通过。

- [ ] **Step 4: 生成 Prisma Client**

```bash
cd backend && npx prisma generate
```

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(invoice): add failedAttempts and lastAutoIssueAttemptAt columns"
```

---

### Task 2: 配置项定义

**Files:**
- Modify: `backend/src/modules/admin/invoices/admin-invoices.service.ts:25-100` (`InvoiceSettings` type + `INVOICE_SETTING_DEFINITIONS`)
- Modify: `backend/src/modules/admin/config/config-validation.ts:300-320` (around `INVOICE_PROVIDER_MODE`)
- Modify: `backend/prisma/seed.ts:1617-1640` (around invoice 配置 seed)
- Modify: `backend/src/modules/admin/invoices/dto/admin-invoice.dto.ts` (`UpdateInvoiceSettingsDto`)

- [ ] **Step 1: 扩展 `InvoiceSettings` type**

`admin-invoices.service.ts` 顶部 type 定义里追加字段：

```ts
type InvoiceSettings = {
  providerMode: 'MOCK';
  lineMode: 'ORDER_ITEMS' | 'MERGED_CATEGORY';
  defaultTaxRate: number;
  defaultTaxClassificationCode: string;
  defaultGoodsName: string;
  allowVipPackage: boolean;
  remarkTemplate: string;
  issuerProfile: InvoiceIssuerProfile;
  autoIssue: boolean;
  autoIssueMaxAttempts: number;
};
```

- [ ] **Step 2: 扩展 `INVOICE_SETTING_DEFINITIONS`**

`INVOICE_SETTING_DEFINITIONS` 对象末尾（`issuerProfile` 之后）追加：

```ts
  autoIssue: {
    key: 'INVOICE_AUTO_ISSUE',
    defaultValue: true,
    description: '买家申请发票后自动开票',
  },
  autoIssueMaxAttempts: {
    key: 'INVOICE_AUTO_ISSUE_MAX_ATTEMPTS',
    defaultValue: 3,
    description: '自动开票最大重试次数（含首次），超出后标记 FAILED',
  },
```

- [ ] **Step 3: 在 `getInvoiceSettingsFromClient` 里读出**

找到 `getInvoiceSettingsFromClient` 方法返回对象的位置（约 service.ts:630-680），在 `providerMode` 行之后追加：

```ts
      autoIssue: this.getRuleValue(byKey, 'autoIssue') as boolean,
      autoIssueMaxAttempts: this.getRuleValue(byKey, 'autoIssueMaxAttempts') as number,
```

同样在 `getInvoiceSettings`（admin GET）返回对象里追加同样两行。

- [ ] **Step 4: 加入 `UpdateInvoiceSettingsDto`**

`dto/admin-invoice.dto.ts` 的 `UpdateInvoiceSettingsDto` 类追加（仿照 `allowVipPackage`）：

```ts
  @IsOptional()
  @IsBoolean()
  autoIssue?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  autoIssueMaxAttempts?: number;
```

- [ ] **Step 5: 加入 `config-validation.ts`**

`config-validation.ts` 找到 `INVOICE_PROVIDER_MODE` 配置块，下方追加：

```ts
  INVOICE_AUTO_ISSUE: {
    type: 'boolean',
    description: '买家申请发票后自动开票',
  },
  INVOICE_AUTO_ISSUE_MAX_ATTEMPTS: {
    type: 'number',
    min: 1,
    max: 10,
    description: '自动开票最大重试次数',
  },
```

- [ ] **Step 6: 加 seed 默认值**

`prisma/seed.ts` invoice 配置块（约 1617-1640）追加：

```ts
    { key: 'INVOICE_AUTO_ISSUE', value: true, desc: '买家申请发票后自动开票' },
    { key: 'INVOICE_AUTO_ISSUE_MAX_ATTEMPTS', value: 3, desc: '自动开票最大重试次数' },
```

- [ ] **Step 7: 跑 seed 验证**

```bash
cd backend && npx prisma db seed
```

Expected: 两个新 key 写入 `RuleConfig` 表。

- [ ] **Step 8: 跑现有 invoice 单测**

```bash
cd backend && npx jest admin/invoices/admin-invoices.service.spec.ts
```

Expected: 全绿（fixture `invoiceSettingsRows` 没有这两个 key，会走 `defaultValue` 兜底，不破现有测试）。

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/admin/ backend/prisma/seed.ts
git commit -m "feat(invoice): add autoIssue and autoIssueMaxAttempts settings"
```

---

### Task 3: AdminInvoicesService 加 SYSTEM 触发支持

**Files:**
- Modify: `backend/src/modules/admin/invoices/admin-invoices.service.ts` (issueInvoice / 各 history.create)
- Modify: `backend/src/modules/admin/invoices/admin-invoices.module.ts` (exports)

- [ ] **Step 1: 让 `issueInvoice` 接受 `adminId: string | null`**

修改 `issueInvoice` 签名（约 service.ts:319）：

```ts
async issueInvoice(invoiceId: string, dto: IssueInvoiceDto, adminId: string | null) {
```

往下传给 `issueManualInvoice` / `reserveInvoiceForProvider` / `finalizeProviderInvoice` / `markProviderIssueFailed` 时也允许 `null`。

- [ ] **Step 2: 状态历史 operatorType 改 SYSTEM 当 adminId 为 null**

找到所有 `tx.invoiceStatusHistory.create({ data: { ..., operatorType: 'ADMIN', ... } })`（service.ts 共 4 处：manual issue、auto/mock finalize、provider failed、failInvoice），把每处改为：

```ts
operatorType: adminId ? 'ADMIN' : 'SYSTEM',
operatorId: adminId ?? null,
```

注意 `failInvoice` 只能由 admin 调，不需要改（保留 'ADMIN'）。

- [ ] **Step 3: 加 `markAutoIssueAttemptFailure` 新方法**

在 `markProviderIssueFailed` 之后（约 service.ts:475 之后）加入：

```ts
  /**
   * 自动开票"软失败"：不降级状态，仅记录 failedAttempts。
   * 仅 SYSTEM 自动触发链路调用；admin 主动 issue 失败仍走 markProviderIssueFailed。
   */
  async markAutoIssueAttemptFailure(
    invoiceId: string,
    providerRequestId: string,
    reason: string,
  ) {
    return this.runSerializable(async (tx) => {
      const result = await tx.invoice.updateMany({
        where: { id: invoiceId, status: 'REQUESTED', providerRequestId },
        data: {
          provider: null,
          providerRequestId: null,
          failedAttempts: { increment: 1 },
          lastAutoIssueAttemptAt: new Date(),
        },
      });
      if (result.count === 0) return { ok: false };

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus: 'REQUESTED',
          toStatus: 'REQUESTED',
          reason: reason.slice(0, 500),
          operatorType: 'SYSTEM',
          metadata: { action: 'AUTO_ISSUE_ATTEMPT_FAILED', providerRequestId },
        },
      });
      return { ok: true };
    });
  }
```

- [ ] **Step 4: 重构 AUTO/MOCK 失败分支调上面新方法**

找到 `issueInvoice` 里 AUTO/MOCK 失败分支（约 service.ts:300-320 catch 块）：

```ts
} catch (err: any) {
  await this.markProviderIssueFailed(
    invoiceId,
    reservation.providerRequestId,
    adminId,
    err?.message || 'Provider 调用失败',
    err,
  );
}
```

改为：

```ts
} catch (err: any) {
  const reason = err?.message || 'Provider 调用失败';
  if (adminId === null) {
    // SYSTEM 自动开票：软失败 + 等 cron 重试
    await this.markAutoIssueAttemptFailure(invoiceId, reservation.providerRequestId, reason);
  } else {
    // ADMIN 主动开票：硬失败，立即翻 FAILED
    await this.markProviderIssueFailed(invoiceId, reservation.providerRequestId, adminId, reason, err);
  }
}
```

- [ ] **Step 5: 在 `AdminInvoicesModule` exports 里加 service**

`admin-invoices.module.ts`：

```ts
@Module({
  ...
  providers: [AdminInvoicesService, InvoiceProviderFactory, MockInvoiceProvider],
  controllers: [AdminInvoicesController],
  exports: [AdminInvoicesService],
})
```

- [ ] **Step 6: 加 SYSTEM operatorType 单测**

`admin-invoices.service.spec.ts` 在 issueInvoice success 测试组里加：

```ts
it('writes SYSTEM operatorType when adminId is null', async () => {
  // ...同 success fixture
  await service.issueInvoice('inv-1', { mode: 'MOCK' }, null);
  expect(tx.invoiceStatusHistory.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ operatorType: 'SYSTEM', operatorId: null }),
    }),
  );
});

it('soft-fails (markAutoIssueAttemptFailure) when SYSTEM auto-issue provider call throws', async () => {
  // mock provider.issue to throw
  // assert: invoice.updateMany called with failedAttempts: { increment: 1 }
  // assert: status history operatorType=SYSTEM, action=AUTO_ISSUE_ATTEMPT_FAILED
  // assert: invoice.status NOT changed to FAILED
});
```

- [ ] **Step 7: 跑测试**

```bash
cd backend && npx jest admin/invoices/admin-invoices.service.spec.ts
```

Expected: 全绿。

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/admin/invoices/
git commit -m "feat(invoice): support SYSTEM auto-issue trigger with soft-fail tracking"
```

---

### Task 4: 买家 requestInvoice 触发 fire-and-forget

**Files:**
- Modify: `backend/src/modules/invoice/invoice.module.ts`
- Modify: `backend/src/modules/invoice/invoice.service.ts`
- Modify: `backend/src/modules/invoice/invoice.service.spec.ts`

- [ ] **Step 1: InvoiceModule import AdminInvoicesModule**

`invoice.module.ts`：

```ts
import { AdminInvoicesModule } from '../admin/invoices/admin-invoices.module';

@Module({
  imports: [AdminInvoicesModule],
  providers: [InvoiceService],
  controllers: [InvoiceController],
})
export class InvoiceModule {}
```

如果 Task 0 发现 circular，改为：

```ts
imports: [forwardRef(() => AdminInvoicesModule)],
```

并在 InvoiceService 注入处用 `@Inject(forwardRef(() => AdminInvoicesService))`。

- [ ] **Step 2: InvoiceService 注入 AdminInvoicesService**

`invoice.service.ts` 构造函数：

```ts
import { AdminInvoicesService } from '../admin/invoices/admin-invoices.service';

constructor(
  private prisma: PrismaService,
  private adminInvoicesService: AdminInvoicesService,
) {}
```

- [ ] **Step 3: 加 `triggerAutoIssue` 私有方法**

在 `invoice.service.ts` 末尾加：

```ts
  /**
   * Fire-and-forget 触发自动开票。
   * - 仅在 settings.autoIssue=true 时触发
   * - HTTP 响应立即返回 REQUESTED，不等 issue 完成
   * - 失败由 AdminInvoicesService.markAutoIssueAttemptFailure 软失败兜底
   * - 任何异常被 catch 吞掉，避免污染请求上下文
   */
  private triggerAutoIssue(invoiceId: string) {
    Promise.resolve().then(async () => {
      try {
        const settings = await this.adminInvoicesService.getInvoiceSettings();
        if (!settings.autoIssue) return;
        await this.adminInvoicesService.issueInvoice(
          invoiceId,
          { mode: settings.providerMode },
          null, // SYSTEM
        );
      } catch (e) {
        // 软失败已由 issueInvoice 内部处理；额外 catch 仅为防止未捕获 promise rejection 污染日志
        // eslint-disable-next-line no-console
        console.error('[auto-issue] unexpected error', invoiceId, e);
      }
    });
  }
```

注意 `getInvoiceSettings` 是 admin service 的现成 public 方法，返回完整 InvoiceSettings。

- [ ] **Step 4: `requestInvoice` 末尾调 `triggerAutoIssue`**

找到 `requestInvoice` 末尾（事务返回后、return 给 controller 前），加：

```ts
this.triggerAutoIssue(invoice.id);
return invoice;
```

如果是重申请路径（CANCELED/FAILED → REQUESTED），同样触发。

- [ ] **Step 5: 加单测**

`invoice.service.spec.ts` 加：

```ts
it('fires auto-issue after creating REQUESTED invoice', async () => {
  // mock adminInvoicesService.getInvoiceSettings to return { autoIssue: true, providerMode: 'MOCK' }
  // mock adminInvoicesService.issueInvoice resolves
  // call requestInvoice
  // await new Promise(r => setImmediate(r)); // flush microtasks
  // assert: adminInvoicesService.issueInvoice called with (invoiceId, { mode: 'MOCK' }, null)
});

it('does not fire auto-issue when autoIssue setting is false', async () => {
  // mock getInvoiceSettings to return { autoIssue: false }
  // call requestInvoice
  // await microtask flush
  // assert: issueInvoice NOT called
});

it('does not throw when auto-issue fails', async () => {
  // mock issueInvoice rejects
  // call requestInvoice → assert resolves successfully (HTTP 200)
});
```

- [ ] **Step 6: 跑测试**

```bash
cd backend && npx jest invoice/invoice.service.spec.ts
```

Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/invoice/
git commit -m "feat(invoice): fire-and-forget auto-issue after buyer request"
```

---

### Task 5: Cron 重试

**Files:**
- Create: `backend/src/modules/invoice/invoice-auto-issue-retry.service.ts`
- Create: `backend/src/modules/invoice/invoice-auto-issue-retry.service.spec.ts`
- Modify: `backend/src/modules/invoice/invoice.module.ts`

- [ ] **Step 1: 写 service 骨架**

新建 `backend/src/modules/invoice/invoice-auto-issue-retry.service.ts`：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminInvoicesService } from '../admin/invoices/admin-invoices.service';

const RETRY_BATCH_SIZE = 20;
const MIN_AGE_MS = 10 * 60 * 1000; // 距上次尝试至少 10 分钟

@Injectable()
export class InvoiceAutoIssueRetryService {
  private readonly logger = new Logger(InvoiceAutoIssueRetryService.name);

  constructor(
    private prisma: PrismaService,
    private adminInvoicesService: AdminInvoicesService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleRetries() {
    try {
      const settings = await this.adminInvoicesService.getInvoiceSettings();
      if (!settings.autoIssue) return;

      const cutoff = new Date(Date.now() - MIN_AGE_MS);
      const candidates = await this.prisma.invoice.findMany({
        where: {
          status: 'REQUESTED',
          providerRequestId: null,
          failedAttempts: { gt: 0, lt: settings.autoIssueMaxAttempts },
          OR: [
            { lastAutoIssueAttemptAt: null },
            { lastAutoIssueAttemptAt: { lt: cutoff } },
          ],
        },
        select: { id: true, failedAttempts: true },
        take: RETRY_BATCH_SIZE,
        orderBy: { lastAutoIssueAttemptAt: 'asc' },
      });

      for (const inv of candidates) {
        try {
          await this.adminInvoicesService.issueInvoice(
            inv.id,
            { mode: settings.providerMode },
            null,
          );
        } catch (e: any) {
          this.logger.warn(`[auto-issue-retry] ${inv.id} retry failed: ${e?.message}`);
        }
      }

      // 处理已达上限的：强制翻 FAILED
      const exhausted = await this.prisma.invoice.findMany({
        where: {
          status: 'REQUESTED',
          providerRequestId: null,
          failedAttempts: { gte: settings.autoIssueMaxAttempts },
        },
        select: { id: true },
        take: RETRY_BATCH_SIZE,
      });
      for (const inv of exhausted) {
        await this.adminInvoicesService.markAutoIssueRetryExhausted(inv.id);
      }
    } catch (e: any) {
      this.logger.error('[auto-issue-retry] cycle failed', e);
    }
  }
}
```

- [ ] **Step 2: 在 `AdminInvoicesService` 加 `markAutoIssueRetryExhausted`**

`admin-invoices.service.ts` 末尾加：

```ts
  /**
   * 自动开票重试次数耗尽，强制翻 FAILED。供 cron 调用。
   */
  async markAutoIssueRetryExhausted(invoiceId: string) {
    return this.runSerializable(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice || invoice.status !== 'REQUESTED' || invoice.providerRequestId) return { ok: false };

      const result = await tx.invoice.updateMany({
        where: { id: invoiceId, status: 'REQUESTED', providerRequestId: null },
        data: {
          status: 'FAILED',
          failReason: '自动开票多次失败，请联系客服或重新申请',
          failedAt: new Date(),
        },
      });
      if (result.count === 0) return { ok: false };

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus: 'REQUESTED',
          toStatus: 'FAILED',
          reason: '自动开票重试次数耗尽',
          operatorType: 'SYSTEM',
          metadata: { action: 'AUTO_ISSUE_RETRY_EXHAUSTED', failedAttempts: invoice.failedAttempts },
        },
      });

      return { ok: true };
    });
  }
```

- [ ] **Step 3: 注册到 InvoiceModule**

`invoice.module.ts`：

```ts
import { InvoiceAutoIssueRetryService } from './invoice-auto-issue-retry.service';

@Module({
  imports: [AdminInvoicesModule],
  providers: [InvoiceService, InvoiceAutoIssueRetryService],
  controllers: [InvoiceController],
})
```

- [ ] **Step 4: 写单测**

`invoice-auto-issue-retry.service.spec.ts`：

```ts
describe('InvoiceAutoIssueRetryService', () => {
  // 1. handleRetries 跳过当 autoIssue=false
  // 2. handleRetries 不会重试 failedAttempts=0 的（这些是没启动 autoIssue 的旧 REQUESTED）
  // 3. handleRetries 不会重试 lastAutoIssueAttemptAt 在 10 分钟内的
  // 4. handleRetries 对符合条件的逐个调 issueInvoice(id, {mode:'MOCK'}, null)
  // 5. handleRetries 对 failedAttempts >= max 的调 markAutoIssueRetryExhausted
  // 6. 单个 invoice 重试抛错不影响其他 invoice 的重试
});
```

每个用例 mock PrismaService.invoice.findMany 和 AdminInvoicesService 的两个方法，断言调用次数和参数。

- [ ] **Step 5: 跑测试**

```bash
cd backend && npx jest invoice/invoice-auto-issue-retry.service.spec.ts
```

Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/invoice/invoice-auto-issue-retry.service.* backend/src/modules/invoice/invoice.module.ts backend/src/modules/admin/invoices/admin-invoices.service.ts
git commit -m "feat(invoice): cron retry stalled auto-issues and force-fail after max attempts"
```

---

### Task 6: 卖家/管理端隐私一致性检查

**Files:**
- Check: `backend/src/modules/seller/orders/seller-orders.service.ts:131,219` (select clause)
- Check: `backend/src/modules/admin/invoices/admin-invoices.service.ts:findAll / findById`

- [ ] **Step 1: 验证卖家端不会泄露 failedAttempts**

```bash
grep -n "invoice" backend/src/modules/seller/orders/seller-orders.service.ts
```

确认 select 子句仅 `{ status: true }`，不含 failedAttempts。如果不是 → 修正。

- [ ] **Step 2: 验证 admin findAll/findById 返回 failedAttempts 字段**

Spread `...invoice` 已经包含所有字段，无需改动。在前端把它显示出来即可。

无 commit。

---

### Task 7: Admin API 类型 + 设置页 UI

**Files:**
- Modify: `admin/src/api/invoices.ts`
- Modify: `admin/src/pages/invoices/settings.tsx`

- [ ] **Step 1: `InvoiceSettings` 加字段**

`admin/src/api/invoices.ts`：

```ts
export interface InvoiceSettings {
  providerMode: 'MOCK';
  lineMode: 'ORDER_ITEMS' | 'MERGED_CATEGORY';
  defaultTaxRate: number;
  defaultTaxClassificationCode: string;
  defaultGoodsName: string;
  allowVipPackage: boolean;
  remarkTemplate: string;
  issuerProfile: InvoiceIssuerProfile;
  autoIssue: boolean;
  autoIssueMaxAttempts: number;
}
```

`Invoice` 类型加：

```ts
  failedAttempts: number;
  lastAutoIssueAttemptAt?: string | null;
```

- [ ] **Step 2: 设置页加两个字段**

`admin/src/pages/invoices/settings.tsx` 「内容与税务规则」Card 末尾加：

```tsx
<Col xs={24} md={8}>
  <ProFormSwitch
    name="autoIssue"
    label="自动开票"
    tooltip="开启后，买家申请发票将立即触发后台自动开票，10 分钟内出票"
  />
</Col>
<Col xs={24} md={8}>
  <ProFormDigit
    name="autoIssueMaxAttempts"
    label="自动开票最大重试次数"
    min={1}
    max={10}
    fieldProps={{ precision: 0, step: 1 }}
    rules={[{ required: true, message: '请输入重试次数' }]}
  />
</Col>
```

- [ ] **Step 3: 启动 admin dev server 手动验证**

```bash
cd admin && npm run dev
```

打开设置页，确认两个字段渲染、可填、提交后后端 updateInvoiceSettings 成功。

- [ ] **Step 4: Commit**

```bash
git add admin/src/api/invoices.ts admin/src/pages/invoices/settings.tsx
git commit -m "feat(admin/invoices): auto-issue toggle and max attempts in settings page"
```

---

### Task 8: 管理端列表 + 详情显示失败次数

**Files:**
- Modify: `admin/src/pages/invoices/index.tsx`
- Modify: `admin/src/pages/invoices/detail.tsx`

- [ ] **Step 1: 列表 REQUESTED 行加警示**

`admin/src/pages/invoices/index.tsx` 在 status render 函数里追加：

```tsx
if (r.status === 'REQUESTED' && r.failedAttempts > 0) {
  return (
    <Space>
      <Tag color="warning">自动开票失败 {r.failedAttempts} 次</Tag>
    </Space>
  );
}
```

放在 `providerRequestId` 判定之前（"开票中"优先级更高）。

- [ ] **Step 2: 详情页显示**

`admin/src/pages/invoices/detail.tsx` 在 Descriptions 区追加：

```tsx
{invoice.failedAttempts > 0 && (
  <Descriptions.Item label="自动开票失败次数">
    <Text type="warning">
      {invoice.failedAttempts} 次
      {invoice.lastAutoIssueAttemptAt && `（上次 ${dayjs(invoice.lastAutoIssueAttemptAt).format('YYYY-MM-DD HH:mm:ss')}）`}
    </Text>
  </Descriptions.Item>
)}
```

- [ ] **Step 3: 状态历史里 SYSTEM 显示**

`detail.tsx` 已有 statusHistory Timeline，找到 operatorType 渲染处，加入 SYSTEM 映射：

```ts
const operatorTypeLabel: Record<string, string> = {
  BUYER: '买家',
  ADMIN: '管理员',
  SYSTEM: '系统自动',
  PROVIDER: '开票服务',
};
```

- [ ] **Step 4: 手动验证**

dev server 模拟一条 REQUESTED + failedAttempts=2 的记录，进列表/详情检查显示。

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/invoices/index.tsx admin/src/pages/invoices/detail.tsx
git commit -m "feat(admin/invoices): show auto-issue failure count in list and detail"
```

---

### Task 9: 买家 App 文案 + refetch

**Files:**
- Modify: `src/types/domain/Invoice.ts`
- Modify: `src/components/cards/InvoiceSection.tsx`
- Modify: `app/orders/[id].tsx` (refetch on focus)
- Modify: `app/invoices/[id].tsx` / `app/invoices/index.tsx` (REQUESTED 文案)

- [ ] **Step 1: Invoice 类型加字段**

`src/types/domain/Invoice.ts`：

```ts
export type Invoice = {
  // ...既有
  failedAttempts?: number;
  lastAutoIssueAttemptAt?: string | null;
};
```

- [ ] **Step 2: 改 InvoiceSection REQUESTED 文案**

`src/components/cards/InvoiceSection.tsx` 找到 REQUESTED 状态渲染，文案改为：

```tsx
<Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
  系统正在自动开票，预计 10 分钟内出票，请稍后下拉刷新。
</Text>
```

「取消申请」按钮保留。

- [ ] **Step 3: 订单详情进入时 refetch**

`app/orders/[id].tsx` 用 expo-router 的 `useFocusEffect` 在进入页面时 invalidate `['order', orderId]`：

```tsx
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';

useFocusEffect(useCallback(() => {
  queryClient.invalidateQueries({ queryKey: ['order', id] });
}, [id, queryClient]));
```

如果文件已有相同 import，复用。

- [ ] **Step 4: 发票列表/详情 REQUESTED 文案**

`app/invoices/index.tsx` 卡片副文案在 REQUESTED 分支加：

```tsx
<Text>{statusLabel(item.status)} · 系统正在自动开票</Text>
```

`app/invoices/[id].tsx` 在 REQUESTED 大状态卡片下加：

```tsx
{invoice.status === 'REQUESTED' && (
  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 8 }]}>
    系统正在自动开票，预计 10 分钟内完成。如长时间未出票，请下拉刷新或联系客服。
  </Text>
)}
```

- [ ] **Step 5: 手动验证（模拟器）**

启动 mock 模式，申请发票后立刻看到「系统正在自动开票」文案；下拉刷新（mock 中可能跳到 ISSUED）。

- [ ] **Step 6: Commit**

```bash
git add src/types/domain/Invoice.ts src/components/cards/InvoiceSection.tsx app/orders/[id].tsx app/invoices/
git commit -m "feat(app/invoices): show auto-issue pending copy and refetch on order focus"
```

---

### Task 10: 后端集成测试（端到端 Mock 链路）

**Files:**
- Create: `backend/src/modules/invoice/invoice.e2e-spec.ts`（如果项目有 e2e 习惯）OR 在现有 spec 加集成场景

- [ ] **Step 1: 写 e2e 场景**

新建 `invoice.e2e-spec.ts`，覆盖：

```ts
describe('Invoice auto-issue E2E', () => {
  // Setup: 真实 PrismaService (test DB) + MockInvoiceProvider
  
  it('full flow: buyer apply → auto-issue → invoice ISSUED within 200ms', async () => {
    // 1. 创建 order RECEIVED
    // 2. 调 invoiceService.requestInvoice
    // 3. await new Promise(r => setTimeout(r, 200)) // 等 Mock 0.1s
    // 4. prisma.invoice.findUnique → expect status=ISSUED, pdfUrl 非空
    // 5. expect statusHistory 包含 REQUESTED → ISSUED, operatorType=SYSTEM
  });

  it('autoIssue setting off: invoice stays REQUESTED indefinitely', async () => {
    // setting autoIssue=false
    // requestInvoice → assert no auto-issue triggered
    // status 仍 REQUESTED
  });

  it('provider failure: failedAttempts incremented, status stays REQUESTED', async () => {
    // mock provider.issue to throw on first call
    // requestInvoice + await microtasks
    // assert failedAttempts=1, status=REQUESTED, no pdfUrl
  });
});
```

如果项目无 e2e 习惯：跳过，仅靠 unit test。

- [ ] **Step 2: 跑**

```bash
cd backend && npx jest invoice/invoice.e2e-spec.ts
```

Expected: 全绿。

- [ ] **Step 3: Commit（如有）**

```bash
git add backend/src/modules/invoice/invoice.e2e-spec.ts
git commit -m "test(invoice): add e2e tests for auto-issue happy path and failures"
```

---

### Task 11: 文档同步

**Files:**
- Modify: `docs/features/invoice.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/issues/tofix-safe.md`（如有安全考量）
- Modify: `plan.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 在 `docs/features/invoice.md` 加自动开票章节**

```markdown
## 自动开票（2026-05-15 新增）

- **触发**：买家申请发票成功后，后端立即 fire-and-forget 调 `AdminInvoicesService.issueInvoice(id, { mode }, null)`，HTTP 响应不等结果。
- **开关**：`INVOICE_AUTO_ISSUE`（默认 true）。关闭则回到旧的人工触发模式。
- **失败兜底**：单次失败不降级 status，仅 `failedAttempts++` + 写 SYSTEM 状态历史。
- **重试 cron**：`InvoiceAutoIssueRetryService` 每 10 分钟扫一次，重试间隔 ≥ 10 分钟。
- **重试上限**：`INVOICE_AUTO_ISSUE_MAX_ATTEMPTS`（默认 3）。耗尽后强制翻 FAILED，buyer 看到失败提示。
- **买家可见性**：REQUESTED 期间文案"系统正在自动开票，预计 10 分钟内出票"；FAILED 后显示 failReason。中间失败次数不告知 buyer。
- **管理端可见性**：列表 + 详情显示 failedAttempts 警示徽章；状态历史区分 SYSTEM/ADMIN/BUYER 操作者。
```

- [ ] **Step 2: 在 `docs/architecture/admin-frontend.md` 发票管理段落补充**

```markdown
| 发票设置 | 新增 `autoIssue` Switch（默认 ON） + `autoIssueMaxAttempts`（默认 3）。关 Switch 退回到人工触发模式 |
| 发票管理列表 | REQUESTED 行若 `failedAttempts>0`，显示「自动开票失败 N 次」橙色 Tag，优先级低于「开票中」Tag |
| 发票详情 | Descriptions 区显示 failedAttempts 与 lastAutoIssueAttemptAt；状态历史区分 SYSTEM/ADMIN/BUYER |
```

- [ ] **Step 3: `docs/issues/tofix-safe.md` 不动**

本次改动无并发/资金/状态安全新风险（沿用现有 Serializable + CAS 链路），不新增条目。

- [ ] **Step 4: `plan.md` 追加**

```markdown
- [x] **发票自动开票**（2026-05-15 新增并完成）
  - **来源**: `docs/superpowers/plans/2026-05-15-invoice-auto-issue.md`
  - **实际做了**: Invoice schema 加 failedAttempts/lastAutoIssueAttemptAt；新增 INVOICE_AUTO_ISSUE 开关；requestInvoice fire-and-forget 触发 issue；SYSTEM operatorType；cron 每 10 分钟重试，达上限翻 FAILED；买家 App 文案 + refetch；管理端开关 + 失败次数显示
  - **验证**: prisma validate / 后端 Jest / admin build / app TS（不含既有 e2e 阻塞）通过
```

- [ ] **Step 5: `CLAUDE.md` 登记本 plan**

在「设计方案与实施计划」段加：

```markdown
- `docs/superpowers/plans/2026-05-15-invoice-auto-issue.md` — 发票自动开票实施计划（Schema/配置/SYSTEM 触发/cron 重试/管理端开关/买家 App 文案，**发票自动开票权威来源**）
```

- [ ] **Step 6: Commit**

```bash
git add docs/features/invoice.md docs/architecture/admin-frontend.md plan.md CLAUDE.md
git commit -m "docs(invoice): record auto-issue implementation"
```

---

### Task 12: 端到端验收

**Files:** 无代码改动

- [ ] **Step 1: staging 部署后**

push 之后 GitHub Actions 部署完，做以下手测：

1. **正常路径**：
   - admin 后台 → 发票设置 → 确认「自动开票」=ON、最大重试=3
   - 买家 App（mock 关闭走真接口）→ 已收货订单 → 申请发票
   - 后端日志看到 `[auto-issue]` 触发
   - 1 分钟内刷新订单详情 → 发票区 status=ISSUED + PDF 可点开

2. **关闭自动开票**：
   - admin 把 autoIssue 关掉 → 买家申请 → 始终 REQUESTED，无 SYSTEM history
   - admin 手工点「自动开票」→ 走 ADMIN operatorType 路径

3. **失败重试**（需要临时改 Mock provider 模拟失败一次）：
   - 买家申请 → failedAttempts=1, status=REQUESTED
   - 等 10 分钟 cron 跑 → failedAttempts=0 重置（成功）或 failedAttempts=2（再次失败）
   - 重复直到 failedAttempts=3 → status=FAILED + buyer 看到 failReason

4. **管理端可见性**：
   - 列表 REQUESTED 行 failedAttempts>0 显示橙 Tag
   - 详情显示失败次数 + 上次尝试时间
   - 状态历史里能看到 SYSTEM operator

- [ ] **Step 2: 检查 PM2 日志**

```bash
ssh staging "pm2 logs aimaimai-backend --lines 200"
```

确认无未捕获 promise rejection。

- [ ] **Step 3: 关闭 plan 任务**

在本文件顶部加 `> 状态：✅ 全部完成`。

```bash
git add docs/superpowers/plans/2026-05-15-invoice-auto-issue.md
git commit -m "docs(invoice): mark auto-issue plan as completed"
```

---

## Self-Review Notes

- 模块依赖：Task 0 验证；如有 circular 用 forwardRef
- `getInvoiceSettings` 是 `AdminInvoicesService` 现成 public method（admin 设置页在用）：买家服务复用安全
- AUTO/MOCK 失败时清理 providerRequestId（`markAutoIssueAttemptFailure` 设 null）→ cron 下次能找到这条记录
- 不与现有 `resetProviderReservation` 冲突：那个处理「reserveInvoiceForProvider 后 finalize 前进程崩」，针对 `providerRequestId IS NOT NULL` 的卡单；本计划重试针对 `providerRequestId IS NULL + failedAttempts > 0` 的软失败
- `markAutoIssueRetryExhausted` 用 Serializable + CAS 防并发：cron 多实例 / 同时人工 issue 时只有一方赢
- 单测 fixture 不需要新加配置 key（走 defaultValue 兜底）
- 不引入新的安全风险：买家不可见 failedAttempts、卖家维持只暴露 status

## 回滚预案

- 关 `INVOICE_AUTO_ISSUE` setting → 立即停止自动触发（不需要 revert 代码）
- 完整 revert：依次 `git revert` Task 11/10/9/8/7/5/4/3/2/1 commits（Task 6 无 commit）
- DB schema 不可逆：`failedAttempts` 字段保留即可，不影响旧逻辑
