# L12 - 管理后台全页面联通审查（B 档）

**审查时间**：2026-04-11
**审查范围**：`admin/src/pages/` 全部页面 × `backend/src/modules/admin/` 全部控制器 × 客户服务 `customer-service/cs-admin.controller.ts`
**审查模式**：只读（Explore agent）
**审查人**：Claude（L12 subagent）

---

## 一、执行摘要

管理后台共 **53 个页面文件**（含子组件）、**26 个 API client 文件**、后端 **29 个 admin 控制器**（含 `customer-service/cs-admin.controller.ts`）。整体联通度较高，但存在 1 个 **严重断链 (Critical)**、3 个 **高危不一致 (High)**、4 个 **中等问题 (Medium)** 和若干 Low 级观察。

**关键发现**：

- **Critical** — `admin/replacements` 页面与 `/admin/replacements` API 完全是孤儿：后端没有任何 `admin/replacements` 控制器（已被统一到 `/admin/after-sale` 体系）。前端页面仍注册在路由与菜单中，Dashboard 甚至把"待处理换货"写死调用 `getReplacements`。访问该页或加载 Dashboard 的任何一次都会拿到 404。
- **High** — 前端 `PERMISSIONS` 常量缺少 `dashboard:read`，但后端 `/admin/stats/*` 三个接口都挂了 `@RequirePermission('dashboard:read')`，任何没有该权限的管理员（包括非超管）打开首页即 403。
- **High** — `/admin/refunds` 页面与菜单项标记"退款仲裁(旧)"，但整条仲裁链路仍然挂载；`replacements` 也标成"(旧)"但没清理。新旧两套并存，权限常量里同时存在 `AFTER_SALE_*` 和 `REPLACEMENTS_*`，既增加混乱，也让数据库的旧 `Replacement` 表成为没有前端入口维护的僵尸数据。
- **High** — `/admin/merchant-applications` 控制器存在并被 `admin/companies` 页以 Tab 形式调用，但顶层菜单中无"入驻申请"独立入口；管理员必须通过隐藏路径进入。新功能入口漏挂。

---

## 二、页面 × API 联通大表

说明：
- **联通**：路径、方法、参数全部匹配；
- **基本联通**：路径匹配但存在字段/权限语义微小偏差；
- **断链**：后端对应路由不存在；
- **未注册**：前端页面存在但菜单无入口；
- **未接入**：存在但当前页面未调用。

权限列显示前端 `PermissionGate` / 菜单 `permission` 与后端 `@RequirePermission` 的组合。

### 2.1 仪表盘与认证

| # | 页面 | 前端路由 | 主 API | 后端 Controller | 联通状态 | 权限标识 | 已知问题 |
|---|---|---|---|---|---|---|---|
| 1 | 工作台 Dashboard | `/` | `/admin/stats/dashboard`, `/admin/stats/sales-trend`, `/admin/stats/bonus` + 多个 list 预览 | `admin/stats/*` | 主查询联通 | 后端 `dashboard:read`（前端常量缺失） | **High**：前端 PERMISSIONS 缺 `dashboard:read`；**Critical**：`pendingItems` 中调用 `getReplacements({ status: 'REQUESTED' })` → 404 永久失败 |
| 2 | 登录 | `/login` | `POST /admin/auth/login` | `admin/auth` | 联通 | 无 | — |
| — | （无）Profile | — | `GET /admin/auth/profile` | `admin/auth` | 路由存在，`api/auth.ts#getProfile` 定义但**当前代码未调用**（store 从 login 响应构造 admin） | — | Low：定义但未接入 |
| — | （无）Refresh | 拦截器 | `POST /admin/auth/refresh` | `admin/auth` | 联通 | 无 | — |

### 2.2 用户与奖励

