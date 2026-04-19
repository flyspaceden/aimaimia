# 快递物流链路实施文档

> **状态**: 顺丰丰桥直连已完成，快递100代码已删除
> **最后更新**: 2026-04-12
> **权威范围**: 快递物流链路的开发进度、顺丰直连改造计划、上线前配置清单

---

## 📢 0. 策略变更：从快递100迁移到顺丰丰桥直连

### 0.1 决策背景

**原方案**：使用快递100作为统一快递 API 中间层，一个接口覆盖多家快递公司。

**问题**：
1. 平台业务决策是**只用顺丰**（不需要多快递公司支持）
2. 顺丰电子面单在快递100里仍然需要先向顺丰申请月结账号（快递100无法代办）
3. 快递100按次收费（面单 0.08元/次 + 查询 0.08元/次），月均发货量大时成本显著
4. 快递100只暴露顺丰功能的子集，无法使用顺丰冷链、丰密面单、生鲜专线等高级功能
5. 多一层中间依赖，故障点多

**新方案**：**直接对接顺丰丰桥平台**（https://qiao.sf-express.com），彻底移除快递100依赖。

### 0.2 新方案优势

| 维度 | 快递100方案（当前已完成） | 顺丰丰桥直连（新方案） |
|------|------------------------|---------------------|
| 架构层级 | 你 → 快递100 → 顺丰 | 你 → 顺丰 |
| API 费用 | 0.08元/面单 + 0.08元/查询 | 免费 |
| 功能完整度 | 顺丰功能的子集 | 顺丰全部能力 |
| 月结申请 | 仍需向顺丰申请 | 仍需向顺丰申请 |
| 代码维护 | 已完成 | 需重写 SfExpressService |
| 冷链/丰密面单 | 不支持 | 原生支持 |
| 故障依赖 | 快递100+顺丰双故障点 | 仅顺丰 |

### 0.3 迁移计划

**状态：已完成（2026-04-12）**

详见 **第 7 节：顺丰直连改造方案**。

迁移路径：
1. **阶段 A（我做，并行进行）**：新建 `SfExpressService`，实现顺丰丰桥 API 接口
2. **阶段 B（用户做）**：申请顺丰月结账号 + 丰桥 API 权限（详见第 8 节）
3. **阶段 C（联调）**：沙箱环境验证
4. **阶段 D（切换）**：生产环境切换，删除快递100相关代码

### 0.4 对现有代码的影响

**保留不变**：
- `ShipmentService` 核心业务逻辑（回调处理、Order 联动、去重、状态机）
- `SellerShippingService`（对外接口不变，内部实现切换）
- `SellerOrdersService.ship()` 发货确认
- 数据库 Schema（Shipment 表、字段保持不变）
- 买家 App 物流追踪页
- 卖家后台发货管理页
- 105 个单元测试中大部分可复用

**将被替换**：
- `Kuaidi100WaybillService` → `SfExpressService.createOrder/printWaybill/cancelOrder`
- `Kuaidi100Service` → `SfExpressService.queryRoute/parsePushCallback`
- `ShipmentController.handleKuaidi100Callback` → `ShipmentController.handleSfPush`
- 环境变量 `KUAIDI100_*` → `SF_*`

**将被删除**：
- `backend/src/modules/shipment/kuaidi100.service.ts`
- `backend/src/modules/shipment/kuaidi100-waybill.service.ts`
- `backend/src/modules/shipment/kuaidi100-waybill.service.spec.ts`
- `backend/src/modules/shipment/shipment.service.kuaidi100-callback.spec.ts`

---

## 1. 整体架构（历史：快递100方案，已于 2026-04-12 被顺丰丰桥直连替换，以下内容仅供历史参考）

### 1.1 数据流

```
买家下单付款 (Order PAID)
    ↓
卖家后台生成电子面单
    ↓ Kuaidi100WaybillService.createWaybill()
快递100 API → 返回真实单号 + 面单图片短链 + taskId
    ↓
Shipment 记录创建 (status=INIT, 存储 waybillNo + kuaidi100TaskId)
    ↓
卖家打印面单 → 贴包裹 → 确认发货
    ↓ SellerOrdersService.ship()
Shipment: INIT → IN_TRANSIT
Order: PAID → SHIPPED
    ↓
快递100推送物流更新 → 我方回调接口
    ↓ ShipmentController.handleKuaidi100Callback()
ShipmentTrackingEvent 写入（去重） + Shipment 状态更新
    ↓
全部包裹 DELIVERED 时 CAS 更新
Order: SHIPPED → DELIVERED (设置 returnWindowExpiresAt)
    ↓
买家确认收货 或 autoReceiveAt 超时自动确认
Order: DELIVERED → RECEIVED
    ↓
触发分润（BonusAllocationService）
```

### 1.2 模块职责

