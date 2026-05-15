# Invoice Chain Closure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the invoice chain end to end so buyers can apply/cancel/view/download invoices, admins can configure invoice content and issue Mock PDFs, and sellers only see invoice status.

**Architecture:** Keep the existing buyer `InvoiceService`, admin `AdminInvoicesService`, and order modules. Add invoice status history, provider fields, `InvoiceProvider` abstraction with a Mock implementation, `RuleConfig`-backed invoice settings, and minimal DTO changes so order detail/list surfaces invoice state without leaking sensitive invoice data.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest, React Native 0.81, Expo Router 6, expo-web-browser, React 19, Vite, Ant Design 5, @tanstack/react-query.

**Execution Status (2026-05-15):** ✅ Implemented and locally verified. Backend schema/config/buyer invoice/admin provider/order exposure/seller privacy, admin settings + issue flows, buyer App invoice PDF opening/order detail state, and docs sync are complete. Root App `tsc` remains blocked only by pre-existing `tests/e2e` Playwright/Node type gaps.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-15-invoice-chain-closure-design.md`
- Base invoice feature: `docs/features/invoice.md`
- Safety checklist: `docs/issues/tofix-safe.md`
- App frontend authority: `docs/architecture/frontend.md`
- Admin frontend authority: `docs/architecture/admin-frontend.md`

---

## File Structure

Backend schema and config:
- Modify `backend/prisma/schema.prisma`: add `InvoiceStatusHistory`, provider fields, `invoiceContentSnapshot`, `requestCount`, `requestedAt`.
- Create generated migration under `backend/prisma/migrations/<timestamp>_invoice_chain_closure/migration.sql`.
- Modify `backend/src/modules/admin/config/config-validation.ts`: add `INVOICE_*` validation rules.
- Modify `backend/prisma/seed.ts`: seed invoice settings defaults if the seed file already centralizes `RuleConfig`.

Backend buyer invoice:
- Create `backend/src/modules/invoice/invoice.service.spec.ts`: request/cancel/reapply/history/concurrency tests.
- Modify `backend/src/modules/invoice/invoice.service.ts`: transactional request/cancel, reapply reuse, stable errors, history writes.
- Modify `backend/src/modules/invoice/invoice.controller.ts`: no route shape change expected; keep buyer API stable.

Backend admin invoice:
- Create `backend/src/modules/admin/invoices/provider/invoice-provider.interface.ts`: provider contract.
- Create `backend/src/modules/admin/invoices/provider/mock-invoice.provider.ts`: generated PDF buffer + `UploadService.uploadBuffer()`.
- Create `backend/src/modules/admin/invoices/provider/invoice-provider.factory.ts`: provider resolver.
- Create `backend/src/modules/admin/invoices/admin-invoices.service.spec.ts`: settings, search, issue, fail, status history, sanitized `providerRaw` tests.
- Modify `backend/src/modules/admin/invoices/admin-invoices.module.ts`: import `UploadModule`, register provider/factory.
- Modify `backend/src/modules/admin/invoices/admin-invoices.service.ts`: settings API, payload builder, provider issue flow, status history.
- Modify `backend/src/modules/admin/invoices/admin-invoices.controller.ts`: add settings routes and updated issue route.
- Modify `backend/src/modules/admin/invoices/dto/admin-invoice.dto.ts`: settings DTO, issue mode DTO, manual upload/URL fields.

Backend order exposure and seller privacy:
- Create or modify `backend/src/modules/order/map-order.spec.ts`: assert buyer list/detail invoice fields.
- Modify `backend/src/modules/order/order.service.ts`: include `invoice` in list/detail queries and map safe invoice DTO.
- Modify `backend/src/modules/seller/orders/seller-orders.service.ts`: keep status-only projection; add regression test if missing.
- Modify `backend/src/modules/seller/orders/seller-orders.dto.ts`: ensure `invoiceStatus?: InvoiceStatus | null` only.
- Create or modify `backend/src/modules/seller/orders/seller-orders.service.spec.ts`: regression test that seller detail never leaks invoice private fields.

Admin frontend:
- Modify `admin/src/api/invoices.ts`: add settings types/API and issue mode types.
- Modify `admin/src/pages/invoices/index.tsx`: keyword search text, settings entry, Mock issue action, manual upload/URL flow.
- Modify `admin/src/pages/invoices/detail.tsx`: timeline, provider metadata, final content snapshot, Mock/manual issue.
- Create `admin/src/pages/invoices/settings.tsx`: invoice issuer/content/provider settings page.
- Modify `admin/src/App.tsx`: add `invoices/settings` route.
- Modify `admin/src/layouts/AdminLayout.tsx`: add menu entry near invoice management.

Buyer App:
- Modify `src/types/domain/Invoice.ts`: add fail/provider/requestedAt/history/content snapshot fields.
- Modify `src/types/domain/Order.ts`: add `invoice`, `invoiceStatus`, and `invoiceEligible`.
- Modify `src/repos/InvoiceRepo.ts`: use `requestedAt`, remove `example.com` mock PDF or replace with a locally valid mock URL in mock mode.
- Modify `src/repos/OrderRepo.ts`: mock orders may include invoice/invoiceStatus.
- Modify `src/components/cards/InvoiceSection.tsx`: use order detail invoice state, handle failed/canceled states.
- Modify `app/orders/[id].tsx`: render `InvoiceSection`, stop always showing apply action for non-VIP orders.
- Modify `app/invoices/index.tsx`: open PDF using `expo-web-browser`, show `requestedAt`.
- Modify `app/invoices/[id].tsx`: open PDF using `expo-web-browser`, refresh order/invoice caches after cancel.
- Modify `app/(tabs)/me.tsx`: add “我的发票” tool entry.

Docs:
- Modify `docs/features/invoice.md`: mark this closure scope and provider abstraction.
- Modify `docs/architecture/frontend.md`: update buyer invoice entry/order-detail status.
- Modify `docs/architecture/admin-frontend.md`: update invoice settings page.
- Modify `plan.md`: record invoice chain closure task.
- Modify `AGENTS.md`: register this implementation plan.

---

## Chunk 1: Backend Schema, Config, And Buyer Invoice Safety

### Task 1: Schema Migration And Config Validation

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_invoice_chain_closure/migration.sql`
- Modify: `backend/src/modules/admin/config/config-validation.ts`
- Modify: `backend/prisma/seed.ts`
- Test: `backend/src/modules/admin/config/config-validation.spec.ts` if present; otherwise create it.