| # | 页面 | 前端路由 | 主 API | 后端 Controller | 联通状态 | 权限标识 | 已知问题 |
|---|---|---|---|---|---|---|---|
| 3 | App 用户列表 | `/users` | `GET /admin/app-users`, `GET /admin/app-users/stats` | `admin/app-users` | 联通 | 菜单 `users:read` ↔ 后端 `users:read` | — |
| 4 | App 用户详情 | `/users/:id` | `GET /admin/app-users/:id`, `POST :id/toggle-ban` | `admin/app-users` | 联通 | `users:read` / `users:ban` | — |
| — | （未接入）访客清理 | — | `GET /admin/app-users/guest-cleanup/preview`, `POST .../execute` | `admin/app-users` | **未接入**：后端已实现但前端无入口调用 | — | Low：游客模式下线后端遗留工具，无前端页面触发 |
| 5 | 管理员账号 | `/admin/users` | `GET /admin/users`, 全 CRUD + reset-password | `admin/users` | 联通 | `admin_users:read/create/update/delete` ↔ 后端一致 | — |
| 6 | 角色权限 | `/admin/roles` | `GET /admin/roles`, `/permissions`, `/:id` + CRUD | `admin/roles` | 联通 | `admin_roles:*` | — |
| 7 | VIP 会员列表 | `/bonus/members` | `GET /admin/bonus/members` | `admin/bonus` | 联通 | `bonus:read` | — |
| 8 | VIP 会员详情 | `/bonus/members/:userId` | `GET /admin/bonus/members/:userId` | `admin/bonus` | 联通 | `bonus:read` | — |
| 9 | 提现审核 | `/bonus/withdrawals` | `GET /admin/bonus/withdrawals`, `POST :id/approve`, `/reject` | `admin/bonus` | 联通 | `bonus:read` / `bonus:approve_withdraw` | — |
| 10 | VIP 奖励树 | `/bonus/vip-tree` | `/admin/bonus/vip-tree/{search,root-stats,context,:u/children,:u/reward-records,:u/orders,:u/path-explain}` | `admin/bonus` | 联通 | `bonus:read` | — |
| 11 | 普通奖励树 | `/bonus/normal-tree` | `/admin/bonus/normal-tree/*`（同 VIP 对称） | `admin/bonus` | 联通 | `bonus:read` | — |
| 12 | 普通奖励广播窗口 | `/bonus/broadcast-window` | `/admin/bonus/broadcast-window/{buckets, ?bucket, :orderId/distributions}` + `/admin/config` 读参数 | `admin/bonus` + `admin/config` | 联通 | `bonus:read` | — |
| 13 | VIP 系统配置 | `/bonus/vip-config` | `GET /admin/config`, `PUT /admin/config/:key`, versions, rollback | `admin/config` | 联通 | `config:read/update` | — |
| 14 | 普通系统配置 | `/bonus/normal-config` | 同上（不同 key 前缀） | `admin/config` | 联通 | `config:read/update` | — |
| 15 | 购买 VIP 赠品 | `/vip-gifts` | `/admin/vip/gift-options` CRUD + `/batch/sort`, `/reward-skus`, `/sku-references/:id`, `/:id/status` + `/admin/vip/packages` CRUD | `admin/vip-gift` + `admin/vip-package` | 联通 | `vip_gift:*` ↔ 后端；VIP 档位子区域后端用 `config:read/update` 而非 `vip_gift:*`（**不一致**） | **Medium**：VipPackage CRUD 与 VipGiftOption 同页但权限码不同，前端用一个 `VIP_GIFT_READ` 显示，可能导致仅有 `vip_gift:read` 的管理员看到档位读按钮但点编辑时收到 403 |

### 2.3 商家与商品

