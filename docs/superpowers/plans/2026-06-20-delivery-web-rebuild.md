# 配送 Web 前端重做 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重做 `delivery-admin` 和 `delivery-seller`，让配送管理后台接近现有 `admin` 的成熟度，让配送中心接近现有 `seller` 的成熟度，同时保持配送业务、认证、API、颜色和数据边界完全独立。

**Architecture:** 以现有 `admin/`、`seller/` 的布局、路由、表格、详情页和交互密度为基线，不在当前简化页面上继续堆补丁。保留配送专属 API client 与类型，页面层复用成熟交互结构并换成 `/api/v1/delivery-admin/*`、`/api/v1/delivery-seller/*` 数据源。配送管理后台浅蓝主题，配送中心橙色主题。

**Tech Stack:** Vite + React 19 + TypeScript + React Router v7 + Ant Design 5 + ProComponents + React Query + Zustand.

**Current Status (2026-06-20):** 第一轮重做已完成并验证：配送管理后台布局已改为管理后台式分组，核心运营列表页已升级为 `ProTable`；配送中心布局和工作台/物流/导出/企业/员工/客服页已升级为卖家中心式 `ProCard` 分区；本地 dev proxy 默认改为 `https://test-api.ai-maimai.com`，可用 `VITE_PROXY_TARGET` 覆盖回本地后端；合同测试继续锁定配送数据隔离和配送中心价格隐私边界。二次 UX 收口已完成：配送管理后台配置中心改为分类设置面板，仅保留配送单位字段、清单导出、平台规则；平台规则在页面内直接使用低库存阈值数字框、逐单自定义列开关修改并统一保存，不再暴露内部配置标识、配置范围或 JSON 内容；客服配置移入客服中心；配送管理后台客服中心按主后台补齐 6 页；配送中心企业资料和员工权限页改为设置化分区，权限使用中文分组勾选，账号启用状态使用开关。验证命令：`cd delivery-admin && npm test && npm run build`、`cd delivery-seller && npm test && npm run build`、`git diff --check`。

---

## Scope Decisions

- 不回滚 `staging`：现有 staging 已完成配送后端、数据库、迁移、seed、域名和 API 验证，保留作为联调基线。
- 新分支：`codex/delivery-frontend-rebuild`，新 worktree：`.worktrees/delivery-frontend-rebuild`。
- 不触碰主工作区未提交改动。
- 不把配送账号和爱买买账号打通；配送三端仍使用独立 token、独立 auth store、独立 API namespace。
- 配送管理后台删除：VIP、分润树、红包、抽奖、退换货/退款、发票、数字资产、奖励商品。
- 配送中心删除：售后/退换货、普通卖家 analytics、溯源等不适用模块。
- 配送中心必须隐藏：平台最终售价、加价率、平台利润、买家支付金额等平台侧价格信息。配送中心可看供货价/成本价、订单履约信息、自己的财务清单导出。

## Files and Responsibilities

### delivery-admin

- Modify `delivery-admin/src/layouts/AdminLayout.tsx`: 基于 `admin/src/layouts/AdminLayout.tsx` 重建菜单分组、头像菜单、未保存离开保护、浅蓝主题。
- Modify `delivery-admin/src/App.tsx`: 路由结构对齐管理后台，按配送模块组织，不保留主后台不需要的模块。
- Modify `delivery-admin/src/pages/delivery-admin/*.tsx`: 用现有管理后台的 `ProTable`、统计卡、详情页区块模式重写核心页面。
- Modify `delivery-admin/src/pages/login/index.tsx`: 保留切换爱买买管理后台按钮，视觉接近 `admin` 登录页，但浅蓝主题。
- Modify `delivery-admin/src/api/delivery-management.ts`: 不切回主后台 API，只补齐页面需要的配送接口封装。
- Modify `delivery-admin/src/types/delivery-management.ts`: 保持与配送后端 DTO 对齐。
- Modify `delivery-admin/test/*.test.ts`: 扩展页面/API/禁用模块测试，保证不引用 `admin/*` API namespace。

