# L16 地址管理链路 审查报告（B 档）

**审查日期**: 2026-04-11
**审查范围**: 用户收货地址 CRUD、默认地址、结算页地址选择、Order.addressSnapshot、卖家发货地址
**审查方式**: 只读审查

---

## 1. 链路总览

| 环节 | 文件 | 状态 |
|------|------|------|
| Schema Address 模型 | backend/prisma/schema.prisma:1270-1283 | 正常 |
| 后端 AddressService CRUD | backend/src/modules/address/address.service.ts | 有缺陷 |
| 后端 Address Controller | backend/src/modules/address/address.controller.ts | 正常 |
| DTO (Create/Update) | backend/src/modules/address/dto/ | 正常（兼容双字段命名） |
| AddressRepo (App) | src/repos/AddressRepo.ts | 正常 |
| 类型 Address (App) | src/types/domain/Address.ts | 字段不全 |
| 地址列表/编辑页 | app/me/addresses.tsx | 正常 |
| 结算页地址选择 | app/checkout.tsx:102-110 / app/checkout-address.tsx | 正常 |
| addressSnapshot 入订单 | backend/src/modules/order/checkout.service.ts:355-374, 775-784 | 正常（已加密） |
| 订单读回解密 | backend/src/modules/order/order.service.ts:1114-1122 | 正常 |
| 卖家发货地址来源 | backend/src/modules/seller/shipping/seller-shipping.service.ts:83-102 | 有缺陷 |
| 卖家面单收件人解析 | seller-shipping.service.ts:52-78 | **严重缺陷** |

---

## 2. 验证点结果

### 2.1 Address CRUD（P1 问题）
- `list` / `create` / `update` / `remove` / `setDefault` 完整，controller 使用全局 `CurrentUser`。
- `ensureOwnership` 校验了 userId 归属 ✅
- **[P1 并发]** `create` 和 `update` 在设置新默认地址时执行 `updateMany(isDefault=false)` + `create/update(isDefault=true)` **未包装事务**（service.ts:39-61, 81-99）。仅 `setDefault` 使用 `$transaction`（service.ts:130-139），但也未指定 Serializable。并发场景下可能出现用户有 0 或 2 个默认地址。
- **[P2 原子性]** `create` 里"第一个地址自动设默认"的逻辑使用 `count()` + 后续 `create()`，count 与 create 之间可能插入其他创建，导致出现两条"第一条"都被标为默认。建议包装事务或改为唯一索引 + CAS。
- **[P2 删除兜底]** `remove`(service.ts:111-120) 删除默认地址后补选最新一条，但读写两次且不在事务里，并发 remove 可能导致默认地址丢失或重复。

### 2.2 字段对齐（P0 问题）
- **Schema**（`Address`）使用 `recipientName` / `regionCode` / `regionText` / `detail`。
- **DTO**（create/update）同时接受 `recipientName|receiverName` 与 `province/city/district` 或 `regionText`，向下兼容前端 ✅
- **Service.formatAddress**（service.ts:172-188）返回 `receiverName`、再把 `regionText` 通过 `parseRegionText` 切分成 `province/city/district` 返回给 App；**regionCode 未返回**。
- **前端 Address 类型**（src/types/domain/Address.ts）只声明 7 字段，**缺 regionCode、缺 location**。下单时也不回传 regionCode，但后端结账流程会从数据库按 id 重新取，问题不大。
- **结论**：App 端字段对齐无功能性问题，但类型定义不完整，建议补齐。

### 2.3 **[P0 严重]** addressSnapshot 字段与卖家 parseAddressSnapshot 不匹配
`checkout.service.ts:362-368 / 777-783` 写入订单的快照 shape：
```
{ recipientName, phone, regionCode, regionText, detail }
```
（加密后存 `addressSnapshot`）

但 `seller-shipping.service.ts:52-78` 的 `parseAddressSnapshot` 读取字段是：
```ts
name:    (addr as any).name || (addr as any).receiverName || '',
phone:   (addr as any).phone || (addr as any).receiverPhone || '',
address: [province, city, district, detail].filter(Boolean).join(''),
```
- `name` / `receiverName` 均不存在 → **recipientName 为空字符串**
- `province` / `city` / `district` 也不存在（实际存的是 `regionText`）→ **只有 detail 作为收件地址**，省市区丢失
- 结果：调用 kuaidi100 创建面单时 `recipientName='',recipientAddress='仅街道门牌号'`，面单必然失败或信息残缺。

单测 `seller-shipping.service.spec.ts:33-40` 使用了虚构的旧字段（`receiverName/province/city/district`），**从未覆盖真实生产 shape**，因此测试无法暴露该 bug。

修复建议（二选一）：
1. `parseAddressSnapshot` 改为读 `recipientName` + `regionText + detail`；
2. 或 checkout 时同时写 province/city/district 冗余字段（注意向下兼容）。

推荐方案 1，代价最小。

### 2.4 地区码准确性（P2）
- schema 保留 `regionCode` 字段，checkout 从数据库读原始 Address 时保留 `regionCode` 到订单快照。
- **但 App 端表单没有行政区划选择器**（app/me/addresses.tsx:135-165），用户手动输入 province/city/district 文本，**后端 `dto.regionCode` 实际永远为空字符串**（service.ts:30）。
- 影响：快递接口若依赖 regionCode 做路由、发票地址、税务地区等将不可用。这是历史遗留，非本轮缺陷，但需登记。

