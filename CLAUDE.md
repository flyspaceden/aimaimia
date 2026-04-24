# 爱买买 - AI赋能农业电商平台

## 项目概述
爱买买是一个 AI 赋能的农业电商平台，采用多商户入驻模式。包含买家 App（React Native）、卖家后台（React Web）和管理后台（React Web）。后端 NestJS 统一服务。

## 相关文档

### 架构设计 (`docs/architecture/`)
- `docs/architecture/data-system.md` — 完整数据库设计（9 大域，67 模型，41 枚举，**权威来源**）
- `docs/architecture/backend.md` — 后端技术文档（API/模块/部署）
- `docs/architecture/frontend.md` — 买家 App 前端设计文档（页面设计稿、组件规范、AI 视觉语言，**前端开发权威来源**）
- `docs/architecture/sales.md` — 卖家系统设计文档（数据模型、API 设计、前端页面、业务流程，**卖家端开发权威来源**）
- `docs/architecture/seller.md` — 卖家系统完整设计方案（隐私保护策略、页面设计、安全架构、API 改造计划，**卖家系统开发权威来源，替代 sales.md 中的前端/隐私相关内容**）
- `docs/architecture/admin-frontend.md` — 管理后台前端

### AI 功能 (`docs/ai/`)
- `docs/ai/ai.md` — AI 语音助手集成方案（ASR 接入、意图识别、大模型选型、全链路架构、费用估算、升级路线，**AI 功能开发权威来源，所有 AI 相关计划/问题/进度均在此文档更新**）
- `docs/ai/ai搜索.md` — AI 搜索功能设计

### 功能设计 (`docs/features/`)
- `docs/features/redpocket.md` — 平台红包（优惠券）系统完整设计方案（需求、数据模型、API、管理后台、买家App改造、实施步骤，**平台红包系统开发权威来源**）
- `docs/features/refund.md` — 退换货系统完整规则文档（23条规则 + 2个附录、法律依据、配置参数，**退换货业务规则权威来源**）
- `docs/features/invoice.md` — 发票申请功能完整设计方案（需求定义、预期结果、4 Phase 实施计划、API 设计、安全要求，**发票功能开发权威来源**）
- `docs/features/new-features-design.md` — 五大新功能设计方案（F1 订单流程重构 / F2 赠品锁定 / F3 奖品过期 / F4 平台公司 / F5 奖励过期可配置，**新功能实现权威来源**）
- `docs/features/buy-vip.md` — VIP 购买流程
- `docs/features/plan-treeforuser.md` — 普通用户分润奖励系统改造计划（抽奖/普通树/自动定价/运费/换货，Phase A~G 已完成 + Phase H~L 新增，**普通用户系统改造权威来源**）
- `docs/features/test-reward.md` — 分润奖励系统商业模式盈利测试模型（资金流分析、解析模型、时序仿真设计、参数扫描、压力测试、报表设计，**分润系统盈利测试权威来源**）
- `docs/features/admin-tree-frontend.md` — 管理端树前端
- `docs/features/普通用户红包分润系统.md` — 普通用户分润奖励系统需求原文（产品需求文档）
- `docs/features/shipping.md` — 快递物流链路实施文档（顺丰丰桥直连已完成，含顺丰月结+API申请流程、迁移记录、代码路径速查，**快递链路开发权威来源**）
- `docs/features/支付宝支付.md` — 支付宝收款与付款集成方案（收款现状、分润出款商家转账方案、法律合规、个税代扣代缴、涉税报送、实施路线图，**支付宝支付/分润出款通道权威来源**）
- `docs/features/智能客服.md` — 智能客服系统完整文档（三层路由、8个数据模型、Socket.IO事件清单、买家App+管理后台用户流程、跨系统数据流、bug修复历史、144个测试用例、待优化项、配置项与上线检查清单、常见问题排查，**智能客服系统运维与开发权威来源，每次客服bug/优化必须同步更新**）