### delivery-seller

- Modify `delivery-seller/src/layouts/SellerLayout.tsx`: 基于 `seller/src/layouts/SellerLayout.tsx` 重建菜单和结构，保留橙色主题与切换爱买买卖家中心。
- Modify `delivery-seller/src/App.tsx`: 修正路由结构和权限守卫，接近卖家中心风格。
- Modify `delivery-seller/src/pages/products/*.tsx`: 基于卖家中心商品列表/编辑页重写配送商品页，但只展示供货价/成本价。
- Modify `delivery-seller/src/pages/orders/*.tsx`: 基于卖家中心订单列表/详情/物流风格重写配送订单页，增加清单/面单操作，隐藏平台售价。
- Modify `delivery-seller/src/pages/company/*.tsx`: 基于卖家中心企业设置/员工管理重写。
- Modify `delivery-seller/src/pages/exports/index.tsx`: 财务清单导出页，供配送中心看自己的应结/供货清单。
- Modify `delivery-seller/src/pages/customer-service/index.tsx`: 基于客服中心风格增强。
- Modify `delivery-seller/test/*.test.ts`: 扩展隐私边界测试，禁止最终售价/加价率/platform margin 等标识出现在 active delivery seller pages。

## Chunk 1: Baseline and Guardrails

### Task 1: Record Current Baseline

**Files:**
- Read: `admin/src/App.tsx`
- Read: `admin/src/layouts/AdminLayout.tsx`
- Read: `seller/src/App.tsx`
- Read: `seller/src/layouts/SellerLayout.tsx`
- Read: `delivery-admin/src/App.tsx`
- Read: `delivery-admin/src/layouts/AdminLayout.tsx`
- Read: `delivery-seller/src/App.tsx`
- Read: `delivery-seller/src/layouts/SellerLayout.tsx`

- [x] **Step 1: Create isolated worktree**

Run:

```bash
git worktree add -b codex/delivery-frontend-rebuild .worktrees/delivery-frontend-rebuild origin/staging
```

Expected: new worktree at `.worktrees/delivery-frontend-rebuild`.

- [x] **Step 2: Verify current delivery builds**

Run:

```bash
cd delivery-admin && npm ci && npm test && npm run build
cd ../delivery-seller && npm ci && npm test && npm run build
```

Expected: both current simplified frontends pass. This proves later failures are introduced by this rebuild, not baseline dependency drift.

### Task 2: Add Frontend Guardrail Tests

**Files:**
- Modify: `delivery-admin/test/delivery-admin-routes.test.ts`
- Modify: `delivery-seller/test/delivery-seller-routes.test.ts`

- [ ] **Step 1: Add failing admin route coverage test**

Assert that delivery admin keeps mature operational modules:

```ts
const requiredRoutes = [
  '/users',
  '/units',
  '/merchants',
  '/merchant-applications',
  '/products',
  '/pricing-rules',
  '/orders',
  '/shipping-records',
  '/manifests',
  '/settlements',
  '/customer-service',
  '/audit',
  '/config',
  '/account-security',
];
```

Run:

```bash
cd delivery-admin && npm test
```

Expected: fails only if a required delivery route disappears.

- [ ] **Step 2: Add admin forbidden modules test**

Assert source does not include active routes for VIP, coupon, lottery, after-sale, invoices, digital assets, reward products.

- [ ] **Step 3: Add seller privacy guardrail test**

Assert active `delivery-seller/src/pages` and `delivery-seller/src/api` do not contain final sale price, markup, platform margin, or buyer payment field names.

- [ ] **Step 4: Run tests**

Run:

```bash
cd delivery-admin && npm test
cd ../delivery-seller && npm test
```

Expected: current tests pass or fail for the exact newly encoded missing maturity gaps.

## Chunk 2: Delivery Admin Rebuild

### Task 3: Rebuild Delivery Admin Layout from Admin Layout

**Files:**
- Modify: `delivery-admin/src/layouts/AdminLayout.tsx`

- [ ] **Step 1: Replace simplified flat menu with admin-like grouped menu**