- [ ] **Step 1: Write config validation tests**

Create or extend `backend/src/modules/admin/config/config-validation.spec.ts`:

```ts
import { validateConfigValue } from './config-validation';

describe('invoice config validation', () => {
  it('accepts valid invoice provider mode and line mode', () => {
    expect(validateConfigValue('INVOICE_PROVIDER_MODE', 'MOCK')).toBeNull();
    expect(validateConfigValue('INVOICE_LINE_MODE', 'ORDER_ITEMS')).toBeNull();
    expect(validateConfigValue('INVOICE_LINE_MODE', 'MERGED_CATEGORY')).toBeNull();
  });

  it('rejects invalid invoice tax rate and issuer profile', () => {
    expect(validateConfigValue('INVOICE_DEFAULT_TAX_RATE', 0.2)).toContain('INVOICE_DEFAULT_TAX_RATE');
    expect(validateConfigValue('INVOICE_ISSUER_PROFILE', { companyName: '', taxNo: '' })).toContain('companyName');
  });

  it('rejects unknown remark variables', () => {
    expect(validateConfigValue('INVOICE_REMARK_TEMPLATE', '订单 {{orderId}} {{token}}')).toContain('白名单');
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd backend
npx jest src/modules/admin/config/config-validation.spec.ts --runInBand
```

Expected: FAIL because `INVOICE_*` rules are not implemented.

- [ ] **Step 3: Add Prisma model fields**

Update `backend/prisma/schema.prisma`:

```prisma
model Invoice {
  id                     String        @id @default(cuid())
  orderId                String        @unique
  order                  Order         @relation(fields: [orderId], references: [id])
  profileSnapshot        Json
  status                 InvoiceStatus @default(REQUESTED)
  invoiceNo              String?
  pdfUrl                 String?
  failReason             String?
  provider               String?
  providerRequestId      String?
  providerRaw            Json?
  invoiceContentSnapshot Json?
  requestCount           Int           @default(1)
  requestedAt            DateTime      @default(now())
  issuedAt               DateTime?
  failedAt               DateTime?
  canceledAt             DateTime?
  createdAt              DateTime      @default(now())
  updatedAt              DateTime      @updatedAt

  statusHistory          InvoiceStatusHistory[]

  @@index([status])
  @@index([providerRequestId])
}

model InvoiceStatusHistory {
  id           String         @id @default(cuid())
  invoiceId    String
  invoice      Invoice        @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  fromStatus   InvoiceStatus?
  toStatus     InvoiceStatus
  reason       String?
  operatorId   String?
  operatorType String?
  metadata     Json?
  createdAt    DateTime       @default(now())

  @@index([invoiceId, createdAt])
}
```

- [ ] **Step 4: Add config validation rules**

In `backend/src/modules/admin/config/config-validation.ts`, add string support if needed:

```ts
export type ConfigValueType = 'number' | 'integer' | 'boolean' | 'json' | 'string';
```

Add rules for:

```ts
INVOICE_PROVIDER_MODE
INVOICE_ALLOW_VIP_PACKAGE
INVOICE_LINE_MODE
INVOICE_DEFAULT_TAX_RATE
INVOICE_DEFAULT_TAX_CLASSIFICATION_CODE
INVOICE_DEFAULT_GOODS_NAME
INVOICE_REMARK_TEMPLATE
INVOICE_ISSUER_PROFILE
```

Use custom validation for enum strings, template variables, and issuer profile required fields. Do not allow key-like fields such as `appSecret`, `token`, `privateKey`, `cert`, `password`.

- [ ] **Step 5: Generate migration and Prisma client**

Run:

```bash
cd backend
npx prisma migrate dev --name invoice_chain_closure
npx prisma generate
```

Expected: migration generated and Prisma Client updated.

- [ ] **Step 6: Edit migration to preserve existing request times**

Open the generated migration and make sure existing rows preserve their original application time:

```sql
ALTER TABLE "Invoice" ADD COLUMN "requestedAt" TIMESTAMP(3);
UPDATE "Invoice" SET "requestedAt" = "createdAt" WHERE "requestedAt" IS NULL;
ALTER TABLE "Invoice" ALTER COLUMN "requestedAt" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "requestedAt" SET DEFAULT CURRENT_TIMESTAMP;
```

If Prisma generated a single `ADD COLUMN "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`, replace that part with the four-step sequence above. This avoids rewriting historical invoices to the migration time.

- [ ] **Step 7: Seed invoice defaults**

In `backend/prisma/seed.ts`, add or extend the existing `RuleConfig` seeding block with upserts:

