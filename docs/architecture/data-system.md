# 爱买买 AI 赋能农业电商平台 — 数据库设计（NestJS + Prisma + PostgreSQL｜中国区 iOS/Android 上线版｜完整版）

> 覆盖三端：App（买家）/ 卖家后台（公司）/ 平台后台（运营）  
> 中国区本地化：微信/支付宝/银行卡支付，高德/腾讯地图，顺丰等物流对接  
> 核心商业：分润奖励（普通广播 X + VIP 三叉树上溯分配）可审计、可回滚、可版本化

---

## 0. 总体设计原则（强制）

1) **订单是事实来源**：付款/签收/退款事件驱动奖励生成与回滚  
2) **账本化**：奖励/余额/池子全部通过流水变更（不可“直接改历史”）  
3) **可配置、可版本化**：关键参数必须可在后台修改并形成版本快照  
4) **幂等**：支付回调、物流回调、分配、释放、退款回滚都要幂等键  
5) **中国对接 rawPayload 留存**：微信/支付宝/快递回调原文（脱敏/加密）  
6) **敏感数据安全**：手机号、身份证、银行卡等建议加密存储 + 访问审计

---

## 1. 奖励与会员体系：最终业务规则（已确认）

### 1.1 利润分配公式（六分结构）
对每一笔订单：
- profit = saleAmount - costAmount

**普通用户六分（默认）**：50%平台 / 16%奖励 / 16%产业基金 / 8%慈善 / 8%科技 / 2%备用金
**VIP用户六分（默认）**：50%平台 / 30%奖励 / 10%产业基金 / 2%慈善 / 2%科技 / 6%备用金

> 必须落库：profit、splitRatios（六分配比快照）、ruleVersion 快照。
> **历史兼容**：早期VIP订单使用旧公式（rebateRatio → rebatePool → 60%/37%/1%/2%），RewardAllocation.meta 中可能含 rebateRatio/rebatePool/rewardPool 字段，新订单使用 splitRatios 六分格式。

### 1.2 分流规则（关键）
- VIP树体系：仅对 **VIP 用户且未出局** 生效（所有金额订单均参与）
- 普通体系：非VIP全部订单 + VIP出局后订单

### 1.3 普通会员奖励（广播前 X 个）
- 按订单金额分桶（bucketKey）
- 同桶队列按时间排序
- 每次订单触发：取队列前 X 个用户，每人奖励 = (profit × rewardPct) / X（等额）
- 奖励先冻结，签收（或7天自动签收）释放

### 1.4 VIP 399 三叉树奖励（上到下建树，下到上分配）
- 树生成：三叉树，BFS 滑落插入（从上到下、从左到右）
- 奖励分配：VIP 用户 X 的第 k 单有效消费（未退款）→ 发给 X 的第 k 个祖先（点对点，仅一层）
- 解锁：祖先 A 必须 selfPurchaseCount ≥ k 才”解锁第 k 层奖励”；未解锁奖励冻结等待
- 上限：每个VIP最多拿 15 层；拿满出局；第16次起走普通体系
- 退款/拒收：会回滚”第 k 单”计数与对应奖励（必须可追溯、可重算）

### 1.5 VIP 推荐奖励（购买即发放）
- 触发条件：被推荐用户（已绑定推荐码）购买 VIP 成功
- 奖励对象：推荐人（inviterUserId）
- 奖励金额：由 `RuleConfig.VIP_REFERRAL_BONUS` 配置，默认 50 元
- 发放方式：在 VIP 购买事务内同步完成，直接创建 AVAILABLE 状态的 RewardLedger，即时入账推荐人奖励余额
- 流水标识：`refType = 'VIP_REFERRAL'`，`meta.scheme = 'VIP_REFERRAL'`，`meta.sourceUserId` 记录被推荐人 ID
- 幂等保障：VIP 购买本身是幂等的（重复购买被拒绝），推荐奖励随事务原子提交

---

## 2. 数据域拆分（完整表清单）

### 2.1 认证与用户域（Auth & User）✅（新增：国内手机号/微信登录）
- User：用户主表
- UserProfile：头像昵称等
- AuthIdentity：登录身份（手机号/微信等）
- SmsOtp：短信验证码
- Session / RefreshToken：会话与刷新令牌
- Device：设备信息（用于安全与推送）
- LoginEvent：登录审计日志
- UserConsent：隐私授权记录

### 2.2 平台后台域（Admin / Governance）
- AdminUser / AdminRole / AdminPermission / AdminAuditLog
- RuleConfig / RuleVersion
- ReviewTask（审核工作流）
- RiskFlag / Blacklist（可选）

### 2.3 卖家域（Seller Portal）
- SellerUser / SellerRole / SellerAuditLog
- Company/CompanyProfile/CompanyDocument/CompanyActivity
- Product/ProductSKU/ProductMedia/InventoryLedger
- TraceBatch/TraceEvent/OrderItemTraceLink
- Shipment（发货）

### 2.4 公司域（Company）
- Company / CompanyProfile / CompanyDocument / CompanyActivity

### 2.5 商品域（Product）
- Category / Tag / Product / ProductSKU / ProductMedia / ProductTag
- ProductBundleItem（组合商品组成项）
- InventoryLedger / (可选) PriceHistory / ProductAttribute

### 2.6 溯源确权域（Traceability）
- OwnershipClaim / TraceBatch / TraceEvent
- ProductTraceLink / OrderItemTraceLink

### 2.7 交易域（Order）
- Address / Cart / CartItem
- **CheckoutSession**（结算会话，付款后建单）
- Order / OrderItem / OrderStatusHistory
- Payment（微信/支付宝/银行卡/聚合）
- Refund
- Shipment / ShipmentTrackingEvent（顺丰等）
- ShippingTemplate（运费模板）
- InvoiceProfile / Invoice（中国发票）
- Coupon / CouponRedemption（可选）

### 2.8 AI 域（AI）
- AiSession / AiUtterance / AiIntentResult / AiActionExecution
- SearchIndexSnapshot（可选：AI摘要/检索）

### 2.9 会员分润奖励域（Membership & Rewards）
- MemberProfile / VipPurchase / ReferralLink
- VipTreeNode / VipProgress / VipEligibleOrder
- RewardAccount / RewardAllocation / RewardLedger
- NormalBucket / NormalQueueMember
- WithdrawRequest（提现申请/审核）
- PlatformPool（可用 RewardAccount 统一实现：PLATFORM_PROFIT/FUND_POOL/POINTS）

### 2.10 平台红包域（Coupon）
- CouponCampaign（红包活动：触发类型/发放模式/抵扣规则/配额/有效期）
- CouponInstance（红包实例：AVAILABLE/RESERVED/USED/EXPIRED/REVOKED 状态机）
- CouponUsageRecord（使用记录：关联订单+抵扣金额）

> **注意**：平台红包与分润奖励是完全独立的系统。红包只能结算抵扣，奖励只能提现。

### 2.11 团购分享回馈域（Group Buy）
- GroupBuyActivity / GroupBuyTier（后台指定平台商品、SKU、团购价、包邮、返还档位）
- GroupBuyInstance / GroupBuyCode（用户购买指定团购商品后，确认收货且售后期结束无退换货才生成分享码）
- GroupBuyReferral（仅统计一级直接推荐好友购买同款商品；被推荐订单确认收货且售后期结束无退换货后才有效）
- GroupBuyRebateAccount / GroupBuyRebateLedger（独立团购返还余额和流水，可提现、可在普通商品结算抵扣，团购商品本身现金购买）