| 模块 | 职责 | 关键文件 |
|------|------|---------|
| **Kuaidi100WaybillService** | 封装快递100电子面单 V2 API，提供下单和取消 | `backend/src/modules/shipment/kuaidi100-waybill.service.ts` |
| **Kuaidi100Service** | 封装快递100查询和推送订阅 API | `backend/src/modules/shipment/kuaidi100.service.ts` |
| **ShipmentService** | 回调处理、主动查询、订单状态联动 | `backend/src/modules/shipment/shipment.service.ts` |
| **ShipmentController** | 买家物流查询接口 + 快递100回调端点 | `backend/src/modules/shipment/shipment.controller.ts` |
| **SellerShippingService** | 卖家面单生成/取消/打印 | `backend/src/modules/seller/shipping/seller-shipping.service.ts` |
| **SellerOrdersService** | 卖家发货确认、批量发货 | `backend/src/modules/seller/orders/seller-orders.service.ts` |
| **SellerAfterSaleService** | 售后换货面单生成 | `backend/src/modules/seller/after-sale/seller-after-sale.service.ts` |
| **OrderAutoConfirmService** | 自动确认收货 cron | `backend/src/modules/order/order-auto-confirm.service.ts` |

### 1.3 关键业务决策

- **快递100统一入口**: 所有快递公司（SF/YTO/ZTO/STO/YUNDA/JD/EMS等50+）都走快递100电子面单 V2 API，不直接对接各快递公司
- **平台统一月结账号**: 运费由平台统一支付，卖家不需要自己的月结号
- **打印模式**: IMAGE（快递100返回面单图片短链）
- **自动订阅物流推送**: 下单时设置 `needSubscribe: true` + `pollCallBackUrl`，面单生成即自动订阅
- **取消面单顺序**: 先调快递100远端取消，成功后再清空本地状态（避免本地清空但远端仍持有单号的不一致）

---

## 2. 已完成的部分（历史：快递100时期，已被顺丰直连替代）

### 2.1 后端核心服务

#### ✅ Kuaidi100WaybillService - 电子面单集成
- `createWaybill()` - 下单取号，支持 `needSubscribe` 自动订阅
- `cancelWaybill(carrierCode, waybillNo)` - 按快递100官方参数取消（kuaidicom + kuaidinum + partnerId）
- `isConfigured()` - 配置完整性检查
- 签名算法：MD5(param + t + key + secret) 大写
- `label` 为空时抛异常（不静默通过）
- 无 `KUAIDI100_CALLBACK_URL` 时日志警告 + 禁用 `needSubscribe`

**文件**: `backend/src/modules/shipment/kuaidi100-waybill.service.ts`
**测试**: `kuaidi100-waybill.service.spec.ts` (14 tests)

#### ✅ Kuaidi100Service - 物流查询和推送
- `queryTracking(carrierCode, trackingNo, phone)` - 主动查询物流轨迹
- `subscribe()` - 订阅推送（备用路径，面单生成时已自动订阅）
- `parseCallbackPayload()` - 解析快递100回调格式
- `CARRIER_MAP` / `CARRIER_NAME_MAP` - 快递编码和中文名映射
- 顺丰查询自动携带手机号后4位

**文件**: `backend/src/modules/shipment/kuaidi100.service.ts`

#### ✅ ShipmentService - 物流状态管理
- `handleCallback()` - 处理物流回调，更新 Shipment + Order 状态
  - HMAC-SHA256 签名验证
  - 轨迹事件去重（按 occurredAt + message 作为 key）
  - 全部包裹签收时 CAS 更新 Order 为 DELIVERED
  - 自动设置 `returnWindowExpiresAt`
  - OrderStatusHistory 记录
- `handleKuaidi100Callback()` - 快递100专用回调，独立 token 验证
- `queryTrackingFromKuaidi100()` - 主动查询并联动 Order 状态
  - 已签收的不回退
  - 与回调处理共享 Order 联动逻辑
  - Serializable 隔离级别
- `getByOrderId()` - 买家查询物流，支持多包裹聚合
  - 单包裹返回完整轨迹
  - 多包裹显示包裹数量，轨迹按时间合并
  - 快递单号脱敏

**文件**: `backend/src/modules/shipment/shipment.service.ts`
**测试**: `shipment.service.spec.ts` (29 tests)

#### ✅ ShipmentController - API 端点
- `GET /shipments/:orderId` - 查询订单物流（买家）
- `GET /shipments/:orderId/track` - 主动查询快递100最新轨迹
- `POST /shipments/callback` - 通用物流回调（签名验证）
- `POST /shipments/kuaidi100/callback` - 快递100专用回调
  - 认证异常（Unauthorized/Forbidden）→ 抛出对应HTTP状态
  - 业务异常（NotFound/BadRequest）→ 返回 200 停止无意义重试
  - 瞬态异常（数据库超时、序列化冲突 P2034）→ 返回 500 让快递100重推

**文件**: `backend/src/modules/shipment/shipment.controller.ts`
**测试**: `shipment.controller.spec.ts` (8 tests)

#### ✅ SellerShippingService - 卖家面单操作
- `generateWaybill()` - 生成电子面单
  - 订单归属验证
  - 状态校验（仅 PAID/SHIPPED 允许）
  - 幂等性：已有面单拒绝重复生成（CAS 保护）
  - 分布式锁（pg_advisory_xact_lock）防并发
  - 失败回滚（自动调用 cancelWaybill 回收单号）
  - 存储 kuaidi100TaskId
- `cancelWaybill()` - 取消面单
  - **先调快递100远端取消，再 CAS 清空本地**（避免不一致）
  - 仅 INIT 状态允许取消
- `batchGenerateWaybill()` - 批量生成（部分失败不阻断）
- `getWaybillPrintUrl()` - HMAC 签名的临时打印 URL（15分钟有效）
- `verifyPrintSignature()` - 打印链接签名验证