```ts
const invoiceConfigDefaults = {
  INVOICE_PROVIDER_MODE: 'MOCK',
  INVOICE_ALLOW_VIP_PACKAGE: false,
  INVOICE_LINE_MODE: 'ORDER_ITEMS',
  INVOICE_DEFAULT_TAX_RATE: 0,
  INVOICE_DEFAULT_TAX_CLASSIFICATION_CODE: '',
  INVOICE_DEFAULT_GOODS_NAME: '农产品',
  INVOICE_REMARK_TEMPLATE: '订单号：{{orderId}}',
  INVOICE_ISSUER_PROFILE: {
    companyName: '爱买买app',
    taxNo: '<PLATFORM_TAX_NO>',
    registeredAddress: '',
    registeredPhone: '',
    bankName: '',
    bankAccount: '',
    drawer: '系统开票',
    reviewer: '',
    payee: '',
  },
};
```

Follow the existing seed shape and store `{ value, description }`, not a raw scalar:

```ts
await prisma.ruleConfig.upsert({
  where: { key },
  update: {},
  create: { key, value: { value, description } },
});
```

Settings readers must normalize both shapes because existing code may encounter wrapped and raw values:

```ts
const unwrapRuleValue = (row: { value: unknown } | null | undefined, fallback: unknown) => {
  const raw = row?.value as any;
  return raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw ?? fallback;
};
```

Use this helper for `INVOICE_ALLOW_VIP_PACKAGE` so `{ value: false, description: '...' }` is treated as `false`, not as a truthy object.

- [ ] **Step 8: Verify schema and config tests**

Run:

```bash
cd backend
npx prisma validate
npx jest src/modules/admin/config/config-validation.spec.ts --runInBand
```

Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/modules/admin/config/config-validation.ts backend/src/modules/admin/config/config-validation.spec.ts backend/prisma/seed.ts
git commit -m "feat(invoice): add invoice schema and config rules"
```

### Task 2: Buyer Invoice Request, Cancel, And Reapply

**Files:**
- Create: `backend/src/modules/invoice/invoice.service.spec.ts`
- Modify: `backend/src/modules/invoice/invoice.service.ts`

- [ ] **Step 1: Write failing buyer service tests**

Create `backend/src/modules/invoice/invoice.service.spec.ts` with mocked Prisma transaction tests covering:

- `RECEIVED` order creates `Invoice` and `InvoiceStatusHistory`.
- non-owner order returns forbidden/not found.
- non-`RECEIVED` order fails.
- existing `REQUESTED` or `ISSUED` invoice returns stable `ConflictException`.
- existing `CANCELED` or `FAILED` invoice is reused, `requestCount` increments, stale issue fields are cleared, `requestedAt` updates.
- company profile without `taxNo` fails.
- `VIP_PACKAGE` order fails when `INVOICE_ALLOW_VIP_PACKAGE=false`.
- `VIP_PACKAGE` order can apply when `INVOICE_ALLOW_VIP_PACKAGE=true`.
- cancel uses `updateMany({ id, status: REQUESTED })` and writes `canceledAt` + history.

Core expectation:

```ts
expect(tx.invoice.update).toHaveBeenCalledWith(expect.objectContaining({
  where: { id: 'inv-1' },
  data: expect.objectContaining({
    status: 'REQUESTED',
    invoiceNo: null,
    pdfUrl: null,
    provider: null,
    requestCount: { increment: 1 },
  }),
}));
```

- [ ] **Step 2: Run buyer invoice tests and verify failure**

Run:

```bash
cd backend
npx jest src/modules/invoice/invoice.service.spec.ts --runInBand
```

Expected: FAIL because service is not transactional and has no history/reapply logic.

- [ ] **Step 3: Implement transaction helper and snapshot builder**

In `backend/src/modules/invoice/invoice.service.ts`:

- add a `runSerializable()` retry helper for `P2034`.
- add `buildProfileSnapshot(profile)`.
- add `getInvoiceAllowVipPackage(tx)` that reads `RuleConfig.INVOICE_ALLOW_VIP_PACKAGE` and defaults to `false`.
- use `Prisma.TransactionIsolationLevel.Serializable`.
- catch `P2002` and map to `ConflictException('该订单已申请过发票')`.

- [ ] **Step 4: Implement request/reapply**

Inside the transaction:

- query order with `invoice`.
- enforce ownership and `RECEIVED`.
- if `order.bizType === 'VIP_PACKAGE'`, read `INVOICE_ALLOW_VIP_PACKAGE`; reject VIP invoices when the config is missing or `false`.
- query profile by `profileId`.
- validate company tax number.
- if no invoice, create `Invoice` with `requestedAt: new Date()` and create status history.
- if invoice status is `CANCELED` or `FAILED`, update same invoice row back to `REQUESTED`, clear stale issued fields, increment `requestCount`, update `requestedAt`, create status history.
- if status is `REQUESTED` or `ISSUED`, throw stable conflict.

- [ ] **Step 5: Implement cancel with CAS**

Use:

```ts
const result = await tx.invoice.updateMany({
  where: { id: invoiceId, status: 'REQUESTED', providerRequestId: null },
  data: { status: 'CANCELED', canceledAt: now },
});
```

Then write `InvoiceStatusHistory`. If `count === 0`, throw `ConflictException('发票状态已变更或正在开票，请刷新后重试')`.

- [ ] **Step 6: Return normalized invoice detail/list**

Include:

- `requestedAt`
- `failReason`
- `statusHistory` in detail
- list ordering by `requestedAt desc`

- [ ] **Step 7: Run tests**

```bash
cd backend
npx jest src/modules/invoice/invoice.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/invoice/invoice.service.ts backend/src/modules/invoice/invoice.service.spec.ts
git commit -m "fix(invoice): make buyer invoice requests transactional"
```

---

## Chunk 2: Admin Provider, Settings, And Order Exposure

### Task 3: Admin Invoice Provider And Settings API

**Files:**
- Create: `backend/src/modules/admin/invoices/provider/invoice-provider.interface.ts`
- Create: `backend/src/modules/admin/invoices/provider/mock-invoice.provider.ts`
- Create: `backend/src/modules/admin/invoices/provider/invoice-provider.factory.ts`
- Create: `backend/src/modules/admin/invoices/admin-invoices.service.spec.ts`
- Modify: `backend/src/modules/admin/invoices/admin-invoices.module.ts`
- Modify: `backend/src/modules/admin/invoices/admin-invoices.service.ts`
- Modify: `backend/src/modules/admin/invoices/admin-invoices.controller.ts`
- Modify: `backend/src/modules/admin/invoices/dto/admin-invoice.dto.ts`

- [ ] **Step 1: Write failing admin service tests**

In `backend/src/modules/admin/invoices/admin-invoices.service.spec.ts`, cover:

- `findAll({ keyword })` searches `invoiceNo`, exact `order.id`, and `profileSnapshot.title`.
- `getInvoiceSettings()` returns defaults when `RuleConfig` rows are missing.
- `updateInvoiceSettings()` validates and upserts every `INVOICE_*` key.
- `issueInvoice(mode=AUTO)` builds payload from order/config, calls Mock provider, writes `ISSUED`, provider fields, `invoiceContentSnapshot`, `issuedAt`, and history.
- `issueInvoice(mode=MANUAL)` requires `invoiceNo` and `pdfUrl`, writes provider `MANUAL`.
- provider failure writes `FAILED`, `failedAt`, sanitized `providerRaw`, and history.
- `failInvoice()` writes `failedAt` and history.
- automatic/Mock provider issue reserves a deterministic `providerRequestId` before calling provider, calls provider outside the Serializable retry block, and never calls provider twice for one issue attempt.

Key assertion:

```ts
expect(tx.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
  where: { id: 'inv-1', status: 'REQUESTED' },
  data: expect.objectContaining({
    status: 'ISSUED',
    provider: 'MOCK',
    invoiceContentSnapshot: expect.objectContaining({
      buyer: expect.objectContaining({ title: '深圳某公司', taxNo: '9144...' }),
      issuer: expect.objectContaining({ companyName: '爱买买app' }),
      lines: expect.any(Array),
    }),
  }),
}));
```

- [ ] **Step 2: Run admin tests and verify failure**

```bash
cd backend
npx jest src/modules/admin/invoices/admin-invoices.service.spec.ts --runInBand
```

Expected: FAIL because provider/settings/history are missing.

- [ ] **Step 3: Add provider interface and Mock provider**

Implement `invoice-provider.interface.ts`:

```ts
export type InvoiceIssueInput = {
  invoiceId: string;
  providerRequestId: string;
  order: { id: string; totalAmount: number; paidAt?: Date | null; items: Array<{ title: string; quantity: number; unitPrice: number; amount: number }> };
  buyerSnapshot: Record<string, unknown>;
  issuerProfile: Record<string, unknown>;
  lines: Array<{ name: string; quantity: number; unitPrice: number; amount: number; taxRate: number; taxClassificationCode?: string }>;
  remark?: string;
};

