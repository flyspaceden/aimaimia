# 发票链路完整收口设计方案

> **文档状态**：设计完成，实施计划已拆解
> **创建日期**：2026-05-15
> **权威范围**：发票链路完整收口、开票内容配置、服务商适配器、三端状态闭环
> **前置文档**：`docs/features/invoice.md`

---

## 一、背景与目标

`docs/features/invoice.md` 定义了发票功能的 P0-P2 目标，并标记 Phase 1-4 已完成。2026-05-15 代码审查发现，当前实现具备基础买家 API、管理端列表/开票、卖家端只读状态，但链路尚未完整闭环：

- 买家订单详情不返回/展示发票状态，非 VIP 订单始终显示“申请发票”入口。
- “我的”页缺少“我的发票”入口。
- 已开票 PDF 在买家 App 中只弹 toast，没有真实打开/下载。
- 买家重复申请依赖数据库唯一约束兜底，缺少稳定业务错误和并发保护。
- 管理端搜索文案支持“订单号 / 发票抬头”，后端实际未搜索抬头。
- 管理端仅可录入发票号和 PDF URL，缺少平台开票主体、商品行、税率、备注、PDF 上传、服务商配置等完整开票内容规则。

本设计目标是把发票链路收口为“可测试、可上线、可切真实服务商”的完整系统：买家可申请、查看、取消和下载；管理后台可配置开票内容规则并触发 Mock Provider 开票；卖家端只读发票状态且不泄露买家开票详情。

---

## 二、核心决策

| 决策 | 结论 |
|------|------|
| 服务商接入 | 本轮实现 `InvoiceProvider` 适配器 + `MockInvoiceProvider`，不绑定真实服务商；真实厂商后续替换 provider |
| 发票内容来源 | 买家抬头来自申请时快照；金额、商品行来自订单；平台开票主体、税率、税收分类、备注模板由管理后台配置 |
| 是否允许管理员改金额 | 不允许。发票金额必须由订单实付/订单明细派生，避免财税与订单不一致 |
| 是否允许管理员改买家抬头 | 不允许直接改已申请发票的抬头快照。抬头错误应取消/失败后由买家重新申请 |
| 卖家隐私 | 卖家仅看到 `invoiceStatus`，不得返回抬头、税号、邮箱、电话、开户行、PDF |
| 一单一票与重新申请 | 保留 `Invoice.orderId @unique`。`CANCELED/FAILED` 后重新申请时复用同一 `Invoice` 行，更新新抬头快照并写状态历史；`ISSUED` 不可重新申请 |
| 状态历史 | 新增 `InvoiceStatusHistory`，所有状态变更可追溯 |
| 开票内容快照 | 开票时写入 `invoiceContentSnapshot`，保存当次销售方、购买方、商品行、税率、税收分类、备注和 provider 模式 |
| 配置承载 | 使用现有 `RuleConfig` 存储发票配置，新增 `INVOICE_*` key 和校验规则，不另建配置表 |
| 凭据管理 | 真实 provider 的 appId/key/证书路径只写环境变量和本地 `docs/operations/密码本.md`，不进入可提交文档 |

---

## 三、范围

### 3.1 本轮包含

1. 买家 App 发票闭环：
   - 订单详情显示发票状态，有发票时不再显示申请入口。
   - 仅 `RECEIVED` 且无有效发票时允许申请。
   - 我的页增加“我的发票”入口。
   - 发票详情和列表中的 PDF 按钮真实打开 URL。
   - 申请/取消后刷新订单详情、订单列表、发票列表。

2. 后端发票闭环：
   - 买家申请/取消使用事务、CAS 和唯一约束错误映射。
   - 订单详情返回 `invoice` 或 `invoiceStatus`。
   - 管理端开票调用 provider，而不是直接拼状态。
   - 管理端搜索支持订单号、发票号、抬头名称。
   - 新增状态历史和 provider 字段。