### 问题追踪 (`docs/issues/`)
- `docs/issues/tofix-safe.md` — 安全与并发一致性问题追踪（**时序安全、竞态条件、数据一致性问题权威来源**）
- `docs/issues/tofix-app-frontend.md` — 买家 App 前端交互问题清单与修复计划（20 CRITICAL + 32 HIGH + 39 MEDIUM + 30 LOW，**买家端前端修复排程权威来源**）
- `docs/issues/tofix5.md` — 平台红包系统代码审查问题清单（2P0 + 7P1 + 4P2 + 3P3，含修复方案与执行顺序，**红包系统修复排程权威来源**）
- `docs/issues/tofix6.md` — 移除游客模式改造计划（认证二态统一、购物车本地化、抽奖公开化，F1-F14前端 + B1-B6后端，**游客模式移除排程权威来源**）
- `docs/issues/conflict1.md` — 后端全面审查冲突清单 v2（C/H/M/L 问题重评 + 管理端/卖家端新发现 + 需求引入新问题，**后端修复排程权威来源**）
- `docs/issues/tofix.md` ~ `docs/issues/tofix7.md` — 各轮代码审查问题清单
- `docs/issues/普通用户分润后端问题.md` — 分润后端问题

### 安全与合规 (`docs/security/`)
- `docs/security/security-audit.md` — 全面安全审计文档（认证/资金/API/隐私/基础设施/AI/多商户/监控，12 大维度）
- `docs/security/电商法.md` — 电商法规参考

### 测试 (`docs/testing/`)
- `docs/testing/2026-04-15-webapp-test-plan.md` — Web 端自动化测试计划 v0.1（管理后台+卖家后台，Playwright，L0-L3 分层，7 条 critical path，5 阶段实施，**Web 端 E2E 测试权威来源**）

### 部署运维 (`docs/operations/`)
- `docs/operations/deployment.md` — 部署架构与运维手册（域名规划、Nginx 配置、服务器环境、部署步骤、商户入驻过渡流程、Bug 排查指南，**部署运维权威来源**）
- `docs/operations/阿里云部署.md` — 阿里云部署实施记录（服务器/域名/SSL/宝塔站点/PostgreSQL 实际配置 + 数据库凭据 + 变更日志 + 常见问题，**实际部署状态权威来源，每次部署动作必须更新**）
- `docs/operations/版本管理.md` — 版本管理指南（Git 分支策略 dev/staging/main、阿里云双环境规划、GitHub Actions 自动部署规则、App 三阶段发布流程、版本号规范，**版本管理权威来源**）
- `docs/operations/github操作.md` — GitHub 日常操作指南（双分支 staging/main 发布流程、自动部署规则、手动触发、紧急场景速查，**测试→生产发布权威来源**）
- `docs/operations/新手指南-部署机制详解.md` — 部署/CI/CD 系统全套概念解释（32 个 Q&A，从 workflow 路由到 App 测试，含 PM2/Nginx/Prisma migration/SSH 密钥/回滚/灰度等基础概念，**新手学习部署体系权威入门**）
- `docs/operations/app-compliance-guide.md` — App 上架合规指南（营业执照/ICP备案/软著/App备案/ICP证/应用商店上架全流程，**上架合规权威来源**）
- `docs/operations/商户操作手册.md` — 商户端操作手册（企业入驻 + 登录 + 卖家中心全页面 + 商品/订单/售后/员工/账号安全全流程，**测试阶段商户操作权威来源**）

### 参考资料 (`docs/reference/`)
- `docs/reference/apikey.md` — API 密钥说明
- `docs/reference/prompt-frontend-audit.md` — 前端审计 prompt
- `docs/reference/爱买买_项目框架说明.md` — 项目框架说明
- `docs/reference/phase1-9-全栈开发记录-Schema重建与模块实现.md` — 历史全栈开发记录