| # | 页面 | 前端路由 | 主 API | 后端 Controller | 联通状态 | 权限标识 | 已知问题 |
|---|---|---|---|---|---|---|---|
| 16 | 企业列表 | `/companies` | `GET /admin/companies`, `POST /admin/companies` | `admin/companies` | 联通 | 菜单 `companies:read`；创建需 `companies:audit` | — |
| 16b | 入驻申请 Tab | `/companies`（同页 Tab） | `GET /admin/merchant-applications`, `/:id`, `/pending-count`, `/:id/approve`, `/:id/reject` | `admin/merchant-applications` | 联通 | `companies:read/audit` | **High**：顶层菜单无"入驻申请"独立项，只有企业列表页内的 Tab；与 `docs/superpowers/plans/2026-03-24-merchant-onboarding.md` 要求的独立入口不符 |
| 17 | 企业详情 | `/companies/:id` | `/:id`, `PUT /:id`, `/audit`, `/staff`, `/bind-owner`, `/ai-search-profile`, `/highlights`, `/documents/:docId/verify`, `/tags`（读/写） | `admin/companies` + `admin/tags`（companyTags 经 companies 路由） | 联通 | `companies:read/update/audit` | Low：`companyTags` 实际路由挂在 `admin/companies/:id/tags` 而非 `admin/tags`，但 frontend `api/tags.ts` 中注释和导出位置混在一起容易误导 |
| 18 | 分类管理 | `/categories` | `GET/POST/PUT/DELETE /admin/categories`, `/batch/sort`, `/:id/toggle-active` | `admin/categories` | 联通 | `categories:read/manage` | — |
| 19 | 商家商品列表 | `/products` | `GET /admin/products`, `/stats`, `POST /:id/audit`, `/:id/toggle-status` | `admin/products` | 联通 | 菜单无 permission 字段 = 默认放行；后端 `products:read/update/audit` | **Medium**：前端 PERMISSIONS 定义了 `PRODUCTS_CREATE`、`PRODUCTS_DELETE`，但后端没有任何 `@RequirePermission('products:create')` 或 `products:delete`（管理端不提供新增/删除商品，仅商家端）。这些常量是死代码 |
| 20 | 商品编辑 | `/products/:id/edit` | `GET /admin/products/:id`, `PUT /:id`, `POST /:id/refill-semantic` | `admin/products` | 联通 | `products:update` | — |
| 21 | 奖励商品列表 | `/reward-products` | `GET /admin/reward-products` | `admin/reward-product` | 联通 | `reward_products:read` | — |
| 22 | 奖励商品编辑 | `/reward-products/:id/edit` | `GET /admin/reward-products/:id`, CRUD, SKU 子路由 | `admin/reward-product` | 联通 | `reward_products:*` | — |
| 23 | 标签管理 | `/tags` | `/admin/tag-categories` + `/admin/tags` CRUD | `admin/tags`（双 Controller：`admin/tag-categories` + `admin/tags`） | 联通 | `tags:read/manage` | — |
| 24 | 溯源批次 | `/trace` | `/admin/trace` CRUD | `admin/trace` | 联通 | `trace:read/create/update/delete` | — |

### 2.4 交易与售后