> **注意**：团购分享回馈独立于 Reward 消费积分、Coupon 平台红包、VIP 推荐码、普通/VIP 分润树；不记录二级及以上关系链。月度发起次数由 `RuleConfig.GROUP_BUY_MAX_MONTHLY_LAUNCHES` 配置，默认 4。

---

## 3. 通用字段与约束

- 主键：UUID（uuid）
- 金额：Int（分）
- 时间：createdAt/updatedAt
- JSON：jsonb（Prisma Json）
- 软删除（可选）：deletedAt（重要数据建议不物理删除）
- 业务幂等：merchantOrderNo、merchantRefundNo、providerTxnId、providerRefundId 唯一

---

# A. 认证与用户系统（中国区：手机号短信 + 微信登录）

## A1. User（用户主表）
- id (uuid, PK)
- status (enum: ACTIVE/BANNED/DELETED)
- createdAt, updatedAt

> User 表尽量“干净”，登录身份放到 AuthIdentity，便于多身份绑定。

## A2. UserProfile
- id (uuid, PK)
- userId (uuid, unique FK User)
- nickname (text nullable)
- avatarUrl (text nullable)
- gender (enum nullable: UNKNOWN/MALE/FEMALE)
- birthday (date nullable)
- city (text nullable)
- createdAt, updatedAt

## A3. AuthIdentity（登录身份：手机号/微信）
- id (uuid, PK)
- userId (uuid FK User)
- provider (enum: PHONE/WECHAT)
- identifier (text)  
  - PHONE：E.164 或国内手机号（建议存纯数字 + countryCode）
  - WECHAT：openId（App）或 unionId（若有）
- unionId (text nullable) — 微信 unionid（跨应用统一）
- appId (text nullable) — 微信应用 appid
- verified (boolean default false)
- meta (jsonb nullable) — 微信昵称头像快照/渠道等
- createdAt, updatedAt

**约束/索引**
- unique(provider, identifier, appId)  // 微信不同 appId 下 openId 不同
- index(userId, provider)

> 建议：微信登录后把 openId 作为 identifier，unionId 单独字段。  
> 如果你未来有小程序/公众号联动，unionId 很重要。

## A4. SmsOtp（短信验证码）
- id (uuid, PK)
- phone (text)
- purpose (enum: LOGIN/BIND/RESET)
- codeHash (text) — 不存明文验证码
- expiresAt (timestamp)
- usedAt (timestamp nullable)
- ip (text nullable)
- createdAt

**索引**
- (phone, createdAt)
- (expiresAt)

## A5. Session（会话）
- id (uuid, PK)
- userId (uuid FK User)
- deviceId (uuid nullable FK Device)
- accessTokenHash (text) — 不存明文
- refreshTokenHash (text) — 不存明文
- status (enum: ACTIVE/REVOKED/EXPIRED)
- expiresAt (timestamp)
- createdAt, updatedAt

**索引**
- (userId, status)
- (expiresAt)

> 移动端建议：短 access token + 长 refresh token。  
> 也可不落 accessTokenHash，只落 refreshTokenHash + jti。

## A6. Device（设备）
- id (uuid, PK)
- userId (uuid FK User)
- platform (enum: IOS/ANDROID)
- deviceModel (text nullable)
- osVersion (text nullable)
- appVersion (text nullable)
- pushToken (text nullable) — 极光/华为/小米/苹果推送等
- createdAt, updatedAt

**索引**
- (userId, platform)

## A7. LoginEvent（登录审计）
- id (uuid, PK)
- userId (uuid nullable FK User) — 登录失败时可能为空
- provider (enum: PHONE/WECHAT)
- phone (text nullable)
- wechatOpenId (text nullable)
- success (boolean)
- ip (text nullable)
- userAgent (text nullable)
- meta (jsonb nullable)
- createdAt

## A8. UserConsent（隐私授权）
- id (uuid, PK)
- userId (uuid FK User)
- scope (enum: PRIVACY_POLICY/LOCATION/MICROPHONE/NOTIFICATION)
- granted (boolean)
- version (text) — 隐私政策版本
- grantedAt (timestamp)
- createdAt

---

# B. 平台后台（Admin Console）

## B1. AdminUser
- id (uuid, PK)
- username (text unique)
- phone (text nullable)
- passwordHash (text)
- status (enum: ACTIVE/DISABLED)
- createdAt, updatedAt

## B2. AdminRole / AdminPermission / 绑定表
AdminRole
- id, name(unique), description

AdminPermission（可选）
- id, code(unique), description

AdminUserRole
- adminUserId, roleId (unique pair)

AdminRolePermission
- roleId, permissionId (unique pair)

## B3. AdminAuditLog（后台审计）
- id
- adminUserId
- action (text) — UPDATE_RULE/APPROVE_COMPANY/VOID_LEDGER/...
- targetType (text)
- targetId (text)
- before (jsonb nullable)
- after (jsonb nullable)
- ip (text nullable), userAgent (text nullable)
- createdAt

## B4. ReviewTask（审核工作流）
- id
- targetType (enum: COMPANY/DOCUMENT/PRODUCT/TRACE/WITHDRAW)
- targetId (uuid)
- status (enum: PENDING/APPROVED/REJECTED)
- reviewerAdminId (uuid nullable FK AdminUser)
- reason (text nullable)
- createdAt, updatedAt

## B5. RuleConfig / RuleVersion
RuleConfig（当前配置）
- key (text PK)
- value (jsonb)
- updatedAt

RuleVersion（版本快照）
- id (uuid, PK)
- version (text unique) — hash/时间戳
- snapshot (jsonb) — 全量配置快照
- createdByAdminId (uuid nullable)
- changeNote (text nullable)
- createdAt

---

# C. 卖家系统（Seller Portal）

## C1. SellerUser
- id (uuid, PK)
- companyId (uuid FK Company)
- phone (text)
- passwordHash (text)
- status (enum: ACTIVE/DISABLED)
- createdAt, updatedAt

**索引**
- (companyId, status)
- unique(phone, companyId)（可选）

## C2. SellerRole / SellerUserRole（可选）
SellerRole
- id, companyId, name, description
SellerUserRole
- sellerUserId, roleId (unique pair)

## C3. SellerAuditLog
- id
- sellerUserId
- companyId
- action, targetType, targetId
- before (jsonb), after (jsonb)
- createdAt

---

# D. 公司系统（Company）

## D1. Company
- id (uuid, PK)
- name (text)
- shortName (text nullable)
- description (text nullable) — AI/搜索摘要
- status (enum: PENDING/ACTIVE/SUSPENDED)
- contact (jsonb nullable)
- servicePhone (text nullable)
- serviceWeChat (text nullable)
- address (jsonb nullable) — 经营地址/地图POI
- createdAt, updatedAt

## D2. CompanyProfile
- id (uuid, PK)
- companyId (uuid unique FK Company)
- richContent (jsonb)
- highlights (jsonb nullable) — 结构化卖点：产地、认证、主营、关键词
- updatedAt

## D3. CompanyDocument
- id (uuid, PK)
- companyId (uuid FK Company)
- type (enum: LICENSE/CERT/INSPECTION/FOOD_PERMIT/OTHER)
- title (text)
- fileUrl (text)
- issuer (text nullable)
- issuedAt (timestamp nullable)
- expiresAt (timestamp nullable)
- verifyStatus (enum: PENDING/VERIFIED/REJECTED)
- verifyNote (text nullable)
- createdAt

