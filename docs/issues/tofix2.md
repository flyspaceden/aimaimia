# 爱买买 - 代码审计问题清单与修复计划（第二轮）

> 创建时间：2026-02-17
> 来源：全面代码审计（后端 + 管理后台前端 + 买家 App）
> 前置：`tofix.md` 中批次 1-5 全部已修复
> 状态：**待修复**

---

## 目录

- [批次一：安全加固](#批次一安全加固)
- [批次二：关键 Bug 修复](#批次二关键-bug-修复)
- [批次三：性能与数据完整性](#批次三性能与数据完整性)
- [批次四：管理后台前端修复](#批次四管理后台前端修复)
- [批次五：买家 App 修复](#批次五买家-app-修复)
- [批次六：代码质量与健壮性](#批次六代码质量与健壮性)
- [批次七：可视化功能开发](#批次七可视化功能开发新功能)
- [已知限制（暂不修复）](#已知限制暂不修复)

---

## 批次一：安全加固 ✅ 已完成

> 影响系统安全，必须在生产部署前修复

### S-1 JWT Secret 硬编码默认值（🔴 必修）✅

**文件：**
- `backend/src/modules/auth/jwt.strategy.ts:20`
- `backend/src/modules/admin/common/strategies/admin-jwt.strategy.ts:18-21`

**问题：** JWT Strategy 中 `configService.get('JWT_SECRET', 'nongmai-dev-jwt-secret-2026')` 带有硬编码 fallback。如果生产环境未设置环境变量，任何人看过源码即可伪造合法 JWT。

**修复方案：** 移除默认值，启动时校验必须设置 `JWT_SECRET` 和 `ADMIN_JWT_SECRET`，否则抛出启动错误。

```typescript
// 修改前
secretOrKey: configService.get<string>('JWT_SECRET', 'nongmai-dev-jwt-secret-2026'),

// 修改后
secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
```

### S-2 CORS 全开放（🔴 必修）✅

**文件：** `backend/src/main.ts:14-17`

**问题：** `app.enableCors({ origin: true, credentials: true })` 允许任意域名携带凭证访问 API。

**修复方案：** 从环境变量读取允许的 origin 列表。

```typescript
app.enableCors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:5179'],
  credentials: true,
});
```

### S-3 管理端登录无 IP 级速率限制（🟠 建议修）✅

**文件：** `backend/src/modules/admin/auth/admin-auth.controller.ts`

**问题：** 已有账号级 lockout（5 次失败锁 30 分钟），但无 IP 级限流。攻击者可对多个账号并行暴力破解。

**修复方案：** 在 admin login 端点添加 `@Throttle({ default: { limit: 5, ttl: 60000 } })`。

---

## 批次二：关键 Bug 修复 ✅ 已完成

> 影响核心功能正确性

### B-1 买家 App OrderRepo skuId 类型强转（🔴 必修）✅

**文件：** `src/repos/OrderRepo.ts:153`

**问题：**
```typescript
skuId: (item as any).skuId || item.productId || item.id,
```
OrderItem 类型中无 `skuId` 字段，使用 `as any` 绕过类型检查。提交订单时可能传递错误的 SKU 标识。

**修复方案：**
1. 在 `src/types/domain/Order.ts` 的 OrderItem 类型中添加 `skuId: string` 字段
2. 移除 `as any`，使用正确类型

### B-2 管理后台类型定义与后端响应不匹配（🔴 必修）✅

**文件：** `admin/src/types/index.ts`

**问题：**
- `Product` 类型缺少 `media`、`skus` 字段 → 编辑页 `products/edit.tsx` 用 `as Record<string, unknown>` 强转
- `Company` 类型缺少 `documents`、`_count`、`contact` 字段 → 详情页 `companies/detail.tsx` 同样强转
- `LoginResponse.admin` 为 `AdminUser`（含角色对象数组），但 Store 期望 `AdminProfile`（roles 为字符串数组）→ 登录时运行时类型不匹配

**修复方案：**
1. 扩展 `Product` 类型添加 `media?: ProductMedia[]`、`skus?: ProductSKU[]`
2. 扩展 `Company` 类型添加 `documents?: any[]`、`_count?: Record<string, number>`、`contact?: Record<string, string>`
3. 统一 `LoginResponse` 中的 `admin` 类型与 `AdminProfile` 定义，或在登录时做 mapping

### B-3 管理后台登录流程：Token 先存后验证（🔴 必修）✅

**文件：** `admin/src/pages/login/index.tsx:20-38`

**问题：** 登录成功后先调用 `setAuth(token, admin)` 存入 localStorage，再调用 `getProfile()`。如果 getProfile 失败，无效 Token 残留在存储中，后续请求循环 401。

**修复方案：** 先调 getProfile 验证 Token 有效，成功后再存入 Store。或在 setAuth 中原子化处理。

### B-4 VIP 上溯降级时 selfPurchaseCount 已递增（🟠 建议修）✅

**文件：** `backend/src/modules/bonus/engine/vip-upstream.service.ts:62-69`

**问题：** 当 `effectiveIndex > vipMaxLayers` 触发降级时，`selfPurchaseCount` 已经在事务中递增。这意味着第 16 单（超出 15 层限制）的计数被保留，后续解锁检查可能误触发。

**修复方案：** 将 `selfPurchaseCount` 递增操作移到分流判定之后，或在降级分支中减回。

---

## 批次三：性能与数据完整性 ✅ 已完成

> 影响系统性能或数据正确性

### P-1 买家端订单列表无分页（🔴 必修）✅

**文件：** `backend/src/modules/order/order.service.ts:48-62`

**问题：** `list()` 方法无 `take`/`skip` 参数，一次加载用户所有订单到内存。订单量大时 OOM。

**修复方案：** 添加 `page`/`pageSize` 参数，默认 `take: 20`，返回 `{ items, nextPage }` 分页结构。

### P-2 Admin 权限检查每请求查数据库（🟠 建议修）✅

**文件：** `backend/src/modules/admin/common/guards/permission.guard.ts:42-50`

**问题：** 每个 admin 端点都做 3 表 JOIN（adminUser → roles → permissions）查权限。频繁访问时性能差。

**修复方案：**
- 方案 A（推荐）：权限列表写入 JWT payload，登录/刷新时更新
- 方案 B：使用内存缓存（Map<adminUserId, permissions[]>），权限变更时失效

### P-3 Product.cost 为 null 时利润计算异常（🟠 建议修）✅

**文件：** `backend/src/modules/bonus/engine/reward-calculator.service.ts:36-44`

**问题：** `cost ?? 0` 将 null 成本视为 0，整个售价都被算作利润。分润金额可能异常偏高。

**修复方案：** 商品上架时要求 cost 必填，或 cost 为 null 时跳过分润（rewardPool = 0）并记录警告日志。

### P-4 merchantOrderNo 唯一性不可靠（🟡 低优先）✅

**文件：** `backend/src/modules/order/order.service.ts:252`

**问题：** `MO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` 在高并发下可能重复。

**修复方案：** 使用 `crypto.randomUUID()` 或数据库序列。

### P-5 SmsOtp 表无过期清理（🟡 低优先）✅

**文件：** 全局（无清理任务）

**问题：** 过期验证码永不删除，SmsOtp 表无限增长。

**修复方案：** 添加 `@Cron` 定时任务，每日清理 `expiresAt < now - 24h` 的记录。

---

## 批次四：管理后台前端修复 ✅ 已完成

> 管理后台 UI/交互/健壮性问题

### A-1 错误静默吞没（🟠 建议修）✅

**文件：**
- `admin/src/pages/products/edit.tsx:50-52` — catch 块空白
- `admin/src/pages/audit/index.tsx:36-40` — `handleViewDetail` 无 try-catch

**修复方案：** 所有异步操作添加 try-catch + `message.error()` 反馈。

### A-2 Modal 操作无 loading 状态（🟠 建议修）✅

**文件：** `admin/src/pages/products/index.tsx:37-44`

**问题：** 审核 Modal 按钮无 loading，用户可重复点击。

**修复方案：** 添加 `confirmLoading` 状态，操作期间禁用按钮。

### A-3 菜单权限过滤修改原引用（🟡 低优先）✅

**文件：** `admin/src/layouts/AdminLayout.tsx:112-123`

**问题：** `route.routes = filterMenuByPermission(route.routes)` 直接修改引用对象，每次 render 累积副作用。

**修复方案：** 深拷贝或使用 `useMemo` 缓存过滤结果。

### A-4 状态颜色/文字映射散布各页面（🟡 低优先）✅

**文件：** products/orders/companies/bonus/audit 等多个页面

**问题：** 订单状态、商品状态、审核状态等的颜色和文字映射在每个页面各写一份。

**修复方案：** 创建 `admin/src/constants/statusMaps.ts` 集中管理。

### A-5 Token 刷新机制缺失（🟡 低优先）✅

**文件：** `admin/src/api/client.ts` + `admin/src/api/auth.ts`

**问题：** `refreshToken` API 存在但从未接入 axios interceptor。Token 过期直接登出。

**修复方案：** 在 axios response interceptor 中拦截 401，尝试 refresh 后重试原请求。

### A-6 API baseURL 硬编码（🟡 低优先）✅

**文件：** `admin/src/api/client.ts:6`

**问题：** `baseURL: '/api/v1'` 依赖 Vite proxy，无法适配不同部署环境。

**修复方案：** 改为 `baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1'`。

---

## 批次五：买家 App 修复 ✅ 已完成

> 买家端功能/类型/健壮性问题

### M-1 Token 刷新逻辑缺失（🟠 建议修）✅

**文件：** `src/repos/http/ApiClient.ts`

**问题：** `AuthRepo` 有 `refreshToken` 方法但 `ApiClient` 未实现 401 → 刷新 → 重试。Token 过期后用户被静默踢出。

**修复方案：** 在 ApiClient 中检测 401 响应，调用 `AuthRepo.refreshToken()` 后重试原请求。

### M-2 CartRepo/AddressRepo void 类型强转（🟡 低优先）✅

**文件：** `src/repos/CartRepo.ts:79`、`src/repos/AddressRepo.ts:81`

**问题：** `undefined as unknown as void` 是 anti-pattern。

**修复方案：** 改为 `return simulateRequest(undefined as void, ...)` 或重构返回类型。

### M-3 Auth Token 使用 AsyncStorage（🟡 低优先）✅

**文件：** `src/store/useAuthStore.ts`

**问题：** AsyncStorage 不加密，Token 可被 root 设备读取。

**修复方案：** 生产环境替换为 `expo-secure-store`。

### M-4 checkout 引用未确认的 query key（🟡 低优先）✅ 已确认无问题

**文件：** `src/pages/checkout.tsx:69-71`

**问题：** `invalidateQueries({ queryKey: ['me-order-counts'] })` 和 `['me-order-issue']`，需确认这些 key 是否有对应 useQuery 调用。

**修复方案：** 审查所有 query key 使用，删除无效的 invalidation，或补充对应 query。

### M-5 语音录制功能未实现（🟡 已知 stub）⏭️ 跳过（依赖阶段五第三方服务）

**文件：** `app/(tabs)/home.tsx:75,82`

**问题：** AI 语音按钮的长按录音功能只有 TODO 注释。

**修复方案：** 接入 expo-av 录音 + 讯飞 STT 后实现（依赖阶段五第三方服务）。

---

## 批次六：代码质量与健壮性 ✅ 已完成

> 非阻断性改进

### Q-1 Admin Session 删除 vs 买家 Session 吊销不一致（🟡 低优先）✅

**文件：** `backend/src/modules/admin/auth/admin-auth.service.ts:129-131`

**问题：** Admin 刷新 Token 时直接 `delete` session，买家端是 `update status=REVOKED`。不一致影响审计追溯。

**修复方案：** 统一为 `update status=REVOKED` 模式。

### Q-2 分润回滚无审计日志（🟡 低优先）✅

**文件：** `backend/src/modules/bonus/engine/bonus-allocation.service.ts:126-223`

**问题：** 退款触发的 bonus rollback 不写 AdminAuditLog。

**修复方案：** 在 `rollbackForOrder` 中创建系统审计日志记录。

### Q-3 确认收货与退款并发竞态（🟡 低优先）✅

**文件：** `backend/src/modules/order/order.service.ts`

**问题：** `confirmReceive` 和 `applyAfterSale` 同时调用时，allocate 和 rollback 可能竞争。

**修复方案：** 通过订单状态的事务内检查确保互斥（状态变更在事务内原子完成，分润异步触发带幂等键保护）。

### Q-4 PLATFORM 特殊用户 ID 未抽常量（🟡 低优先）✅

**文件：** `normal-broadcast.service.ts:208`、`platform-split.service.ts` 等

**问题：** 字符串 `'PLATFORM'` 散布在多个文件中。

**修复方案：** 抽取为 `const PLATFORM_USER_ID = 'PLATFORM'` 到 `bonus/constants.ts`。

### Q-5 OrderItem.productSnapshot 不含 companyId（🟡 低优先）✅

**文件：** `backend/src/modules/order/order.service.ts:148-170`

**问题：** `productSnapshot` JSON 未包含 `companyId`，虽然 `OrderItem.companyId` 有独立字段。快照应自包含以便审计。

**修复方案：** 在 `productSnapshot` 中添加 `companyId` 字段。

---

## 批次七：可视化功能开发（新功能）

> 管理后台新增分润可视化模块，包含 VIP 分润树和普通奖励滑动窗口两个子页面

### V-1 VIP 分润树可视化（🟣 新功能）✅

**目标：** 管理员可搜索任意用户，以该用户为中心查看 VIP 三叉树结构，追溯每笔奖励的分配路径。

#### 整体布局：左右分栏

```
┌─────────────────────────────────────────────────────────────┐
│  🔍 搜索栏 (手机号/用户ID/昵称)                    [面包屑路径] │
├──────────────────────────────┬──────────────────────────────┤
│                              │                              │
│    🌳 可视化树区域（左 60%）    │   📋 详情面板（右 40%）        │
│                              │                              │
│    节点之间 SVG 贝塞尔曲线连线  │   点击任意节点 → 右侧展示     │
│    祖先→当前路径渐变高亮       │   该用户完整信息 + 操作        │
│                              │                              │
│      ┌─────┐                │   ┌──────────────────────┐   │
│      │ 父节点│                │   │ 头像 + 昵称 + VIP等级  │   │
│      └──┬──┘                │   │ 购买次数/累计收入/冻结  │   │
│         │                    │   ├──────────────────────┤   │
│      ┌──┴──┐                │   │ [收到奖励][发出奖励][订单]│   │
│      │★当前 │ ← 焦点高亮      │   │  ProTable 列表        │   │
│      └┬─┬─┬┘                │   ├──────────────────────┤   │
│       │ │ │                  │   │ [冻结] [调整VIP] [查看] │   │
│     ┌─┘ │ └─┐               │   └──────────────────────┘   │
│    ┌┴┐ ┌┴┐ ┌┴┐              │                              │
│    │子│ │子│ │子│              │                              │
│    └─┘ └─┘ └─┘              │                              │
└──────────────────────────────┴──────────────────────────────┘
```

#### 节点卡片设计

每个节点为胶囊卡片，信息密度高：

```
┌──────────────────────┐
│ 🟢 林青禾    VIP-3    │  ← 状态色(绿活跃/灰沉默/红冻结) + 昵称 + 等级徽章(铜银金钻)
│ 购3 │ ¥1,280 │ 👶×3  │  ← 购买次数 / 累计收入 / 子节点数
└──────────────────────┘
```

#### 交互设计

| 操作 | 效果 |
|------|------|
| **Hover 节点** | 微放大 + 阴影 + tooltip（手机号、注册时间） |
| **单击节点** | 右侧面板切换到该用户详情，树上节点高亮描边 |
| **双击节点** | 以该节点为中心重新加载树（300ms 过渡动画） |
| **展开子节点** | 点击节点底部 `▼` 按钮，子节点「滑落」出现 |
| **面包屑点击** | 跳转到对应祖先节点为中心的视图 |

#### 奖励流转追溯（亮点）

点击右侧面板中某笔奖励记录时，左侧树上动态高亮流转路径：
- 金色脉冲动画沿 SVG 连线方向流动，展示钱的流向
- 路径上标注每层分得金额
- CSS `@keyframes` 沿 SVG path offset 实现，无需额外库

#### 祖先路径展示

- 顶部面包屑：`A3(根) › 王建国(L1) › 张丽华(L2) › ★ 林青禾(L3)`
- 树区域内祖先→当前路径用渐变色连线高亮（浅蓝→深蓝），其他连线浅灰

#### 后端 API

```
GET /admin/bonus/vip-tree/context?userId=xxx&descendantDepth=1
→ { breadcrumb: [...], parent: {...}|null, current: {...}, children: [...] }

GET /admin/bonus/vip-tree/:nodeId/children?depth=1
→ { children: [...] }  // 懒加载子节点
```

节点数据结构：
```typescript
interface VipTreeNodeView {
  userId: string;
  nickname: string;
  phone: string;           // 脱敏 138****5678
  vipLevel: number;
  selfPurchaseCount: number;
  totalEarned: number;     // 累计收入
  frozenAmount: number;    // 冻结金额
  childCount: number;      // 子节点总数
  status: 'active' | 'silent' | 'frozen';  // 活跃/沉默/冻结
  children?: VipTreeNodeView[];             // 懒加载
}
```

#### 实现步骤

| 步骤 | 文件 | 内容 |
|------|------|------|
| V-1a | `backend/src/modules/admin/bonus/admin-bonus.service.ts` | 新增 `getVipTreeContext()` 和 `getVipTreeChildren()` 方法 |
| V-1b | `backend/src/modules/admin/bonus/admin-bonus.controller.ts` | 新增两个 GET 端点 |
| V-1c | `admin/src/api/bonus.ts` | 新增 `getVipTreeContext()` 和 `getVipTreeChildren()` API 调用 |
| V-1d | `admin/src/pages/bonus/vip-tree.tsx` | 主页面：搜索 + 左右分栏 + 树渲染 + 详情面板 |
| V-1e | `admin/src/pages/bonus/components/TreeNode.tsx` | 胶囊卡片组件（递归渲染） |
| V-1f | `admin/src/pages/bonus/components/TreeConnector.tsx` | SVG 连线 + 路径高亮 + 脉冲动画 |
| V-1g | `admin/src/pages/bonus/components/NodeDetail.tsx` | 右侧详情面板（统计卡片 + Tab 列表 + 操作按钮） |
| V-1h | 侧边栏菜单配置 | 在「分润管理」下新增「分润树」菜单项 |

---

### V-2 普通奖励滑动窗口可视化（🟣 新功能）✅

**目标：** 管理员可按档位查看滑动窗口内订单分布，点击任意订单查看奖励分配明细。

#### 布局设计

```
┌───────────────────────────────────────────────┐
│  💰 滑动窗口概览                    [刷新] [导出] │
├───────────┬───────────────────────────────────┤
│ 档位筛选   │  当前窗口 (最近20单)                 │
│           │                                   │
│ 🔵 0-99   │  ┌─┐┌─┐┌─┐┌─┐┌─┐ ... ┌─┐┌─┐    │
│ 🟢 100-499│  │█││█││▓││▓││░│     │█││▓│    │  ← 柱状图
│ 🟡 500-999│  └─┘└─┘└─┘└─┘└─┘ ... └─┘└─┘    │
│ 🟠 1k-5k  │  #81 #82 #83 #84 #85    #99#100 │
│ 🔴 5k+    │                                   │
│           │  Hover 柱子 → 显示订单金额          │
│  统计卡片:  │  点击柱子 → 下方展开分配详情        │
│  窗口总额   │                                   │
│  平均单价   ├───────────────────────────────────┤
│  分配总奖励  │  订单 #83 奖励分配详情:              │
│           │  金额: ¥350 → 窗口内前20单各分 ¥X.XX │
│           │  [分配列表 ProTable]                 │
└───────────┴───────────────────────────────────┘
```

#### 交互设计

| 操作 | 效果 |
|------|------|
| **切换档位** | 左侧 Radio 切换，右侧柱状图重新加载对应档位窗口 |
| **Hover 柱子** | 显示 tooltip：订单号、金额、下单时间 |
| **点击柱子** | 下方展开该订单的奖励分配明细表 |
| **导出** | 导出当前档位窗口数据为 CSV |

柱状图：高度 = 订单金额，颜色 = 档位颜色，@ant-design/charts Column 组件实现。

#### 后端 API

```
GET /admin/bonus/broadcast-window?bucket=100-499&page=1&pageSize=20
→ {
    bucketInfo: { range, totalOrders, totalAmount, totalReward },
    windowOrders: [{ orderId, amount, rewardDistributed, createdAt }],
    pagination: { total, page, pageSize }
  }

GET /admin/bonus/broadcast-window/:orderId/distributions
→ {
    order: { id, amount, buyerName },
    distributions: [{ recipientId, recipientName, amount, orderIndex }]
  }
```

#### 实现步骤

| 步骤 | 文件 | 内容 |
|------|------|------|
| V-2a | `backend/src/modules/admin/bonus/admin-bonus.service.ts` | 新增 `getBroadcastWindow()` 和 `getBroadcastDistributions()` |
| V-2b | `backend/src/modules/admin/bonus/admin-bonus.controller.ts` | 新增两个 GET 端点 |
| V-2c | `admin/src/api/bonus.ts` | 新增对应 API 调用 |
| V-2d | `admin/src/pages/bonus/broadcast-window.tsx` | 主页面：档位筛选 + 柱状图 + 分配详情 |
| V-2e | 侧边栏菜单配置 | 在「分润管理」下新增「滑动窗口」菜单项 |

---

### 技术选型

| 需求 | 方案 |
|------|------|
| 树形连线渲染 | CSS Flexbox 递归组件 + SVG 连线（三叉树固定结构，不需要 D3） |
| 流动粒子动画 | CSS `@keyframes` 沿 SVG path `offset-distance` 移动 |
| 过渡动画 | `framer-motion`（React 生态动画库，与 Ant Design 兼容） |
| 统计图表 | `@ant-design/charts`（项目已有，Column 柱状图） |
| 详情面板 | 固定分栏布局 + ProTable 列表 + ProDescriptions 详情 |

---

## 已知限制（暂不修复）

> 设计阶段性限制，等对应阶段实现时处理

| 编号 | 内容 | 依赖 |
|------|------|------|
| L-1 | AI 模块为 keyword stub | 阶段五：讯飞 SDK |
| L-2 | 支付为模拟实现 | 阶段五：微信支付/支付宝 |
| L-3 | 提现打款为占位 | 阶段五：支付渠道 |
| L-4 | 地图 SDK 占位 | 阶段五：高德 API |
| L-5 | 文件上传无 OSS | 阶段五：阿里云 OSS |
| L-6 | VipTreeNode 只种子 A1-A3 | 生产初始化脚本补全 |
| L-7 | 管理后台无 SKU/Media 管理 | 后续需求 |
| L-8 | 无 TraceEvent 管理端点 | 溯源批量导入待设计 |
| L-9 | Admin 无创建/删除企业端点 | 企业入驻流程待设计 |

---

## 修复与开发顺序总结

```
批次一（安全）→ 批次二（关键Bug）→ 批次三（性能）→ 批次四（管理后台）→ 批次五（买家App）→ 批次六（质量）→ 批次七（可视化）
   S-1~S-3       B-1~B-4          P-1~P-5         A-1~A-6           M-1~M-5           Q-1~Q-5        V-1~V-2
   约 3 项        约 4 项          约 5 项          约 6 项            约 5 项            约 5 项         约 2 项(13步)
```

**修改文件清单：**

| 文件 | 涉及问题 |
|------|----------|
| `backend/src/modules/auth/jwt.strategy.ts` | S-1 |
| `backend/src/modules/admin/common/strategies/admin-jwt.strategy.ts` | S-1 |
| `backend/src/main.ts` | S-2 |
| `backend/src/modules/admin/auth/admin-auth.controller.ts` | S-3 |
| `src/repos/OrderRepo.ts` | B-1 |
| `src/types/domain/Order.ts` | B-1 |
| `admin/src/types/index.ts` | B-2 |
| `admin/src/pages/login/index.tsx` | B-3 |
| `backend/src/modules/bonus/engine/vip-upstream.service.ts` | B-4 |
| `backend/src/modules/order/order.service.ts` | P-1, P-4 |
| `backend/src/modules/admin/common/guards/permission.guard.ts` | P-2 |
| `backend/src/modules/bonus/engine/reward-calculator.service.ts` | P-3 |
| `admin/src/pages/products/edit.tsx` | A-1 |
| `admin/src/pages/audit/index.tsx` | A-1 |
| `admin/src/pages/products/index.tsx` | A-2 |
| `admin/src/layouts/AdminLayout.tsx` | A-3 |
| `admin/src/api/client.ts` | A-5, A-6 |
| `src/repos/http/ApiClient.ts` | M-1 |
| `src/repos/CartRepo.ts` | M-2 |
| `src/repos/AddressRepo.ts` | M-2 |
| `src/store/useAuthStore.ts` | M-3 |
| `backend/src/modules/admin/auth/admin-auth.service.ts` | Q-1 |
| `backend/src/modules/bonus/engine/bonus-allocation.service.ts` | Q-2 |
| `backend/src/modules/admin/bonus/admin-bonus.service.ts` | V-1a, V-2a |
| `backend/src/modules/admin/bonus/admin-bonus.controller.ts` | V-1b, V-2b |
| `admin/src/api/bonus.ts` | V-1c, V-2c |
| `admin/src/pages/bonus/vip-tree.tsx` | V-1d |
| `admin/src/pages/bonus/components/TreeNode.tsx` | V-1e |
| `admin/src/pages/bonus/components/TreeConnector.tsx` | V-1f |
| `admin/src/pages/bonus/components/NodeDetail.tsx` | V-1g |
| `admin/src/pages/bonus/broadcast-window.tsx` | V-2d |
