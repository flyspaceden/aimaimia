# 顺丰丰桥直连迁移 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完全移除快递100，直接对接顺丰丰桥 API，补齐站内通知、物流异常监控，交付完整可上线的快递链路。

**Architecture:** 新建 `SfExpressService` 统一封装顺丰丰桥 5 个 API（下单/打印/取消/查询/回调解析），`SellerShippingService` 和 `ShipmentService` 切换到新服务。修复地址解析前置问题（PC-1/PC-2），增加物流状态变更站内通知和异常监控 cron。

**Tech Stack:** NestJS, Prisma, 顺丰丰桥 API (MD5+Base64 签名), InboxService (站内消息)

**参考文档:** `docs/superpowers/reports/2026-04-11-drafts/L08-sf-migration.md`

**顺丰凭证:** 见 `交付包/第三方服务开通指南（操作手册）.md` 的密钥汇总表（不在代码仓库中明文存储）

---

## Task 清单（16 个 Task）

| 阶段 | Task | 内容 | 文件冲突 |
|------|------|------|---------|
| 前置 | 0 | 移除文档中的真实凭证 | 无 |
| 前置 | 1 | 修复 addressSnapshot 字段名错位（PC-2） | seller-shipping.service.ts |
| 前置 | 2 | Company.address 结构化完整闭环（PC-1） | schema + seller前端 + admin前端 |
| 前置 | 3 | Schema 迁移 — 字段重命名 | schema.prisma |
| 前置 | 4 | rawBody 配置（回调签名前置） | main.ts |
| 核心 | 5 | 新建 SfExpressService（不含 printWaybill） | sf-express.service.ts |
| 核心 | 6 | SfExpressService 单元测试 | sf-express.service.spec.ts |
| 核心 | 7 | 打印链路方案设计 + printWaybill 实现 | sf-express.service.ts + seller-shipping |
| 切换 | 8 | 切换 SellerShippingService | seller-shipping.service.ts |
| 切换 | 9 | 切换 ShipmentService + Controller | shipment.service.ts + controller.ts |
| 切换 | 10 | 更新模块注册 + AfterSale + 环境变量 | module.ts + after-sale + .env |
| 功能 | 11 | 物流状态变更站内通知 | shipment.service.ts + seller-orders |
| 功能 | 12 | 物流异常监控 cron（含去重） | shipment-monitor.service.ts |
| 前端 | 13 | 卖家后台隐藏快递公司选择 | seller前端 |
| 清理 | 14 | 删除快递100文件 + 更新测试 | 多文件 |
| 收尾 | 15 | 文档更新 + 全量验证 | docs + CLAUDE.md |

---

### Task 0: 移除文档中的真实凭证

**Files:**
- Modify: `docs/superpowers/plans/2026-04-12-sf-express-migration.md`
- Modify: `docs/features/shipping.md`

安全最佳实践：plan 和 shipping.md 中不应包含真实的 clientCode、checkWord、月结账号。

- [ ] **Step 1: 检查 plan 文件**
确认 plan 文件顶部凭证已改为占位符引用（已完成）。

- [ ] **Step 2: 检查 shipping.md**
搜索 `docs/features/shipping.md` 中是否有真实凭证（clientCode/checkWord/月结账号）。如有，替换为 `见交付包/第三方服务开通指南` 的引用。

- [ ] **Step 3: 检查 .env.example**
确认 `.env.example` 中的 SF_* 值都是占位符（`your-sf-*`），不是真实值。

- [ ] **Step 4: Commit**

```bash
git add docs/ backend/.env.example
git commit -m "security: remove real SF credentials from docs, use placeholder references"
```

---

### Task 1: 修复 addressSnapshot 字段名错位（PC-2）

**Files:**
- Modify: `backend/src/modules/seller/shipping/seller-shipping.service.ts:55-78`