## D4. CompanyActivity
- id (uuid, PK)
- companyId (uuid FK Company)
- title (text)
- content (jsonb)
- startAt (timestamp nullable)
- endAt (timestamp nullable)
- createdAt

---

# E. 商品系统（Product）

## E1. Category
- id (uuid, PK)
- parentId (uuid nullable FK Category)
- name (text)
- path (text unique)
- level (int)
- sortOrder (int)
- isActive (boolean)

## E2. Tag
- id (uuid, PK)
- name (text unique)
- type (enum: PRODUCT/COMPANY/TRACE/AI)
- synonyms (text[] nullable)

## E3. Product（SPU）
- id (uuid, PK)
- companyId (uuid FK Company)
- categoryId (uuid FK Category)
- title (text)
- subtitle (text nullable)
- description (text nullable)
- detailRich (jsonb)
- status (enum: DRAFT/ACTIVE/INACTIVE)
- auditStatus (enum: PENDING/APPROVED/REJECTED)  // 或用 ReviewTask 统一
- auditNote (text nullable)
- basePrice (int)
- cost (int)
- currency (text default 'CNY')
- origin (jsonb nullable) — 产地/坐标/行政区划
- attributes (jsonb nullable)
- aiKeywords (text[] nullable)
- shippingTemplateId (uuid nullable FK ShippingTemplate)
- createdAt, updatedAt

## E4. ProductSKU
- id (uuid, PK)
- productId (uuid FK Product)
- skuCode (text unique nullable)
- title (text)
- price (int)
- stock (int)
- weightGram (int) — SKU 发货重量，单位克；顺丰运费计价与面单下单必填
- barcode (text nullable)
- status (enum: ACTIVE/INACTIVE)
- createdAt, updatedAt

## E5. ProductMedia
- id (uuid, PK)
- productId (uuid FK Product)
- type (enum: IMAGE/VIDEO)
- url (text)
- sortOrder (int)
- alt (text nullable)

## E6. ProductTag
- productId (uuid FK Product)
- tagId (uuid FK Tag)
- unique(productId, tagId)

## E7. InventoryLedger（建议）
- id (uuid, PK)
- skuId (uuid FK ProductSKU)
- type (enum: IN/OUT/ADJUST/RESERVE/RELEASE)
- qty (int)
- refType (text) — ORDER/ADMIN/IMPORT/AFTER_SALE
- refId (uuid nullable)
- createdAt

库存流水补充：退货退款成功后的库存回填使用 `InventoryLedger(type=RELEASE, refType=AFTER_SALE, refId=<afterSaleId>)` 记录幂等流水；数据库通过部分唯一索引保证同一个售后单只回填一次。

---

# F. 溯源确权（Traceability）

## F1. OwnershipClaim
- id (uuid, PK)
- type (enum: CERT/INSPECTION/NFT_HASH/OTHER)
- data (jsonb)
- createdAt

## F2. TraceBatch
- id (uuid, PK)
- companyId (uuid FK Company)
- batchCode (text unique)
- ownershipClaimId (uuid nullable FK OwnershipClaim)
- meta (jsonb) — 产地、养殖方式、饲料、检验摘要等
- createdAt

## F3. TraceEvent
- id (uuid, PK)
- batchId (uuid FK TraceBatch)
- type (enum: FARMING/TESTING/PROCESSING/PACKAGING/WAREHOUSE/SHIPPING/OTHER)
- data (jsonb)
- occurredAt (timestamp)
- createdAt

## F4. ProductTraceLink
- id (uuid, PK)
- productId (uuid FK Product)
- batchId (uuid FK TraceBatch)
- note (text nullable)
- unique(productId, batchId)

## F5. OrderItemTraceLink
- id (uuid, PK)
- orderItemId (uuid FK OrderItem)
- batchId (uuid FK TraceBatch)
- quantity (int)
- createdAt

---

# G. 订单与交易系统（中国区）

## G1. Address
- id (uuid, PK)
- userId (uuid FK User)
- recipientName (text)
- phone (text)
- regionCode (text) — 行政区划 code
- regionText (text) — “广东省深圳市南山区”
- detail (text)
- location (jsonb nullable) — {lng,lat,provider:AMAP/TENCENT}
- isDefault (boolean)
- createdAt, updatedAt

## G2. Cart / CartItem
Cart
- id (uuid, PK)
- userId (uuid unique FK User)
- updatedAt

CartItem
- id (uuid, PK)
- cartId (uuid FK Cart)
- skuId (uuid FK ProductSKU)
- quantity (int)
- unique(cartId, skuId)

## G2.5 CheckoutSession（结算会话 — F1 订单流程重构新增）
> 付款后才创建订单：前端发起结算 → 创建 CheckoutSession（ACTIVE）→ 支付回调确认 → 原子建单（PAID）→ 会话标记 COMPLETED

- id (uuid, PK)
- userId (uuid FK User)
- status (enum CheckoutSessionStatus: ACTIVE/PAID/COMPLETED/EXPIRED/FAILED)
- bizType (enum CheckoutBizType: NORMAL_GOODS/VIP_PACKAGE/GROUP_BUY, default NORMAL_GOODS) — 业务类型
- bizMeta (jsonb nullable) — 业务元数据，VIP_PACKAGE 时存 {vipGiftOptionId, giftSkuId, giftTitle, snapshotPrice}；GROUP_BUY 时存 groupBuyActivityId、groupBuyCodeId、referredByInstanceId、价格/包邮/档位快照
- itemsSnapshot (jsonb) — [{skuId, quantity, cartItemId?, isPrize, prizeRecordId?, unitPrice, companyId}]
- addressSnapshot (jsonb) — 完整地址快照
- redPackId (text nullable) — 选用的奖励 ID
- expectedTotal (float) — 服务端计算的应付总额
- goodsAmount (float) — 商品金额
- shippingFee (float) — 运费
- discountAmount (float default 0) — 奖励抵扣
- merchantOrderNo (text unique nullable) — 预生成的商户订单号
- paymentChannel (enum PaymentChannel nullable)
- providerTxnId (text unique nullable) — 支付渠道返回的交易号
- idempotencyKey (text nullable) — 幂等键
- expiresAt (timestamp) — ACTIVE 会话 30 分钟后过期
- paidAt (timestamp nullable)
- createdAt, updatedAt

**关系**
- orders: Order[] — 支付成功后创建的订单（一个会话可拆为多个商户订单）

**索引**
- (userId, status)
- unique(userId, idempotencyKey)
- (merchantOrderNo)
- (expiresAt, status)

**2026-06-22 组合商品补充**
- `itemsSnapshot[].productSnapshot.productType` 支持 `SIMPLE/BUNDLE`
- 当 `productType=BUNDLE` 时，`productSnapshot.bundleItems[]` 固化下单时的组件快照：
  - `skuId / productId / productTitle / skuTitle`
  - `quantityPerBundle / bundleQuantity / totalQuantity`
  - `unitPriceAtCheckout / image / weightGram`
- 结算前的可售库存校验不看 bundle 售卖 SKU 自身 `stock`，而是按组件 SKU 当前库存推导 `availability = min(floor(componentStock / quantityPerBundle))`
- 支付成功后的库存扣减、未发货取消回补、售后退款回补都基于这份组件快照展开到真实 SIMPLE SKU，避免后续商品改名、改图、改组成后影响历史订单