| # | 页面 | 前端路由 | 主 API | 后端 Controller | 联通状态 | 权限标识 | 已知问题 |
|---|---|---|---|---|---|---|---|
| 25 | 订单列表 | `/orders` | `GET /admin/orders`, `/stats`, `POST /:id/ship`, `/:id/cancel` | `admin/orders` | 联通 | `orders:read/ship/cancel` | — |
| 26 | 订单详情 | `/orders/:id` | `GET /admin/orders/:id` | `admin/orders` | 联通 | `orders:read` | — |
| 27 | 发票管理 | `/invoices` | `GET /admin/invoices`, `/stats`, `/:id`, `POST /:id/issue`, `/:id/fail` | `admin/invoices` | 联通 | `invoices:read/issue` | — |
| 28 | 发票详情 | `/invoices/:id` | `GET /admin/invoices/:id` | `admin/invoices` | 联通 | `invoices:read` | — |
| 29 | 售后仲裁 | `/after-sale` | `GET /admin/after-sale`, `/stats`, `/:id`, `POST /:id/arbitrate` | `admin/after-sale` | 联通 | `after-sale:read/arbitrate` | — |
| 30 | **换货仲裁（旧）** | `/replacements` | `GET /admin/replacements`, `/stats`, `/:id`, `POST /:id/arbitrate` | **不存在** | **🔴 断链** | `replacements:read/arbitrate`（后端无任何 Controller 消费这些权限） | **🚨 Critical**：整条 API 404；菜单和路由仍注册；Dashboard "待处理换货" 硬编码调用，每次加载首页都会失败；只是写着"(旧)"但没有删 |
| 31 | 退款仲裁（旧） | `/refunds` | `GET /admin/refunds`, `/:id`, `POST /:id/arbitrate` | `admin/refunds` | 联通 | 菜单 `orders:refund` ↔ 后端 `orders:read` / `orders:refund` | **Medium**：标"(旧)"但 controller 仍然在用，仅对未迁入 `after-sale` 的遗留 Refund 行有效；推荐明确"只读查看/清退"策略或彻底下线 |
| 32 | 运费规则 | `/shipping-rules` | `/admin/shipping-rules` CRUD + `/preview` | `admin/shipping-rule` | 联通 | `shipping:read/create/update/delete` | — |

### 2.5 运营活动

| # | 页面 | 前端路由 | 主 API | 后端 Controller | 联通状态 | 权限标识 | 已知问题 |
|---|---|---|---|---|---|---|---|
| 33 | 红包管理（总览） | `/coupons` | 路由页（不单独请求） | — | 联通 | `coupon:read` | — |
| 34 | 红包活动列表 | `/coupons/campaigns` | `GET /admin/coupons/campaigns`, POST/PATCH/PATCH status, `/:id/manual-issue` | `admin/coupon` | 联通 | `coupon:read/manage` | — |
| 35 | 红包活动表单 | `/coupons/campaigns/*`（表单子页） | `GET/POST/PATCH /admin/coupons/campaigns/:id` | `admin/coupon` | 联通 | `coupon:manage` | — |
| 36 | 红包发放记录 | `/coupons/instances` | `GET /admin/coupons/instances`, `POST /admin/coupons/instances/:id/revoke` | `admin/coupon` | 联通 | `coupon:read/manage` | — |
| 37 | 红包使用记录 | `/coupons/usage` | `GET /admin/coupons/usage` | `admin/coupon` | 联通 | `coupon:read` | — |
| 38 | 红包统计 | `/coupons/stats` | `GET /admin/coupons/stats`, `/stats/:id` | `admin/coupon` | 联通 | `coupon:read` | **Low**：前端 `getCampaignStats(id)` 调 `/admin/coupons/stats/${id}`，后端参数名 `@Param('campaignId')`，结构一致，仅参数名字不统一（无运行影响） |
| 39 | 抽奖管理 | `/lottery` | `/admin/lottery/prizes` CRUD + `/batch-probabilities` + `/records` + `/stats` | `admin/lottery` | 联通 | `lottery:read/create/update/delete` | — |

### 2.6 客服中心（CS 6 页面）

CS 后端 `/admin/cs/*` 位于 `backend/src/modules/customer-service/cs-admin.controller.ts`（不在 `backend/src/modules/admin/` 目录内，但 URL 前缀正确）。