**文件**: `backend/src/modules/seller/shipping/seller-shipping.service.ts`
**测试**: `seller-shipping.service.spec.ts` (52 tests)

#### ✅ SellerOrdersService.ship() - 发货确认
- Serializable 事务 + CAS 防并发重复发货
- Shipment: INIT → IN_TRANSIT
- Order: PAID → SHIPPED（首个商家发货即转换）
- 设置 `autoReceiveAt`（根据 `autoConfirmDays` 配置）
- 记录 OrderStatusHistory

**文件**: `backend/src/modules/seller/orders/seller-orders.service.ts`

#### ✅ SellerAfterSaleService - 售后换货面单
- `generateWaybill()` - 换货面单生成，存储 `replacementKuaidi100TaskId`
- `cancelWaybill()` - 先远端后本地的取消顺序
- AfterSaleRequest 新增 `replacementKuaidi100TaskId` 字段 + migration 文件

**文件**: `backend/src/modules/seller/after-sale/seller-after-sale.service.ts`

### 2.2 Schema 变更

| 字段 | 表 | 说明 | Migration |
|------|-----|------|-----------|
| `kuaidi100TaskId` | Shipment | 快递100任务ID（用于复打/取消） | `20260409010000_add_shipment_kuaidi100_task_id` |
| `replacementKuaidi100TaskId` | AfterSaleRequest | 换货面单快递100任务ID | `20260410010000_add_after_sale_replacement_kuaidi100_task_id` |

### 2.3 前端实现

#### ✅ 买家 App 物流追踪页
- **文件**: `app/orders/track.tsx`
- **功能**:
  - 初次加载读取本地缓存的物流轨迹（`GET /shipments/:orderId`）
  - 下拉刷新触发快递100主动查询（`GET /shipments/:orderId/track`）
  - 刷新结果直接写入 react-query 缓存
  - **多包裹区分**: 超过1个包裹时显示分组列表，每个包裹独立的时间线 + 折叠/展开
  - 单包裹保持原样聚合视图
  - 快递单号脱敏显示
- **Repo**: `src/repos/OrderRepo.ts` - 新增 `refreshShipmentTracking(orderId)` 方法

#### ✅ 卖家后台发货管理
- **文件**: `seller/src/pages/orders/`
- **功能**:
  - 订单列表（待发货/已发货）
  - 生成面单（选择快递公司 + 调用 generateWaybill API）
  - 面单打印（点击打印按钮触发签名 URL）
  - 取消面单（未发货时）
  - 确认发货
  - 批量发货

#### ✅ 管理后台运费规则
- **文件**: `admin/src/pages/...`
- **功能**: CRUD 运费规则（按地区/金额/重量匹配）

### 2.4 环境变量

已在 `backend/.env.example` 配置：

```env
# 快递100（物流查询 + 电子面单）
KUAIDI100_CUSTOMER="your-kuaidi100-customer-id"
KUAIDI100_KEY="your-kuaidi100-key"
KUAIDI100_SECRET="your-kuaidi100-secret"
KUAIDI100_PARTNER_ID="your-platform-partner-id"
KUAIDI100_PARTNER_KEY=""
KUAIDI100_CALLBACK_URL="https://api.ai-maimai.com/api/v1/shipments/kuaidi100/callback"
KUAIDI100_CALLBACK_TOKEN="your-callback-token"
```

### 2.5 测试覆盖

**5 个测试文件，105 个测试全部通过**，覆盖维度：

| 文件 | 测试数 | 覆盖 |
|------|--------|------|
| `kuaidi100-waybill.service.spec.ts` | 14 | 面单创建/取消、HTTP异常、配置检查、无回调URL警告 |
| `shipment.service.spec.ts` | 29 | 回调处理、Order 联动、主动查询、轨迹去重、签名验证、多包裹聚合 |
| `shipment.service.kuaidi100-callback.spec.ts` | 2 | 快递100回调 token 认证 |
| `shipment.controller.spec.ts` | 8 | 回调异常分类（认证/业务/瞬态）、重试策略 |
| `seller-shipping.service.spec.ts` | 52 | 面单全生命周期、取消顺序、幂等性、多商家隔离、HMAC 打印链接 |

所有测试使用真实种子数据（`u-001` / `c-001`-`c-004` / `o-001`-`o-004`）。

---

## 3. 未完成的问题（历史：快递100时期遗留，已在顺丰直连中解决或不再适用）

### 🔴 必须解决（阻断上线）

#### 问题 1: 快递100真实凭证未申请
- **类型**: 外部审批
- **影响**: 整个快递链路无法实际工作，当前只能用 mock 配置跑测试
- **工作**: 申请快递100企业账户 + 电子面单月结账号
- **周期**: 3-7 天（含快递公司面签）
- **申请地址**: https://www.kuaidi100.com 企业平台
- **需要准备**: 营业执照、对公账户、月均发货量预估

#### 问题 2: 快递100后台未配置回调URL
- **类型**: 部署配置
- **影响**: 物流推送永远收不到，买家看到的物流轨迹永远过时
- **操作**: 在快递100管理后台"API 接口设置"中填写：
  - 推送 URL: `https://api.ai-maimai.com/api/v1/shipments/kuaidi100/callback?token=<KUAIDI100_CALLBACK_TOKEN>`
  - 权限令牌: 同 `KUAIDI100_CALLBACK_TOKEN` 环境变量