## G3. Order
- id (uuid, PK)
- userId (uuid FK User)
- status (enum: PENDING_PAYMENT/PAID/SHIPPED/DELIVERED/RECEIVED/CANCELED/REFUNDED)
- status transition note (2026-05-08): `PAID -> CANCELED` 仅用于买家未发货取消订单，成功后由 `Refund.status` 承载退款进度；已发货后的退货/换货仍走售后状态机，不复用未发货取消语义。
- bizType (enum OrderBizType: NORMAL_GOODS/VIP_PACKAGE/GROUP_BUY, default NORMAL_GOODS) — 业务类型
- bizMeta (jsonb nullable) — 业务元数据
- addressSnapshot (jsonb)
- totalAmount (int)
- goodsAmount (int)
- shippingFee (int)
- discountAmount (int)
- paidAt (timestamp nullable)
- receivedAt (timestamp nullable)
- autoReceiveAt (timestamp nullable)
- createdAt, updatedAt

## G4. OrderItem
- id (uuid, PK)
- orderId (uuid FK Order)
- skuId (uuid FK ProductSKU)
- productSnapshot (jsonb)
- unitPrice (int)
- quantity (int)
- companyId (uuid) — 冗余加速
- createdAt

**2026-06-22 组合商品补充**
- `skuId` 仍指向买家下单看到的父售卖 SKU；订单、支付、售后、打印都以父 `OrderItem` 作为身份主体
- `productSnapshot` 需要固定以下 buyer/seller/after-sale 共用字段：
  - `productId / companyId / title / skuTitle / image / price`
  - `productType`
  - `bundleTotalWeightGram`
  - `bundleItems[]`（历史组件快照）
- 售后规则保持整套处理：组合商品只能对父 `OrderItem` 申请一次售后，不开放组件级拆单售后；库存恢复时再按 `bundleItems[]` 逐个 SIMPLE SKU 幂等回填

## G4.1 组合商品数据补充（2026-06-22）

### Product.type
- enum `ProductType`: `SIMPLE / BUNDLE`
- `SIMPLE` 为默认普通商品
- `BUNDLE` 为卖家创建的普通可售组合商品；买家看到的仍是一个父商品/父 SKU

### ProductBundleItem
- id (uuid, PK)
- bundleProductId (uuid FK Product)
- skuId (uuid FK ProductSKU)
- quantity (int, > 0) — 每 1 份组合内包含的组件数量
- sortOrder (int)
- createdAt, updatedAt

**约束**
- unique(bundleProductId, skuId) — 同一组合内同一 SKU 只能出现一次，重复选择时在服务层合并数量
- `quantity > 0`
- 只允许引用同商户、在售、审核通过、`Product.type=SIMPLE` 的 SKU
- 不允许 bundle 嵌套，不允许跨商户引用

**派生口径**
- 组合父商品只有一个销售 SKU；卖家像普通商品一样填写成本价
- 可组合库存 = `min(floor(component.stock / quantity))`
- 组合总重量 = `sum(component.weightGram * quantity)`
- 组件当前售价合计仅作为卖家侧参考值，不改变父商品售价事实来源

## G5. OrderStatusHistory
- id (uuid, PK)
- orderId (uuid FK Order)
- fromStatus (text)
- toStatus (text)
- reason (text nullable)
- meta (jsonb nullable)
- createdAt

## G6. Payment（微信/支付宝/银行卡/聚合）
- id (uuid, PK)
- orderId (uuid FK Order)
- channel (enum: WECHAT_PAY/ALIPAY/UNIONPAY/AGGREGATOR)
- scene (enum: APP/H5/JSAPI/MINI_PROGRAM)
- amount (int)
- currency (text default 'CNY')
- status (enum: INIT/PENDING/PAID/FAILED/CLOSED/REFUNDED/PART_REFUNDED)
- providerTxnId (text nullable unique)
- merchantOrderNo (text unique) — 商户订单号（强烈建议独立生成）
- requestPayload (jsonb nullable)
- rawNotifyPayload (jsonb nullable)
- paidAt (timestamp nullable)
- createdAt, updatedAt

## G7. Refund
- id (uuid, PK)
- orderId (uuid FK Order)
- paymentId (uuid nullable FK Payment)
- amount (int)
- status (enum: REQUESTED/APPROVED/REJECTED/REFUNDING/REFUNDED/FAILED)
- providerRefundId (text nullable unique)
- merchantRefundNo (text unique)
- rawNotifyPayload (jsonb nullable)
- reason (text)
- createdAt, updatedAt

## G8. Shipment（顺丰等）
- id (uuid, PK)
- orderId (uuid unique FK Order)
- carrierCode (text) — SF/JDL/ZTO/...
- carrierName (text)
- trackingNo (text nullable)
- status (enum: INIT/SHIPPED/IN_TRANSIT/DELIVERED/EXCEPTION)
- shippedAt (timestamp nullable)
- deliveredAt (timestamp nullable)
- senderInfoSnapshot (jsonb nullable)
- receiverInfoSnapshot (jsonb)
- rawCarrierPayload (jsonb nullable)
- createdAt, updatedAt

ShipmentTrackingEvent
- id (uuid, PK)
- shipmentId (uuid FK Shipment)
- occurredAt (timestamp)
- statusCode (text nullable)
- message (text)
- location (text nullable)
- rawPayload (jsonb nullable)
- createdAt

## G9. ShippingTemplate（运费模板）
> 历史商户独立运费模板，保留用于旧数据兼容和极端兜底。新订单优先使用平台统一 `ShippingRule`。

- id (uuid, PK)
- companyId (uuid FK Company)
- name (text)
- calcType (enum: WEIGHT/COUNT/AMOUNT)
- rules (jsonb) — 省市区、首重续重、包邮门槛、偏远加价
- createdAt, updatedAt

## G10. ShippingRule（平台统一顺丰风格运费规则）
- id (uuid, PK)
- name (text)
- regionCodes (text[]) — 适用地区行政区划码；空数组表示全国
- minAmount (float nullable) — 历史字段，保留一版用于兼容旧固定费规则
- maxAmount (float nullable) — 历史字段，保留一版用于兼容旧固定费规则
- minWeight (int nullable) — 历史字段，单位克，保留一版用于兼容旧固定费规则
- maxWeight (int nullable) — 历史字段，单位克，保留一版用于兼容旧固定费规则
- fee (float default 0) — 历史固定运费字段；公式模式下仅作兼容展示/回滚兜底
- firstWeightKg (float default 3) — 首重重量，单位 kg
- firstFee (float) — 首重价格，单位元
- additionalWeightKg (float default 1) — 续重步长，单位 kg
- additionalFee (float) — 每个续重步长价格，单位元
- minChargeWeightKg (float default 1) — 最低计费重量，单位 kg
- priority (int default 0) — 高优先级先匹配，优先级相同按 id 稳定排序
- isActive (boolean default true)
- createdAt, updatedAt

**计价口径**
- 买家侧满额包邮；不满额时按收货地区 + 整单商品重量匹配平台规则。
- 多商户订单整单只计算一次运费，支付后按子订单商品金额比例分摊。
- 公式：`firstFee + ceil((chargeWeightKg - firstWeightKg) / additionalWeightKg) × additionalFee`，未超过首重时只收 `firstFee`。
- `DEFAULT_SHIPPING_FEE` 仅作无可用规则或异常时的兜底，不能作为常规配置入口。