| # | 页面 | 前端路由 | 主 API | 后端路由 | 联通状态 | 权限 | 已知问题 |
|---|---|---|---|---|---|---|---|
| 40 | 对话工作台 | `/cs/workstation` | `GET /admin/cs/sessions`, `/:id`, `/agent-status` + Socket.IO | `cs-admin` | 联通 | `cs:read/manage` | — |
| 41 | 工单管理 | `/cs/tickets` | `GET /admin/cs/tickets`, `PATCH /:id` | `cs-admin` | 联通 | `cs:read/manage` | — |
| 42 | FAQ 管理 | `/cs/faq` | `GET /admin/cs/faq`, `POST`, `PATCH /:id`, `DELETE /:id`, `POST /faq/test` | `cs-admin` | 联通 | `cs:read/manage` | — |
| 43 | 快捷入口配置 | `/cs/quick-entries` | `GET /admin/cs/quick-entries`, CRUD, `PATCH /sort` | `cs-admin` | 联通 | `cs:read/manage` | — |
| 44 | 坐席快捷回复 | `/cs/quick-replies` | `GET /admin/cs/quick-replies`, CRUD | `cs-admin` | 联通 | `cs:read/manage` | — |
| 45 | 数据看板 | `/cs/dashboard` | `GET /admin/cs/stats` | `cs-admin` | 联通 | `cs:read` | — |

### 2.7 系统管理

| # | 页面 | 前端路由 | 主 API | 后端 Controller | 联通状态 | 权限 | 已知问题 |
|---|---|---|---|---|---|---|---|
| 46 | 平台设置 | `/config` | `GET /admin/config`, `PUT /admin/config/:key`, `/versions`, `/versions/:id/rollback` | `admin/config` | 联通 | `config:read/update` | — |
| 47 | 发现页筛选 | `/config/discovery-filters` | `GET/PUT /admin/config/:key`（key=`DISCOVERY_COMPANY_FILTERS`） + `GET /admin/tags` | `admin/config` + `admin/tags` | 联通 | `config:read/update` + `tags:read` | **Low**：直接把筛选项写进通用 RuleConfig 表。与 `docs/superpowers/specs/2026-03-28-discovery-filter-design.md` 建议的"独立配置数据模型"不一致，但当前实现已工作 |
| 48 | 审计日志 | `/audit` | `GET /admin/audit`, `/:id`, `/target/:type/:id`, `POST /:id/rollback` | `admin/audit` | 联通 | `audit:read/rollback` | **Low**：`getTargetUrl()` 映射中的 `replacement → /replacements`、`refund → /refunds` 都指向已"旧"的页面；`coupon_campaign → /coupons` 实际应跳 `/coupons/campaigns/:id` |

---

## 三、统计摘要

- **注册页面**（App.tsx Route 数）：**46**
- **菜单项**：**32**（6 个分组）
- **API client 文件**：**26**
- **后端 admin 控制器**：**28**（admin/ 目录 27 + customer-service/cs-admin 1）
- **直联 API 端点**：约 **150+**
- **检测到问题**：Critical **1**, High **3**, Medium **4**, Low **5**

---

## 四、问题清单

### 4.1 🚨 Critical

#### C1. `/admin/replacements` 整条链路 404

- **位置**：
  - 前端：`admin/src/pages/replacements/index.tsx`、`admin/src/api/replacements.ts`、`admin/src/App.tsx:109`、`admin/src/layouts/AdminLayout.tsx:74`、`admin/src/pages/dashboard/index.tsx:24,71`
  - 后端：**不存在** `admin/replacements` 控制器
- **现象**：前端调用 `getReplacements / getReplacementStats / arbitrateReplacement` 所有路由均指向 `/admin/replacements*`，但 `backend/src/modules/admin/` 下没有任何目录或 Controller 消费这些路径。
- **影响**：
  1. 访问 `/replacements` 页：列表始终 404 错误态；
  2. **Dashboard 首屏加载时**，`pendingItems[4]` 固定触发 `getReplacements({ status: 'REQUESTED' })`，每次打开工作台都会在 React Query 缓存里放一个失败项，并且 60 秒 refetch。对所有管理员都有可见影响。