- **工作量**: 0.5 天（含联调测试）

#### 问题 3: Nginx 未暴露回调端点
- **类型**: 部署配置
- **影响**: 快递100回调收到 404
- **操作**: Nginx 配置添加
  ```nginx
  location /api/v1/shipments/kuaidi100/callback {
      proxy_pass http://127.0.0.1:3000;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
  ```
- **工作量**: 0.5 天

#### 问题 4: 面单图片未持久化
- **类型**: 代码缺失
- **影响**: 快递100返回的 `label` 是临时短链，几天后会失效。卖家一旦晚点打印就报错。
- **当前实现**: `Shipment.waybillUrl` 直接存快递100返回的 label URL
- **应改为**:
  1. `createWaybill()` 成功后异步下载 label 图片
  2. 上传到阿里云 OSS（使用已有的上传服务）
  3. `Shipment.waybillUrl` 存 OSS 永久 URL
  4. 失败时降级存 label 原始 URL 并记录告警
- **文件**: `backend/src/modules/shipment/kuaidi100-waybill.service.ts` + `backend/src/modules/seller/shipping/seller-shipping.service.ts`
- **工作量**: 1 天

#### 问题 5: 商家无新订单提醒
- **类型**: 代码缺失
- **影响**: 卖家不知道有订单要发货，订单积压，买家等待时间长
- **方案对比**:
  | 方案 | 工作量 | 成本 | 体验 |
  |------|--------|------|------|
  | 钉钉机器人 webhook | 0.5 天 | 免费 | 商家需加入钉钉群 |
  | 企业微信机器人 | 0.5 天 | 免费 | 商家需加入企业微信 |
  | 短信通知 | 1 天 | 每条0.05元 | 普适但成本高 |
  | 卖家App Push | 3-5 天 | 需开发卖家 App | 最佳但工作量最大 |
- **推荐**: 钉钉/企业微信 webhook 作为 MVP
- **触发点**: 订单支付成功后调用商家配置的 webhook URL
- **文件**: 新增 `backend/src/modules/notification/merchant-notification.service.ts`
- **工作量**: 1 天（含后台配置 webhook URL 的 UI）

#### 问题 6: 买家物流状态无 Push 通知
- **类型**: 代码缺失
- **影响**: 发货、签收买家都收不到推送，体验差
- **关键触发节点**:
  1. 卖家确认发货 → "您的订单已发货"
  2. 快递进入派送 → "快递正在派送"
  3. 签收 → "包裹已送达"
- **依赖**:
  - 极光推送 SDK 或 Firebase Cloud Messaging
  - APNs 证书（iOS）
  - 设备 token 注册表（DeviceToken 模型）
- **当前状态**: 项目中完全没有 Push 基础设施
- **工作量**: 2-3 天

### 🟡 重要但可上线后补

#### 问题 7: 物流异常监控缺失
- **类型**: 代码缺失
- **影响**: 包裹卡在某个节点数天没动，无人发现
- **方案**: 新增 Cron 任务
  - 每天扫描 IN_TRANSIT 状态超过 N 天未更新的 Shipment
  - 触发告警（商家 webhook + 买家站内信）
  - 可选：主动调快递100查询最新状态
- **文件**: 新增 `backend/src/modules/shipment/shipment-monitor.cron.ts`
- **工作量**: 0.5 天

#### 问题 8: 面单真实打印方案缺失
- **类型**: 产品/硬件方案
- **当前**: 返回签名 URL，卖家手动打开浏览器右键打印
- **问题**: 没有对接热敏打印机，卖家体验差
- **方案选项**:
  1. **浏览器打印**（当前）- 免费但体验差
  2. **快递100云打印**（CLOUD 模式）- 需购买云打印机
  3. **网页调用系统打印机** - 需 seller 前端集成 window.print()
- **推荐**: 先完善浏览器打印体验（打印样式 + 自动分页），后期对接快递100云打印
- **工作量**: 0.5-2 天（取决于方案）

#### 问题 9: 买家催发货功能
- **类型**: 功能缺失
- **场景**: 订单 PAID 超过 24 小时未发货，买家想催卖家
- **实现**:
  - App 订单详情页显示"催发货"按钮
  - 触发 webhook 通知商家
  - 每个订单每天最多催 1 次
- **工作量**: 1 天

#### 问题 10: 发货前修改收货地址
- **类型**: 功能缺失
- **场景**: 买家下单后发现地址写错，发货前想修改
- **实现**:
  - 订单状态 PAID 且无 Shipment 时允许修改
  - 新增 `PATCH /orders/:id/address` 接口
  - 不重新计算运费（或提示重算）
- **工作量**: 1 天

#### 问题 11: 退货物流单号输入（退换货场景）
- **类型**: 前端功能缺失
- **场景**: 买家退货时需填写物流单号，卖家才能跟踪退货
- **当前**: Schema 字段已存在（`returnTrackingNo` 等），但前端交互不完整
- **工作量**: 1 天（前端 + 联调）

### 🟢 体验优化（可选）

- 快递100云打印对接（替代浏览器打印）
- 物流地图可视化（高德地图展示包裹位置）
- 发货时效预估展示
- 物流满意度评价
- 保价服务对接

---

## 4. 上线前 Checklist（历史：快递100时期，已不适用）