## G11. OrderShippingCost（顺丰包裹成本记录）
- id (uuid, PK)
- orderId (uuid FK Order)
- packageIndex (int) — 同一订单下第几个顺丰包裹
- companyId (text nullable) — 冗余公司 id，无外键；便于历史包裹成本在商户删除/关系变更后仍可对账
- sfOrderId (text unique) — 顺丰订单号/面单侧幂等标识
- weightGramSent (int) — 发给顺丰的包裹重量，单位克
- estimatedCost (float nullable) — 按平台运费规则估算的应收/参考成本
- actualCost (float nullable) — 顺丰月结对账后回填的真实成本
- reconciledAt (timestamp nullable) — 月结对账确认时间
- createdAt, updatedAt

**用途**
- 平台统一对接顺丰并承担履约运费，买家支付给平台的运费与顺丰月结成本分开记录。
- 商户协商价不进入代码；平台可后续用 `actualCost - estimatedCost` 做月度盈亏报表。

## G12. Invoice（中国发票）
InvoiceProfile
- id (uuid, PK)
- userId (uuid FK User)
- type (enum: PERSONAL/COMPANY)
- title (text)
- taxNo (text nullable)
- email (text nullable)
- phone (text nullable)
- bankInfo (jsonb nullable)
- address (text nullable)
- createdAt, updatedAt

Invoice
- id (uuid, PK)
- orderId (uuid unique FK Order)
- profileSnapshot (jsonb)
- status (enum: REQUESTED/ISSUED/FAILED/CANCELED)
- invoiceNo (text nullable)
- pdfUrl (text nullable)
- issuedAt (timestamp nullable)
- createdAt, updatedAt

---

# H. AI 系统（语音检索 + 语音操作）

## H1. AiSession
- id (uuid, PK)
- userId (uuid FK User)
- page (text) — HOME/PRODUCT_DETAIL/ORDER_LIST/...
- context (jsonb) — 当前页面实体、筛选条件、购物车状态
- createdAt

## H2. AiUtterance
- id (uuid, PK)
- sessionId (uuid FK AiSession)
- audioUrl (text nullable)
- transcript (text)
- language (text default 'zh')
- asrProvider (enum nullable: IFLYTEK/BAIDU/TENCENT/ALI/OTHER)
- rawAsrPayload (jsonb nullable)
- createdAt

## H3. AiIntentResult（可多候选）
- id (uuid, PK)
- utteranceId (uuid FK AiUtterance)
- intent (text) — SearchProduct/SearchCompany/AddToCart/PayNow/FilterOrder...
- slots (jsonb) — {product, company, filters, qty, orderStatus...}
- confidence (float)
- candidates (jsonb nullable) — 候选商品/公司列表
- modelInfo (jsonb nullable)
- createdAt

## H4. AiActionExecution
- id (uuid, PK)
- intentResultId (uuid FK AiIntentResult)
- actionType (enum: NAVIGATE/CALL_API/SHOW_CHOICES)
- actionPayload (jsonb)
- requiresConfirmation (boolean default false)  // 如“付款/下单/提现”
- confirmedAt (timestamp nullable)
- success (boolean)
- error (text nullable)
- result (jsonb nullable)
- createdAt

## H5. SearchIndexSnapshot（可选：AI结构化摘要）
- id (uuid, PK)
- entityType (enum: PRODUCT/COMPANY)
- entityId (uuid)
- text (text) — 拼接摘要
- keywords (text[] nullable)
- embeddingRef (text nullable) — 若向量外置（Milvus/pgvector）
- updatedAt

---

# I. 会员分润奖励系统（商业核心）

## I1. MemberProfile
- id (uuid, PK)
- userId (uuid unique FK User)
- tier (enum: NORMAL/VIP)
- referralCode (text unique nullable)
- inviterUserId (uuid nullable FK User)
- vipPurchasedAt (timestamp nullable)
- vipNodeId (uuid nullable FK VipTreeNode)
- normalEligible (boolean default false) — 可定义“至少付款一次才参与普通奖励”
- createdAt, updatedAt

## I2. VipPurchase
- id (uuid, PK)
- userId (uuid unique FK User) — 每个用户仅允许一条购买记录
- orderId (uuid nullable unique FK Order)
- amount (float default 399.00)
- status (enum: PAID/REFUNDED)
- giftOptionId (text nullable) — 用户选中的赠品方案 ID
- giftSkuId (text nullable) — 赠品 SKU ID
- giftSnapshot (json nullable) — 赠品快照 {title, coverUrl, marketPrice, badge}
- packageId (uuid nullable FK VipPackage) — 购买时选中的 VIP 档位
- referralBonusRate (float nullable) — 购买时快照的推荐奖励比例
- source (text nullable) — 来源：APP_VIP_PACKAGE / ADMIN_GRANT / ACTIVITY
- activationStatus (enum: PENDING/ACTIVATING/SUCCESS/FAILED/RETRYING, default SUCCESS)
- activationError (text nullable) — 激活失败原因
- createdAt

## I2a. VipPackage（VIP 档位规则）
- id (uuid, PK)
- price (float) — 档位价格（元），如 399 / 699 / 999
- referralBonusRate (float default 0.15) — 推荐奖励比例快照源
- selfSeedAssetAmount (int default 0) — 用户本人购买该 VIP 档位时入账的种子资产
- referralSeedAssetAmount (int default 0) — 直接邀请人因该 VIP 购买入账的种子资产
- sortOrder (int default 0)
- status (enum: ACTIVE/INACTIVE, default ACTIVE)
- createdAt, updatedAt
- 口径：上述两项只影响后续 VIP 激活/邀请入账，不自动追溯已形成的历史数字资产流水；历史解释以 `DigitalAssetLedger.ruleSnapshot/meta` 和购买快照为准。

## I2b. VipGiftOption（VIP 赠品方案）
- id (uuid, PK)
- title (text) — 方案标题
- subtitle (text nullable) — 副标题
- coverUrl (text nullable) — 封面图 URL
- skuId (uuid FK ProductSKU) — 绑定的奖励商品 SKU
- marketPrice (float nullable) — 市场参考价
- badge (text nullable) — 前台标签（热销/鲜品等）
- sortOrder (int default 0) — 排序值
- status (enum: ACTIVE/INACTIVE, default ACTIVE)
- createdAt, updatedAt
- @@index([status, sortOrder])

## I3. ReferralLink
- id (uuid, PK)
- inviterUserId (uuid FK User)
- inviteeUserId (uuid unique FK User)
- codeUsed (text)
- channel (text nullable)
- createdAt

## I4. VipTreeNode（三叉树 BFS）
- id (uuid, PK)
- rootId (text) — A1..A10
- userId (uuid unique nullable FK User)
- parentId (uuid nullable FK VipTreeNode)
- level (int)
- position (int)
- childrenCount (int)
- createdAt

## I5. VipProgress（解锁/出局）
- id (uuid, PK)
- userId (uuid unique FK User)
- selfPurchaseCount (int default 0)
- unlockedLevel (int default 0)  // <=15
- exitedAt (timestamp nullable)
- updatedAt

## I6. VipEligibleOrder（第 k 单，退款可回滚）
- id (uuid, PK)
- userId (uuid FK User)
- orderId (uuid unique FK Order)
- amount (int)
- qualifies (boolean)  // VIP用户有效消费标记
- effectiveIndex (int nullable) // k
- valid (boolean default true)
- invalidReason (text nullable)
- createdAt, updatedAt