3. 管理后台完整开票内容配置：
   - 平台开票主体配置。
   - 默认税率、税收分类编码、商品行生成模式。
   - 备注模板配置。
   - Provider 模式配置（本轮默认 `MOCK`）。
   - 单张发票开票时可选择“Mock 自动开票”或“人工上传/录入发票号 + PDF URL”。

4. 卖家端：
   - 保持订单详情只读发票状态。
   - 不新增卖家查看发票详情能力。

5. 测试与文档：
   - 后端单测覆盖申请、取消、开票、失败、并发、配置读取。
   - 管理端构建、后端构建、Prisma validate。
   - 买家 App 发票页面类型检查和关键交互审查。
   - 同步 `docs/features/invoice.md`、`docs/architecture/frontend.md`、`plan.md`、`AGENTS.md`。

### 3.2 本轮不包含

- 不接真实航信/百望/诺诺等厂商。
- 不做税务机关真实验签、红冲、作废、冲红蓝票流程。
- 不做发票 OCR 或自动查验。
- 不做商户自开发票。平台统一开具电子发票。
- 不做实名认证强拦截；如后续需要，另开实名认证设计。

---

## 四、开票内容模型

发票内容由四类来源合成，管理后台只能配置规则，不得随意篡改订单事实。

### 4.1 买家抬头快照

申请时从 `InvoiceProfile` 复制到 `Invoice.profileSnapshot`：

- `type`: `PERSONAL | COMPANY`
- `title`
- `taxNo`
- `email`
- `phone`
- `bankInfo`
- `address`

快照生成后不可被管理端直接修改。若买家抬头错误：

1. `REQUESTED` 状态：买家取消后可重新申请。
2. 管理端发现无法开票：标记 `FAILED`，填写原因，买家可重新申请。
3. 已 `ISSUED`：本轮不支持作废/红冲，需人工线下处理并记录备注。

重新申请不新建第二条 `Invoice`。后端复用同一 `Invoice` 行：

- 允许从 `CANCELED/FAILED` 转回 `REQUESTED`。
- 更新 `profileSnapshot` 为新的买家抬头快照。
- 清空 `invoiceNo/pdfUrl/failReason/provider/providerRequestId/providerRaw/invoiceContentSnapshot/issuedAt/failedAt/canceledAt`。
- `requestCount += 1`。
- 更新 `requestedAt = now()`，买家端展示“申请时间”时使用 `requestedAt`，不能用首次创建的 `createdAt` 误导用户。
- 写入 `InvoiceStatusHistory`，metadata 中记录上一轮状态、上一轮抬头摘要和新一轮 `requestCount`。

### 4.2 订单金额与商品行

金额来自订单，不由管理员输入：

- 发票总金额默认使用 `Order.totalAmount`。
- 商品金额、运费、优惠抵扣口径与订单详情保持一致。
- 多商户订单按平台统一开票，不拆成商户发票。
- VIP 礼包默认可配置是否支持开票，本轮默认普通商品支持，VIP 礼包由 `INVOICE_ALLOW_VIP_PACKAGE` 控制。

商品行生成模式由管理后台配置：

| 模式 | 含义 | 默认 |
|------|------|------|
| `ORDER_ITEMS` | 按订单商品逐行生成发票商品行 | ✅ |
| `MERGED_CATEGORY` | 合并为一行，如“农产品”或“商品一批” | 可选 |

配置项：

- `INVOICE_LINE_MODE`
- `INVOICE_DEFAULT_TAX_RATE`
- `INVOICE_DEFAULT_TAX_CLASSIFICATION_CODE`
- `INVOICE_DEFAULT_GOODS_NAME`

### 4.3 平台开票主体

管理后台配置平台开票方，不从订单读取：

- 公司名称
- 纳税人识别号
- 注册地址
- 注册电话
- 开户行
- 银行账号
- 开票人
- 复核人
- 收款人