checkout 写入 `recipientName`/`phone`/`regionText`/`detail`，但 `parseAddressSnapshot()` 读 `name`/`receiverName`，导致收件人姓名返回空字符串。顺丰 API 对收件人姓名/电话是强制字段，空字符串直接拒绝。

- [ ] **Step 1: 修改 parseAddressSnapshot**

将 `parseAddressSnapshot` 替换为结构化版本。关键改动：
1. 字段读取优先级：`recipientName` > `receiverName` > `name`（兼容新旧格式）
2. 从 `regionText`（如"广东省深圳市南山区"）解析出省/市/区
3. 返回值新增 `province`/`city`/`district`/`fullAddress`

```typescript
  private parseAddressSnapshot(addressSnapshot: unknown): {
    name: string;
    phone: string;
    province: string;
    city: string;
    district: string;
    detail: string;
    fullAddress: string;
  } {
    if (!addressSnapshot) {
      throw new BadRequestException('订单地址信息缺失');
    }

    let addr: any;
    try {
      addr = decryptJsonValue(
        typeof addressSnapshot === 'string'
          ? JSON.parse(addressSnapshot)
          : addressSnapshot,
      );
    } catch {
      throw new BadRequestException('订单地址信息格式错误');
    }

    // 兼容新旧字段名
    const name = addr.recipientName || addr.receiverName || addr.name || '';
    const phone = addr.phone || addr.recipientPhone || addr.receiverPhone || '';

    // 优先使用独立字段，fallback 从 regionText 解析
    let province = addr.province || '';
    let city = addr.city || '';
    let district = addr.district || '';
    const detail = addr.detail || '';

    if (!province && addr.regionText) {
      const m = addr.regionText.match(
        /^(.+?(?:省|自治区|市))(.+?(?:市|自治州|地区|盟))(.+?(?:区|县|市|旗))?/,
      );
      if (m) {
        province = m[1] || '';
        city = m[2] || '';
        district = m[3] || '';
      } else {
        province = addr.regionText;
      }
    }

    const fullAddress = [province, city, district, detail].filter(Boolean).join('');

    return { name, phone, province, city, district, detail, fullAddress };
  }
```

- [ ] **Step 2: 更新 getSenderInfo 返回结构化地址**

```typescript
  private async getSenderInfo(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, servicePhone: true, address: true, contact: true },
    });
    if (!company) throw new NotFoundException('企业信息不存在');

    const address = company.address as Record<string, any> | null;
    const contact = company.contact as Record<string, any> | null;

    return {
      senderName: contact?.name || company.name,
      senderPhone: contact?.phone || company.servicePhone || '',
      senderProvince: address?.province || '',
      senderCity: address?.city || '',
      senderDistrict: address?.district || '',
      senderDetail: address?.detail || '',
      senderAddress: address?.text || [address?.province, address?.city, address?.district, address?.detail].filter(Boolean).join('') || '',
    };
  }
```

- [ ] **Step 3: 验证编译 + Commit**

Run: `cd backend && npx tsc --noEmit --pretty 2>&1 | head -20`

```bash
git add backend/src/modules/seller/shipping/seller-shipping.service.ts
git commit -m "fix(seller-shipping): fix addressSnapshot field names, return structured address for SF Express"
```

---

### Task 2: Company.address 结构化完整闭环（PC-1）

**Files:**
- Modify: `backend/src/modules/seller/company/` — 后端保存接口确保存入结构化字段
- Modify: `seller/src/pages/company/` — 卖家后台企业信息页，地址输入改为省市区级联
- Modify: `admin/src/pages/` — 管理后台商户审核页展示结构化地址
- Modify: `backend/src/modules/seller/shipping/seller-shipping.service.ts` — generateWaybill 前置校验