Use these groups:

- 工作台: `/`
- 用户与单位: `/users`, `/units`
- 商家与商品: `/merchants`, `/merchant-applications`, `/products`, `/pricing-rules`
- 订单与履约: `/orders`, `/shipping-records`, `/abnormal-payments`, `/manifests`, `/settlements`
- 客服中心: `/customer-service`
- 系统管理: `/config`, `/audit`, `/account-security`

- [ ] **Step 2: Preserve switch button**

Avatar dropdown must include `切换爱买买管理后台` and link to `https://test-admin.ai-maimai.com` in staging.

- [ ] **Step 3: Use shallow blue theme**

Keep delivery admin visually distinct with light blue sidebar, but match admin layout density and grouping.

- [ ] **Step 4: Run delivery-admin tests and build**

Run:

```bash
cd delivery-admin && npm test && npm run build
```

Expected: pass.

### Task 4: Upgrade Delivery Admin List Pages to ProTable

**Files:**
- Modify: `delivery-admin/src/pages/delivery-admin/users.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/units.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/merchants.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/merchant-applications.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/products.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/orders.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/settlements.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/manifests.tsx`

- [ ] **Step 1: Convert each list page from basic `Table` to `ProTable`**

Use `ActionType`, search form, `request`, `pagination`, `toolBarRender`, `copyable`, `ellipsis`, and fixed right action columns like existing admin pages.

- [ ] **Step 2: Add top statistic cards where relevant**

Orders, users, merchants, products, settlements should show compact admin-style metric cards.

- [ ] **Step 3: Keep delivery money boundaries explicit**

Admin may see buyer total, supply amount, merchant payable, and platform difference. These are admin-only.

- [ ] **Step 4: Run tests/build**

Run:

```bash
cd delivery-admin && npm test && npm run build
```

Expected: pass.

### Task 5: Upgrade Delivery Admin Detail Pages

**Files:**
- Modify: `delivery-admin/src/pages/delivery-admin/order-detail.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/user-detail.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/unit-detail.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/merchant-detail.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/merchant-application-detail.tsx`
- Modify: `delivery-admin/src/pages/delivery-admin/customer-service-detail.tsx`

- [ ] **Step 1: Use admin detail page pattern**

Use `Card`, `Descriptions`, `Timeline`, `Tabs`, table sections, status actions, and back buttons.

- [ ] **Step 2: Add PDF/manifest actions to order detail**

Admin order detail must expose buyer full manifest generation/download and seller fulfillment manifest actions.

- [ ] **Step 3: Run tests/build**

Run:

```bash
cd delivery-admin && npm test && npm run build
```

Expected: pass.

## Chunk 3: Delivery Seller Rebuild

### Task 6: Rebuild Delivery Seller Layout from Seller Layout

**Files:**
- Modify: `delivery-seller/src/layouts/SellerLayout.tsx`
- Modify: `delivery-seller/src/App.tsx`

- [ ] **Step 1: Align layout with seller center**

Use `layout="mix"`, same menu behavior, same footer density, same avatar menu style.

- [ ] **Step 2: Keep orange selected state**

Use orange selected state `#EA580C`; avoid changing seller center green theme.

- [ ] **Step 3: Preserve permission-code guard**

Delivery center uses permission codes, not seller role-only gates.

- [ ] **Step 4: Run tests/build**

Run:

```bash
cd delivery-seller && npm test && npm run build
```

Expected: pass.

### Task 7: Rebuild Delivery Seller Product Pages from Seller Product Pages

**Files:**
- Modify: `delivery-seller/src/pages/products/index.tsx`
- Modify: `delivery-seller/src/pages/products/edit.tsx`
- Modify: `delivery-seller/src/pages/products/stock.tsx`

- [ ] **Step 1: Copy seller product list UX**

Use dense `ProTable`, product image/title block, status tags, audit state, stock, created date, and edit action.

- [ ] **Step 2: Copy seller product edit UX**

