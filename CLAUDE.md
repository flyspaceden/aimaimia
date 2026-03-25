# 爱买买 - AI赋能农业电商平台

## 项目概述
爱买买是一个 AI 赋能的农业电商平台，采用多商户入驻模式。包含买家 App（React Native）、卖家后台（React Web）和管理后台（React Web）。后端 NestJS 统一服务。

## 相关文档
- `data-system.md` — 完整数据库设计（9 大域，67 模型，41 枚举，**权威来源**）
- `backend.md` — 后端技术文档（API/模块/部署）
- `frontend.md` — 买家 App 前端设计文档（页面设计稿、组件规范、AI 视觉语言，**前端开发权威来源**）
- `sales.md` — 卖家系统设计文档（数据模型、API 设计、前端页面、业务流程，**卖家端开发权威来源**）
- `plan.md` — 项目路线图与进度追踪（**所有进度状态在这里更新**）
- `tofix-safe.md` — 安全与并发一致性问题追踪（**时序安全、竞态条件、数据一致性问题权威来源**）
- `security-audit.md` — 全面安全审计文档（认证/资金/API/隐私/基础设施/AI/多商户/监控，12 大维度）
- `plan-treeforuser.md` — 普通用户分润奖励系统改造计划（抽奖/普通树/自动定价/运费/换货，Phase A~G 已完成 + Phase H~L 新增，**普通用户系统改造权威来源**）
- `conflict1.md` — 后端全面审查冲突清单 v2（C/H/M/L 问题重评 + 管理端/卖家端新发现 + 需求引入新问题，**后端修复排程权威来源**）
- `new-features-design.md` — 五大新功能设计方案（F1 订单流程重构 / F2 赠品锁定 / F3 奖品过期 / F4 平台公司 / F5 奖励过期可配置，**新功能实现权威来源**）
- `普通用户红包分润系统.md` — 普通用户分润奖励系统需求原文（产品需求文档）
- `tofix-app-frontend.md` — 买家 App 前端交互问题清单与修复计划（20 CRITICAL + 32 HIGH + 39 MEDIUM + 30 LOW，**买家端前端修复排程权威来源**）
- `redpocket.md` — 平台红包（优惠券）系统完整设计方案（需求、数据模型、API、管理后台、买家App改造、实施步骤，**平台红包系统开发权威来源**）
- `tofix5.md` — 平台红包系统代码审查问题清单（2P0 + 7P1 + 4P2 + 3P3，含修复方案与执行顺序，**红包系统修复排程权威来源**）
- `tofix6.md` — 移除游客模式改造计划（认证二态统一、购物车本地化、抽奖公开化，F1-F14前端 + B1-B6后端，**游客模式移除排程权威来源**）
- `ai.md` — AI 语音助手集成方案（ASR 接入、意图识别、大模型选型、全链路架构、费用估算、升级路线，**AI 功能开发权威来源，所有 AI 相关计划/问题/进度均在此文档更新**）
- `seller.md` — 卖家系统完整设计方案（隐私保护策略、页面设计、安全架构、API 改造计划，**卖家系统开发权威来源，替代 sales.md 中的前端/隐私相关内容**）
- `invoice.md` — 发票申请功能完整设计方案（需求定义、预期结果、4 Phase 实施计划、API 设计、安全要求，**发票功能开发权威来源**）
- `docs/superpowers/specs/2026-03-15-semantic-intent-design.md` — 语义意图升级设计方案（槽位扩展、LLM 管道、数据模型、搜索评分、实施分期，**语义意图改造权威来源**）
- `test-reward.md` — 分润奖励系统商业模式盈利测试模型（资金流分析、解析模型、时序仿真设计、参数扫描、压力测试、报表设计，**分润系统盈利测试权威来源**）
- `docs/superpowers/specs/2026-03-20-vip-gift-multi-sku-design.md` — VIP 赠品多商品组合设计方案（数据模型、API、管理后台、买家App、迁移策略，**VIP赠品组合系统权威来源**）
- `docs/superpowers/plans/2026-03-20-vip-gift-multi-sku.md` — VIP 赠品多商品组合实施计划（15个任务、全栈改造，**VIP赠品组合实施排程**）
- `deployment.md` — 部署架构与运维手册（域名规划、Nginx 配置、服务器环境、部署步骤、商户入驻过渡流程、Bug 排查指南，**部署运维权威来源**）
- `docs/superpowers/specs/2026-03-24-merchant-onboarding-design.md` — 商户自助入驻功能设计方案（数据模型、API 设计、安全措施、管理后台改动、网站表单、审核自动化流程，**商户入驻功能开发权威来源**）
- `docs/superpowers/plans/2026-03-24-merchant-onboarding.md` — 商户自助入驻实施计划（8 个任务、Schema/Captcha/公开API/管理端/前端/网站/联调，**商户入驻实施排程**）