这个 Task 涉及前后端多页面改动，需要注意：
- `Company.address` 是 `Json?` 类型，不需要改 Schema（JSON 可以存任何结构）
- 需要的是：写入端确保存 `{province, city, district, detail, lng?, lat?}` 格式
- 读取端（Task 1 的 `getSenderInfo`）已经支持新格式
- 历史数据：已有的 `{lng, lat, text}` 格式需要处理

- [ ] **Step 1: 找到卖家后台企业信息页**

搜索 `seller/src/pages/` 中关于企业信息/公司设置的页面。查看当前地址输入是如何实现的（是单个文本框还是已有结构化输入）。

- [ ] **Step 2: 改造卖家后台地址输入**

将地址输入从单个文本框改为**省市区级联选择器**（Ant Design `Cascader`）+ 详细地址文本框。

后端保存时确保 `Company.address` 存入 `{province, city, district, detail, text, lng?, lat?}` 格式。`text` 保留为 `province + city + district + detail` 的拼接，向后兼容。

- [ ] **Step 3: generateWaybill 前置校验**

在 `seller-shipping.service.ts` 的 `generateWaybill()` 方法开头，调用 `getSenderInfo()` 后检查结构化字段是否完整：

```typescript
    const senderInfo = await this.getSenderInfo(companyId);
    if (!senderInfo.senderProvince || !senderInfo.senderCity) {
      throw new BadRequestException(
        '企业发货地址不完整，请在「企业信息」页面补充省市区详细地址后再发货',
      );
    }
```

- [ ] **Step 4: 管理后台商户审核页展示结构化地址**

在管理后台的商户详情/审核页面，展示 Company.address 时显示结构化格式（省/市/区/详细），而不是单个 text 字段。

- [ ] **Step 5: 验证编译 + Commit**

Run: `cd backend && npx tsc --noEmit --pretty 2>&1 | head -20`

```bash
git add backend/ seller/ admin/
git commit -m "feat: structured Company.address with province/city/district, block unstructured from shipping"
```

---

### Task 3: Schema 迁移 — 字段重命名

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260412010000_rename_kuaidi100_to_sf/migration.sql`

- [ ] **Step 1: 创建 migration 文件**

```sql
-- RenameColumn
ALTER TABLE "Shipment" RENAME COLUMN "kuaidi100TaskId" TO "sfOrderId";
-- RenameColumn
ALTER TABLE "AfterSaleRequest" RENAME COLUMN "replacementKuaidi100TaskId" TO "replacementSfOrderId";
```

- [ ] **Step 2: 更新 schema.prisma 中的字段名**

Shipment 模型：`kuaidi100TaskId String?` → `sfOrderId String?  // 顺丰订单ID`
AfterSaleRequest 模型：`replacementKuaidi100TaskId String?` → `replacementSfOrderId String?  // 换货面单顺丰订单ID`

- [ ] **Step 3: 应用并验证**