### Phase 1: 代码补齐（3-4 天）
- [ ] 面单图片持久化到 OSS（问题 4）
- [ ] 商家新订单通知 webhook（问题 5）
- [ ] 买家物流 Push 通知（问题 6）
- [ ] 物流异常监控 cron（问题 7）

### Phase 2: 外部账号申请（平行进行，3-7 天）
- [ ] 快递100 企业账户注册 + 企业认证
- [ ] 快递100 电子面单月结账号申请（需快递公司审核）
- [ ] 极光推送/FCM 账户（如做 Push）
- [ ] APNs 证书申请（iOS Push）
- [ ] 商家钉钉/企业微信机器人配置

### Phase 3: 部署配置（1 天）
- [ ] Nginx 配置回调端点路由
- [ ] HTTPS 证书就绪（api.ai-maimai.com）
- [ ] `.env` 填写真实快递100凭证
- [ ] 在快递100后台填写回调URL + token
- [ ] 测试回调是否能收到（用 curl 模拟推送）

### Phase 4: 联调测试（1-2 天）
- [ ] 沙箱环境：生成真实面单 → 打印 → 发货 → 回调推送 → 签收 → 自动确认
- [ ] 多商家订单测试
- [ ] 取消面单测试（先远端后本地）
- [ ] 换货面单测试
- [ ] 物流异常场景测试
- [ ] 并发场景压测

---

## 5. 关键代码路径速查（已更新为顺丰直连）

> 以下路径已更新为顺丰丰桥直连方案的代码路径。

### 5.0 当前核心入口

| 场景 | 入口方法 | 文件 |
|------|---------|------|
| 卖家生成面单 | `SellerShippingService.generateWaybill()` | seller-shipping.service.ts |
| 卖家取消面单 | `SellerShippingService.cancelWaybill()` | seller-shipping.service.ts |
| 卖家确认发货 | `SellerOrdersService.ship()` | seller-orders.service.ts |
| 买家查物流 | `ShipmentService.getByOrderId()` | shipment.service.ts |
| 买家主动刷新物流 | `ShipmentService.queryTracking()` | shipment.service.ts |
| 顺丰推送回调 | `ShipmentController.handleSfCallback()` | shipment.controller.ts |
| 顺丰 API 封装 | `SfExpressService` | sf-express.service.ts |
| 物流异常监控 | `ShipmentMonitorService.checkStaleShipments()` | shipment-monitor.service.ts |
| 自动确认收货 | `OrderAutoConfirmService.handleAutoConfirm()` | order-auto-confirm.service.ts |

### 5.1 历史代码路径（快递100，已删除，仅供参考）

### 5.1 核心业务入口

| 场景 | 入口方法 | 文件 |
|------|---------|------|
| 卖家生成面单 | `SellerShippingService.generateWaybill()` | seller-shipping.service.ts |
| 卖家取消面单 | `SellerShippingService.cancelWaybill()` | seller-shipping.service.ts |
| 卖家确认发货 | `SellerOrdersService.ship()` | seller-orders.service.ts |
| 买家查物流 | `ShipmentService.getByOrderId()` | shipment.service.ts |
| 买家主动刷新物流 | `ShipmentService.queryTrackingFromKuaidi100()` | shipment.service.ts |
| 快递100推送回调 | `ShipmentController.handleKuaidi100Callback()` | shipment.controller.ts |
| 自动确认收货 | `OrderAutoConfirmService.handleAutoConfirm()` | order-auto-confirm.service.ts |
| 换货面单生成 | `SellerAfterSaleService.generateWaybill()` | seller-after-sale.service.ts |

### 5.2 关键状态转换

```
Shipment.status:  INIT → IN_TRANSIT → DELIVERED
                                    ↘ EXCEPTION

Order.status:     PENDING_PAYMENT → PAID → SHIPPED → DELIVERED → RECEIVED
                                         ↘ CANCELED / REFUNDED
```

### 5.3 并发安全机制

| 场景 | 机制 |
|------|------|
| 面单生成防重复 | `pg_advisory_xact_lock` 分布式锁 + CAS `updateMany where waybillNo: null` |
| 发货状态转换 | Serializable 事务 + 重读校验 |
| 回调 Order 联动 | Serializable + CAS `updateMany where status: 'SHIPPED'` + 最多3次重试 |
| 取消面单 | 事务外先调远端 → 事务内 CAS `updateMany where status: 'INIT'` |
| 轨迹事件去重 | 先查已有事件 → `occurredAt|message` 作为 key 过滤后 createMany |

---

## 6. 相关文档

- `docs/operations/deployment.md` - 部署架构与 Nginx 配置
- `docs/architecture/data-system.md` - Shipment/Order 数据模型权威来源
- `docs/features/refund.md` - 退换货规则（关联退货物流）
- `docs/superpowers/specs/2026-04-09-kuaidi100-waybill-integration-design.md` - 快递100电子面单统一集成设计方案（**历史方案，将被替换**）
- `docs/superpowers/plans/2026-04-09-kuaidi100-waybill-integration.md` - 快递100实施计划（**历史方案**）

---

## 7. 顺丰直连改造方案（新方案，进行中）

### 7.1 技术路线

**目标**：完全移除快递100，直接对接顺丰丰桥平台（https://qiao.sf-express.com），使用顺丰原生 API。

**丰桥 API 文档**：https://qiao.sf-express.com/pages/developDoc/index.html