## 关键架构决策

**任何不确定的改动必须先向用户确认，不要自行猜测或创造**

| 决策 | 结论 |
|------|------|
| 分润奖励 vs 平台红包 | **两套完全独立的系统，严禁混淆**。分润奖励（Reward 体系：`RewardAccount`/`RewardLedger`/`VIP_REWARD`/`NORMAL_REWARD`）只能提现；平台红包（Coupon 体系：`CouponCampaign`/`CouponInstance`）只能结算抵扣。部分前端页面功能可沿用，部分不能 |
| 金额单位 | **Float / 元**（Prisma Schema 与前端一致，非 data-system.md 的 Int/分） |
| VIP 三叉树根节点 | **A1–A10 十个高管**，每棵独立子树，BFS 滑落插入 |
| 管理端认证隔离 | 独立 JWT Secret（`ADMIN_JWT_SECRET`）、独立 Passport Strategy（`admin-jwt`）、独立 Guard |
| 卖家端认证隔离 | 独立 JWT Secret（`SELLER_JWT_SECRET`）、独立 Passport Strategy（`seller-jwt`）、独立 Guard |
| 多商户模式 | `CompanyStaff` 关联表连接 User ↔ Company，角色分 OWNER / MANAGER / OPERATOR |
| 普通用户分润树 | 单棵树、单个平台根节点，轮询平衡插入（无推荐码），分配机制与VIP一致（k次消费→k层祖辈），利润六分（50/16/16/8/8/2） |
| VIP 利润公式 | **与普通用户统一为六分结构**（不再使用 rebatePool 两级分割）。VIP默认：50%平台/30%奖励/10%产业基金/2%慈善/2%科技/6%备用金。100% 利润显式分配，无隐性平台收入 |
| 普通/VIP系统隔离 | 两套独立参数（`NORMAL_*`/`VIP_*`前缀）、独立树结构、**统一六分利润结构但各自独立配比**、独立冻结过期天数 |
| 卖家自动定价 | 卖家设成本，售价=成本×MARKUP_RATE（默认1.3），奖励商品例外（管理员手动设价） |
| 订单流程 | **付款后才创建订单**：引入 CheckoutSession → 支付回调原子建单（PAID），无 PENDING_PAYMENT 状态 |
| 赠品锁定 | THRESHOLD_GIFT 入购物车锁定，按勾选非奖品商品总额实时解锁，解锁后自动包含在订单中 |
| 奖品过期 | 可配置过期时间（小时），从入购物车起算，wonCount 永不回退 |
| 平台公司 | 命名"爱买买app"，Company.isPlatform=true，奖品商品归属平台，用户搜索排除奖励商品 |
| 超卖容忍 | 允许库存变为负数，卖家收到补货通知，不退款 |
| 奖品不可退 | 清空购物车删奖品为预期行为，wonCount 永不回退，过期名额不释放 |
| VIP 赠品组合 | **一个赠品方案可包含多个商品**（VipGiftItem 子表，一对多）。封面图支持 4 种模式：宫格拼图（默认）/对角线分割/层叠卡片/自定义上传。价格自动计算 `Σ(sku.price × quantity)`，不存储冗余总价 |

## 技术栈

### 买家 App
React Native 0.81 + Expo 54 / expo-router 6 / TypeScript / Zustand / @tanstack/react-query / react-hook-form + zod / react-native-reanimated

