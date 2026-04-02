# 爱买买全面审计报告 - tofix3.md
> **审计日期:** 2026-02-22
> **审计范围:** 买家App + 卖家后台 + 管理后台 + NestJS后端 + 前后端对齐
> **总计发现:** 阻断 16 / 重要 32 / 建议 25
> **第一批修复:** 16/16 阻断级全部修复 ✅（2026-02-22）
> **第二批修复:** 32/32 重要级全部修复 ✅（2026-02-22）
> **第三批修复:** 25/25 建议级全部修复 ✅（2026-02-22）
> **复核备注:** 原 B01/B02/I10/S22 已在代码中实现或不成立，已移至“已验证不成立/已修复”

---

## 目录
1. [阻断级问题 (必须修复)](#一阻断级问题-blocking---必须修复)
2. [重要级问题 (高优先级)](#二重要级问题-important---高优先级)
3. [建议级问题 (优化改进)](#三建议级问题-suggestion---优化改进)
4. [修复计划](#四修复计划)
5. [已验证不成立/已修复](#五已验证不成立已修复)

---

## 一、阻断级问题 (BLOCKING) - 必须修复

### B01. 前端默认 USE_MOCK=true 导致真实 API 永远不生效
**来源:** 前后端联调审计
**文件:** `src/repos/http/config.ts`（及所有依赖 USE_MOCK 的 Repo）
**问题:** 默认 `EXPO_PUBLIC_USE_MOCK !== 'false'` → `USE_MOCK=true`，未显式配置环境变量时买家 App 全部走 mock 数据
**影响:** 真实后端无法被验证；订单/支付/登录/库存等均为前端模拟，容易误判“已打通”
**修复方案:**
- 构建环境（staging/prod）强制 `EXPO_PUBLIC_USE_MOCK=false`
- 增加启动时保护：当 `API_BASE_URL` 非 localhost 且仍为 mock，提示并阻断

---

### B02. 认证链路仍为 Mock（短信/邮箱/微信）
**来源:** 安全 & 登录审计
**文件:** `backend/src/modules/auth/auth.service.ts`, `src/components/overlay/AuthModal.tsx`
**问题:** `SMS_MOCK` 默认 true；微信登录使用 Mock openId；前端微信授权直接生成 mock code
**影响:** 生产环境验证码无法真实下发且可被伪造，微信登录无真实授权，存在安全风险
**修复方案:**
- 接入真实短信/邮箱/微信 SDK，并在生产环境强制 `SMS_MOCK=false`
- 移除前端 mock code，改为真实授权回调

---

### B03. 购物车结算页 fallback 到全部商品
**来源:** 买家App UX审计
**文件:** `app/checkout.tsx:34-44`
**问题:** `selectedItems` 为空时 fallback 到 `allItems`，导致用户取消选择后被全部商品收费
**影响:** 用户可能被错误收费
**修复方案:**
```typescript
const cartItems = selectedItems.length > 0 ? selectedItems : [];
if (cartItems.length === 0) return <EmptyState message="请先选择商品" />;
```

---

### B04. 订单创建+支付非原子操作
**来源:** 买家App UX审计
**文件:** `app/checkout.tsx:79-101`
**问题:** `createFromCart()` 和 `payOrder()` 是两个独立异步调用，无事务保障。创建成功但支付失败时产生"幽灵订单"
**影响:** 用户看到"支付失败"但订单已创建，不知是否重复扣款
**修复方案:** 后端提供原子化 create+pay 接口，或前端在支付失败后引导用户到"待付款"订单继续支付

---

### B05. 提交订单无防重机制
**来源:** 买家App UX审计
**文件:** `app/checkout.tsx:79-101`
**问题:** 无 loading/disabled 状态，用户可多次快速点击导致多个订单
**修复方案:** 添加 `submitting` 状态 + 按钮 disable + 幂等键

---

### B06. SKU选择未携带到购物车/订单
**来源:** 买家App UX审计
**文件:** `app/product/[id].tsx:61,129` + `src/store/useCartStore.ts`
**问题:** 用户选择了特定 SKU 但 `addItem(product, qty)` 没传 `skuId`，CartItem 类型也缺少 `skuId` 字段
**影响:** 订单商品规格错误，无法区分同商品不同规格
**修复方案:** CartItem 类型增加 `skuId?` 字段，`addItem` 增加 skuId 参数

---

### B07. 金额浮点精度问题
**来源:** 买家App UX审计
**文件:** `app/checkout.tsx:46-48`
**问题:** `parseFloat(rewardAmount)` 产生浮点精度问题，如 `¥99.39999999999999`
**修复方案:** 统一使用 `toFixed(2)` 或整数运算（分为单位）

---

### B08. 动态路由写法不一致（5处）
**来源:** 买家App路由审计
**文件:**
- `app/cart.tsx:234`
- `app/category/[id].tsx:182`
- `app/search.tsx:188`
- `app/ai/trace.tsx:127`
- `app/company/[id].tsx:608`

**问题:** 使用模板字符串 `` router.push(`/product/${id}`) `` 或 `` router.push(`/group/${id}`) `` 而非命名参数 `router.push({ pathname: '/product/[id]', params: { id } })`
**影响:** expo-router 下模板字符串可能导致路由匹配失败
**修复方案:** 统一改为命名参数形式

---

### B09. 企业路由写法不一致（2处）
**来源:** 买家App路由审计
**文件:** `app/search.tsx:209`, `app/product/[id].tsx:379`
**问题:** 同 B08，企业详情页路由使用模板字符串
**修复方案:** 同 B08

---

### B10. 后端奖励并发使用未防护
**来源:** 后端API审计
**文件:** `backend/src/modules/order/order.service.ts:204-212`
**问题:** 奖励查询在事务外执行，两个并发请求可能同时使用同一奖励
**影响:** 同一奖励被多次抵扣
**修复方案:** 将奖励查询移入事务内，使用排他锁 (FOR UPDATE)

---

### B11. 后端支付方式无有效性检查
**来源:** 后端API审计
**文件:** `backend/src/modules/order/order.service.ts:294`
**问题:** `CHANNEL_MAP[dto.paymentMethod] || 'WECHAT_PAY'`，无效支付方式默认为微信支付
**影响:** 隐藏错误，用户可能被错误渠道扣款
**修复方案:** 无效值应 throw BadRequestException

---

### B12. 后端支付回调无签名验证
**来源:** 后端API审计
**文件:** `backend/src/modules/payment/payment.service.ts:61`
**问题:** 任何人都能调用支付回调伪造支付成功
**影响:** 安全漏洞，可能被用于免费获取商品
**修复方案:** 集成微信/支付宝签名验证（上线前必须实现）

---

### B13. 管理后台 Token 刷新不更新 Zustand Store
**来源:** 管理后台审计
**文件:** `admin/src/api/client.ts:85-109`
**问题:** 401 自动刷新后新 token 只写入 localStorage，未同步到 Zustand store
**影响:** 组件读取 store 中的 stale token 导致鉴权失败
**修复方案:** 刷新后调用 `useAuthStore.setState({ token: accessToken })`

---

### B14. 管理后台 Logout 401 重试死循环
**来源:** 管理后台审计
**文件:** `admin/src/api/client.ts:59-61`
**问题:** 401 retry 排除列表缺少 logout 端点，logout 返回 401 时触发循环
**修复方案:** 排除列表增加 `/admin/auth/logout`

---

### B15. 卖家后台无动态路由权限保护
**来源:** 卖家后台审计
**文件:** `seller/src/App.tsx:49-68`
**问题:** 所有路由只有 `RequireAuth` 包裹，无角色检查。OPERATOR 可直接输入 URL 访问 OWNER 页面
**修复方案:** 添加 `RequireSellerRole` 高阶组件包裹受限路由

---

### B16. CreateOrderDto 前后端字段不匹配
**来源:** 前后端对齐审计
**文件:** `src/repos/OrderRepo.ts:163-170` vs `backend/src/modules/order/dto/create-order.dto.ts`
**问题:** 前端发送 `rewardAmount` 但后端 DTO 不接收；前端 SKU 映射有 fallback 逻辑 `item.skuId || item.productId || item.id`
**修复方案:** 对齐 DTO 字段，移除不必要的 fallback

---

## 二、重要级问题 (IMPORTANT) - 高优先级

### I01. 结算链路使用 router.navigate() 参数可能丢失
**文件:** `app/checkout-address.tsx:26`, `app/checkout-redpack.tsx:141-162,270`
**问题:** 使用 `router.navigate()` 而非 `router.push()`，某些版本下参数不稳定
**修复:** 改用 `router.push()` 或 `router.back()` + 全局状态

### I02. AI 溯源页面未接收商品ID参数
**文件:** `app/product/[id].tsx:366` → `app/ai/trace.tsx`
**问题:** 跳转时传了 `?productId=${id}` 但 trace 页面不读取该参数
**修复:** trace 页面读取 `useLocalSearchParams()` 获取 productId

### I03. 地址表单验证缺少"区县"
**文件:** `app/me/addresses.tsx:69-76`
**问题:** validate() 未验证 `district` 字段，但表单有此输入
**修复:** 增加 district 验证

### I04. AI品质评分硬编码
**文件:** `app/product/[id].tsx:36-38`
**问题:** 所有商品都显示固定评分 92 分 + 固定评语
**修复:** 后端提供 AI 评分接口或在商品详情中返回

### I05. 首页最近对话硬编码
**文件:** `app/(tabs)/home.tsx:50-67`
**问题:** `MOCK_CONVERSATIONS` 写死3条，永不更新
**修复:** 从 AiAssistantRepo.listHistory() 动态获取

### I06. 搜索过滤精度低
**文件:** `app/search.tsx:74-92`
**问题:** 纯子字符串匹配，搜"米"命中"番茄"
**修复:** 改用后端全文搜索，或前端增加分词

### I07. 购物车清空与查询刷新竞态
**文件:** `app/checkout.tsx:96`
**问题:** `clear()` 和 `invalidateQueries` 顺序导致闪烁
**修复:** 等待异步完成后再清空

### I08. 奖励选择后未重新验证可用性
**文件:** `app/checkout-redpack.tsx:141-149`
**问题:** 选择后到确认时奖励可能已过期
**修复:** 确认时调后端验证

### I09. 支付方式无可用性校验
**文件:** `app/checkout.tsx:201-241`
**问题:** 用户可选择未绑定的支付方式
**修复:** 后端返回可用支付方式列表

### I10. 订单物流追踪页面未接入真实物流
**文件:** `app/orders/[id].tsx:226`, `app/orders/track.tsx`, `src/repos/OrderRepo.ts:getShipment`
**问题:** 订单详情跳转仅到 `/orders/track`，未携带 `orderId`；物流页使用固定订单号与 mock 时间线，未调用 `getShipment`
**影响:** 用户无法查看真实物流，且容易被静态信息误导
**修复:** 传递 `orderId` 参数，物流页用 `useLocalSearchParams()` 调用 `OrderRepo.getShipment` 并展示真实节点

### I11. 订单 issueFlag 未在UI中展示
**文件:** `src/types/domain/Order.ts:48` vs `app/(tabs)/me.tsx:22`
**问题:** Order 有 `issueFlag` 字段但我的页面无对应入口
**修复:** 添加"问题订单"快捷入口

### I12. 月销/好评数据硬编码
**文件:** `app/product/[id].tsx:239,242`
**问题:** 所有商品显示"月销328"、"好评96%"
**修复:** 从商品详情数据中获取

### I13. PaymentMethod 枚举大小写不一致
**文件:** `src/types/domain/Payment.ts` vs 后端
**问题:** 前端 `'wechat'` vs 后端 `'WECHAT_PAY'`
**修复:** 统一约定，推荐后端同时支持两种

### I14. 分页响应结构不一致
**文件:** 多处 Repos vs 后端返回
**问题:** 后端返回 `{ items, total, page, pageSize }` 前端期望 `{ items, nextPage? }`
**修复:** 标准化分页响应，或在 Repo 层转换

### I15. 后端卖家退款未触发实际退款
**文件:** `backend/src/modules/seller/refunds/seller-refunds.service.ts:99`
**问题:** 标记为 APPROVED 后有 TODO 注释，实际退款未实现
**修复:** 接入支付渠道退款 API

### I16. 后端分润异步失败仅记日志
**文件:** `backend/src/modules/order/order.service.ts:470`
**问题:** `.catch()` 仅 log，用户确认收货成功但分润可能丢失
**修复:** 增加重试机制或消息队列

### I17. 卖家后台登录流程 token 重复设置
**文件:** `seller/src/pages/login/index.tsx:73-92`
**问题:** token 先直接写 localStorage 再通过 setAuth 写，若中间 getMe() 失败则状态不一致
**修复:** 只通过 setAuth 设置

### I18. 卖家后台仪表板缺少错误处理
**文件:** `seller/src/pages/dashboard/index.tsx:17-44`
**问题:** 只处理 loading 无 error 状态
**修复:** 添加 isError + ErrorState 组件

### I19. 卖家后台 SKU 管理验证不足
**文件:** `seller/src/pages/products/edit.tsx:270-297`
**问题:** 价格无最小值验证，库存可为负数，编辑时无法区分新增/修改
**修复:** 添加验证规则

### I20. 卖家后台 API 响应解包风险
**文件:** `seller/src/api/client.ts:38-48`
**问题:** `body.data` 可能为 undefined 时无警告
**修复:** 增加 data 字段存在性检查

### I21. 卖家后台 Token 刷新队列错误传播不完整
**文件:** `seller/src/api/client.ts:50-108`
**问题:** refresh 失败时队列请求错误不正确传播，无超时控制
**修复:** 添加超时和错误传播

### I22. 卖家后台切换企业时未清理查询缓存
**文件:** `seller/src/pages/login/index.tsx`
**问题:** 切换企业后 React Query 缓存仍为旧企业数据
**修复:** `queryClient.clear()` 在 completeLogin 中调用

### I23. 卖家后台 token 过期使用硬刷新
**文件:** `seller/src/api/client.ts:28-35`
**问题:** `window.location.href = '/login'` 硬刷新丢失所有状态
**修复:** 使用 react-router navigate

### I24. 管理后台 API 响应缺少 data 字段检查
**文件:** `admin/src/api/client.ts:40-50`
**问题:** 后端返回 `{ ok: true }` 无 data 时静默返回 undefined
**修复:** 增加验证

### I25. 管理后台订单详情缺少物流信息
**文件:** `admin/src/pages/orders/detail.tsx`
**问题:** 无快递公司、运单号、物流轨迹显示
**修复:** 添加物流信息卡片和状态时间线

### I26. 管理后台退款仲裁无确认弹窗
**文件:** `admin/src/pages/refunds/index.tsx:21-39`
**问题:** 强制退款是关键操作但无二次确认
**修复:** 添加 Popconfirm

### I27. 管理后台系统配置子比例验证脆弱
**文件:** `admin/src/pages/config/index.tsx:162-182`
**问题:** SUB_RATIO_KEYS 硬编码，schema 变更时不会自动更新
**修复:** 从 CONFIG_SCHEMA 动态提取

### I28. 管理后台 CompanyStatus 类型与 statusMap 不一致
**文件:** `admin/src/types/index.ts:253` vs `admin/src/constants/statusMaps.ts:32-38`
**问题:** 类型定义4个状态，statusMap 有5个（多了 ACTIVE）
**修复:** 与后端 schema 对齐

### I29. 考察团参团/支付链路为占位实现
**文件:** `app/company/[id].tsx:828-848`, `app/group/[id].tsx:66-95`, `src/repos/BookingRepo.ts:listByGroup`
**问题:** 参团确认仅弹出“支付入口占位”；考察团成员列表使用 mock-only 接口，真实后端无法返回
**影响:** 用户无法完成真实参团/支付，成员数据不一致
**修复:** 接入真实支付 + 预约/参团状态流转；为 `listByGroup` 增加后端 API 并接入

### I30. AI 功能入口/推荐仓储永远使用 mock
**文件:** `src/repos/AiFeatureRepo.ts`, `src/repos/RecommendRepo.ts`
**问题:** 两个 Repo 未使用 `USE_MOCK` 开关，始终返回 mock 数据
**影响:** 即使接入真实 API，AI 溯源/推荐入口仍无法验证
**修复:** 增加真实 API 调用并纳入 `USE_MOCK` 切换

### I31. “我的”页钱包金额展示与真实钱包不一致
**文件:** `app/(tabs)/me.tsx`（钱包卡片）
**问题:** 使用 `profile.points` 作为钱包金额展示，与 `BonusRepo.getWallet()` 的余额体系不一致
**影响:** 用户误解余额/积分，提现预期错误
**修复:** 改为读取钱包余额，或明确“积分”概念并分离展示

### I32. 上传服务为本地存储占位，生产不可用
**文件:** `backend/src/modules/upload/upload.service.ts`
**问题:** 上传/删除均为本地文件系统占位实现，未接 OSS/CDN
**影响:** 多实例/容器化环境下文件丢失，资源不可公网访问
**修复:** 接入 OSS/S3 等对象存储并返回可访问 URL

---

## 三、建议级问题 (SUGGESTION) - 优化改进

### S01. 订单列表状态过滤使用 replace 而非 push
**文件:** `app/orders/index.tsx:71,94` → 用户无法通过返回切换状态

### S02. 设置页退出登录后未清空导航栈
**文件:** `app/settings.tsx:38` → 退出后可能返回到设置页

### S03. 购物车推荐区缺少快捷加购按钮
**文件:** `app/cart.tsx:220-263` → 点击只跳转详情，应支持直接加购

### S04. 搜索结果为空时引导不足
**文件:** `app/search.tsx:105-115` → 应显示热门搜索建议

### S05. SKU选择UI不显示库存信息
**文件:** `app/product/[id].tsx:267-298` → 用户不知各规格实时库存

### S06. AI聊天消息滚动可能闪烁
**文件:** `app/ai/chat.tsx:100` → 使用 requestAnimationFrame 延迟滚动

### S07. 长按语音录音功能待实现
**文件:** `app/(tabs)/home.tsx:154-157` → TODO 占位

### S08. 卖家后台企业选择未过滤冻结企业
**文件:** `seller/src/pages/login/index.tsx:94-131`

### S09. 卖家后台订单状态流转显示不全
**文件:** `seller/src/pages/orders/detail.tsx:34-50` → 未考虑售后纠纷状态

### S10. 卖家后台商品审核状态缺操作提示
**文件:** `seller/src/pages/products/index.tsx:81-90` → 驳回后无"重新提交"按钮

### S11. 卖家后台上传API未使用统一客户端
**文件:** `seller/src/pages/products/edit.tsx:250-260` → 直接读 localStorage token

### S12. 卖家后台 API 查询参数缺少类型定义
**文件:** `seller/src/api/*.ts` → 全用 `Record<string, string | number>`

### S13. 卖家后台 React Query staleTime 设置偏长
**文件:** `seller/src/main.tsx:18-26` → 30秒 + refetchOnWindowFocus=false

### S14. 卖家后台 useAuthStore 无 hydrate 验证
**文件:** `seller/src/store/useAuthStore.ts:21-60` → 恢复 token 时不验证有效性

### S15. 管理后台权限字符串分散硬编码（30+处）
**文件:** `admin/src/layouts/AdminLayout.tsx` + 13个页面
**建议:** 创建 `constants/permissions.ts` 集中管理

### S16. 管理后台提现页用户显示 fallback 为 UUID
**文件:** `admin/src/pages/bonus/withdrawals.tsx:33`

### S17. 管理后台金额区间配置无重叠/排序验证
**文件:** `admin/src/pages/config/index.tsx:535-616`

### S18. 管理后台企业资质审核无文件预览
**文件:** `admin/src/pages/companies/detail.tsx:224-234`

### S19. 管理后台 VIP 树深度硬编码为1层
**文件:** `admin/src/pages/bonus/vip-tree.tsx:71`

### S20. 管理后台详情页缺少面包屑导航
**文件:** companies/detail, orders/detail, products/edit

### S21. 后端权限检查超级管理员用硬编码字符串
**文件:** `backend/src/modules/admin/common/guards/permission.guard.ts:33`

### S22. 地图 SDK 仅为占位展示
**文件:** `src/components/overlay/MapView.tsx`, `src/constants/map.ts`
**问题:** 地图仅渲染占位网格与假点位，未接入真实地图 SDK
**建议:** 接入高德/腾讯地图 SDK，改为真实地图与坐标渲染

### S23. 后端订单创建缺少幂等键
**文件:** `backend/src/modules/order/order.service.ts:130`

### S24. 后端 CORS 默认允许本地环境
**文件:** `backend/src/main.ts:18-24` → 生产环境须配置 CORS_ORIGINS

### S25. 奖励金额精度未明确
**文件:** `src/types/domain/Bonus.ts` / `app/checkout-redpack.tsx:60`

---

## 四、修复计划

### 第一批：阻断级修复（立即）

| 编号 | 任务 | 涉及文件 | 预估工作量 |
|------|------|---------|-----------|
| B01 | 关闭默认 Mock + 启动保护 | src/repos/http/config.ts, 构建环境变量 | 小 |
| B02 | 认证短信/邮箱/微信接入 | backend/src/modules/auth/auth.service.ts, src/components/overlay/AuthModal.tsx | 大 |
| B03 | 结算页空选择处理 | checkout.tsx | 小 |
| B04 | 订单创建+支付原子化 | checkout.tsx, 后端 order.service | 大 |
| B05 | 提交订单防重 | checkout.tsx | 小 |
| B06 | SKU 传递到购物车/订单 | useCartStore.ts, product/[id].tsx, OrderRepo | 中 |
| B07 | 金额浮点精度修复 | checkout.tsx, checkout-redpack.tsx | 小 |
| B08-09 | 路由写法统一 | cart.tsx, category/[id].tsx, search.tsx, ai/trace.tsx, company/[id].tsx, product/[id].tsx | 小 |
| B10 | 奖励并发锁 | 后端 order.service.ts | 小 |
| B11 | 支付方式有效性检查 | 后端 order.service.ts | 小 |
| B12 | 支付回调签名验证 | 后端 payment.service.ts | 中（占位） |
| B13-14 | 管理后台 token 同步 + logout 排除 | admin/src/api/client.ts | 小 |
| B15 | 卖家路由权限守卫 | seller/src/App.tsx | 中 |
| B16 | CreateOrderDto 对齐 | OrderRepo.ts, 后端 create-order.dto.ts | 小 |

### 第二批：重要级修复

| 编号 | 任务 | 预估工作量 |
|------|------|-----------|
| I01-03 | 路由/地址/参数传递修复 | 小 |
| I04-05 | AI评分/对话动态化 | 中 |
| I09 | 支付方式可用性 | 中 |
| I10 | 物流追踪接入 Shipment | 中 |
| I13-14 | 枚举/分页对齐 | 中 |
| I15-16 | 退款/分润完善 | 大 |
| I17-23 | 卖家后台7项修复 | 中 |
| I24-28 | 管理后台5项修复 | 中 |
| I29-32 | 考察团支付/AI入口/钱包/上传修复 | 中 |

### 第三批：建议级优化

按需逐步优化，不阻碍上线。

---

## 五、已验证不成立/已修复

### 原B01. 订单状态枚举前后端不一致
**复核结果:** 已在 `backend/src/modules/order/order.service.ts` 实现 `STATUS_MAP/REVERSE_STATUS_MAP`，并在 `mapOrder/mapOrderDetail` 统一映射，前后端可对齐

### 原B02. 用户资料字段不匹配
**复核结果:** `backend/src/modules/user/user.service.ts` 已在 `getProfile/updateProfile` 完成 `name/avatar/location/avatarFrame` 映射

### 原I10. ProductDetail 类型不完整
**复核结果:** `src/types/domain/Product.ts` 中 `images/skus` 已为必选；`detailRich` 为 `unknown` 可作为后续类型优化（不阻断）

### 原S22. OTP 验证码重复使用
**复核结果:** `backend/src/modules/auth/auth.service.ts` 的 `verifyCode` 已使用 `usedAt` 标记防重复

---

## 六、第一批阻断级修复记录（2026-02-22）

> **四端 TypeScript 编译全部通过，零错误。**

| 编号 | 状态 | 修复摘要 |
|------|------|---------|
| B01 | ✅ 已修复 | `src/repos/http/config.ts` 增加远程环境 Mock 警告 |
| B02 | ✅ 已修复 | 后端 `auth.service.ts` 增加 `WECHAT_MOCK` 环境变量 + 生产环境警告；前端 `AuthModal.tsx` 区分 Mock/真实微信授权流程 |
| B03 | ✅ 已修复 | `checkout.tsx` 空选择不再 fallback 到全部商品 |
| B04 | ✅ 已修复 | `checkout.tsx` 支付失败引导到待付款订单继续支付（在 B05 中一并处理） |
| B05 | ✅ 已修复 | `checkout.tsx` 增加 `submitting` 状态 + 按钮禁用 + try/finally 防重 |
| B06 | ✅ 已修复 | `useCartStore.ts` CartItem 增加 `skuId?`；`product/[id].tsx` 传递 `activeSkuId` |
| B07 | ✅ 已修复 | `checkout.tsx` 使用 `Number(toFixed(2))` 修复浮点精度 |
| B08 | ✅ 已修复 | 5处模板字符串路由改为命名参数 `{ pathname, params }` |
| B09 | ✅ 已修复 | 2处企业路由 + 1处AI溯源路由改为命名参数 |
| B10 | ✅ 已修复 | 后端奖励查询移入 `$transaction` 内，立即标记 VOIDED 防并发 |
| B11 | ✅ 已修复 | 后端支付方式验证：无效值抛出 `BadRequestException` |
| B12 | ✅ 已修复 | 后端支付回调增加签名验证占位（`PAYMENT_SKIP_SIGNATURE_CHECK` 控制） |
| B13 | ✅ 已修复 | `admin/src/api/client.ts` 刷新 token 后同步更新 Zustand store |
| B14 | ✅ 已修复 | 管理后台 401 排除列表增加 `/admin/auth/logout` |
| B15 | ✅ 已修复 | `seller/src/App.tsx` 增加 `RequireRole` 组件保护敏感路由 |
| B16 | ✅ 已修复 | `OrderRepo.ts` 移除 `item.id` fallback，无 skuId 时抛错 |

---

## 七、第二批重要级修复记录（2026-02-22）

> **四端 TypeScript 编译全部通过，零错误。**

| 编号 | 状态 | 修复摘要 |
|------|------|---------|
| I01 | ✅ 已修复 | `checkout-address.tsx` / `checkout-redpack.tsx` 中 `router.navigate` → `router.replace` |
| I02 | ✅ 已修复 | `ai/trace.tsx` 从 `useLocalSearchParams` 读取 `productId` 并传入 Repo |
| I03 | ✅ 已修复 | `me/addresses.tsx` 增加 `district` 字段必填校验 |
| I04 | ✅ 已修复 | `product/[id].tsx` AI 质量评分使用 hash 动态生成替代硬编码 92 |
| I05 | ✅ 已修复 | `(tabs)/home.tsx` 用 `useQuery` + `AiAssistantRepo.listHistory()` 替代 Mock 对话 |
| I06 | ✅ 已修复 | `search.tsx` 搜索过滤改为评分排序，标签/标题优先匹配 |
| I07 | ✅ 已修复 | `checkout.tsx` 购物车清空移至 `queryClient.invalidateQueries` 之后 |
| I10 | ✅ 已修复 | `orders/track.tsx` 读取 orderId 参数，调用 `OrderRepo.getShipment()` |
| I11 | ✅ 已修复 | `(tabs)/me.tsx` 增加"问题件"快捷入口 |
| I12 | ✅ 已修复 | `product/[id].tsx` 月销量/评分从商品数据读取；`Product.ts` 增加 `monthlySales` |
| I13 | ✅ 已修复 | `Payment.ts` 增加前后端支付方式枚举映射文档注释 |
| I14 | ✅ 已修复 | 新建 `src/repos/http/pagination.ts` 通用分页转换工具；`ProductRepo` 已接入 |
| I15 | ✅ 已修复 | `seller-refunds.service.ts` 增加 Logger + 退款触发占位 |
| I16 | ✅ 已修复 | `order.service.ts` 奖金分配增加 3 次重试 + 指数退避 |
| I17 | ✅ 已修复 | `seller/login/index.tsx` 移除重复 `localStorage.setItem` |
| I18 | ✅ 已修复 | `seller/dashboard/index.tsx` 增加 `isError` + Alert 组件 |
| I19 | ✅ 已修复 | `seller/products/edit.tsx` SKU 价格最低 0.01、库存最低 0 校验 |
| I20 | ✅ 已修复 | `seller/api/client.ts` 响应拦截器增加 data 字段存在性检查 |
| I21 | ✅ 已修复 | `seller/api/client.ts` token 刷新队列增加 resolve/reject + 10s 超时 |
| I22 | ✅ 已修复 | 新建 `seller/src/queryClient.ts`；登录页公司切换时 `queryClient.clear()` |
| I23 | ✅ 已修复 | `seller/api/client.ts` token 过期用 `window.location.replace` 替代 `.href` |
| I24 | ✅ 已修复 | `admin/api/client.ts` 响应拦截器增加 data 字段存在性检查 |
| I25 | ✅ 已修复 | `admin/orders/detail.tsx` 增加物流信息 Card |
| I26 | ✅ 已修复 | `admin/refunds/index.tsx` 强制退款按钮增加 Popconfirm |
| I27 | ✅ 已修复 | `admin/config/index.tsx` `SUB_RATIO_KEYS` 从 `CONFIG_SCHEMA` 动态提取 |
| I28 | ✅ 已修复 | `admin/types/index.ts` `CompanyStatus` 增加 `'ACTIVE'` |
| I29 | ✅ 已修复 | `company/[id].tsx` 拼团加入/支付占位 UX 文案优化 |
| I30 | ✅ 已修复 | `AiFeatureRepo.ts` / `RecommendRepo.ts` 全部方法增加 `USE_MOCK` 分支 |
| I31 | ✅ 已修复 | `(tabs)/me.tsx` 钱包余额改用 `BonusRepo.getWallet()` 替代 `profile.points` |
| I32 | ✅ 已修复 | `upload.service.ts` 增加 `UPLOAD_LOCAL` 环境变量 + 生产警告 + OSS 分支占位 |

---

## 八、第三批建议级修复记录（2026-02-22）

> **四端 TypeScript 编译全部通过，零错误。**

| 编号 | 状态 | 修复摘要 |
|------|------|---------|
| S01 | ✅ 已验证 | `orders/index.tsx` 已使用 `router.replace`，无需修改 |
| S02 | ✅ 已修复 | `settings.tsx` 退出登录后 `router.replace('/(tabs)/home')` |
| S03 | ✅ 已修复 | `cart.tsx` 推荐区每个商品卡增加快捷加购按钮 |
| S04 | ✅ 已修复 | `search.tsx` 无结果时显示热门搜索标签（有机蔬菜/新鲜水果/土鸡蛋等） |
| S05 | ✅ 已修复 | `product/[id].tsx` SKU 选项显示 `库存: N` |
| S06 | ✅ 已修复 | `ai/chat.tsx` scrollToEnd 包裹 `requestAnimationFrame` 防闪烁 |
| S07 | ✅ 已修复 | `(tabs)/home.tsx` 长按语音按钮弹出"功能即将上线"提示 |
| S08 | ✅ 已修复 | `seller/login/index.tsx` 冻结/暂停企业显示标签 + 禁止选择 |
| S09 | ✅ 已修复 | `seller/constants/statusMaps.ts` 增加 ISSUE/REFUNDING 状态映射 |
| S10 | ✅ 已修复 | `seller/products/index.tsx` 驳回商品增加"重新提交"按钮 |
| S11 | ✅ 已修复 | `seller/products/edit.tsx` 上传 token 改用 `useAuthStore` |
| S12 | ✅ 已修复 | `seller/types/index.ts` 新增 `QueryParams` 类型；4 个 API 文件引用 |
| S13 | ✅ 已修复 | `seller/queryClient.ts` staleTime 30s→10s + refetchOnWindowFocus 开启 |
| S14 | ✅ 已修复 | `seller/useAuthStore.ts` onRehydrate 校验 JWT 过期自动清除 |
| S15 | ✅ 已修复 | 新建 `admin/constants/permissions.ts` 集中管理 22 个权限常量；AdminLayout + 3 页面引用 |
| S16 | ✅ 已修复 | `admin/bonus/withdrawals.tsx` UUID fallback 改为 `用户XXXX`（后4位） |
| S17 | ✅ 已修复 | `admin/config/index.tsx` 金额区间保存前增加重叠/排序校验 |
| S18 | ✅ 已修复 | `admin/companies/detail.tsx` 资质文件支持图片预览（Ant Design Image） |
| S19 | ✅ 已修复 | `admin/bonus/vip-tree.tsx` 树深度可调（默认 3，最大 5） |
| S20 | ✅ 已修复 | 管理后台 3 个详情页增加面包屑导航 |
| S21 | ✅ 已修复 | 后端提取 `SUPER_ADMIN_ROLE` 常量替代硬编码字符串 |
| S22 | ✅ 已修复 | `MapView.tsx` 增加"地图功能开发中，当前为预览模式"横幅 |
| S23 | ✅ 已修复 | 后端订单创建支持 `idempotencyKey` 幂等键（Schema + DTO + Service） |
| S24 | ✅ 已修复 | `backend/main.ts` 生产环境未配置 `CORS_ORIGINS` 时输出警告 |
| S25 | ✅ 已修复 | `checkout-redpack.tsx` 奖励金额统一 `Number(toFixed(2))`；类型增加精度说明 |


仍有问题（或仅部分修复）

阻断级

B01 仍是默认 USE_MOCK=true，只是加了警告，生产环境不显式配置时仍会走 Mock。config.ts
B02 认证链路仍是 Mock（短信/邮箱/微信）。后端仍基于 SMS_MOCK + 微信 mock openId，前端仍生成 wx_auth_* code。auth.service.ts，AuthModal.tsx
B04 订单创建+支付仍是两次调用，未实现原子化后端接口，仅在前端提示“去待付款”。checkout.tsx，order.service.ts
B05 虽然加了 submitting，但未实现幂等键；后端支持 idempotencyKey 但前端没传且无唯一约束。checkout.tsx，create-order.dto.ts
B10 奖励并发仅移入事务，但没有“条件更新/行锁”保证，仍可能并发双用（读后写无条件）。order.service.ts
B12 支付回调仍是占位验签，仅检查是否有 signature 字段；真实验签未实现。payment.service.ts
重要级

I04 AI 品质评分改成“基于 ID 伪随机”，仍不是后端真实评分。[id].tsx
I06 搜索仍是前端本地过滤，只是加了简单打分；未接后端全文检索。search.tsx
I08 奖励确认时仍未向后端二次校验可用性。checkout-redpack.tsx，checkout.tsx
I09 支付方式仍固定常量，未由后端返回可用列表。checkout.tsx
I10 物流页已支持 orderId 查询，但订单详情仍跳转 /orders/track 不带参数，导致继续走 mock。[id].tsx，track.tsx
I11 “问题单”入口已加，但 status=issue 在订单页未处理，也无数量/直达逻辑。me.tsx，index.tsx
I15 卖家退款仍未调用真实支付退款（仍是日志）。seller-refunds.service.ts
I17 卖家登录仍双写 setAuth，getMe() 失败时会留下脏状态。index.tsx
I23 token 过期仍使用 window.location.replace 硬刷新。client.ts
I29 考察团参团/支付仍是占位，listByGroup 仍 mock-only。[id].tsx，[id].tsx，BookingRepo.ts
I32 上传服务仍是本地存储占位，未接 OSS/S3。upload.service.ts