### 7.2 核心 API 映射

| 业务场景 | 顺丰丰桥 API 名称 | 说明 | 替代的快递100方法 |
|---------|------------------|------|----------------|
| 创建订单取号 | `EXP_RECE_CREATE_ORDER` | 创建顺丰运单，返回真实单号 | `Kuaidi100WaybillService.createWaybill()` |
| 云打印面单 | `COM_RECE_CLOUD_PRINT_WAYBILLS` | 获取面单图片（PDF/BASE64） | `createWaybill()` 返回的 label URL |
| 订单确认/取消 | `EXP_RECE_UPDATE_ORDER` | dealType=2 表示取消 | `Kuaidi100WaybillService.cancelWaybill()` |
| 路由查询 | `EXP_RECE_SEARCH_ROUTES` | 主动查询物流轨迹 | `Kuaidi100Service.queryTracking()` |
| 路由订阅（主动推送） | 无需订阅 API，下单时配置 callback URL | 顺丰直接推送到你的回调 | `Kuaidi100Service.subscribe()` |
| 订单结果查询 | `EXP_RECE_SEARCH_ORDER_RESP` | 查询订单下单结果 | 无对应 |

### 7.3 顺丰 API 签名算法

**基础格式**：
```
verifyCode = MD5(msgData + timestamp + checkWord)
```
然后 Base64 编码。

**关键要点**：
- `msgData`：请求的业务参数 JSON 字符串
- `timestamp`：毫秒时间戳（String）
- `checkWord`：丰桥分配的校验码（相当于 API Secret）
- 签名结果放在 HTTP Header 或请求 body 的 `verifyCode` 字段

**与快递100对比**：
- 快递100：`MD5(param + t + key + secret)` 大写十六进制
- 顺丰：`MD5(msgData + timestamp + checkWord)` Base64 编码

### 7.4 新架构设计

```
ShipmentModule
├── SfExpressService           (新建：顺丰丰桥 API 封装)
│   ├── createOrder()          # 下单取号
│   ├── printWaybill()         # 云打印面单
│   ├── cancelOrder()          # 取消订单
│   ├── queryRoute()           # 路由查询
│   └── parsePushCallback()    # 解析顺丰推送
├── ShipmentService            (保留：核心业务逻辑)
└── ShipmentController         (更新：新增 /shipments/sf/push 端点)
```

### 7.5 环境变量变更

**删除**：
```env
# 快递100相关（全部删除）
KUAIDI100_CUSTOMER
KUAIDI100_KEY
KUAIDI100_SECRET
KUAIDI100_PARTNER_ID
KUAIDI100_PARTNER_KEY
KUAIDI100_CALLBACK_URL
KUAIDI100_CALLBACK_TOKEN
```

**新增**：
```env
# 顺丰丰桥（SF Fengqiao）
SF_API_URL="https://bsp-oisp.sf-express.com/std/service"  # 生产环境
SF_API_URL_UAT="https://bsp-oisp-uat.sf-express.com/std/service"  # UAT 沙箱
SF_CLIENT_CODE="your-sf-client-code"        # 丰桥分配的开发者编码
SF_CHECK_WORD="your-sf-check-word"          # 丰桥分配的校验码（密钥）
SF_MONTHLY_ACCOUNT="your-sf-monthly-account" # 顺丰月结账号（12位数字）
SF_CALLBACK_URL="https://api.ai-maimai.com/api/v1/shipments/sf/push"
SF_ENV="UAT"  # UAT 或 PROD，用于切换沙箱/生产
```

### 7.6 代码改造任务清单

**全部任务已完成（2026-04-12）**

#### 阶段 A：新建 SfExpressService ✅ 已完成

| 任务 | 文件 | 状态 |
|------|------|------|
| 创建 SfExpressService 骨架 | `backend/src/modules/shipment/sf-express.service.ts` | ✅ 完成 |
| 实现签名算法（MD5 + Base64） | 同上 | ✅ 完成 |
| 实现 createOrder() | 同上 | ✅ 完成 |
| 实现 printWaybill() | 同上 | ✅ 完成 |
| 实现 cancelOrder() | 同上 | ✅ 完成 |
| 实现 queryRoute() | 同上 | ✅ 完成 |
| 实现 parsePushCallback() | 同上 | ✅ 完成 |
| 编写单元测试 | `backend/src/modules/shipment/sf-express.service.spec.ts` | ✅ 完成 |

#### 阶段 B：改造 SellerShippingService 和 ShipmentService ✅ 已完成

| 任务 | 文件 | 状态 |
|------|------|------|
| 移除 Kuaidi100WaybillService 注入，改用 SfExpressService | `seller-shipping.service.ts` | ✅ 完成 |
| 更新 createCarrierWaybill 和 cancelCarrierWaybill | 同上 | ✅ 完成 |
| 新增 handleSfPush 方法 | `shipment.service.ts` | ✅ 完成 |
| 新增 /shipments/sf/push 回调端点 | `shipment.controller.ts` | ✅ 完成 |
| 更新 ShipmentModule 注册 | `shipment.module.ts` | ✅ 完成 |
| 更新测试 | 各 .spec.ts | ✅ 完成 |

#### 阶段 C：删除快递100相关代码 ✅ 已完成