### 卖家后台前端
Vite + React 19 + TypeScript / react-router-dom v7 / Ant Design 5 + @ant-design/pro-components / @tanstack/react-query / @ant-design/charts / Zustand

### 管理后台前端
Vite + React 19 + TypeScript / react-router-dom v7 / Ant Design 5 + @ant-design/pro-components / @tanstack/react-query / @ant-design/charts / Zustand

### 后端
NestJS + Prisma + PostgreSQL / Redis（队列/缓存） / 第三方服务均为占位实现（微信支付/支付宝/讯飞/高德/阿里云 OSS/SMS）

## 项目结构
```
app/                    # 买家 App 路由页面（expo-router 文件系统路由）
src/
  components/           # UI 组件（cards/feedback/forms/inputs/layout/overlay/ui）
  theme/                # 设计令牌（colors, spacing, radius, typography, shadow）
  types/domain/         # TypeScript 类型定义（每个业务实体一个文件）
  repos/                # Repository 层（16 个对接真实 API，3 个 AI Repo 为 Mock）
  store/                # Zustand 状态（useCartStore, useAuthStore）
  constants/            # 枚举常量
backend/
  prisma/               # Schema（67+ 模型 + 41+ 枚举）+ 种子数据
  src/modules/          # 买家端 20 模块 + 管理端 11 模块（admin/）+ 卖家端 7 模块（seller/）
seller/                 # 卖家后台前端（Vite + React + Ant Design）
admin/                  # 管理后台前端
```

## 开发规则

### Bug 修复纪律
- **同一个 Bug 修改不超过 2 次**：如果修了 2 次还没解决，**必须停止改代码**，转为仔细审查代码、分析根因、向用户说明真正原因，得到确认后才能动代码
- 禁止"试一试"式修复：每次改动前必须理解清楚问题的根本原因，不要猜测性地改代码

### 强制流程
1. **任何新需求先确认**：复述需求 → 提出修改建议 → 用户许可后才动代码
2. **每完成一个前端任务**：立即更新 `frontend.md`（标记对应 Section/组件完成状态）和 `plan.md`（更新 Batch 进度），告诉用户下一步是什么
3. **所有前端开发必须先调用 `/ui-ux-pro-max`**：获取设计指导后再写 UI 代码（买家 App + 管理后台均适用）
4. **Phase 完成前必须验证**：
   - 后端：`npx prisma validate` / TypeScript 编译 / API 测试
   - 前端：TypeScript 编译无错误 / 页面正常渲染
5. **对齐检查**：后端模块间关联正确，前端 Repo/Types 与后端 Schema/API 一致
6. **安全检查（每次代码变更必做）**：
   - 每次修改代码前，判断该改动是否涉及并发安全、资金操作、状态转换、认证鉴权等场景
   - 如涉及，对照 `tofix-safe.md` 末尾的「安全检查清单」逐项检查
   - 如发现新的安全/时序/竞态问题，立即追加到 `tofix-safe.md` 并告知用户
   - 如改动解决了已有的安全问题，更新 `tofix-safe.md` 中对应条目的状态为 ✅ 已修复
   - **涉及金额、库存、奖励、奖金、支付的代码变更必须使用 Serializable 隔离级别**
7. **文档同步（CLAUDE.md 是项目的单一入口）**：
   - 每次新建文档（`.md` 或其他说明文件）时，必须同步在 `CLAUDE.md` 的「相关文档」列表中添加该文档的路径、用途和权威范围
   - 项目发生版本迭代、架构变更、技术栈升级、关键决策变动时，必须及时更新 `CLAUDE.md` 中对应的段落（技术栈、架构决策、项目结构等）
   - `CLAUDE.md` 是所有新会话的唯一上下文入口——任何不在此文件中登记的文档等于不存在
8. **并行 Agent 执行**：
   - 执行任务时应积极使用多个 Agent 并行工作，提高效率
   - **前提条件**：并行的任务之间不能有文件冲突（不同 Agent 不能同时修改同一个文件）
   - 适合并行的场景：不同模块/不同文件的独立改动、前端与后端分离的任务、多个页面的独立修复
   - 不适合并行的场景：有依赖关系的任务（如 B 依赖 A 的输出）、修改同一文件的多个任务