## I7. RewardAccount
- id (uuid, PK)
- userId (uuid FK User)
- type (enum: RED_PACKET/POINTS/FUND_POOL/PLATFORM_PROFIT)
- balance (int default 0)
- frozen (int default 0)
- createdAt, updatedAt
- unique(userId, type)

## I8. RewardAllocation（分配批次，强审计）
- id (uuid, PK)
- triggerType (enum: ORDER_PAID/ORDER_RECEIVED/REFUND)
- orderId (uuid nullable FK Order)
- ruleType (enum: NORMAL_BROADCAST(@deprecated)/NORMAL_TREE/VIP_UPSTREAM/PLATFORM_SPLIT/VIP_PLATFORM_SPLIT/ZERO_PROFIT) — 与 schema.prisma `AllocationRuleType` 严格对齐；2026-05-06 补 migration `20260506010000_add_vip_platform_split_allocation_rule` 修历史 init migration 漏 VIP_PLATFORM_SPLIT 的 bug
- ruleVersion (text)
- bucketKey (text nullable)
- meta (jsonb) — 快照：profit/splitRatios/rewardAmount/x/vipIndex/ancestorUserId...（历史记录可能含旧字段 rebateRatio/rebatePool/rewardPool，向后兼容保留）
- idempotencyKey (text unique) — 强烈建议（比如 `ALLOC:ORDER_PAID:<orderId>:<ruleType>:<version>`)
- createdAt

## I9. RewardLedger（流水）
- id (uuid, PK)
- allocationId (uuid FK RewardAllocation)
- accountId (uuid FK RewardAccount)
- userId (uuid FK User) — 接收者
- entryType (enum: FREEZE/RELEASE/WITHDRAW/VOID/ADJUST)
- amount (int)
- status (enum: FROZEN/AVAILABLE/WITHDRAWN/VOIDED)
- refType (enum: ORDER/REFUND/ADMIN)
- refId (uuid nullable)
- meta (jsonb) — 必含：scheme、sourceUserId、bucketKey、vipIndex、ancestorUserId、locked、calcSnapshot
- createdAt

## I9.5 DigitalAssetAccount / DigitalAssetLedger（数字资产 V2）
- DigitalAssetAccount
  - id (uuid, PK)
  - userId (uuid unique FK User)
  - cumulativeSpendAmount (float default 0) — 当前累计消费金额（所有用户可有）
  - seedAssetBalance (int default 0) — 当前种子资产余额（仅 VIP 可展示/持有）
  - creditAssetBalance (int default 0) — 当前消费资产余额（仅 VIP 可展示/持有）
  - historicalCreditGrantedAt (timestamp nullable) — 首次 VIP 激活时历史累计消费转消费资产的时间
  - historicalCreditGrantLedgerId (uuid/text nullable) — 首次历史消费资产转入对应流水
  - createdAt, updatedAt
- DigitalAssetLedger
  - id (uuid, PK)
  - accountId (uuid FK DigitalAssetAccount)
  - userId (uuid FK User)
  - subjectType (enum: CUMULATIVE_SPEND / SEED_ASSET / CREDIT_ASSET)
  - orderId (uuid nullable FK Order)
  - orderItemId (uuid nullable FK OrderItem)
  - refundId (uuid nullable FK Refund)
  - afterSaleId (uuid nullable FK AfterSaleRequest)
  - vipPurchaseId (uuid nullable FK VipPurchase)
  - adminUserId (uuid nullable FK AdminUser)
  - type (enum: ORDER_RECEIVED/REFUND_REVERSAL/ADMIN_ADJUSTMENT/BACKFILL/CONSUMPTION_CONFIRMED/SELF_VIP_PURCHASE/REFERRAL_VIP_PURCHASE/HISTORICAL_CONSUMPTION_GRANT)
  - direction (enum: CREDIT/DEBIT)
  - amount (float) — 正数；`CUMULATIVE_SPEND` 以元计，资产类一般等于入账/扣回数量
  - assetAmount (int nullable) — 资产类流水的整数数量快照
  - balanceAfter (float) — 当前 subject 的余额快照；`CUMULATIVE_SPEND` 为金额，资产类为数量
  - cumulativeSpendAfter (float nullable)
  - seedAssetBalanceAfter (int nullable)
  - creditAssetBalanceAfter (int nullable)
  - ruleSnapshot (jsonb nullable) — 消费资产倍率档位、分段计算结果、原始未四舍五入值等快照
  - idempotencyKey (text unique)
  - reason (text nullable)
  - meta (jsonb nullable) — 金额口径、行级分摊、退款来源、VIP 档位/邀请源、回填批次等审计快照
  - createdAt
- DigitalAssetRefundReversalFailure
  - id (uuid, PK)
  - refundId (uuid/text unique) — 已成功退款但数字资产扣回失败的退款单
  - orderId / afterSaleId / userId (uuid/text nullable) — 便于排查和后台后续扩展
  - source (text) — AFTER_SALE_REFUND / AUTO_REFUND 等触发来源
  - status (enum: PENDING / RESOLVED / FAILED)
  - retryCount (int default 0)
  - nextRetryAt / lastAttemptAt / resolvedAt (timestamp nullable/default)
  - lastError (text nullable)
  - createdAt, updatedAt
- 口径：
  - 所有用户都记录 `cumulativeSpendAmount`；只有 VIP 用户可展示/持有 `seedAssetBalance` 与 `creditAssetBalance`。
  - `cumulativeSpendAmount` 只按普通商品真实实付商品金额累计，不含运费，扣除消费积分、平台红包和普通商品 VIP 折扣；VIP 礼包不计入累计消费，也不直接产生消费资产。
  - `SEED_ASSET` 只来自本人购买 VIP 礼包（`SELF_VIP_PURCHASE`）和直接邀请好友购买 VIP 礼包（`REFERRAL_VIP_PURCHASE`）两类场景。
  - `CREDIT_ASSET` 由累计消费按可配置倍率档位计算；首次 VIP 激活可把历史累计消费按当时规则一次性转入 `HISTORICAL_CONSUMPTION_GRANT`，其后普通商品确认收货走 `CONSUMPTION_CONFIRMED`。
  - 退款/退货成功按原入账行与快照可审计扣回；若退款主链路已成功但扣回失败，写 `DigitalAssetRefundReversalFailure`，定时重试同一个幂等 `reverseRefund(refundId)`，成功后标记 RESOLVED，超限后转 FAILED 人工核查；后台人工调整只能调整具体 subject，不能直接改“数字资产总额”。
  - 该体系独立于 Reward 消费积分、Coupon 平台红包和普通/VIP 分润计数；未来现金使用、收益、股权/期权/工资/兑换规则另起设计，当前不承诺固定价值或回报。

## I9.6 GroupBuyActivity / GroupBuyInstance / GroupBuyRebate（团购分享回馈）
- GroupBuyActivity
  - id (uuid, PK)
  - title (text)
  - productId (uuid FK Product, Restrict)
  - skuId (uuid FK ProductSKU, Restrict)
  - price (float) — 后台指定团购价和返还计算基数
  - freeShipping (boolean)
  - status (enum: DRAFT/ACTIVE/PAUSED/ENDED)
  - startAt/endAt/displayOrder/deletedAt