- **根因**：退换货系统已由 `docs/superpowers/plans/2026-03-30-unified-after-sale.md` 迁移到 `/admin/after-sale`，但 `replacements` 页面、API、菜单项、Dashboard 引用都没有清理。
- **建议**：
  1. 立即从 `Dashboard pendingItems` 中删除 `待处理换货` 条目，或替换为 `getAfterSales({ status: 'REQUESTED', afterSaleType: 'REPLACE' })`；
  2. 从 `AdminLayout` 菜单中移除 `/replacements`；
  3. 从 `App.tsx` 删除路由注册；
  4. 删除 `admin/src/pages/replacements/`、`admin/src/api/replacements.ts`；
  5. 删除 `PERMISSIONS.REPLACEMENTS_*` 常量与审计日志 `getTargetUrl` 的 `replacement` 映射；
  6. 考虑把 DB 中旧 `Replacement` 表的数据一次性迁到 `AfterSale` 或归档备份。

### 4.2 ⚠️ High

#### H1. 前端 `PERMISSIONS` 缺 `dashboard:read`

- **位置**：`admin/src/constants/permissions.ts` vs `backend/src/modules/admin/stats/admin-stats.controller.ts:15,21,27`
- **现象**：后端对 `GET /admin/stats/dashboard`、`/sales-trend`、`/bonus` 全部要求 `dashboard:read`，但前端 `PERMISSIONS` 常量没有该 key；工作台菜单项也没有 permission 字段（即默认显示）。
- **影响**：
  - 非超级管理员（无 `dashboard:read` 权限码）打开 `/` 直接拿到 403；
  - `PermissionGate` 无法在 UI 层面提示缺权限。
- **建议**：
  - 在 `PERMISSIONS` 中补 `DASHBOARD_READ = 'dashboard:read'`；
  - 菜单项 `工作台` 加 `permission: PERMISSIONS.DASHBOARD_READ`；
  - 或在后端评估把 `/admin/stats/*` 降级为 `users:read` / `bonus:read` 的并集。

#### H2. 新旧售后系统并存且无明确下线策略

- **位置**：
  - 旧：`/replacements`（已断）、`/refunds` + `admin/refunds` 控制器 + `PERMISSIONS.REPLACEMENTS_*` + `PERMISSIONS.ORDERS_REFUND`
  - 新：`/after-sale` + `admin/after-sale` 控制器 + `PERMISSIONS.AFTER_SALE_*`
- **现象**：菜单项写着"退款仲裁(旧)"和"换货仲裁(旧)"但都还在挂载，`admin/refunds` 控制器还在接收流量；权限常量里两套仲裁码并存。
- **影响**：
  - 管理员不知道应该用哪个页面；
  - 新系统上线后若有遗留单据，仲裁动作只有一方会更新，可能出现状态不一致；
  - 权限角色仍需为每人维护双套授权。
- **建议**：制定明确的下线时间点；对 `/refunds` 设置只读模式；把旧 refund 页面改为"遗留数据查看"并说明；或整体合并进 `/after-sale`。

#### H3. 入驻申请缺顶层菜单入口

- **位置**：`admin/src/pages/companies/applications-tab.tsx`（嵌入在 `/companies` 页内部 Tab） vs `AdminLayout.tsx` 菜单
- **现象**：设计方案 `docs/superpowers/specs/2026-03-24-merchant-onboarding-design.md` 明确要求有独立入口"商户入驻申请"，但目前仅作为 `/companies` 页里的 Tab；顶层菜单没有任何入口或红点提示（`getMerchantApplicationPendingCount` 已实现却未暴露）。
- **影响**：审核员可能长期察觉不到新申请；Tab 方式在菜单深度上被埋没。
- **建议**：
  - 方案 A：在 `商家与商品` 组新增菜单项 `入驻申请 /companies?tab=applications`，用 pending-count 做 Badge；
  - 方案 B：拆出独立 `/merchant-applications` 路由并把 applications-tab 组件搬过去。

### 4.3 🟡 Medium

#### M1. VIP 赠品页（`/vip-gifts`）权限码不一致