### 2.5 结算页地址选择（正常）
- `checkout.tsx:35-110` 首次加载自动 `addresses.find(isDefault) ?? addresses[0]` ✅
- `checkout-address.tsx` 选择后通过 `useCheckoutStore.setSelectedAddress(id)` 回写，back() 返回 checkout ✅
- `checkout.tsx:221-230`：无地址时刷新并跳转到 `/me/addresses` ✅
- React Query key 包含 `selectedAddress?.id`，切换地址会重新 preview ✅

### 2.6 addressSnapshot 入订单（正常，已加密）
- Checkout 流程写入 CheckoutSession 时加密（`encryptJsonValue`），checkout.service.ts:374 / 784
- 支付回调 COD 创建 Order 时直接透传加密后的 session 快照（checkout.service.ts:1193）✅
- `order.service.ts:1114` 返回详情前 decrypt，并用 `maskAddressSnapshot` 做脱敏输出 ✅
- 注意：`checkout.service.ts:359-373` 判定有效地址的条件仅为 `address.userId === userId`，未检查 `detail` / `phone` 是否为空，依赖 Address 模型非空约束（schema 字段均为 `String` 必填），OK。

### 2.7 卖家发货地址（P1）
- 系统**没有独立的"发货地址"模型**。Company 仅有 `address Json? {lng,lat,text}`（schema.prisma:905）和 `contact Json?`。
- `seller-shipping.service.getSenderInfo`（ts:83-102）从 `company.address.text`、`company.contact.{name,phone}`、`company.servicePhone` 拼装发件人信息，任何一项为空都会导致面单发件人残缺。
- seller/src/pages/company/index.tsx:198-201 只能编辑 `addressText`，**没有分省市区/门牌号/发件人姓名/发件人电话独立字段**。
- 结论：卖家发货地址是"临时方案"，与即将迁移到的顺丰丰桥直连需求（docs/features/shipping.md）不兼容，需在顺丰接入前补齐 `CompanyShipFrom`（或类似）独立模型。登记为 P1 阻塞项。

### 2.8 无地址空态（正常）
- `app/me/addresses.tsx:205-210`：EmptyState 显示"添加地址"CTA ✅
- `app/checkout-address.tsx:53-59`：EmptyState → 跳转 `/me/addresses` ✅
- `app/checkout.tsx:229-230`：无地址直接 push 到 `/me/addresses` ✅

---

## 3. E2E 验证

### E2E-1 新建地址 → 设默认 → 结算自动选中
- 步骤：App 新建地址（首条自动默认）→ 进入 checkout → `selectedAddress = addresses.find(isDefault)`
- 结果：**通过** ✅
- 注意：useCheckoutStore 中 `selectedAddressId` 在支付成功后未见清理（未在本轮审查范围内），可能残留跨订单。仅提示，不做阻塞。

### E2E-2 修改地址不影响已下订单
- Order 表使用 `addressSnapshot` 快照字段（schema.prisma:1365），非外键 ✅
- checkout.service.ts 写入时完整复制并加密，后续用户修改 Address 行不会影响已存在订单 ✅
- **通过** ✅
- 但需注意：`Address` 关系 `User @relation(onDelete: Restrict)` ✅，用户删除地址后订单仍存在快照，不会因外键连锁失效。

---

## 4. 问题清单汇总

| 级别 | 位置 | 问题 | 建议 |
|------|------|------|------|
| **P0** | seller-shipping.service.ts:52-78 | `parseAddressSnapshot` 读 `name/province/city/district`，与 checkout 写入的 `recipientName/regionText/detail` 完全不匹配，面单收件人全部为空或残缺 | 改为读 `recipientName` 和 `regionText + detail`，并为此写真实单测（覆盖加密 envelope） |
| **P1** | address.service.ts:39-99 | create/update 设默认地址的"清旧 + 写新"未在事务内，并发写可能产生 0 或 2 个默认 | 包装 `$transaction` 并用 Serializable；或 schema 增加 `@@unique([userId, isDefault])` 部分索引（PostgreSQL 支持） |
| **P1** | seller/src/pages/company/index.tsx + schema Company.address | 没有结构化发货地址模型，仅一个 text 字段；与顺丰丰桥直连所需字段（发件人/电话/省市区/详址）不兼容 | 新增 `CompanyShipFrom`（senderName/senderPhone/province/city/district/detail/regionCode/isDefault），卖家后台配置页同步改造 |
| **P2** | address.service.ts:46-49 | `count()` + 后续 `create()` 非原子，并发首创可能两条都 `isDefault=true` | 合并进事务 |
| **P2** | address.service.ts:111-120 (remove 兜底) | 删除默认后补默认不在事务里 | 合并进同一事务 |
| **P2** | app/me/addresses.tsx:135-165 | 省市区为纯文本输入，regionCode 永远为空 | 引入省市区 Picker（民政部地区码库），下一轮需求 |
| **P3** | src/types/domain/Address.ts | 类型缺 `regionCode`、`location` 字段 | 补齐便于后续使用 |
| **P3** | backend/src/modules/seller/shipping/seller-shipping.service.spec.ts:33-40 | Mock 的 addressSnapshot shape 与生产完全不同，掩盖 P0 bug | 用真实 shape + encryptJsonValue 包裹后 mock |

---

## 5. 审查结论

**链路可用性：有 P0 阻塞**

核心问题是 #1：卖家端面单生成将读不到收件人姓名和完整地址，任何真实发货都会失败或面单信息残缺。单测被虚构数据掩盖。必须在顺丰丰桥直连前修复。

次要阻塞 #2 是卖家发货地址模型缺失，顺丰直连前必须建模。

其余为并发/数据一致性 P1/P2 项，不阻塞但需要在 Serializable 治理行动中统一修复。

地址管理自身链路（创建/列表/结算选择/入订单）在"单用户单请求"语境下功能正常。