Run: `cd backend && npx prisma db push && npx prisma validate`

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/
git commit -m "refactor(schema): rename kuaidi100TaskId to sfOrderId"
```

---

### Task 4: rawBody 配置（回调签名前置）

**Files:**
- Modify: `backend/src/main.ts`

顺丰推送签名验证需要用**原始 body 字符串**做 MD5，NestJS 默认解析 JSON 后原始字符串丢失。必须开启 rawBody 功能。

- [ ] **Step 1: 配置 NestJS rawBody**

在 `backend/src/main.ts` 中，找到 `NestFactory.create()` 调用，添加 `rawBody: true` 选项：

```typescript
const app = await NestFactory.create(AppModule, {
  rawBody: true,
});
```

或者如果使用了 Express adapter：
```typescript
app.useBodyParser('json', { limit: '10mb' });
```

需要确认 `main.ts` 的当前写法再决定具体改法。

- [ ] **Step 2: 验证 rawBody 可用**

在 `shipment.controller.ts` 中，`@Req() req` 应该能访问 `req.rawBody`（Buffer 类型）。

- [ ] **Step 3: Commit**

```bash
git add backend/src/main.ts
git commit -m "feat: enable rawBody for SF Express push signature verification"
```

---

### Task 5: 新建 SfExpressService（不含 printWaybill）

**Files:**
- Create: `backend/src/modules/shipment/sf-express.service.ts`

创建顺丰丰桥 API 封装服务。先实现 4 个方法：`createOrder`、`cancelOrder`、`queryRoutes`、`parsePushPayload` + 签名算法 + 推送签名验证。`printWaybill` 在 Task 7 中根据打印方案决定后再实现。

内容与原计划 Task 3 的代码相同（见原计划文件的 SfExpressService 完整代码），但**移除 `printWaybill()` 方法**，留到 Task 7。

- [ ] **Step 1: 创建 SfExpressService**

包含：`buildVerifyCode()`、`callApi()`、`createOrder()`、`cancelOrder()`、`queryRoutes()`、`parsePushPayload()`、`verifyPushSignature()`、`isConfigured()`、`OP_CODE_MAP` 静态映射。

- [ ] **Step 2: 验证编译**

Run: `cd backend && npx tsc --noEmit --pretty 2>&1 | head -10`

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/shipment/sf-express.service.ts
git commit -m "feat(shipment): add SfExpressService (createOrder, cancelOrder, queryRoutes, pushCallback)"
```

---

### Task 6: SfExpressService 单元测试

**Files:**
- Create: `backend/src/modules/shipment/sf-express.service.spec.ts`

与原计划 Task 4 代码相同，但移除 `printWaybill` 相关测试。覆盖：签名算法（2）、createOrder（5）、cancelOrder（3）、queryRoutes（4）、parsePushPayload（3）、verifyPushSignature（3）= 至少 20 个测试。

- [ ] **Step 1: 创建测试文件**

使用真实种子数据值（`c-001`/`u-001`/`o-001` 等）mock 参数。mock `global.fetch`。

- [ ] **Step 2: 运行测试**

Run: `cd backend && npx jest sf-express.service.spec --no-coverage`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/shipment/sf-express.service.spec.ts
git commit -m "test(shipment): SfExpressService unit tests"
```

---

### Task 7: 打印链路方案设计 + printWaybill 实现

**Files:**
- Modify: `backend/src/modules/shipment/sf-express.service.ts`
- Modify: `backend/src/modules/seller/shipping/seller-shipping.controller.ts`

先确定方案，再写代码。

**设计决策**：
1. 顺丰 `COM_RECE_CLOUD_PRINT_WAYBILLS` 返回 **PDF Base64**
2. 存储方式：将 PDF Base64 上传到 OSS，`Shipment.waybillUrl` 存 OSS 的永久 URL
3. 如果 OSS 未配置（`UPLOAD_LOCAL=true`），降级存到本地文件系统
4. 现有的打印代理端点（`printWaybill`）需要适配 PDF：
   - 当前逻辑：`fetchBinaryWithLimit(waybillUrl)` 下载图片 → 加水印 → 返回
   - PDF 改造：如果 `waybillUrl` 是 OSS PDF URL，直接 302 重定向或 proxy 返回 PDF（不加水印，PDF 水印处理复杂度高）

- [ ] **Step 1: 在 SfExpressService 中添加 printWaybill 方法**

```typescript
  async printWaybill(waybillNo: string): Promise<{ pdfBase64: string }> {
    if (!this.isConfigured()) {
      throw new BadRequestException('顺丰丰桥服务未配置');
    }

    const templateCode = this.configService.get<string>(
      'SF_TEMPLATE_CODE',
      'fm_150_standard_HNGHAfep',
    );

    const msgData = {
      templateCode,
      version: '2.0',
      fileType: 'pdf',
      sync: true,
      documents: [{ masterWaybillNo: waybillNo }],
    };

    const data = await this.callApi('COM_RECE_CLOUD_PRINT_WAYBILLS', msgData);

    const fileBase64 = data?.obj?.files?.[0]?.token
      || data?.obj?.files?.[0]?.url
      || data?.files?.[0]?.token;

    if (!fileBase64) {
      this.logger.error(`顺丰面单打印返回缺少文件数据: waybillNo=${waybillNo}`);
      throw new BadRequestException('面单打印失败: 未获取到面单文件');
    }

    return { pdfBase64: fileBase64 };
  }