Use existing seller form layout, sections, image upload style, SKU table style, validation, draft-like ergonomics if delivery API supports it.

- [ ] **Step 3: Enforce price privacy**

Labels must say `供货价` / `成本价`; no `售价`, `平台售价`, `最终售价`, `加价率`.

- [ ] **Step 4: Run privacy tests/build**

Run:

```bash
cd delivery-seller && npm test && npm run build
```

Expected: pass.

### Task 8: Rebuild Delivery Seller Order Pages from Seller Order Pages

**Files:**
- Modify: `delivery-seller/src/pages/orders/index.tsx`
- Modify: `delivery-seller/src/pages/orders/detail.tsx`
- Modify: `delivery-seller/src/pages/orders/logistics.tsx`

- [ ] **Step 1: Copy seller order list density**

Use order status tabs, statistic cards, `ProTable`, row selection, batch actions, and refresh-on-visibility.

- [ ] **Step 2: Keep delivery-specific actions**

Include generate waybill, print waybill, confirm shipment, export fulfillment manifest.

- [ ] **Step 3: Remove buyer paid amount from seller UI**

Seller-facing order pages must show item quantities, receiver, shipping, supply amount/payable where allowed, not platform final sale price.

- [ ] **Step 4: Run tests/build**

Run:

```bash
cd delivery-seller && npm test && npm run build
```

Expected: pass.

### Task 9: Rebuild Delivery Seller Company, Staff, Finance, and Customer Service Pages

**Files:**
- Modify: `delivery-seller/src/pages/company/index.tsx`
- Modify: `delivery-seller/src/pages/company/staff.tsx`
- Modify: `delivery-seller/src/pages/exports/index.tsx`
- Modify: `delivery-seller/src/pages/customer-service/index.tsx`

- [ ] **Step 1: Align company/staff pages with seller center**

Use the same `Card`, `Descriptions`, `ProTable`, modal form, and role/status tags.

- [ ] **Step 2: Expand finance export page**

Show settlement month/status, supply amount, settled amount, export buttons, and file download via authenticated backend.

- [ ] **Step 3: Expand customer service page**

Use conversation list + detail drawer/panel pattern, message preview, assigned status, order links.

- [ ] **Step 4: Run tests/build**

Run:

```bash
cd delivery-seller && npm test && npm run build
```

Expected: pass.

## Chunk 4: Visual Verification and Deployment Readiness

### Task 10: Browser Verification

**Files:**
- No code changes expected unless screenshots reveal layout bugs.

- [ ] **Step 1: Start delivery-admin dev server**

Run:

```bash
cd delivery-admin && npm run dev -- --host 127.0.0.1 --port 5178
```

- [ ] **Step 2: Start delivery-seller dev server**

Run:

```bash
cd delivery-seller && npm run dev -- --host 127.0.0.1 --port 5179
```

- [ ] **Step 3: Verify desktop and mobile screenshots**

Use browser automation for:

- `delivery-admin` login and shell.
- `delivery-admin` orders/products/users/merchants.
- `delivery-seller` login and shell.
- `delivery-seller` orders/products/company/exports.

- [ ] **Step 4: Check no text overlap**

Inspect sidebars, buttons, table toolbars, cards, status tags.

### Task 11: Final Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run final tests**

```bash
cd delivery-admin && npm test && npm run build
cd ../delivery-seller && npm test && npm run build
```

- [ ] **Step 2: Check source boundaries**

```bash
rg -n "/api/v1/(?!delivery-admin|delivery-seller)" delivery-admin/src delivery-seller/src
rg -n "finalPrice|salePrice|markup|platformMargin|平台售价|最终售价|加价率|平台利润" delivery-seller/src
```

Expected: no forbidden active references.

- [ ] **Step 3: Commit**

```bash
git add delivery-admin delivery-seller docs/superpowers/plans/2026-06-20-delivery-web-rebuild.md
git commit -m "refactor(delivery): rebuild admin and center frontends"
```

- [ ] **Step 4: Do not push or merge to staging without user confirmation**

Report branch, worktree path, verification result, and screenshots if available.