### 设计方案与实施计划 (`docs/superpowers/`)
- `docs/superpowers/specs/2026-04-23-forgot-password-design.md` — 忘记密码功能设计方案（买家 App 内嵌向导 + 卖家后台方案 β 按企业选择性重置 + 管理后台"联系超管"提示、三端密码独立、SmsPurpose 新增 BUYER_RESET/SELLER_RESET、verifyCode 必填 purpose、LoginEvent 审计 sink，**忘记密码功能权威来源**）
- `docs/superpowers/plans/2026-04-23-forgot-password.md` — 忘记密码实施计划（15 个任务：Schema × 1 + 后端 × 6 + 买家 App × 2 + 卖家后台 × 3 + 管理后台 × 1 + 文档 × 1 + 验收 × 1）
- `docs/superpowers/specs/2026-03-15-semantic-intent-design.md` — 语义意图升级设计方案（槽位扩展、LLM 管道、数据模型、搜索评分、实施分期，**语义意图改造权威来源**）
- `docs/superpowers/specs/2026-03-20-vip-gift-multi-sku-design.md` — VIP 赠品多商品组合设计方案（数据模型、API、管理后台、买家App、迁移策略，**VIP赠品组合系统权威来源**）
- `docs/superpowers/plans/2026-03-20-vip-gift-multi-sku.md` — VIP 赠品多商品组合实施计划（15个任务、全栈改造，**VIP赠品组合实施排程**）
- `docs/superpowers/specs/2026-03-24-merchant-onboarding-design.md` — 商户自助入驻功能设计方案（数据模型、API 设计、安全措施、管理后台改动、网站表单、审核自动化流程，**商户入驻功能开发权威来源**）
- `docs/superpowers/plans/2026-03-24-merchant-onboarding.md` — 商户自助入驻实施计划（8 个任务、Schema/Captcha/公开API/管理端/前端/网站/联调，**商户入驻实施排程**）
- `docs/superpowers/specs/2026-03-26-vip-multi-package-design.md` — VIP 多档位礼包设计方案（VipPackage 数据模型、多价格结账、按比例推荐奖励、管理后台档位管理、买家App档位选择，**VIP 多档位系统权威来源**）
- `docs/superpowers/plans/2026-03-26-vip-multi-package.md` — VIP 多档位礼包实施计划（12 个任务、Schema/Seed/CRUD/结账/奖励/配置清理/管理前端/买家App，**VIP 多档位实施排程**）
- `docs/superpowers/specs/2026-03-27-deferred-deep-link-design.md` — 延迟深度链接设计方案（推荐码全链路无感知传递、Cookie+指纹双层匹配、落地页、Universal Link、换绑逻辑、域名统一，**推荐码深度链接系统权威来源**）
- `docs/superpowers/plans/2026-03-27-deferred-deep-link.md` — 延迟深度链接实施计划（13 个任务、Schema/后端模块/换绑/域名统一/网站落地页/App端匹配/部署配置，**推荐码深度链接实施排程**）
- `docs/superpowers/specs/2026-03-27-configurable-tag-system-design.md` — 可配置标签系统设计方案（TagCategory+Tag+CompanyTag 数据模型、管理后台标签管理页、企业/商品标签动态配置、数据迁移策略，**标签系统权威来源**）
- `docs/superpowers/plans/2026-03-27-configurable-tag-system.md` — 可配置标签系统实施计划（13 个任务、Schema/Seed/管理CRUD/公开API/企业标签/卖家标签/商品标签/管理前端/卖家前端/清理，**标签系统实施排程**）
- `docs/superpowers/specs/2026-03-28-discovery-filter-design.md` — 发现页企业筛选栏动态化设计方案（配置数据模型、管理后台页面、App端动态加载、管理端商品标签编辑，**发现页筛选配置权威来源**）
- `docs/superpowers/plans/2026-03-28-discovery-filter.md` — 发现页企业筛选栏动态化实施计划（8个任务、后端配置/公开API/管理前端/拖拽排序/App端动态化/Mock同步，**发现页筛选实施排程**）
- `docs/superpowers/specs/2026-03-30-unified-after-sale-design.md` — 统一退换货系统设计方案（数据模型、状态机、统一售后API、分润冻结、退款计算、超时Cron、三端改造，**退换货系统权威来源**）
- `docs/superpowers/specs/2026-03-30-unified-after-sale-test-plan.md` — 统一退换货系统测试方案（58个测试用例、单元/集成/API/端到端/并发/边界/回归，**退换货系统测试权威来源**）
- `docs/superpowers/plans/2026-03-30-unified-after-sale.md` — 统一退换货系统实施计划（17个任务、Schema/后端6模块/前端3端/Cron/测试，**退换货系统实施排程**）
- `docs/superpowers/specs/2026-04-08-intelligent-customer-service-design.md` — 智能客服系统设计方案（三层路由、8个数据模型、Socket.IO实时通讯、管理后台6页面、买家App客服页、后端模块结构，**智能客服系统权威来源**）
- `docs/superpowers/plans/2026-04-08-intelligent-customer-service.md` — 智能客服系统实施计划（17个任务、Schema/后端7服务/Socket.IO Gateway/管理前端7页面/买家App组件/种子数据，**智能客服系统实施排程**）