export type InvoiceIssueResult = {
  invoiceNo: string;
  pdfUrl: string;
  provider: string;
  providerRequestId: string;
  raw?: Record<string, unknown>;
};

export interface InvoiceProvider {
  issue(input: InvoiceIssueInput): Promise<InvoiceIssueResult>;
}
```

`mock-invoice.provider.ts` should generate a minimal PDF buffer and call:

```ts
await this.uploadService.uploadBuffer(buffer, 'invoices/mock', 'pdf', 'application/pdf');
```

- [ ] **Step 4: Register provider dependencies**

Modify `backend/src/modules/admin/invoices/admin-invoices.module.ts`:

- import `UploadModule`
- provide `MockInvoiceProvider`
- provide `InvoiceProviderFactory`

- [ ] **Step 5: Add settings DTO and routes**

In `admin-invoice.dto.ts`, keep existing query/fail DTOs and add decorated DTOs. This project uses global `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`, so every accepted request field must have a `class-validator` decorator.

```ts
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

class InvoiceIssuerProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  companyName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  taxNo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  registeredAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  registeredPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  bankAccount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  drawer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  reviewer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  payee?: string;
}

export class UpdateInvoiceSettingsDto {
  @IsOptional()
  @IsIn(['MOCK'])
  providerMode?: 'MOCK';

  @IsOptional()
  @IsBoolean()
  allowVipPackage?: boolean;

  @IsOptional()
  @IsIn(['ORDER_ITEMS', 'MERGED_CATEGORY'])
  lineMode?: 'ORDER_ITEMS' | 'MERGED_CATEGORY';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.13)
  defaultTaxRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  defaultTaxClassificationCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultGoodsName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarkTemplate?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InvoiceIssuerProfileDto)
  issuerProfile?: InvoiceIssuerProfileDto;
}

export class IssueInvoiceDto {
  @IsIn(['AUTO', 'MOCK', 'MANUAL'])
  mode!: 'AUTO' | 'MOCK' | 'MANUAL';

  @ValidateIf((dto) => dto.mode === 'MANUAL')
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  invoiceNo?: string;

  @ValidateIf((dto) => dto.mode === 'MANUAL')
  @IsUrl({ require_protocol: true, require_tld: false })
  @MaxLength(2048)
  pdfUrl?: string;
}
```

Controller routes must be declared before `@Get(':id')`, otherwise `settings` can be treated as an invoice id by the dynamic route. Import `Put` from `@nestjs/common`.

```ts
@Get('settings')
@RequirePermission('invoices:issue')
getSettings()

