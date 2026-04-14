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
- weightGram (int nullable)
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
- refType (text) — ORDER/ADMIN/IMPORT
- refId (uuid nullable)
- createdAt

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
- bizType (enum CheckoutBizType: NORMAL_GOODS/VIP_PACKAGE, default NORMAL_GOODS) — 业务类型
- bizMeta (jsonb nullable) — 业务元数据，VIP_PACKAGE 时存 {vipGiftOptionId, giftSkuId, giftTitle, snapshotPrice}
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

## G3. Order
- id (uuid, PK)
- userId (uuid FK User)
- status (enum: PENDING_PAYMENT/PAID/SHIPPED/DELIVERED/RECEIVED/CANCELED/REFUNDED)
- bizType (enum OrderBizType: NORMAL_GOODS/VIP_PACKAGE, default NORMAL_GOODS) — 业务类型
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
- id (uuid, PK)
- companyId (uuid FK Company)
- name (text)
- calcType (enum: WEIGHT/COUNT/AMOUNT)
- rules (jsonb) — 省市区、首重续重、包邮门槛、偏远加价
- createdAt, updatedAt

## G10. Invoice（中国发票）
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
- source (text nullable) — 来源：APP_VIP_PACKAGE / ADMIN_GRANT / ACTIVITY
- activationStatus (enum: PENDING/ACTIVATING/SUCCESS/FAILED/RETRYING, default SUCCESS)
- activationError (text nullable) — 激活失败原因
- createdAt

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
- ruleType (enum: NORMAL_BROADCAST/VIP_UPSTREAM/PLATFORM_SPLIT)
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
- CheckoutBizType: NORMAL_GOODS, VIP_PACKAGE
- OrderStatus: PENDING_PAYMENT, PAID, SHIPPED, DELIVERED, RECEIVED, CANCELED, REFUNDED
- OrderBizType: NORMAL_GOODS, VIP_PACKAGE
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
- AllocationRuleType: NORMAL_BROADCAST(@deprecated), NORMAL_TREE, VIP_UPSTREAM, PLATFORM_SPLIT, ZERO_PROFIT
- RewardEntryType: FREEZE, RELEASE, WITHDRAW, VOID, ADJUST
- RewardStatus: FROZEN, AVAILABLE, WITHDRAWN, VOIDED

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

---