### 审查报告 (`docs/superpowers/reports/`)
- `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md` — v1.0 上线链路审查报告（17 条链路 + 6 项横切关注点，30 个 T1 阻塞 + 48 个 T2 待补，**上线决策权威来源**）
- `docs/superpowers/reports/2026-04-11-drafts/` — 审查中间 draft 目录（18 个 draft 文件，按 L01-L17 + X1-X6 编号，每条链路的详细审查证据）

### 项目管理（根目录）
- `plan.md` — v1.0 上线冲刺路线图（6 批次 + 54 条 checkbox 待修 + 48 条 T2 + 17 条疑点，**活文档：每次修完打勾+每次新需求追加**）
- `docs/reference/plan-history-2026Q1.md` — 历史开发记录归档（Phase 1-10 全栈开发记录，2026-02 至 2026-03）

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
2. **每完成一个前端任务**：立即更新 `docs/architecture/frontend.md`（标记对应 Section/组件完成状态）和 `plan.md`（更新 Batch 进度），告诉用户下一步是什么
3. **所有前端开发必须先调用 `/ui-ux-pro-max`**：获取设计指导后再写 UI 代码（买家 App + 管理后台均适用）
4. **Phase 完成前必须验证**：
   - 后端：`npx prisma validate` / TypeScript 编译 / API 测试
   - 前端：TypeScript 编译无错误 / 页面正常渲染
5. **对齐检查**：后端模块间关联正确，前端 Repo/Types 与后端 Schema/API 一致
6. **安全检查（每次代码变更必做）**：
   - 每次修改代码前，判断该改动是否涉及并发安全、资金操作、状态转换、认证鉴权等场景
   - 如涉及，对照 `docs/issues/tofix-safe.md` 末尾的「安全检查清单」逐项检查
   - 如发现新的安全/时序/竞态问题，立即追加到 `docs/issues/tofix-safe.md` 并告知用户
   - 如改动解决了已有的安全问题，更新 `docs/issues/tofix-safe.md` 中对应条目的状态为 ✅ 已修复
   - **涉及金额、库存、奖励、奖金、支付的代码变更必须使用 Serializable 隔离级别**
7. **文档同步（CLAUDE.md 是项目的单一入口）**：
   - 每次新建文档（`.md` 或其他说明文件）时，必须同步在 `CLAUDE.md` 的「相关文档」列表中添加该文档的路径、用途和权威范围
   - 项目发生版本迭代、架构变更、技术栈升级、关键决策变动时，必须及时更新 `CLAUDE.md` 中对应的段落（技术栈、架构决策、项目结构等）
   - `CLAUDE.md` 是所有新会话的唯一上下文入口——任何不在此文件中登记的文档等于不存在
   - **凭据集中管理**：任何涉及密码、密钥、API Key、Token、证书路径、账号等敏感凭据的新增 / 变更（数据库密码、JWT Secret、第三方服务 Key、管理员账号修改等），**必须立即更新 `docs/operations/密码本.md`**（已 gitignore，仅本地保留）。其他文档只能用占位符引用（如 `<TEST_DB_PASSWORD>` / `<ALIPAY_APP_PRIVATE_KEY>`），严禁明文写入任何会被 commit 的文件
   - **部署动作记录**：任何在阿里云 / 宝塔 / 服务器上的实际部署动作（新建站点、申请证书、改 Nginx、装服务、数据库变更、PM2 进程变化、第三方回调地址改动等）必须立即更新 `docs/operations/阿里云部署.md`（已 gitignore）
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
   - 与计划文档（docs/features/plan-treeforuser.md 等）逐字段交叉比对，报告所有偏差
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
   - 文档（plan.md / docs/architecture/data-system.md / docs/issues/tofix-safe.md 等）与代码实际状态同步