@Put('settings')
@RequirePermission('invoices:issue')
@AuditLog({ action: 'CONFIG_CHANGE', module: 'invoices', targetType: 'InvoiceSettings' })
updateSettings(@Body() dto: UpdateInvoiceSettingsDto)
```

- [ ] **Step 6: Implement payload builder and issue flow**

In `AdminInvoicesService`:

- `getInvoiceSettings()`
- `updateInvoiceSettings(dto)`
- `buildInvoicePayload(invoice, settings)`
- `renderRemark(template, vars)`
- `sanitizeProviderRaw(raw)`
- `issueInvoice(invoiceId, dto, adminId?)`
- `failInvoice(invoiceId, dto, adminId?)`

Keep `Invoice.orderId @unique`; do not create extra invoices.

Provider issue flow must avoid external side effects inside retryable Serializable transactions:

1. For `AUTO`/`MOCK`, start a short Serializable transaction and reserve the invoice with CAS:
   ```ts
   updateMany({
     where: { id: invoiceId, status: 'REQUESTED', providerRequestId: null },
     data: {
       provider,
       providerRequestId: `invoice-${invoiceId}-${invoice.requestCount}`,
     },
   })
   ```
2. Commit the reservation before calling `provider.issue(input)`.
3. Call provider outside the transaction and pass the deterministic `providerRequestId` as the provider idempotency key.
4. Finalize in a second short Serializable transaction:
   ```ts
   updateMany({
     where: { id: invoiceId, status: 'REQUESTED', providerRequestId },
     data: { status: 'ISSUED', invoiceNo, pdfUrl, providerRaw, invoiceContentSnapshot, issuedAt },
   })
   ```
5. If provider fails, use the same `where: { id, status: 'REQUESTED', providerRequestId }` guard to mark `FAILED`.
6. Update buyer `cancelInvoice()` CAS to require `providerRequestId: null`, so an invoice reserved for provider issue cannot be canceled mid-issue.

Manual issue has no external provider side effect and can remain a single Serializable + CAS transaction.

- [ ] **Step 7: Run admin tests**

```bash
cd backend
npx jest src/modules/admin/invoices/admin-invoices.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/admin/invoices backend/src/modules/admin/config/config-validation.ts
git commit -m "feat(admin/invoices): add settings and mock provider issue flow"
```

### Task 4: Buyer Order Invoice Fields And Seller Privacy

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/order/map-order.spec.ts`
- Modify: `backend/src/modules/seller/orders/seller-orders.service.ts`
- Modify: `backend/src/modules/seller/orders/seller-orders.dto.ts`
- Create or modify: `backend/src/modules/seller/orders/seller-orders.service.spec.ts`

- [ ] **Step 1: Write failing order mapping tests**

Extend `backend/src/modules/order/map-order.spec.ts`:

```ts
it('mapOrder exposes invoiceStatus only in list shape', () => {
  const out = (service as any).mapOrder({
    id: 'o1',
    status: 'RECEIVED',
    bizType: 'NORMAL_GOODS',
    totalAmount: 100,
    createdAt: new Date(),
    items: [],
    shipments: [],
    afterSaleRequests: [],
    refunds: [],
    invoice: { status: 'REQUESTED' },
  });

  expect(out.invoiceStatus).toBe('REQUESTED');
  expect(out.invoiceEligible).toBe(false);
  expect(out.invoice).toBeUndefined();
});

it('mapOrderDetail exposes safe invoice detail without tax number leakage in list-only fields', () => {
  const out = (service as any).mapOrderDetail({
    id: 'o1',
    userId: 'u1',
    status: 'RECEIVED',
    bizType: 'NORMAL_GOODS',
    totalAmount: 100,
    goodsAmount: 100,
    shippingFee: 0,
    createdAt: new Date(),
    items: [],
    shipments: [],
    statusHistory: [],
    payments: [],
    refunds: [],
    afterSaleRequests: [],
    invoice: {
      id: 'inv1',
      status: 'ISSUED',
      invoiceNo: 'MOCK-1',
      pdfUrl: 'http://localhost/inv.pdf',
      requestedAt: new Date(),
      issuedAt: new Date(),
      failReason: null,
      profileSnapshot: { type: 'COMPANY', title: '某公司', taxNo: '9144' },
    },
  });

  expect(out.invoice).toMatchObject({ id: 'inv1', status: 'ISSUED', invoiceNo: 'MOCK-1' });
  expect(out.invoice.profileSnapshot).toEqual({ type: 'COMPANY', title: '某公司' });
  expect(out.invoiceEligible).toBe(false);
});
```

- [ ] **Step 2: Run mapping tests and verify failure**

```bash
cd backend
npx jest src/modules/order/map-order.spec.ts --runInBand
```

Expected: FAIL because order queries/mappers do not include invoice.

- [ ] **Step 3: Include invoice in buyer order queries**

In `OrderService.list()` include:

```ts
invoice: { select: { status: true } }
```

In `OrderService.getById()` include safe detail fields:

```ts
invoice: {
  select: {
    id: true,
    status: true,
    invoiceNo: true,
    pdfUrl: true,
    requestedAt: true,
    issuedAt: true,
    failReason: true,
    profileSnapshot: true,
  },
}
```

- [ ] **Step 4: Map safe invoice data**

In `mapOrder()` add `invoiceStatus: order.invoice?.status ?? null`.

In `mapOrderDetail()` add:

```ts
invoice: order.invoice ? {
  id: order.invoice.id,
  status: order.invoice.status,
  invoiceNo: order.invoice.invoiceNo,
  pdfUrl: order.invoice.pdfUrl,
  requestedAt: order.invoice.requestedAt?.toISOString?.() ?? order.invoice.requestedAt,
  issuedAt: order.invoice.issuedAt?.toISOString?.() ?? null,
  failReason: order.invoice.failReason,
  profileSnapshot: {
    type: (order.invoice.profileSnapshot as any)?.type,
    title: (order.invoice.profileSnapshot as any)?.title,
  },
} : null
```

Also add `invoiceEligible` in both list and detail DTOs:

```ts
invoiceEligible:
  order.status === 'RECEIVED' &&
  !order.invoice &&
  ((order.bizType || 'NORMAL_GOODS') !== 'VIP_PACKAGE' || allowVipPackage),
```

For list mapping, if reading `allowVipPackage` would add extra DB work, it is acceptable to return `invoiceEligible` only on detail and keep list as `false` or omit it; the order-detail page is the source for the apply button.

- [ ] **Step 5: Add seller privacy regression**

If no seller order spec exists, create `backend/src/modules/seller/orders/seller-orders.service.spec.ts` with a small test around `findById()` mocked Prisma result. Assert returned object has `invoiceStatus`, and does not have `profileSnapshot`, `pdfUrl`, `invoiceNo`, `taxNo`, `phone`, or `email`.

- [ ] **Step 6: Run backend test subset**

```bash
cd backend
npx jest src/modules/order/map-order.spec.ts src/modules/seller/orders/seller-orders.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/order/order.service.ts backend/src/modules/order/map-order.spec.ts backend/src/modules/seller/orders
git commit -m "fix(orders): expose invoice state without seller leakage"
```

---

## Chunk 3: Admin Frontend

### Task 5: Admin Invoice API Types And Settings Page

**Files:**
- Modify: `admin/src/api/invoices.ts`
- Create: `admin/src/pages/invoices/settings.tsx`
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/layouts/AdminLayout.tsx`

- [ ] **Step 1: Add API types first**

In `admin/src/api/invoices.ts`, add:

```ts
export type InvoiceIssueMode = 'AUTO' | 'MOCK' | 'MANUAL';

export interface InvoiceSettings {
  providerMode: 'MOCK';
  allowVipPackage: boolean;
  lineMode: 'ORDER_ITEMS' | 'MERGED_CATEGORY';
  defaultTaxRate: number;
  defaultTaxClassificationCode: string;
  defaultGoodsName: string;
  remarkTemplate: string;
  issuerProfile: {
    companyName: string;
    taxNo: string;
    registeredAddress?: string;
    registeredPhone?: string;
    bankName?: string;
    bankAccount?: string;
    drawer?: string;
    reviewer?: string;
    payee?: string;
  };
}
```

Add:

```ts
export const getInvoiceSettings = (): Promise<InvoiceSettings> =>
  client.get('/admin/invoices/settings');

export const updateInvoiceSettings = (data: Partial<InvoiceSettings>): Promise<{ ok: boolean }> =>
  client.put('/admin/invoices/settings', data);