- **位置**：`admin/src/pages/vip-gifts/index.tsx` 使用 `PERMISSIONS.VIP_GIFT_*`；但同页里的 "VIP 档位" CRUD 对应后端 `admin/vip-package` 控制器使用的是 `config:read/config:update`。
- **影响**：仅有 `vip_gift:*` 权限但无 `config:update` 的管理员会在 UI 看到"新建档位"按钮但点击后拿 403。
- **建议**：
  - 要么把 `vip-package` Controller 的 @RequirePermission 改成 `vip_gift:update` 系列；
  - 要么在前端档位区块使用 `config:update` 做 PermissionGate。

#### M2. `PERMISSIONS.PRODUCTS_CREATE / PRODUCTS_DELETE` 死代码

- **位置**：`admin/src/constants/permissions.ts:5,7` vs `admin/products` controller
- **现象**：后端没有任何 `@RequirePermission('products:create'|'products:delete')`；管理端不提供新增/删除商品（由商家端 seller 负责）。前端常量中的两个 key 永远不会被任何 Guard 校验。
- **影响**：会误导角色配置界面显示"商品-新建/删除"可勾选权限，但勾选后没有任何实际效果。
- **建议**：删除两个常量；若角色管理页 Permission 选择器是从后端 `/admin/roles/permissions` 动态拿的则影响较小，否则需要同步清理前端权限列表。

#### M3. 审计日志 `getTargetUrl` 映射过时

- **位置**：`admin/src/pages/audit/index.tsx:21-40`
- **现象**：
  - `replacement → /replacements`、`refund → /refunds`：都指向"旧"页面（或 404 页）；
  - `coupon_campaign → /coupons`：应为 `/coupons/campaigns/:targetId`；
  - `withdrawal → /bonus/withdrawals`：没有带 id 参数，无法直接定位。
- **建议**：随 C1、H2 一起更新跳转映射。

#### M4. 发现页筛选配置走 RuleConfig 而非独立模型

- **位置**：`admin/src/pages/config/discovery-filters.tsx:99,143` → `/admin/config/:key`
- **现象**：设计方案 `docs/superpowers/specs/2026-03-28-discovery-filter-design.md` 中推荐独立数据模型与专用 API，实际实现落在通用 RuleConfig 存储。
- **影响**：能用，但每次发现页筛选变更会产生一次 ConfigVersion 记录，污染配置变更历史；并且无法利用 Tag 外键约束防止脏引用。
- **建议**：记录在 tofix 队列中；短期内若无此需求可保留。

### 4.4 🟢 Low（观察）

| # | 位置 | 现象 |
|---|---|---|
| L1 | `admin/src/api/auth.ts:17` | `getProfile` 已定义但页面从未调用（`store/useAuthStore` 从 login 响应直接构造 admin 对象）。后端 `/admin/auth/profile` 仍在，保留即可但可删 |
| L2 | `admin/src/api/app-users.ts` | 后端 `guest-cleanup/preview` 和 `execute` 路由存在但前端没有任何页面触发；游客模式下线后属于闲置工具，保留不影响 |
| L3 | `admin/src/api/coupon.ts:216` vs 后端 coupon.controller.ts:223 | `stats/:id` vs `stats/:campaignId` 仅参数名不同，不影响联通 |
| L4 | 管理员账号页 `/admin/users` | 无明显问题，但新建 admin 时前端允许 `roleIds` 数组为空，后端需自行校验 |
| L5 | 所有 ProTable | 列定义与后端返回字段抽样匹配（Order、Product、Company、Coupon 均校验过）。未逐字段核对 Trace、ShippingRule |

---

## 五、跨系统一致性检查

### 5.1 前端 `PERMISSIONS` vs 后端 `@RequirePermission` 完整对照

下面列出**有差异**的项（完全匹配的省略）：