10. **推送 GitHub 前必须向用户确认 + 保持版本可回退**：
    - **不自动推送**：代码改完可以先本地 commit，但 `git push` 必须先向用户复述改动内容 + 询问是否推送。用户明确说"推 / push / 上测试 / 上生产"才执行
    - **App（`app/` 下）OTA 同样要先问**：push 只触发 GitHub Actions（workflow 中没有 app 部署，见 `.github/workflows/deploy-website.yml`），买家 App 上线必须走 EAS，是否发 OTA 由用户决定
    - **版本回退友好**：
      - 一个逻辑改动一个 commit，禁止把不相关改动塞一起（线上出事才能只 revert 一项）
      - commit message 沿用 `type(scope): 描述` 风格（如 `fix(admin/companies): xxx`）方便日后定位
      - 推 `main` 前主动告诉用户回滚路径（`git revert <SHA> && git push`）
      - **破坏性改动醒目提醒**：数据库 migration（`backend/prisma/migrations/` —— 注意 workflow 里 backend 部署会自动跑 `prisma migrate deploy`，回滚需手写反向 SQL）、删字段、改枚举值、改利润公式等，推送前必须用显著提示告知用户"此改动回滚需额外步骤"，不能只说一句 push 了
    - **具体操作规则不在此重复**，以下文件为真相源：
      - `.github/workflows/deploy-website.yml` — 分支路由、触发路径、部署产物、migrate deploy 时机
      - `docs/operations/github操作.md` — 双分支发布流程、紧急场景
      - `docs/operations/版本管理.md` — App 三阶段发布 + OTA

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
- **🚫 禁止静态 `message` / `Modal.confirm` / `notification`**：`admin/src/main.tsx` 用 `<AntdApp>` 包裹整棵树，antd v5 的静态方法在此场景下会静默失效（点击无反应，toast 不弹）。**必须**在组件内通过 `const { message, modal, notification } = App.useApp();` 拿 hook 实例；`Modal.confirm(...)` → `modal.confirm(...)`；`<Modal>` JSX 组件可以正常用。反面案例：`bonus/vip-config.tsx` / `bonus/normal-config.tsx` 保存按钮无反应（2026-04-21 修复）

**卖家后台：**
- 使用 ProTable / ProForm / ProLayout 覆盖卖家管理界面（与管理后台同技术栈）
- API 客户端统一 axios 实例，自动附加 seller JWT
- 所有数据查询强制 `companyId` 过滤，确保多商户数据隔离
- **🚫 同样禁止静态 `message` / `Modal.confirm` / `notification`**：`seller/src/App.tsx` 同样用了 `<AntdApp>`（cc8146e），规则同上

**后端：**
- 管理端控制器用 `@Public()` 绕过全局买家 Guard，再显式 `@UseGuards(AdminAuthGuard, PermissionGuard)`
- 卖家端控制器用 `@Public()` 绕过全局买家 Guard，再显式 `@UseGuards(SellerAuthGuard, SellerRoleGuard)`
- 卖家端用 `@CurrentSeller()` 装饰器注入 `{ userId, companyId, staffId, role }`
- 写操作用 `@AuditLog()` 装饰器自动记录审计日志（before/after 快照）
- 超级管理员角色绕过所有权限检查

### 注意事项
- 地图 SDK / 支付 / AI 语音均为占位实现，不要删除，在其基础上迭代
- 管理后台超级管理员账号：`admin` / `123456`

### 服务器部署架构（Node 直装 + PM2）
生产 + 测试服务器宿主机：**Alibaba Cloud Linux 3**（2026-04-18 由 CentOS 7 替换，原因：CentOS 7 EOL + glibc 2.17 太老导致现代 npm 包反复踩坑）。

宿主机直接运行：
- Nginx（反向代理 + SSL，宝塔管理）
- PostgreSQL 18（数据库，宝塔安装）
- Redis 7.x（队列/缓存，宝塔安装）
- Node 20 + PM2（NestJS 后端进程，NodeSource 官方源直装，glibc 无障碍）

**所有 npm 包用最新版本**，无需任何降级或兼容补丁。不再使用 Docker（业务 v1.0 未上线，无必要引入容器化复杂度）。

详细部署流程 + 换 OS 重建清单见 `docs/operations/阿里云部署.md`。