```

- [ ] **Step 2: 在 SellerShippingService.createCarrierWaybill 中处理面单存储**

面单生成后：
1. 调用 `printWaybill` 获取 PDF Base64
2. 将 Base64 解码为 Buffer
3. 上传到 OSS（或本地文件系统）
4. `Shipment.waybillUrl` 存永久 URL

如果项目已有 `UploadService` 或 `OssService`，直接复用。如果没有，暂时存为 data URL（`data:application/pdf;base64,...`），后续接入 OSS 时替换。

- [ ] **Step 3: 适配打印代理端点**

修改 `SellerShippingController.printWaybill()`：如果 `waybillUrl` 以 `data:application/pdf` 开头或以 `.pdf` 结尾，设置 `Content-Type: application/pdf`，跳过图片水印逻辑。

- [ ] **Step 4: 补充 printWaybill 测试**

在 `sf-express.service.spec.ts` 中新增 printWaybill 测试（成功/失败/未配置）。

- [ ] **Step 5: 验证编译 + 运行测试 + Commit**

```bash
git add backend/src/modules/shipment/ backend/src/modules/seller/shipping/
git commit -m "feat(shipment): implement printWaybill with PDF storage"
```

---

### Task 8: 切换 SellerShippingService 到 SfExpressService

**Files:**
- Modify: `backend/src/modules/seller/shipping/seller-shipping.service.ts`

与原计划 Task 5 相同：替换导入/注入、重写 `createCarrierWaybill`/`cancelCarrierWaybill`、字段 `kuaidi100TaskId` → `sfOrderId`、硬编码 `carrierCode='SF'` + `carrierName='顺丰速运'`。

额外增加 generateWaybill 开头强制 `carrierCode = 'SF'`。

- [ ] **Step 1-7: 与原计划 Task 5 步骤相同**

- [ ] **Commit**

```bash
git commit -m "refactor(seller-shipping): switch to SfExpressService, hardcode SF carrier"
```

---

### Task 9: 切换 ShipmentService + ShipmentController

**Files:**
- Modify: `backend/src/modules/shipment/shipment.service.ts`
- Modify: `backend/src/modules/shipment/shipment.controller.ts`

与原计划 Task 6 相同，额外变更：

**Controller 回调端点使用 rawBody**（Task 4 前置完成）：

```typescript
  @Post('sf/callback')
  async handleSfCallback(
    @Body() body: any,
    @Req() req: any,
  ) {
    const bodyStr = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body);
    const pushDigest = req.headers?.['x-sf-digest'] || body.msgDigest;
    // ... 签名验证用 bodyStr
  }