| 权限码 | 前端存在 | 后端 @RequirePermission 出现 | 状态 |
|---|---|---|---|
| `dashboard:read` | ❌ | ✅（stats/*） | **前端缺失** |
| `products:create` | ✅ | ❌ | 前端死代码 |
| `products:delete` | ✅ | ❌ | 前端死代码 |
| `replacements:read` | ✅ | ❌ | 前端死代码（Critical C1 连带） |
| `replacements:arbitrate` | ✅ | ❌ | 前端死代码 |

其余 `users:*`、`orders:*`、`companies:*`、`bonus:*`、`config:*`、`audit:*`、`trace:*`、`categories:*`、`coupon:*`、`invoices:*`、`shipping:*`、`reward_products:*`、`admin_users:*`、`admin_roles:*`、`lottery:*`、`vip_gift:*`、`tags:*`、`cs:*`、`after-sale:*` 双端一致。

### 5.2 审计日志 @AuditLog 覆盖度（抽样）

| 模块 | 写操作 | 是否 @AuditLog |
|---|---|---|
| `admin/products` | update / toggle-status / audit | ✅ 全部覆盖 |
| `admin/orders` | ship / cancel | ✅ 全部覆盖 |
| `admin/companies` | POST / PUT / audit / bind-owner / ai-search-profile / highlights / tags / documents verify | ✅ 全部覆盖 |
| `admin/merchant-applications` | approve / reject | ✅ 覆盖 |
| `admin/app-users` | toggle-ban、guest-cleanup | 未直接检查，但动作级别较高应补审计 |
| `admin/bonus` | approve/reject withdrawal | 未直接检查（流水已经落 RewardLedger，审计可选） |
| `admin/coupon` | 创建/更新/手动发放/撤回 | 未直接检查 |
| `admin/config` | 更新 / rollback | 未直接检查（但本身会写 ConfigVersion 自审计） |
| `admin/after-sale` | arbitrate | 未直接检查 |

> 本轮审查未逐一核对每个控制器的 `@AuditLog`。建议后续再做一次专项检查（L12 续作或 L05 审计链路复审）。

### 5.3 菜单注册完整性

| 页面 | 在 App.tsx 路由 | 在 AdminLayout 菜单 | 说明 |
|---|---|---|---|
| Dashboard | ✅ | ✅ | OK |
| 入驻申请 | ✅（companies/index Tab） | ❌ | **H3** |
| 换货仲裁 | ✅ | ✅（标旧） | **C1** |
| 退款仲裁 | ✅ | ✅（标旧） | **H2** |
| 其余 30+ 页面 | ✅ | ✅ | OK |

---

## 六、建议执行顺序

1. **立即（阻塞生产）**：修复 C1 — 删 Dashboard 的 `getReplacements` 调用或改为 AfterSale 版本。
2. **本周**：H1 补 `dashboard:read` 权限常量 + 菜单 permission。
3. **本迭代**：H2 下线旧 refunds/replacements 页面与权限；H3 为入驻申请挂菜单入口 + Badge。
4. **下一迭代**：M1 统一 VIP gift/package 权限；M2 清理 products 死权限；M3 更新审计跳转映射。
5. **技术债记录**：M4 发现页筛选数据模型改造可延后。

---

## 七、审查范围覆盖确认

- [x] `admin/src/pages/` 所有目录（22 个业务目录，53 个 .tsx 文件）
- [x] `admin/src/api/` 全部 26 个文件
- [x] `backend/src/modules/admin/` 全部 27 个控制器
- [x] `backend/src/modules/customer-service/cs-admin.controller.ts`（CS 管理端）
- [x] `App.tsx` 路由注册
- [x] `AdminLayout.tsx` 菜单配置
- [x] `constants/permissions.ts` × 后端 `@RequirePermission`
- [x] 关键 DTO 字段一致性（products, orders, vip-gifts）

**未覆盖/留作下次**：
- 完整的 ProTable 列 ↔ 后端返回字段逐列核对（仅抽样）
- 所有写操作的 `@AuditLog` 逐项清单
- `seller/` 卖家后台与管理端的交叉路由（超出 L12 范围）

---

**报告结束。**