```

Update `issueInvoice()` payload to support:

```ts
{ mode: 'AUTO' | 'MOCK' } | { mode: 'MANUAL'; invoiceNo: string; pdfUrl: string }
```

- [ ] **Step 2: Create settings page**

Create `admin/src/pages/invoices/settings.tsx` with:

- React Query v5 object syntax:
  ```ts
  useQuery({
    queryKey: ['admin', 'invoice-settings'],
    queryFn: getInvoiceSettings,
  })
  ```
- `ProForm`
- sections: issuer profile, line rule, tax rule, remark template, provider
- save via `updateInvoiceSettings`
- `const { message } = App.useApp();`
- no static `message`, `Modal.confirm`, or `notification`

- [ ] **Step 3: Register route and menu**

In `admin/src/App.tsx`:

```ts
const InvoiceSettingsPage = lazy(() => import('@/pages/invoices/settings'));
...
<Route path="invoices/settings" element={<InvoiceSettingsPage />} />
```

In `admin/src/layouts/AdminLayout.tsx`, under transaction routes:

```ts
{ path: '/invoices/settings', name: '发票设置', permission: PERMISSIONS.INVOICES_ISSUE }
```

- [ ] **Step 4: Build admin**

```bash
cd admin
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/src/api/invoices.ts admin/src/pages/invoices/settings.tsx admin/src/App.tsx admin/src/layouts/AdminLayout.tsx
git commit -m "feat(admin/invoices): add invoice settings page"
```

### Task 6: Admin Invoice List And Detail Issue Flow

**Files:**
- Modify: `admin/src/pages/invoices/index.tsx`
- Modify: `admin/src/pages/invoices/detail.tsx`
- Modify: `admin/src/api/invoices.ts`

- [ ] **Step 1: Update invoice types**

Add to admin `Invoice`:

- `requestedAt`
- `provider`
- `providerRequestId`
- `invoiceContentSnapshot`
- `statusHistory`
- `failedAt`
- `canceledAt`

- [ ] **Step 2: List page actions**

In `index.tsx`:

- change application time from `createdAt` to `requestedAt`.
- add toolbar button “发票设置” to navigate `/invoices/settings`.
- for `REQUESTED` row, show:
  - `自动开票`
  - `人工开票`
  - `失败`
- `自动开票` calls `issueInvoice(id, { mode: 'MOCK' })`.
- `人工开票` keeps modal for `invoiceNo + pdfUrl`.

- [ ] **Step 3: Detail page content**

In `detail.tsx`:

- show status history timeline.
- show provider/providerRequestId.
- show `invoiceContentSnapshot` if present:
  - buyer
  - issuer
  - lines
  - remark
- if no snapshot yet, show preview from order/profile with “待开票，以开票时配置为准”.
- use `requestedAt` for apply time.

- [ ] **Step 4: Manual PDF handling**

Manual issue must support both upload and URL paste:

- accept only PDF.
- use Ant Design `Upload` or `Upload.Dragger` with `accept="application/pdf"` and `action={`${API_BASE}/upload?folder=invoices/manual`}`.
- include admin auth header, otherwise `AnyAuthGuard` will reject the upload:
  ```tsx
  <Upload
    accept="application/pdf"
    action={`${API_BASE}/upload?folder=invoices/manual`}
    headers={{
      Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}`,
    }}
  />
  ```
- read upload response URL and fill `pdfUrl`.
- keep URL paste input for PDFs generated in a third-party system.
- require `invoiceNo` plus either uploaded `pdfUrl` or pasted `pdfUrl`.

The backend upload allowlist already includes `application/pdf`; do not defer upload support.

- [ ] **Step 5: Build admin**

```bash
cd admin
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add admin/src/api/invoices.ts admin/src/pages/invoices/index.tsx admin/src/pages/invoices/detail.tsx
git commit -m "feat(admin/invoices): wire mock and manual issue actions"
```

---

## Chunk 4: Buyer App

### Task 7: Buyer Types, Repos, And PDF Opening

**Files:**
- Modify: `src/types/domain/Invoice.ts`
- Modify: `src/types/domain/Order.ts`
- Modify: `src/repos/InvoiceRepo.ts`
- Modify: `src/repos/OrderRepo.ts`
- Modify: `app/invoices/index.tsx`
- Modify: `app/invoices/[id].tsx`

- [ ] **Step 1: Update domain types**

In `Invoice.ts`, add:

```ts
export type InvoiceStatusHistory = {
  id: string;
  fromStatus?: InvoiceStatus | null;
  toStatus: InvoiceStatus;
  reason?: string | null;
  operatorType?: 'BUYER' | 'ADMIN' | 'SYSTEM' | 'PROVIDER' | string;
  createdAt: string;
};
```

Extend `Invoice` with:

- `failReason?: string | null`
- `requestedAt: string`
- `provider?: string | null`
- `providerRequestId?: string | null`
- `statusHistory?: InvoiceStatusHistory[]`

In `Order.ts`, import `Invoice, InvoiceStatus` and add:

```ts
invoiceEligible?: boolean;
invoiceStatus?: InvoiceStatus | null;
invoice?: Pick<Invoice, 'id' | 'status' | 'invoiceNo' | 'pdfUrl' | 'requestedAt' | 'issuedAt' | 'failReason' | 'profileSnapshot'> | null;
```

- [ ] **Step 2: Update mock data**

In `InvoiceRepo.ts`:

- add `requestedAt` to mocks.
- replace `https://example.com/invoice/...` with a URL that is clearly mock-only or route through local upload in dev.
- update mock `requestInvoice()` to prevent duplicate active request and support reapply after canceled/failed.

In `OrderRepo.ts`, mock `getById()` should return orders with `invoice` if the mock invoice exists for the order.

- [ ] **Step 3: Add PDF open helper**

In `app/invoices/index.tsx` and `app/invoices/[id].tsx`:

```ts
import * as WebBrowser from 'expo-web-browser';

const openPdf = async (url?: string | null) => {
  if (!url || !/^https?:\/\//.test(url)) {
    show({ message: '发票 PDF 地址无效', type: 'error' });
    return;
  }
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    show({ message: '无法打开发票 PDF，请稍后重试', type: 'error' });
  }
};
```

Stop using toast-only “正在打开”.

- [ ] **Step 4: Cache invalidation after cancel**

After cancel:

```ts
queryClient.invalidateQueries({ queryKey: ['invoices'] });
queryClient.invalidateQueries({ queryKey: ['invoice-detail', invoice.id] });
queryClient.invalidateQueries({ queryKey: ['order', invoice.orderId] });
queryClient.invalidateQueries({ queryKey: ['orders'] });
```

- [ ] **Step 5: Run TypeScript check**

Because root `npx tsc --noEmit` currently fails on unrelated `tests/e2e` types, use the project-approved App type command if one exists. If none exists, run:

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: either PASS, or only the known unrelated e2e Node/Playwright type failures documented in the final verification.

- [ ] **Step 6: Commit**

```bash
git add src/types/domain/Invoice.ts src/types/domain/Order.ts src/repos/InvoiceRepo.ts src/repos/OrderRepo.ts app/invoices/index.tsx app/invoices/[id].tsx
git commit -m "feat(app/invoices): open issued invoice PDFs"
```

### Task 8: Buyer Order Detail And My Page Entry

**Files:**
- Modify: `src/components/cards/InvoiceSection.tsx`
- Modify: `app/orders/[id].tsx`
- Modify: `app/(tabs)/me.tsx`

- [ ] **Step 1: Make `InvoiceSection` state complete**

Update `InvoiceSection`:

- Accept `invoice?: Order['invoice'] | null`.
- Accept `invoiceEligible?: boolean`.
- Allow apply only when `orderStatus === 'RECEIVED'`, not `DELIVERED`.
- Show apply/reapply only when `invoiceEligible === true`; do not hard-code VIP blocking in the App. The backend decides VIP eligibility from `INVOICE_ALLOW_VIP_PACKAGE`.
- `FAILED`: show reason and “重新申请” action.
- `CANCELED`: show “重新申请” action.
- `REQUESTED`: link to detail for cancel.
- `ISSUED`: link to detail/open PDF.

- [ ] **Step 2: Wire order detail**

In `app/orders/[id].tsx`:

- import `InvoiceSection`.
- pass `order.invoice`.
- pass `order.invoiceEligible`.
- remove unconditional `onApplyInvoice={!isVip ? ...}` from `OrderInfoBlock`.
- place invoice block near order info or inside the order info section, matching current layout density.

- [ ] **Step 3: Add My page entry**

In `app/(tabs)/me.tsx`, add to `TOOL_GRID`:

```ts
{ label: '我的发票', icon: 'file-document-outline' as const, route: '/invoices' },
```

- [ ] **Step 4: Run App check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no new invoice/order type errors. Known unrelated e2e errors must be documented if they still appear.

- [ ] **Step 5: Commit**

```bash
git add src/components/cards/InvoiceSection.tsx app/orders/[id].tsx 'app/(tabs)/me.tsx'
git commit -m "feat(app/orders): show invoice state on order detail"
```

---

## Chunk 5: Verification, Docs, And Review

### Task 9: Full Verification

**Files:**
- No source changes unless verification exposes a defect.

- [ ] **Step 1: Backend schema and tests**

```bash
cd backend
npx prisma validate
npx jest src/modules/invoice/invoice.service.spec.ts src/modules/admin/invoices/admin-invoices.service.spec.ts src/modules/order/map-order.spec.ts src/modules/seller/orders/seller-orders.service.spec.ts --runInBand
npm run build
```

Expected: PASS.

- [ ] **Step 2: Admin build**

```bash
cd admin
npm run build
```

Expected: PASS.

- [ ] **Step 3: Seller build**

```bash
cd seller
npm run build
```

Expected: PASS.

- [ ] **Step 4: App type check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no new invoice/order errors. If unrelated `tests/e2e` Node/Playwright failures remain, copy the exact first failing lines into the implementation summary and do not claim root tsc is clean.

- [ ] **Step 5: Manual chain check**

Run backend/admin/app dev servers if needed and verify:

1. Buyer creates profile and applies invoice from `RECEIVED` normal order.
2. Order detail immediately shows `REQUESTED`.
3. Admin list finds invoice by order ID and title.
4. Admin settings save issuer profile and line rules.
5. Admin Mock issue creates invoice number and real uploaded PDF URL.
6. Buyer invoice detail opens PDF through browser.
7. Seller order detail only shows `invoiceStatus`.

### Task 10: Documentation And Mandatory Review

**Files:**
- Modify: `docs/features/invoice.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/admin-frontend.md`
- Modify: `docs/issues/tofix-safe.md` if new safety findings exist.
- Modify: `plan.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Sync docs**

Update:

- `docs/features/invoice.md`: current status, Mock provider, settings page, one-order-one-invoice reapply rule.
- `docs/architecture/frontend.md`: My invoice entry, order detail invoice state, PDF open behavior.
- `docs/architecture/admin-frontend.md`: invoice settings page and Mock/manual issue actions.
- `plan.md`: mark/add invoice chain closure task.
- `AGENTS.md`: ensure this plan is listed.

- [ ] **Step 2: Safety checklist**

Review `docs/issues/tofix-safe.md` for amount/status/concurrency rules:

- Serializable transactions for request/cancel/issue/fail.
- CAS for state transition.
- no credentials in committed docs.
- no tax number, phone, bank account, provider token, certificate path, private PDF URL, or raw provider payload in application logs.
- seller privacy.

If a new issue is discovered, append it before final verification.

- [ ] **Step 3: Dispatch code review Agent**

Use a read-only Explorer/code-review agent. Ask it to inspect the diff for:

- Prisma relations/indexes.
- invoice status history correctness.
- Serializable/CAS coverage.
- providerRaw redaction.
- log redaction for invoice profile/provider data.
- admin settings permission/audit.
- buyer/admin/seller DTO consistency.
- App route and type consistency.
- docs sync.

- [ ] **Step 4: Fix Critical/High review findings**

Fix every Critical/High finding. For Medium findings, either fix or document why it is deferred. Low findings can be recorded.

- [ ] **Step 5: Final commit**

```bash
git add docs/features/invoice.md docs/architecture/frontend.md docs/architecture/admin-frontend.md docs/issues/tofix-safe.md plan.md AGENTS.md
git commit -m "docs(invoice): record invoice chain closure"
```

---

## Acceptance Checklist

- [ ] Buyer can apply invoice only for eligible `RECEIVED` orders.
- [ ] When `INVOICE_ALLOW_VIP_PACKAGE=true`, eligible VIP package orders expose `invoiceEligible=true` and the App can apply from order detail.
- [ ] Buyer cannot duplicate active invoice requests for one order.
- [ ] Buyer can reapply after `CANCELED` or `FAILED`, reusing the same `Invoice` row.
- [ ] Buyer can cancel only `REQUESTED` invoice with CAS protection.
- [ ] Admin can configure issuer, line mode, tax rate/classification, remark template, and provider mode.
- [ ] Admin can issue through Mock provider and produce an accessible PDF URL.
- [ ] Admin can manually issue with invoice number + PDF URL.
- [ ] Admin can mark failure and buyer can see reason.
- [ ] Invoice status history records create/cancel/issue/fail/reapply.
- [ ] Buyer order list returns at most `invoiceStatus`.
- [ ] Buyer order detail returns safe invoice summary.
- [ ] Seller order detail returns only `invoiceStatus`.
- [ ] `providerRaw` contains no secrets, signatures, tokens, certs, full bank account, phone, or private PDF params.
- [ ] Logs do not print tax numbers, phone numbers, bank accounts, provider credentials, or private invoice PDF URLs.
- [ ] `npx prisma validate`, backend build, admin build, seller build pass.
- [ ] App type check has no new invoice/order errors.
- [ ] Docs and `AGENTS.md` are synchronized.