- GroupBuyTier
  - activityId (uuid FK GroupBuyActivity)
  - sequence (int)
  - basisPoints (int) — 1000 = 10%
  - label (text nullable)
  - unique(activityId, sequence)
- GroupBuyInstance
  - userId (uuid FK User)
  - activityId (uuid FK GroupBuyActivity)
  - initiatorOrderId (uuid unique FK Order)
  - status (enum: QUALIFICATION_PENDING/SHARING/COMPLETED/TERMINATED/QUALIFICATION_ABANDONED/QUALIFICATION_INVALID/EXPIRED)
  - priceSnapshot/freeShippingSnapshot/shippingFeeSnapshot/tierSnapshot/activitySnapshot
  - validReferralCount/candidateCount
  - activatedAt/completedAt/terminatedAt/abandonedAt/expiredAt/invalidatedAt/invalidReason
- GroupBuyCode
  - instanceId (uuid unique FK GroupBuyInstance)
  - code (text unique)
  - status (enum: PENDING/ACTIVE/DISABLED/COMPLETED/EXPIRED)
  - activatedAt/disabledAt/completedAt/expiredAt
- GroupBuyReferral
  - instanceId (uuid FK GroupBuyInstance)
  - codeId (uuid nullable FK GroupBuyCode)
  - referredUserId (uuid FK User)
  - referredOrderId (uuid unique FK Order)
  - referredInstanceId (uuid unique nullable FK GroupBuyInstance)
  - status (enum: CANDIDATE/VALID/INVALID/VOIDED)
  - candidateSequence/effectiveSequence/amountSnapshot/invalidReason/validAt/invalidatedAt/voidedAt
- GroupBuyRebateAccount
  - userId (uuid unique FK User)
  - balance/reserved/withdrawn/deducted (float)
- GroupBuyRebateLedger
  - accountId/userId/instanceId/referralId/orderId
  - type (enum: PENDING_REBATE/RELEASE/VOID/WITHDRAW/DEDUCT/REFUND_RETURN/ADMIN_ADJUST)
  - status (enum: PENDING/AVAILABLE/RESERVED/COMPLETED/VOIDED/FAILED)
  - amount/balanceBefore/balanceAfter
  - idempotencyKey (text unique)
  - refType/refId/meta/deletedAt
- 资金与状态口径：团购 checkout 必须现金购买，不允许消费积分、平台红包或团购返还余额抵扣；分享码和返还释放均等待订单 `RECEIVED`、`returnWindowExpiresAt < now` 且无售后/退款。所有涉及名额、分享码、返还余额和抵扣的写入必须使用 Serializable 事务或幂等键/CAS 保护。

## I10. NormalBucket
- id (uuid, PK)
- bucketKey (text unique)
- ruleVersion (text)
- createdAt

## I11. NormalQueueMember（桶队列成员）
- id (uuid, PK)
- bucketId (uuid FK NormalBucket)
- userId (uuid FK User)
- joinedAt (timestamp)
- orderId (uuid nullable FK Order)
- active (boolean default true)
- createdAt

## I12. WithdrawRequest（提现）
- id (uuid, PK)
- userId (uuid FK User)
- amount (int)
- channel (enum: WECHAT/ALIPAY/BANKCARD)
- accountSnapshot (jsonb) — 脱敏/加密
- status (enum: REQUESTED/APPROVED/REJECTED/PAID/FAILED)
- reviewerAdminId (uuid nullable FK AdminUser)
- providerPayoutId (text nullable)
- createdAt, updatedAt

---

## 4. 枚举建议（Prisma enums）
- UserStatus: ACTIVE, BANNED, DELETED
- AuthProvider: PHONE, WECHAT
- SmsPurpose: LOGIN, BIND, RESET
- SessionStatus: ACTIVE, REVOKED, EXPIRED
- Platform: IOS, ANDROID

- CompanyStatus: PENDING, ACTIVE, SUSPENDED
- ProductStatus: DRAFT, ACTIVE, INACTIVE
- ProductAuditStatus: PENDING, APPROVED, REJECTED

- CheckoutSessionStatus: ACTIVE, PAID, COMPLETED, EXPIRED, FAILED
- CheckoutBizType: NORMAL_GOODS, VIP_PACKAGE, GROUP_BUY
- OrderStatus: PENDING_PAYMENT, PAID, SHIPPED, DELIVERED, RECEIVED, CANCELED, REFUNDED
- OrderBizType: NORMAL_GOODS, VIP_PACKAGE, GROUP_BUY
- PaymentChannel: WECHAT_PAY, ALIPAY, UNIONPAY, AGGREGATOR
- PaymentScene: APP, H5, JSAPI, MINI_PROGRAM
- PaymentStatus: INIT, PENDING, PAID, FAILED, CLOSED, REFUNDED, PART_REFUNDED

- RefundStatus: REQUESTED, APPROVED, REJECTED, REFUNDING, REFUNDED, FAILED

- ShipmentStatus: INIT, SHIPPED, IN_TRANSIT, DELIVERED, EXCEPTION
- ShippingCalcType: WEIGHT, COUNT, AMOUNT

- MemberTier: NORMAL, VIP
- VipGiftOptionStatus: ACTIVE, INACTIVE
- VipActivationStatus: PENDING, ACTIVATING, SUCCESS, FAILED, RETRYING
- RewardAccountType: RED_PACKET, NORMAL_RED_PACKET, POINTS, FUND_POOL, PLATFORM_PROFIT, INDUSTRY_FUND, CHARITY_FUND, TECH_FUND, RESERVE_FUND
- AllocationTriggerType: ORDER_PAID, ORDER_RECEIVED, REFUND
- AllocationRuleType: NORMAL_BROADCAST(@deprecated), NORMAL_TREE, VIP_UPSTREAM, VIP_PLATFORM_SPLIT, PLATFORM_SPLIT, ZERO_PROFIT
- RewardEntryType: FREEZE, RELEASE, WITHDRAW, VOID, ADJUST
- RewardStatus: FROZEN, AVAILABLE, WITHDRAWN, VOIDED
- DigitalAssetLedgerType: ORDER_RECEIVED, REFUND_REVERSAL, ADMIN_ADJUSTMENT, BACKFILL, CONSUMPTION_CONFIRMED, SELF_VIP_PURCHASE, REFERRAL_VIP_PURCHASE, HISTORICAL_CONSUMPTION_GRANT
- DigitalAssetLedgerSubjectType: CUMULATIVE_SPEND, SEED_ASSET, CREDIT_ASSET
- DigitalAssetLedgerDirection: CREDIT, DEBIT
- DigitalAssetRefundReversalFailureStatus: PENDING, RESOLVED, FAILED
- GroupBuyActivityStatus: DRAFT, ACTIVE, PAUSED, ENDED
- GroupBuyInstanceStatus: QUALIFICATION_PENDING, SHARING, COMPLETED, TERMINATED, QUALIFICATION_ABANDONED, QUALIFICATION_INVALID, EXPIRED
- GroupBuyCodeStatus: PENDING, ACTIVE, DISABLED, COMPLETED, EXPIRED
- GroupBuyReferralStatus: CANDIDATE, VALID, INVALID, VOIDED
- GroupBuyRebateLedgerType: PENDING_REBATE, RELEASE, VOID, WITHDRAW, DEDUCT, REFUND_RETURN, ADMIN_ADJUST
- GroupBuyRebateLedgerStatus: PENDING, AVAILABLE, RESERVED, COMPLETED, VOIDED, FAILED