9. **代码审查（每个任务完成后强制执行）**：
   - 每完成一个任务（Phase/功能模块/Bug修复），**必须**启动一个独立的审查 Agent（`subagent_type: Explore`）来检查本次所有改动
   - 审查 Agent **只读不写**：仅负责发现问题并返回结构化报告，不修改任何代码
   - 主 Agent 收到报告后，逐条评估问题严重性，修复所有 High/Critical 问题，对 Medium 问题说明处理决策（修复或保留及原因），Low 问题记录但可暂缓
   - **审查维度按系统类型区分**：

   **后端代码审查**：
   - Schema/模型：字段类型、关系双向声明、索引覆盖、枚举值完整性
   - 与计划文档（plan-treeforuser.md 等）逐字段交叉比对，报告所有偏差
   - 并发安全：金额/库存/奖励操作是否用 Serializable、CAS 是否在事务内、幂等键设计
   - 种子数据：数据格式与 Schema 字段类型一致、JSON 字段结构与业务代码预期一致、新增配置项完整
   - 业务逻辑：状态机转换合法性、利润分配比例总和校验、配置回退机制
   - TypeScript 编译 + Prisma validate 通过

   **买家 App 前端审查**：
   - TypeScript 类型与后端 API 响应一致（`src/types/domain/` ↔ 后端 DTO）
   - Repository 层方法签名与后端路由匹配（HTTP method + path + 参数）
   - Store 状态与新增字段同步（如 CartItem 新增奖品字段）
   - 组件：设计令牌使用正确、三态实现完整（Skeleton/Empty/Error）、无硬编码样式
   - 导航/路由：新页面在 app/ 下注册且 expo-router 文件路径正确

   **卖家后台 / 管理后台前端审查**：
   - API 层：请求路径和参数与后端 Controller 路由一致
   - ProTable/ProForm 列定义与后端返回字段匹配
   - 权限标识与后端 `@Permission()` 装饰器一致
   - 菜单/路由配置包含新页面入口

   **跨系统一致性审查**：
   - 枚举值三端一致（Schema 枚举 ↔ 前端 constants ↔ 后端 DTO）
   - 新增 API 端点在对应前端 Repo 中有调用方法
   - 文档（plan.md / data-system.md / tofix-safe.md 等）与代码实际状态同步

### 代码约定

**买家 App：**
- Repository 模式：`src/repos/` → 返回 `Result<T>` → 页面通过 React Query 调用
- 页面用 `<Screen>` 包裹，列表页实现三态（Skeleton/EmptyState/ErrorState）
- 样式用 `src/theme/` 设计令牌，主色调自然绿（#2E7D32）+ 科技蓝
- 文件名：组件 PascalCase，工具/常量 camelCase
- 代码注释使用中文

**管理后台：**
- 使用 ProTable / ProForm / ProLayout 覆盖管理界面
- `PermissionGate` 组件按权限控制 UI 显隐
- API 客户端统一 axios 实例，自动附加 admin JWT

**卖家后台：**
- 使用 ProTable / ProForm / ProLayout 覆盖卖家管理界面（与管理后台同技术栈）
- API 客户端统一 axios 实例，自动附加 seller JWT
- 所有数据查询强制 `companyId` 过滤，确保多商户数据隔离

**后端：**
- 管理端控制器用 `@Public()` 绕过全局买家 Guard，再显式 `@UseGuards(AdminAuthGuard, PermissionGuard)`
- 卖家端控制器用 `@Public()` 绕过全局买家 Guard，再显式 `@UseGuards(SellerAuthGuard, SellerRoleGuard)`
- 卖家端用 `@CurrentSeller()` 装饰器注入 `{ userId, companyId, staffId, role }`
- 写操作用 `@AuditLog()` 装饰器自动记录审计日志（before/after 快照）
- 超级管理员角色绕过所有权限检查

### 注意事项
- 地图 SDK / 支付 / AI 语音均为占位实现，不要删除，在其基础上迭代
- 管理后台超级管理员账号：`admin` / `admin123456`