建议使用 `RuleConfig` JSON key：

- `INVOICE_ISSUER_PROFILE`

示例：

```json
{
  "companyName": "爱买买app",
  "taxNo": "<PLATFORM_TAX_NO>",
  "registeredAddress": "",
  "registeredPhone": "",
  "bankName": "",
  "bankAccount": "",
  "drawer": "系统开票",
  "reviewer": "",
  "payee": ""
}
```

### 4.4 备注模板

管理后台可配置备注模板，provider 调用前渲染：

- `INVOICE_REMARK_TEMPLATE`
- 支持变量：`{{orderId}}`、`{{paidAt}}`、`{{buyerTitle}}`、`{{totalAmount}}`

示例：

```text
订单号：{{orderId}}；支付时间：{{paidAt}}
```

### 4.5 配置项清单

所有配置写入 `RuleConfig`，并在 `backend/src/modules/admin/config/config-validation.ts` 增加校验。

| Key | 类型 | 默认值 | 校验规则 | 可编辑 |
|-----|------|--------|----------|--------|
| `INVOICE_PROVIDER_MODE` | enum string | `MOCK` | 本轮仅 `MOCK`；真实服务商接入后追加枚举，如 `BAIWANG`、`NUONUO` | 是 |
| `INVOICE_ALLOW_VIP_PACKAGE` | boolean | `false` | 布尔值 | 是 |
| `INVOICE_LINE_MODE` | enum string | `ORDER_ITEMS` | `ORDER_ITEMS | MERGED_CATEGORY` | 是 |
| `INVOICE_DEFAULT_TAX_RATE` | number | `0` | 0-0.13，最多 4 位小数 | 是 |
| `INVOICE_DEFAULT_TAX_CLASSIFICATION_CODE` | string | 空字符串 | 空或 6-30 位数字/字母 | 是 |
| `INVOICE_DEFAULT_GOODS_NAME` | string | `农产品` | 1-100 字符；`MERGED_CATEGORY` 模式必填 | 是 |
| `INVOICE_REMARK_TEMPLATE` | string | `订单号：{{orderId}}` | 0-500 字符，仅允许白名单变量 | 是 |
| `INVOICE_ISSUER_PROFILE` | json | 见 4.3 示例 | `companyName`、`taxNo` 必填；银行账号、电话长度限制；不允许密钥字段 | 是 |

---

## 五、数据模型变更

### 5.1 Invoice 字段补强

在 `Invoice` 增加 provider 与状态时间字段：

```prisma
model Invoice {
  id                String        @id @default(cuid())
  orderId           String        @unique
  order             Order         @relation(fields: [orderId], references: [id])
  profileSnapshot   Json
  status            InvoiceStatus @default(REQUESTED)
  invoiceNo         String?
  pdfUrl            String?
  failReason        String?
  provider          String?
  providerRequestId String?
  providerRaw       Json?
  invoiceContentSnapshot Json?
  requestCount      Int           @default(1)
  requestedAt       DateTime      @default(now())
  issuedAt          DateTime?
  failedAt          DateTime?
  canceledAt        DateTime?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  statusHistory     InvoiceStatusHistory[]

  @@index([status])
  @@index([providerRequestId])
}
```

`failReason` 已存在，不重复新增。`Invoice.orderId @unique` 保留，用“复用同一行重新申请”解决取消/失败后的再次申请。

`invoiceContentSnapshot` 在开票成功时写入，结构包含：

```json
{
  "providerMode": "MOCK",
  "buyer": {
    "type": "COMPANY",
    "title": "...",
    "taxNo": "...",
    "email": "...",
    "phone": "...",
    "bankInfo": "...",
    "address": "..."
  },
  "issuer": { "companyName": "...", "taxNo": "..." },
  "order": { "id": "...", "totalAmount": 100.0, "paidAt": "..." },
  "lines": [
    {
      "name": "商品名",
      "quantity": 1,
      "unitPrice": 100.0,
      "amount": 100.0,
      "taxRate": 0,
      "taxClassificationCode": ""
    }
  ],
  "remark": "订单号：..."
}
```