| 任务 | 文件 | 状态 |
|------|------|------|
| 删除 Kuaidi100Service | `kuaidi100.service.ts` | ✅ 已删除 |
| 删除 Kuaidi100WaybillService | `kuaidi100-waybill.service.ts` | ✅ 已删除 |
| 删除对应测试 | `*.spec.ts` | ✅ 已删除 |
| 更新环境变量 | `.env.example` | ✅ 完成 |
| 更新文档 | 本文档 | ✅ 完成 |

### 7.7 迁移顺序

```
┌─ 阶段 A：写 SfExpressService（3 天，并行）
│  ↓
阶段 B：改造 SellerShippingService ────┐
│                                       │
└─ 用户申请顺丰凭证（6-14 天，并行）───┘
                                        │
                                        ↓
                           阶段 C：沙箱联调（1-2 天）
                                        ↓
                           阶段 D：生产切换 + 删除快递100代码
```

---

## 8. 顺丰月结账号 + 丰桥 API 申请流程（用户操作）

### 8.1 申请前准备

**需要的材料**：
- 营业执照（深圳华海农业科技集团有限公司的彩色扫描件）
- 法定代表人身份证正反面
- 对公账户信息（开户行、账号）
- 公司联系人信息（姓名 + 手机号）
- 经办人授权书（如非法人本人操作，顺丰提供模板）
- 经办人身份证（如非法人本人）
- 预估月均发件量（用于谈判协议价）
- 主要发件地址 + 品类

**预存金额准备**：
- 一般要求预存保证金 5000 - 20000 元（不是运费，是押金，可退）
- 具体金额由顺丰销售根据业务量评估

### 8.2 平台入口汇总

| 平台 | 地址 | 用途 |
|------|------|------|
| **顺丰企业服务平台（月结管家）** | **https://v.sf-express.com/** | ✅ **申请月结账号** + 对账 + 开票 |
| **顺丰丰桥** | **https://qiao.sf-express.com/** | ✅ **开发应用 + 申请 API 权限** + 沙箱测试 |
| 顺丰开放平台 | https://open.sf-express.com/ | ❌ 不需要（面向大型技术合作伙伴） |

### 8.3 完整申请流程（10 步）

#### 第 1 步：打开月结申请入口
**地址**：https://v.sf-express.com/

#### 第 2 步：登录或注册企业账号
- 用企业联系人手机号登录（如 138***0623）
- 没账号则点「注册」→ 选企业账号
- 顺丰的账号体系是通的，v.sf-express.com 和 qiao.sf-express.com 共用一个账号

#### 第 3 步：点击「申请新的月结账号」
登录后在首页或菜单找到「申请新的月结账号」按钮。

#### 第 4 步：填写申请表单

| 字段 | 填写内容 |
|------|---------|
| 企业名称 | 深圳华海农业科技集团有限公司 |
| 统一社会信用代码 | 从营业执照上获取 |
| 法定代表人 | 从营业执照上获取 |
| 联系人姓名 | 经办人姓名 |
| 联系手机 | 138***0623 |
| 寄件地址 | 仓库/办公室详细地址 |
| 收件人（账单邮寄地址） | 同上或其他 |
| 邮箱 | 用于接收电子账单 |
| 预估月寄件量 | 真实估算，如 500 单/月 |
| 主要寄件品类 | **农产品（生鲜/常温）** |
| 是否需要冷链 | 如有生鲜则选「是」 |

#### 第 5 步：上传资料
- 营业执照彩色扫描件
- 法人身份证正反面
- 授权书（如非法人本人，下载模板填写盖公章后上传）
- 经办人身份证（如非法人本人）

#### 第 6 步：提交并等待初审
- 顺丰后台初审：1-2 个工作日
- 初审通过后，**当地顺丰销售经理会主动联系 138***0623**

#### 第 7 步：和销售经理沟通（关键）

电话/上门时必须说清楚：

> **"我要开企业月结账号，同时需要开通丰桥电子面单 API 权限，用于对接我们自研的电商平台发货系统。预估月发件量 X 单，主要发农产品，部分需要冷链。"**

**必谈事项**：
1. **协议运费价目表**（要求提供 PDF 或纸质版）
2. **预存保证金金额**（5000-20000 元区间）
3. **账期**（一般月结 30 天）
4. **结算方式**（对公转账）
5. **是否开通「云打印面单审核」**（丰桥 API 上生产必须通过）
6. **顺丰技术对接人联系方式**（后续 API 联调会用到）

**运费参考**：
- 月发 500 单以下：协议价 12-15 元/单（首重 1kg）
- 月发 500-2000 单：协议价 8-12 元/单
- 月发 2000+ 单：协议价 6-10 元/单
- 农产品/生鲜有时有专项优惠

#### 第 8 步：签约 + 预存保证金
- 签订电子合同（加盖企业公章 + 法人章）
- 对公转账预存保证金
- 收到确认后拿到：
  - **月结账号**（12 位数字，例如 `7551234567`）
  - **月结密码**
  - **电子账单邮箱**
  - **销售经理联系方式**
  - **顺丰技术对接人联系方式**

#### 第 9 步：丰桥创建应用申请 API 权限

**转战到丰桥**：https://qiao.sf-express.com/

1. 用同一个手机号登录
2. **企业认证**（如果还没认证）：
   - 「账号管理」→「企业认证」
   - 上传营业执照、法人身份证等
   - 审核 1-3 个工作日