- LotteryPrizeType: DISCOUNT_BUY, THRESHOLD_GIFT, NO_PRIZE
- LotteryResult: WON, NO_PRIZE
- ReplacementStatus: REQUESTED, UNDER_REVIEW, APPROVED, SHIPPED, COMPLETED, REJECTED

- InvoiceType: PERSONAL, COMPANY
- InvoiceStatus: REQUESTED, ISSUED, FAILED, CANCELED

---

## 5. 必要索引（上线必做）
- AuthIdentity(unique provider+identifier+appId)
- SmsOtp(phone, createdAt)
- Session(userId, status), Session(expiresAt)

- Payment(unique merchantOrderNo), Payment(unique providerTxnId)
- Refund(unique merchantRefundNo), Refund(unique providerRefundId)

- NormalQueueMember(bucketId, active, joinedAt) @deprecated
- VipTreeNode(rootId, level, position)
- VipEligibleOrder(userId, valid, createdAt), VipEligibleOrder(userId, effectiveIndex)

- NormalTreeNode(unique parentId+position), NormalTreeNode(level, position), NormalTreeNode(level, childrenCount)
- NormalEligibleOrder(unique orderId), NormalEligibleOrder(userId, valid, createdAt), NormalEligibleOrder(userId, effectiveIndex)
- LotteryRecord(unique userId+drawDate), LotteryRecord(userId, createdAt)
- ReplacementRequest(orderId), ReplacementRequest(userId, status)

- RewardAllocation(unique idempotencyKey)
- RewardLedger(userId, status, createdAt)
- DigitalAssetAccount(unique userId)
- DigitalAssetAccount(seedAssetBalance)
- DigitalAssetAccount(creditAssetBalance)
- DigitalAssetLedger(unique idempotencyKey)
- DigitalAssetLedger(userId, createdAt)
- DigitalAssetLedger(subjectType, createdAt)
- DigitalAssetLedger(orderId)
- DigitalAssetLedger(refundId)
- DigitalAssetLedger(vipPurchaseId)
- DigitalAssetRefundReversalFailure(unique refundId)
- DigitalAssetRefundReversalFailure(status, nextRetryAt)
- DigitalAssetRefundReversalFailure(userId, createdAt)
- DigitalAssetRefundReversalFailure(orderId, createdAt)
- GroupBuyActivity(status, startAt, endAt)
- GroupBuyTier(unique activityId+sequence)
- GroupBuyInstance(userId, status, createdAt), GroupBuyInstance(activityId, status), GroupBuyInstance(unique initiatorOrderId)
- GroupBuyCode(unique code), GroupBuyCode(unique instanceId), GroupBuyCode(status, createdAt)
- GroupBuyReferral(instanceId, status), GroupBuyReferral(codeId, status), GroupBuyReferral(unique referredOrderId), GroupBuyReferral(unique referredInstanceId)
- GroupBuyRebateAccount(unique userId)
- GroupBuyRebateLedger(unique idempotencyKey), GroupBuyRebateLedger(userId, status, createdAt)
- ReviewTask(status, createdAt)

---

## 5.5 数据完整性保护（onDelete: Restrict）

以下外键关系添加了 `onDelete: Restrict`，防止误删关联数据：

| 模型 | 外键字段 | 目标模型 | 保护说明 |
|------|----------|----------|----------|
| CompanyStaff | userId | User | 防止删除有员工关联的用户 |
| CompanyStaff | companyId | Company | 防止删除有员工关联的企业 |
| Cart | userId | User | 防止删除有购物车的用户 |
| Order | userId | User | 防止删除有订单的用户 |
| Payment | orderId | Order | 防止删除有支付记录的订单 |
| Refund | orderId | Order | 防止删除有退款记录的订单 |
| MemberProfile | userId | User | 防止删除有会员记录的用户 |
| VipProgress | userId | User | 防止删除有 VIP 进度的用户 |
| RewardAllocation | orderId | Order | 防止删除有分配记录的订单 |
| DigitalAssetAccount | userId | User | 防止删除有数字资产账户的用户 |
| DigitalAssetLedger | userId/accountId/orderId/refundId/vipPurchaseId | User/DigitalAssetAccount/Order/Refund/VipPurchase | 防止删除数字资产流水依赖的审计对象 |
| GroupBuyActivity | productId/skuId | Product/ProductSKU | 防止删除仍被团购活动引用的平台商品/SKU |
| GroupBuyInstance | userId/activityId/initiatorOrderId | User/GroupBuyActivity/Order | 防止删除团购发起记录依赖的用户、活动和订单 |
| GroupBuyReferral | instanceId/codeId/referredUserId/referredOrderId/referredInstanceId | GroupBuyInstance/GroupBuyCode/User/Order | 防止删除直接推荐记录依赖的团购、用户和订单 |
| GroupBuyRebateAccount / GroupBuyRebateLedger | userId/accountId/instanceId/referralId/orderId | User/GroupBuyRebateAccount/GroupBuyInstance/GroupBuyReferral/Order | 防止删除团购返还账户和流水依赖的审计对象 |

## 5.6 新增外键索引（v3.0 性能优化）

以下外键字段新增了 `@@index` 以加速关联查询：

| 模型 | 索引字段 | 用途 |
|------|----------|------|
| ProductMedia | productId | 加速商品媒体查询 |
| InventoryLedger | skuId | 加速库存流水查询 |
| OrderItemTraceLink | orderItemId | 加速订单溯源查询 |
| ShipmentTrackingEvent | shipmentId | 加速物流事件查询 |
| RewardLedger | allocationId | 加速分配关联的流水查询 |

---

## 6. 关键实现注意（简短版）
- 手机号登录：SmsOtp 校验后，查/建 User + 绑定 AuthIdentity(provider=PHONE)
- 微信登录：用 code 换 openId/unionId，查/建 User + 绑定 AuthIdentity(provider=WECHAT)
- 允许绑定：同一 User 可同时绑定 PHONE + WECHAT
- 支付/退款/物流回调：落 rawPayload（脱敏），以 providerTxnId/providerRefundId/事件唯一键幂等
- 奖励发放：写 RewardAllocation（幂等）→ 写 RewardLedger（冻结）→ 签收释放/解锁释放 → 退款作废与重算
- 数字资产 V2：所有账户写入只通过 DigitalAssetService，在 Serializable 事务内按 idempotencyKey 写 DigitalAssetLedger，并同步 `cumulativeSpendAmount` / `seedAssetBalance` / `creditAssetBalance`；VIP 激活与数字资产发放和会员升阶共事务；确认收货只累计普通商品实付金额，退款/退货成功按快照扣回；退款已成功但扣回失败时写 `DigitalAssetRefundReversalFailure` 并由 cron 重试幂等扣回；历史回填先 dry-run 再执行；后台只允许对具体 subject 做审计可追踪调整，禁止直接改总额。
- 团购分享回馈：团购购买走 GROUP_BUY CheckoutSession 和 GROUP_BUY Order；支付成功后创建 QUALIFICATION_PENDING 实例，确认收货且售后期结束无退换货后生成分享码；仅一级直接推荐订单成为 CANDIDATE，满足同样收货/售后条件后按档位释放到独立 GroupBuyRebateAccount。分享码名额、月度发起次数、返还释放、抵扣和提现均需幂等与 Serializable 保护。

---