管理端详情展示已开票内容时优先使用 `invoiceContentSnapshot`，不能用当前 `RuleConfig` 重新推导历史发票内容。

### 5.2 InvoiceStatusHistory

```prisma
model InvoiceStatusHistory {
  id          String         @id @default(cuid())
  invoiceId   String
  invoice     Invoice        @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  fromStatus  InvoiceStatus?
  toStatus    InvoiceStatus
  reason      String?
  operatorId  String?
  operatorType String?        // BUYER | ADMIN | SYSTEM | PROVIDER
  metadata    Json?
  createdAt   DateTime       @default(now())

  @@index([invoiceId, createdAt])
}
```

状态历史写入规则：

- 创建发票：`null -> REQUESTED`，operatorType=`BUYER`
- 买家取消：`REQUESTED -> CANCELED`，operatorType=`BUYER`
- 管理开票成功：`REQUESTED -> ISSUED`，operatorType=`ADMIN`
- 管理标记失败：`REQUESTED -> FAILED`，operatorType=`ADMIN`
- Provider 失败：`REQUESTED -> FAILED`，operatorType=`PROVIDER`

---

## 六、后端架构

### 6.1 Provider 接口

新增目录：

```text
backend/src/modules/admin/invoices/provider/
  invoice-provider.interface.ts
  mock-invoice.provider.ts
  invoice-provider.factory.ts
```

接口：