3. **创建应用**：
   - 「应用管理」→「创建应用」
   - 应用名称：爱买买电商平台
   - 应用类型：**自用型**
   - 开发语言：Node.js
4. **关联 API**（勾选以下必须的接口）：
   - ✅ 下订单接口（EXP_RECE_CREATE_ORDER）
   - ✅ 订单结果查询（EXP_RECE_SEARCH_ORDER_RESP）
   - ✅ 订单确认/取消（EXP_RECE_UPDATE_ORDER）
   - ✅ 路由查询（EXP_RECE_SEARCH_ROUTES）
   - ✅ **云打印面单接口（COM_RECE_CLOUD_PRINT_WAYBILLS）** ⚠️ 必选
5. **绑定月结账号**（填第 8 步拿到的月结号 + 密码）
6. 提交审核（1-3 个工作日）

#### 第 10 步：拿到最终 API 凭证

审核通过后，在丰桥「我的应用」→「应用详情」里：

| 凭证 | 填到 .env |
|------|----------|
| clientCode | `SF_CLIENT_CODE` |
| checkWord | `SF_CHECK_WORD` |
| 月结账号 | `SF_MONTHLY_ACCOUNT` |
| UAT API 地址 | `SF_API_URL_UAT` |
| 生产 API 地址 | `SF_API_URL` |

**然后把这些凭证发给我**，立刻开始沙箱联调。

### 8.4 沙箱测试 + 生产切换

#### 沙箱（UAT）测试
1. 丰桥默认提供沙箱环境，**无需等生产审批即可开始测试**
2. 使用 UAT URL 调用 API，下单不会真实发货
3. 测试全流程：下单 → 打印 → 取消 → 查询 → 推送回调
4. 顺丰要求通过**「云打印面单审核」**（新用户强制），审核周期 1-3 天

#### 生产环境切换
1. 沙箱审核通过
2. 在丰桥提交「申请生产环境开通」
3. 顺丰审核 1-2 个工作日
4. 切换 `SF_ENV=PROD` 和 `SF_API_URL` 到生产地址
5. **灰度测试**：先发 10 单真实订单验证
6. 全量切换

### 8.5 时间线预估

| 阶段 | 耗时 |
|------|------|
| 月结账号申请（v.sf-express.com）| 1-3 天（顺丰初审）|
| 顺丰销售谈判 + 签约 | 3-7 天 |
| 丰桥企业认证 | 1-3 天 |
| 丰桥应用创建 + API 审批 | 1-3 天 |
| 沙箱测试 + 云打印面单审核 | 1-3 天 |
| 生产环境开通 | 1-2 天 |
| **总计** | **8-21 天**（中位数约 10-14 天）|

**可以并行的事**：
- 顺丰月结申请的同时，我可以先写 `SfExpressService` 代码
- 等顺丰沙箱凭证下来立刻联调，节省 3-5 天等待时间

### 8.6 常见问题

**Q1: 为什么不能一上来就用丰桥？**
A: 丰桥申请应用时必须绑定月结账号，所以必须先在 v.sf-express.com 办月结。

**Q2: 预存保证金会被扣运费吗？**
A: 不会。保证金是押金，月度运费是单独对账结算。合同终止时保证金可退。

**Q3: 沙箱和生产的 API 参数一样吗？**
A: 接口定义完全一致，只是 URL 不同：
- UAT: `https://bsp-oisp-uat.sf-express.com/std/service`
- PROD: `https://bsp-oisp.sf-express.com/std/service`

**Q4: clientCode 和月结账号有什么区别？**
A:
- `clientCode`：丰桥分配的开发者编码，标识你的应用
- `月结账号`：顺丰运费结算账号，标识你的企业
- 两者都要传到 API 调用中

**Q5: 没通过「云打印面单审核」会怎样？**
A: 沙箱可以跑，但生产环境下订单会被顺丰拒绝。必须通过审核才能上生产。

**Q6: 顺丰回调推送需要单独申请吗？**
A: 不需要单独申请。在调用 `EXP_RECE_CREATE_ORDER` 时传入 `callbackurl` 参数即可，顺丰会自动推送物流变更到这个地址。

### 8.7 回调 URL 部署

新的回调端点需要在 Nginx 暴露：

```nginx
server {
    server_name api.ai-maimai.com;

    location /api/v1/shipments/sf/push {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
    }
}
```

顺丰会向这个 URL POST 物流变更事件，代码需要：
1. 验证签名（使用 `checkWord`）
2. 解析顺丰格式的 payload
3. 调用 `ShipmentService.handleSfPush()` 处理

### 8.8 用户操作 Checklist

- [ ] 打开 https://v.sf-express.com/ 登录
- [ ] 提交月结账号申请（上传营业执照、身份证、授权书）
- [ ] 等待顺丰销售经理联系
- [ ] 签合同、预存保证金、拿到月结号
- [ ] 打开 https://qiao.sf-express.com/ 登录
- [ ] 完成企业认证
- [ ] 创建应用，勾选 5 个必要 API
- [ ] 绑定月结账号
- [ ] 等待审核通过
- [ ] 从丰桥后台复制 clientCode / checkWord / 月结账号
- [ ] 把凭证发给开发者联调沙箱
- [ ] 通过云打印面单审核
- [ ] 切换生产环境
- [ ] 灰度测试 10 单
- [ ] 全量上线