```

**成功响应格式改为顺丰要求**：
- 成功：`{ apiResultCode: 'A1000', apiErrorMsg: '' }`
- 失败（可重试）：`{ apiResultCode: 'A1001', apiErrorMsg: '服务暂时不可用' }`

- [ ] **Step 1-6: 与原计划 Task 6 步骤相同 + rawBody 使用**

- [ ] **Commit**

```bash
git commit -m "refactor(shipment): switch to SfExpressService for tracking and callbacks, use rawBody"
```

---

### Task 10: 更新模块注册 + AfterSale + 环境变量

与原计划 Task 7 相同。

- [ ] **Step 1-5: 与原计划 Task 7 步骤相同**

---

### Task 11: 物流状态变更站内通知

与原计划 Task 8 相同。

- [ ] **Step 1-6: 与原计划 Task 8 步骤相同**

---

### Task 12: 物流异常监控 cron（含去重逻辑）

**Files:**
- Create: `backend/src/modules/shipment/shipment-monitor.service.ts`

与原计划 Task 9 相同，但增加以下去重和持久化逻辑：

**通知去重**：同一个 Shipment 不重复通知。方案：在 Shipment 表利用 `updatedAt` 判断 — cron 只扫描 `updatedAt < staleDate` 的记录，通知后 `touch updatedAt`（不改 status），下次扫描就不会重复。

**EXCEPTION 状态即时通知**：在 `ShipmentService.handleCallback()` 中，当 Shipment 状态变为 `EXCEPTION` 时立即发站内通知（不等 cron）：

```typescript
// handleCallback 中 EXCEPTION 状态处理
if (shipmentStatus === 'EXCEPTION') {
  try {
    const order = await tx.order.findUnique({
      where: { id: shipment.orderId },
      select: { userId: true },
    });
    if (order) {
      await this.inboxService.send({
        userId: order.userId,
        category: 'order',
        type: 'logistics_exception',
        title: '物流异常',
        content: '您的包裹物流出现异常（退签/退回），请联系客服处理。',
        target: { route: '/orders/[id]', params: { id: shipment.orderId } },
      });
    }
  } catch (err: any) {
    this.logger.warn(`物流异常通知发送失败: ${err.message}`);
  }
}
```

**cron 幂等**：每次扫描后 touch `updatedAt`，确保不重复通知。

- [ ] **Step 1: 创建 ShipmentMonitorService（含去重）**

```typescript
@Cron(CronExpression.EVERY_DAY_AT_9AM)
async checkStaleShipments() {
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - ShipmentMonitorService.STALE_DAYS);

  const staleShipments = await this.prisma.shipment.findMany({
    where: {
      status: 'IN_TRANSIT',
      updatedAt: { lt: staleDate }, // 去重：通知后 touch updatedAt，下次不再扫到
    },
    include: { order: { select: { userId: true } } },
    take: 100,
  });

  for (const shipment of staleShipments) {
    try {
      if (shipment.order?.userId) {
        await this.inboxService.send({
          userId: shipment.order.userId,
          category: 'order',
          type: 'logistics_stale',
          title: '物流更新异常',
          content: `您的包裹已超过 ${ShipmentMonitorService.STALE_DAYS} 天未更新物流信息，请关注。`,
          target: { route: '/orders/track', params: { orderId: shipment.orderId } },
        });
      }
      // touch updatedAt 防止重复通知
      await this.prisma.shipment.update({
        where: { id: shipment.id },
        data: { updatedAt: new Date() },
      });
    } catch (err: any) {
      this.logger.error(`物流异常通知发送失败: ${err.message}`);
    }
  }
}
```

- [ ] **Step 2: 在 handleCallback 中添加 EXCEPTION 即时通知**

- [ ] **Step 3: 验证编译 + Commit**

```bash
git commit -m "feat(shipment): stale shipment monitoring cron with dedup + EXCEPTION instant notification"
```

---

### Task 13: 卖家后台隐藏快递公司选择

与原计划 Task 10 相同。

---

### Task 14: 删除快递100文件 + 更新测试

与原计划 Task 11 相同。

---

### Task 15: 文档更新 + 全量验证

与原计划 Task 12 + Task 13 合并。

- [ ] **Step 1: 更新 shipping.md**
- [ ] **Step 2: 更新 CLAUDE.md**
- [ ] **Step 3: Prisma validate**
- [ ] **Step 4: TypeScript 全量编译**
- [ ] **Step 5: 运行全部测试**
- [ ] **Step 6: 确认无快递100残留引用**
- [ ] **Step 7: 确认环境变量一致**
- [ ] **Step 8: Commit**

```bash
git commit -m "docs: finalize SF Express migration, remove all kuaidi100 references"
```