```ts
export type InvoiceIssueInput = {
  invoiceId: string;
  providerRequestId: string;
  order: {
    id: string;
    totalAmount: number;
    paidAt?: Date | null;
    items: Array<{ title: string; quantity: number; unitPrice: number; amount: number }>;
  };
  buyerSnapshot: Record<string, unknown>;
  issuerProfile: Record<string, unknown>;
  lines: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    taxRate: number;
    taxClassificationCode?: string;
  }>;
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

`MockInvoiceProvider` 生成稳定可测数据：

- `provider = "MOCK"`
- `providerRequestId = "mock-" + invoiceId`
- `invoiceNo = "MOCK-" + 日期 + 短 id`
- 生成一个最小可打开的 PDF buffer，通过现有 `UploadService.uploadBuffer()` 保存到 `invoices/mock` 目录。
- `pdfUrl` 使用上传结果 URL，保证买家 App 能真实打开。

因此 `AdminInvoicesModule` 需要导入 `UploadModule`，并把 `UploadService` 注入 `MockInvoiceProvider`。真实 provider 后续只需实现同一接口。

### 6.2 买家 InvoiceService

保留现有买家接口，补强实现：

- `requestInvoice(userId, dto)`
  - Serializable 事务。
  - 校验订单归属、状态 `RECEIVED`、业务类型配置。
  - 校验抬头归属和企业税号。
  - 若订单无发票：创建发票和首条状态历史。
  - 若订单已有 `CANCELED/FAILED` 发票：复用该行，更新新抬头快照，清空上一轮开票字段，`requestCount += 1`，更新 `requestedAt`，写状态历史。
  - 若订单已有 `REQUESTED/ISSUED` 发票：返回稳定业务错误。
  - 捕获 `P2002` 映射为 `ConflictException('该订单已申请过发票')`。

- `cancelInvoice(userId, invoiceId)`
  - Serializable 事务。
  - 查询发票及订单归属。
  - CAS：`updateMany({ id, status: REQUESTED })`。
  - 写 `canceledAt` 和状态历史。
  - 若状态已变更，返回明确业务错误。

- `getUserInvoices/getInvoiceDetail`
  - 保持按 `order.userId` 过滤。
  - 详情返回 order 摘要和状态历史。

### 6.3 管理端 AdminInvoicesService

新增职责：

- `getInvoiceSettings() / updateInvoiceSettings()`
  - 读取/写入 `RuleConfig` 中 `INVOICE_*` 配置。
  - 用 `config-validation.ts` 做 JSON/number/enum 校验。

  Controller 路由：

  ```text
  GET /api/v1/admin/invoices/settings
  PUT /api/v1/admin/invoices/settings
  ```

  权限：沿用 `@RequirePermission('invoices:issue')`，写操作加 `@AuditLog({ module: 'invoices', action: 'CONFIG_CHANGE' })`。

  DTO：

  ```ts
  export class UpdateInvoiceSettingsDto {
    providerMode?: 'MOCK';
    allowVipPackage?: boolean;
    lineMode?: 'ORDER_ITEMS' | 'MERGED_CATEGORY';
    defaultTaxRate?: number;
    defaultTaxClassificationCode?: string;
    defaultGoodsName?: string;
    remarkTemplate?: string;
    issuerProfile?: {
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

- `buildInvoicePayload(invoice)`
  - 从发票、订单、配置生成 provider 输入。
  - 保证金额来自订单。
  - 渲染备注模板。

- `issueInvoice(invoiceId, dto)`
  - 单张发票开票动作支持三种模式：
    - `mode = AUTO`：按 `INVOICE_PROVIDER_MODE` 解析 provider，本轮实际解析为 `MOCK`。
    - `mode = MOCK`：显式调用 Mock Provider，便于前端文案和测试。
    - `mode = MANUAL`：管理员上传 PDF 或录入 `invoiceNo + pdfUrl`，仍写 provider=`MANUAL`。
	  - 自动/Mock provider 开票必须分两段执行，避免 Serializable 重试重复调用外部服务：
	    1. 短事务内 CAS 预占：`status=REQUESTED AND providerRequestId IS NULL`，写入确定性 `providerRequestId = invoice-{invoiceId}-{requestCount}` 和 provider 名称。
	    2. 事务外调用 provider，并把 `providerRequestId` 作为幂等 key 传入。
	    3. 短事务内 CAS 落库：`status=REQUESTED AND providerRequestId=<key>`，写 `ISSUED` 或 `FAILED`。
	  - 买家取消也必须要求 `providerRequestId IS NULL`，防止开票中被取消。
	  - 管理端人工开票和标记失败也必须要求 `providerRequestId IS NULL`，防止覆盖 provider 飞行中的开票。
	  - 人工开票无外部 provider 调用，可在单个 Serializable + CAS 事务内完成。
	  - 人工开票 `pdfUrl` 必须来自平台上传域名 / OSS 域名白名单。
	  - 写 `invoiceNo/pdfUrl/provider/providerRequestId/providerRaw/invoiceContentSnapshot/issuedAt`。
	  - 写状态历史。

`providerRaw` 只能保存脱敏后的 provider 响应元数据，禁止写入请求头、签名、token、证书、密钥、完整银行账号、手机号、私密 PDF 签名参数等敏感内容。真实 provider 接入时，如必须保存原始响应，应先做字段白名单和脱敏。

- `failInvoice(invoiceId, dto)`
  - Serializable + CAS，条件为 `status=REQUESTED AND providerRequestId IS NULL`。
  - 写 `failReason/failedAt`。
  - 写状态历史。

- `resetProviderReservation(invoiceId)`
  - 仅用于恢复卡在 `REQUESTED + providerRequestId != null` 的开票任务。
  - 默认保护窗口为 10 分钟，窗口内拒绝重置，避免覆盖真实飞行中的 provider 调用。
  - 重置时 CAS 锁定当前 `providerRequestId`，清空 `provider/providerRequestId`，写 `providerRaw.resetReason` 和状态历史。

### 6.4 订单详情 API

买家 `GET /orders/:id` 详情返回：

```ts
invoice?: {
  id: string;
  status: InvoiceStatus;
  invoiceNo?: string | null;
  pdfUrl?: string | null;
  createdAt: string;
  issuedAt?: string | null;
  requestedAt: string;
  failReason?: string | null;
  profileSnapshot?: { type: InvoiceType; title: string };
} | null;
invoiceEligible: boolean;
```

订单列表不强制返回完整发票对象，可仅返回 `invoiceStatus`，避免列表 payload 膨胀。

买家订单列表建议返回 `invoiceStatus?: InvoiceStatus | null`，用于申请/取消后列表刷新时保持 UI 一致；列表不返回抬头和 PDF。

卖家 `GET /seller/orders/:id` 保持：

```ts
invoiceStatus?: InvoiceStatus | null;
```

不得返回其他发票字段。

---

## 七、管理后台设计

### 7.1 发票列表

现有 `admin/src/pages/invoices/index.tsx` 保留 ProTable，补：

- 搜索 keyword 支持：
  - `orderId`
  - `invoiceNo`
  - `profileSnapshot.title`
- REQUESTED 行支持：
  - “自动开票（Mock）”
  - “人工上传/录入”
  - “失败”
- 增加“发票设置”入口。

管理端 API 客户端新增：

```ts
getInvoiceSettings(): Promise<InvoiceSettings>
updateInvoiceSettings(data: UpdateInvoiceSettingsParams): Promise<{ ok: boolean }>
```

### 7.2 发票详情

现有详情页补：

- 状态时间线，读取 `statusHistory`。
- 展示 provider、providerRequestId、失败原因。
- 展示最终开票内容预览：
  - 购买方抬头
  - 销售方主体
  - 商品行
  - 税率/税收分类编码
  - 总金额
  - 备注
- 人工开票弹窗支持两种输入：
  - 上传 PDF：复用现有上传能力，限制文件类型为 PDF，上传成功后回填 `pdfUrl`。
  - 粘贴 URL：用于第三方系统已生成 PDF 的场景，但后端仍必须按平台上传域名 / OSS 域名白名单校验。
  - `REQUESTED + providerRequestId != null` 显示为“开票中”，隐藏自动开票、人工开票、标记失败，只保留“重置开票任务”入口。

### 7.3 发票设置页

新增 `admin/src/pages/invoices/settings.tsx`，权限沿用 `invoices:issue` 或新增 `invoices:config`。为减少权限迁移成本，本轮建议沿用 `invoices:issue`。

路由和菜单：

- `admin/src/App.tsx` 增加 `invoices/settings`。
- `admin/src/layouts/AdminLayout.tsx` 在“交易与售后 / 发票管理”附近增加“发票设置”入口，权限同 `PERMISSIONS.INVOICES_ISSUE`。

页面区块：

1. 开票主体
2. 商品行规则
3. 税率与税收分类
4. 备注模板
5. Provider 模式

必须使用 `App.useApp()` 获取 `message/modal/notification`，禁止 antd 静态方法。

---

## 八、买家 App 设计

### 8.1 订单详情发票区块

用现有 `InvoiceSection` 或将能力合入 `OrderInfoBlock`，推荐复用 `InvoiceSection`：

- `!invoice && order.invoiceEligible === true`：显示申请入口。`invoiceEligible` 由后端按订单状态、业务类型和 `INVOICE_ALLOW_VIP_PACKAGE` 计算，App 不硬编码 VIP 是否可开票。
- `invoice.status === REQUESTED`：显示“待开票”，可进入详情取消。
- `ISSUED`：显示“已开票”，可进入详情打开 PDF。
- `FAILED`：显示失败原因和重新申请指引。
- `CANCELED`：可重新申请。

### 8.2 我的页入口

`app/(tabs)/me.tsx` 的 `TOOL_GRID` 增加：

- label：`我的发票`
- icon：`file-document-outline`
- route：`/invoices`

### 8.3 PDF 打开

发票列表和详情使用 `expo-web-browser` 优先打开：

- URL 非空且 `http/https` 才允许打开。
- 打开失败时提示“无法打开发票 PDF，请稍后重试”。
- 不在 App 内展示税号以外更多敏感内容给无关页面。

---

## 九、安全与一致性

发票涉及金额、状态转换和税务记录，必须按安全清单执行：

- 申请、取消、开票、失败全部使用 Serializable 事务。
- 状态转换使用 CAS。
- 发票金额从订单读取，不接受前端传入金额。
- 管理端写操作加 `@AuditLog()`。
- Provider 凭据不写入 git，可提交文档只使用占位符。
- 管理端 `invoices:read` 仅可看脱敏后的抬头 / 开票快照；完整电话、邮箱、银行账号、地址等只给 `invoices:issue` 或超级管理员。
- 卖家端接口只返回状态，不能返回 `profileSnapshot` 或 `pdfUrl`。
- 日志不得明文打印税号、手机号、银行账号、PDF 私密 URL。
- 管理端手工发票 PDF URL 必须来自平台上传域名 / OSS 域名白名单，禁止保存任意外部链接。

---

## 十、测试策略

### 10.1 后端单测

覆盖：

- 买家仅可给自己的 `RECEIVED` 订单申请。
- 非 `RECEIVED` 订单申请失败。
- 一单一票重复申请返回稳定 409。
- 企业抬头缺税号失败。
- 抬头快照不随 profile 更新变化。
- `REQUESTED` 可取消，`ISSUED/FAILED/CANCELED` 不可取消。
- 管理开票成功写 provider 字段、状态历史、issuedAt。
- 管理开票和买家取消并发时只有一个成功。
- 卖家订单详情只返回 `invoiceStatus`。
- keyword 可搜索抬头。

### 10.2 前端验证

- 管理端 `npm run build`
- 卖家端 `npm run build`
- 买家 App 定向 TypeScript 检查或 Expo 编译检查
- 手工/真机场景：
  - 已完成订单申请发票
  - 我的发票列表查看
  - 管理端 Mock 开票
  - 买家 App 打开 PDF
  - 卖家端仅看到状态

### 10.3 必跑命令

```bash
cd backend && npx prisma validate
cd backend && npm run build
cd admin && npm run build
cd seller && npm run build
npx tsc --noEmit
```

说明：当前根目录 `npx tsc --noEmit` 已知会因 `tests/e2e` Node/Playwright 类型配置失败，实施时需先决定是修 tsconfig test types，还是使用排除 e2e 的 App 专用类型检查命令。

---

## 十一、文档同步

实施时必须同步：

- `docs/features/invoice.md`：更新“已完成”状态，记录本轮收口和 provider 设计。
- `docs/architecture/frontend.md`：标记买家发票入口和订单详情状态完成。
- `plan.md`：更新 L11 发票入口和相关上线任务。
- `docs/issues/tofix-safe.md`：如发现新并发/金额/状态问题，追加或标记修复。
- `AGENTS.md`：登记本 spec 和后续 plan。

如新增真实 provider 凭据，必须写入本地 `docs/operations/密码本.md`，不得写入可提交文档。

---

## 十二、验收标准

1. 买家从已收货订单能申请发票，申请后订单详情立即显示“待开票”。
2. 我的页能进入“我的发票”，列表和详情可查看状态。
3. 管理端能配置开票主体和规则，能用 Mock Provider 开票。
4. 开票后买家能打开电子发票 PDF。
5. 买家不能重复申请同一订单发票，错误提示稳定。
6. 买家取消与管理开票并发时不会出现双写或状态倒退。
7. 卖家端只显示发票状态，不泄露抬头、税号、联系方式、PDF。
8. Prisma validate、后端 build、管理端 build、卖家端 build 通过。
