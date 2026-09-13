# 项目文档导航

本文件承接 AGENTS.md 的完整文档索引。以下路径均相对仓库根目录；按任务读取相关条目，不必全文加载。

## 阅读与维护规则

- 全局执行纪律见 `AGENTS.md`；本索引不授予 push、部署或数据变更权限。
- Schema/API/配置描述当前实现；已批准设计描述目标要求，实施计划描述步骤，报告和部署记录只证明对应版本。发现冲突先报告，不擅自改业务口径。
- 同一主题按文档明确的“补充/覆盖”范围阅读；日期较新不代表整份旧文档失效。
- 本索引从旧入口迁移；下文任务数、模型数、完成状态和接入状态是原摘要，不是当前验收证据，以对应文件及实际版本核实结果为准。
- 新增正式文档时登记路径、用途、适用范围和替代关系；临时日志、截图和中间产物不必登记。不要把完整目录重新复制到 AGENTS.md。
- 凭据和实际部署记录分别维护在本地忽略文件 `docs/operations/密码本.md`、`docs/operations/阿里云部署.md`；提交前核实忽略状态，其他文档仅用占位符。

## 原本地 staging 与 main 的差异（2026-09-12 核查）

- 原本地 staging 的 `operations/branch-strategy.md` 和 `operations/github操作.md` 仍含 staging 开发、整体合并及自动生产部署的旧叙述，与根 AGENTS.md 冲突。根文件的 main 基线、候选隔离及授权门禁继续生效；执行发布前核对目标 checkout 的 workflow 和远端配置。
- 原本地 staging 工作区未找到 `.github/workflows/deploy-release.yml`、`scripts/sync-staging-test-checkout.mjs`、`miniapp/`。这些路径在本次发布所基于的 origin/main 中存在；不要把旧 checkout 的缺失当作 main 状态；不得改用旧发布脚本或手动覆盖测试目录作为替代。
- 下方两个文档在原本地 staging 中缺失，但已确认存在于本次 origin/main 基线；按目标 checkout 阅读，不据引用推断已完成或获批。

## 最新 main 补充索引

- `docs/operations/fund-ledgers-staging-20260909.md` — 基金账本及三页体验优化的 staging-next 发布版本、CI 与实际页面验收记录（本次基金测试发布证据）
- `docs/superpowers/specs/2026-09-09-fund-management-pages-ux-design.md` — 资金管理三页结构、查询/详情/按付款状态操作设计（本次管理后台体验优化权威来源）
- `docs/superpowers/specs/2026-09-06-app-pickup-fulfillment-design.md` — App 普通/团购/VIP 自提接入设计、支付恢复与凭证边界（**App 自提接入权威来源，本地实现完成、真机待验收**）
- `docs/superpowers/plans/2026-09-06-app-pickup-fulfillment.md` — App 自提逐文件实施任务与验收矩阵（**App 自提实施排程，分层记录验证状态**）
- `docs/superpowers/reports/2026-09-07-app-pickup-system-reaudit.md` — App 自提二轮系统审查、VIP 激活补偿与真实数据库并发验证（**进入 CI/测试部署前的本地复审记录，不代替真机/线上验收**）
- `docs/superpowers/reports/2026-09-07-app-pickup-implementation-report.md` — App 自提实现、独立审查、本地测试与未完成真机/发布边界（**本次自提接入验证记录**）

## 补充入口与覆盖关系

- `docs/superpowers/specs/2026-06-17-digital-asset-v2-rules-design.md` — 数字资产 V2 规则，扩展累计消费第一版；对应实施计划 `docs/superpowers/plans/2026-06-17-digital-asset-v2-rules.md`。
- `docs/superpowers/specs/2026-06-21-digital-asset-frozen-credit-design.md` — 消费资产付款冻结、确认收货释放，覆盖 V2 中相应入账时点；对应计划 `docs/superpowers/plans/2026-06-21-digital-asset-frozen-credit.md`。
- `docs/superpowers/plans/2026-07-28-global-order-queue-reward.md` — 队列奖励的已确认规则与实施步骤；独立于普通树、VIP 树及直推，不代表生产启用状态。
- `docs/testing/code-review-checklist.md` — 各端代码审查维度，从原 AGENTS.md 移出。

## 分类索引

### 架构设计 (`docs/architecture/`)
- `docs/architecture/data-system.md` — 完整数据库设计（9 大域，67 模型，41 枚举，**权威来源**）
- `docs/architecture/backend.md` — 后端技术文档（API/模块/部署）
- `docs/architecture/frontend.md` — 买家 App 前端设计文档（页面设计稿、组件规范、AI 视觉语言，**前端开发权威来源**）
- `docs/architecture/sales.md` — 卖家系统设计文档（数据模型、API 设计、前端页面、业务流程，**卖家端开发权威来源**）
- `docs/architecture/seller.md` — 卖家系统完整设计方案（隐私保护策略、页面设计、安全架构、API 改造计划，**卖家系统开发权威来源，替代 sales.md 中的前端/隐私相关内容**）
- `docs/architecture/admin-frontend.md` — 管理后台前端
- `docs/architecture/responsive-design.md` — 买家 App 响应式适配规范（6 条核心原则 / `useResponsiveLayout`+`priceTextProps`+`fitTextProps` 工具集 / 新页面 Checklist / grep 审计黑名单 / 6 个真机测试场景，**响应式适配权威来源，新页面/Code Review/OTA 发布前必跑**）

### AI 功能 (`docs/ai/`)
- `docs/ai/ai.md` — AI 语音助手集成方案（ASR 接入、意图识别、大模型选型、全链路架构、费用估算、升级路线，**AI 功能开发权威来源，所有 AI 相关计划/问题/进度均在此文档更新**）
- `docs/ai/ai搜索.md` — AI 搜索功能设计

### 功能设计 (`docs/features/`)
- `docs/features/redpocket.md` — 平台红包（优惠券）系统完整设计方案（需求、数据模型、API、管理后台、买家App改造、实施步骤，**平台红包系统开发权威来源**）
- `docs/features/refund.md` — 退换货系统完整规则文档（四类售后类型、退货/换货窗口、运费承担、退款口径、法律依据、配置参数，**退换货业务规则权威来源**）
- `docs/features/invoice.md` — 发票申请功能基础设计方案（需求定义、预期结果、4 Phase 实施计划、API 设计、安全要求，**发票基础需求权威来源；链路收口 / 开票配置 / Provider / 状态历史以后续 superpowers spec 为准**）
- `docs/features/new-features-design.md` — 五大新功能设计方案（F1 订单流程重构 / F2 赠品锁定 / F3 奖品过期 / F4 平台公司 / F5 奖励过期可配置，**新功能实现权威来源**）
- `docs/features/buy-vip.md` — VIP 购买流程
- `docs/features/plan-treeforuser.md` — 普通用户分润奖励系统改造计划（抽奖/普通树/自动定价/运费/换货，Phase A~G 已完成 + Phase H~L 新增，**普通用户系统改造权威来源**）
- `docs/features/global-order-queue-reward.md` — 全平台订单队列奖励规则（统一队列、利润出资、N人滑动、大单拆位、内部待结算/双向售后作废、后台参数与示例，**订单队列奖励权威来源；独立于普通/VIP树和直推**）
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
- `docs/issues/app-tpfix1.md` — 2026-04-29 build-4-29.apk 真机测试发现的 9 个 bug 修复清单（账号绑定/图片/Tab/键盘/地址/弹窗/支付宝/消息路由/AI语音，含 file:line + 修复方案 + 部署批次，**真机测试 bug 修复排程权威来源**）
- `docs/issues/app-tofix2.md` — 2026-05-04 推荐链路全链路 Bug 修复清单（推荐码生成/扫码落地页/DDL/Universal Link/App Link/注册自动绑定，**推荐链路修复排程权威来源**）
- `docs/issues/app-tofix3.md` — 2026-05 顺丰物流链路真机/沙箱联调问题清单（物流骨架、电子面单、轨迹订阅、前端物流展示、沙箱/生产联调差异，**物流链路修复排程权威来源**）
- `docs/issues/app-tofix4.md` — 2026-05-07 商品/SKU 上下架引发的购物车、抽奖、结算级联 Bug 修复清单（奖品卡死、LotteryRecord 状态机、CheckoutSession 软排除、一次性数据修复 SQL，**商品上下架级联修复排程权威来源**）
- `docs/issues/普通用户分润后端问题.md` — 分润后端问题

### 安全与合规 (`docs/security/`)
- `docs/security/security-audit.md` — 全面安全审计文档（认证/资金/API/隐私/基础设施/AI/多商户/监控，12 大维度）
- `docs/security/电商法.md` — 电商法规参考

### 测试 (`docs/testing/`)
- `docs/testing/2026-04-15-webapp-test-plan.md` — Web 端自动化测试计划 v0.1（管理后台+卖家后台，Playwright，L0-L3 分层，7 条 critical path，5 阶段实施，**Web 端 E2E 测试权威来源**）

### 部署运维 (`docs/operations/`)
- `docs/operations/deployment.md` — 部署架构与运维手册（域名规划、Nginx 配置、服务器环境、部署步骤、商户入驻过渡流程、Bug 排查指南，**部署运维权威来源**）
- `docs/operations/阿里云部署.md` — 阿里云部署实施记录（服务器/域名/SSL/宝塔站点/PostgreSQL 实际配置 + 变更日志 + 常见问题，**实际部署状态权威来源，每次部署动作必须更新**）
- `docs/operations/branch-strategy.md` — Git 分支、候选版本、测试快照、生产主干、当前旧 staging/Delivery 无损收敛策略（**版本控制权威来源；main 是唯一长期基线，staging 不是开发主干**）
- `docs/operations/版本管理.md` — 开发/测试/生产环境实物清单、App/小程序/后台发布边界与版本号规范（**环境版本权威来源**）
- `docs/operations/github操作.md` — 干净 main-based worktree、候选 PR、staging 验收、manual exact-SHA production approval、hotfix 与回退操作（**Git 日常操作权威来源**）
- `docs/operations/staging-to-production.md` — 从测试环境切换到生产环境操作手册（main 发布、生产 env、第三方回调、数据库迁移、回滚、首次生产切换，**测试→生产切换执行权威来源**）
- `docs/operations/miniapp-production-integration-20260821.md` — 微信小程序、自提、微信提现、必要后台和推荐 H5 选择性进入生产的冻结基线、Delivery 排除边界、分批门禁与回滚清单（**本次小程序生产集成执行真相源**）
- `docs/operations/新手指南-部署机制详解.md` — 部署/CI/CD 系统全套概念解释（32 个 Q&A，从 workflow 路由到 App 测试，含 PM2/Nginx/Prisma migration/SSH 密钥/回滚/灰度等基础概念，**新手学习部署体系权威入门**）
- `docs/operations/app-compliance-guide.md` — App 上架合规指南（营业执照/ICP备案/软著/App备案/ICP证/应用商店上架全流程，**上架合规权威来源**）
- `docs/operations/app-发布与OTA手册.md` — App 发布与 OTA 操作手册（OTA vs Build 决策表、EAS 命令速查、推送前 checklist、当前 App 状态、回滚流程、测试人员分发，**App 维度操作权威来源**，每次 eas build / update 后必须更新第六章）
- `docs/operations/商户操作手册.md` — 商户端操作手册（企业入驻 + 登录 + 卖家中心全页面 + 商品/订单/售后/员工/账号安全全流程，**测试阶段商户操作权威来源**）

### 法律文本 (`docs/legal/`)
- `docs/legal/爱买买法律文本审核稿.docx` — 隐私政策 + 用户协议 Word 审核稿（由 `src/content/legal/*.ts` 原样导出，供法律顾问审核；权威原文仍是 `.ts` 源文件，源码变更后需重新导出）

### 参考资料 (`docs/reference/`)
- `docs/reference/apikey.md` — API 密钥说明
- `docs/reference/prompt-frontend-audit.md` — 前端审计 prompt
- `docs/reference/爱买买_项目框架说明.md` — 项目框架说明
- `docs/reference/phase1-9-全栈开发记录-Schema重建与模块实现.md` — 历史全栈开发记录

### 设计方案与实施计划 (`docs/superpowers/`)
- `docs/superpowers/specs/2026-04-23-forgot-password-design.md` — 忘记密码功能设计方案（买家 App 内嵌向导 + 卖家后台方案 β 按企业选择性重置 + 管理后台"联系超管"提示、三端密码独立、SmsPurpose 新增 BUYER_RESET/SELLER_RESET、verifyCode 必填 purpose、LoginEvent 审计 sink，**忘记密码功能权威来源**）
- `docs/superpowers/plans/2026-04-23-forgot-password.md` — 忘记密码实施计划（15 个任务：Schema × 1 + 后端 × 6 + 买家 App × 2 + 卖家后台 × 3 + 管理后台 × 1 + 文档 × 1 + 验收 × 1）
- `docs/superpowers/specs/2026-04-24-product-draft-design.md` — 卖家商品草稿设计方案（启用 `ProductStatus.DRAFT`、每商户 5 份上限、标题为最低门槛、30 秒 debounce 自动保存、DRAFT 在卖家默认列表/管理审核/商品总数统计中全部排除、提交时手动跑 `CreateProductDto` 校验、**商品草稿系统权威来源**）
- `docs/superpowers/plans/2026-04-24-product-draft.md` — 卖家商品草稿实施计划（9 个任务：后端 DTO/Service/Controller × 2 + 单测 × 1 + 前端 API/创建页/编辑页/列表页 × 4 + 文档 + 代码审查）
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
- `docs/superpowers/specs/2026-05-01-order-pages-redesign-design.md` — 订单页面重做设计方案（淘宝展开风列表 + 七区块详情 + 状态变色 + 未完成订单横幅 + 续付页 + checkout 防重锁 + 6001 改造，**买家 App 订单链路 UX 升级权威来源**）
- `docs/superpowers/plans/2026-05-01-order-pages-redesign.md` — 订单页面重做实施计划（32 任务，3 Phase：UI 重写+最小后端 / 后端剩余 DTO+横幅+续付链路 / buyerNote 字段。**Phase 1 已完成**）
- `docs/superpowers/specs/2026-05-08-order-repurchase-design.md` — 已完成订单再次购买设计方案（新增 `POST /orders/:id/repurchase`、普通商品批量回购物车、奖品/VIP 排除、部分成功提示，**订单复购功能权威来源**）
- `docs/superpowers/plans/2026-05-08-order-repurchase.md` — 已完成订单再次购买实施计划（后端复购接口 / 幂等限流 / 购物车合并 / App 按钮接入 / 验证清单，**订单复购实施排程**）
- `docs/superpowers/specs/2026-05-18-stock-aware-repurchase-low-stock-display-design.md` — 库存感知复购与低库存展示设计方案（复购低库存数量降级为 1 / 无库存虚拟提示且不真实入购物车 / App“仅剩 x 件”平台阈值，**复购库存与 App 低库存展示权威来源，补充并覆盖复购 spec 的库存口径**）
- `docs/superpowers/plans/2026-05-18-stock-aware-repurchase-low-stock-display.md` — 库存感知复购与低库存展示实施计划（后端库存裁决 / App 虚拟无库存提示 / 后台低库存阈值 / 售后库存回填，**库存体验与库存一致性实施排程**）
- `docs/superpowers/plans/2026-05-08-unshipped-order-cancel-refund.md` — PAID 未发货取消退款收尾实施计划（买家 App / 后端资金链路 / 卖家中心 / 管理后台 / 分润隔离 / 真机验证 / 文档同步，**未发货取消退款上线收口排程**）
- `docs/superpowers/specs/2026-05-09-after-sale-chain-closure-design.md` — 售后链路收口设计方案（基于现有 after-sale 主干，补齐 `NO_REASON_EXCHANGE`、顺丰退货面单、售后退款幂等、退款/售后状态历史、三端接线，**退款/退货/换货链路收口权威来源**）
- `docs/superpowers/plans/2026-05-09-after-sale-chain-closure.md` — 售后链路收口实施计划（Schema/后端退款与面单服务/三端前端/验证与文档同步，**退款/退货/换货链路实施排程**）
- `docs/superpowers/specs/2026-05-08-sf-style-shipping-pricing-design.md` — 顺丰风格平台统一运费计价设计方案（首重+续重公式、平台自定义价格、满额包邮、整单一次计费、SKU 重量补强、管理后台批量导入，**平台运费计价改造权威来源**）
- `docs/superpowers/plans/2026-05-08-sf-style-shipping-pricing.md` — 顺丰风格平台统一运费计价实施计划（Schema/运费引擎/Checkout 锁价/顺丰面单真实重量/`OrderShippingCost` 成本记录/管理后台/卖家 SKU 重量/文档同步，**平台运费计价实施排程**）
- `docs/superpowers/specs/2026-05-15-invoice-chain-closure-design.md` — 发票链路完整收口设计方案（开票内容配置、Mock Provider 适配器、买家/管理/卖家三端状态闭环、并发安全与状态历史，**发票链路收口 / Provider / 设置页 / 状态历史权威来源，补充并覆盖 `docs/features/invoice.md` 对应部分**）
- `docs/superpowers/plans/2026-05-15-invoice-chain-closure.md` — 发票链路完整收口实施计划（Schema/配置/买家申请取消/Mock Provider/管理后台设置与开票/买家 App 发票闭环/卖家隐私/验证与文档同步，**发票链路收口实施排程**）
- `docs/superpowers/specs/2026-05-19-reward-dual-track-design.md` — 消费积分双轨设计方案（Reward 余额同时支持支付宝提现与普通商品结算抵扣、默认提现代扣 20%、普通/VIP 抵扣比例 10%/15%、平台红包可叠加、VIP 礼包禁止抵扣，**消费积分提现/抵扣权威来源，替代旧支付宝实时提现单轨方案**）
- `docs/superpowers/plans/2026-05-19-reward-dual-track.md` — 消费积分双轨实施计划（Schema/提现服务/抵扣服务/支付宝转账与查询补偿/买家 App 钱包提现结算/管理后台规则与税务报送/验证与文档同步，**消费积分双轨实施排程**）
- `docs/superpowers/plans/2026-05-23-wechat-pay-integration.md` — 微信支付接入实施计划（WechatPayService 全套含 createAppOrder/refund/queryRefund/parseNotify/queryOrder/closeOrder / 退款 pending 二态 / raw body 验签的 wechat notify / confirmCheckout channel dispatch / cancel/expire 关单 / 售后退货运费支付与退款微信全链路 / 未发货取消退款 pending 闭环 / Android WXPayEntryActivity / App checkout 普通+VIP+续付+Pending Banner+售后详情 / admin 订单详情中文标签 / available 开关和隐私政策条件触发，**微信支付接入实施排程，支付宝行为不变 + 资金链路安全 + Android-only v1.0**）
- `docs/superpowers/specs/2026-06-04-account-deletion-immediate-design.md` — 账号注销即时版设计方案（注销前阻止企业负责人、支付中结算、支付处理中、提现处理中和非 ACTIVE 账号；已付款订单/售后继续履约并依法保留，注销后立即不可恢复，消费积分/红包/VIP/抽奖权益作废，手机号/微信登录标识释放，订单/支付/退款/发票/审计依法保留，**账号注销功能权威来源**）
- `docs/superpowers/plans/2026-06-04-account-deletion-immediate.md` — 账号注销即时版实施计划（Schema/后端注销模块/AuthIdentity 释放/JWT 拦截/推荐与分润保护/买家 App 注销页/法律文本/验证清单，**账号注销实施排程**）
- `docs/superpowers/specs/2026-06-14-digital-asset-cumulative-spend-design.md` — 数字资产累计消费设计方案（独立 `DigitalAssetAccount`/`DigitalAssetLedger` 账户+流水；确认收货后按商品实付金额入账，退款/退货成功扣回，VIP 礼包计入，历史 `RECEIVED` 订单回填；买家 App 数字资产中心雏形 + 管理后台完整数字资产管理页，**数字资产累计消费权威来源**）
- `docs/superpowers/plans/2026-06-14-digital-asset-cumulative-spend.md` — 数字资产累计消费实施计划（Schema/核心记账服务/订单与退款接入/历史回填/买家 App 数字资产中心/管理后台数字资产页/安全验证拆分，**数字资产累计消费实施排程**）
- `docs/superpowers/specs/2026-06-15-buyer-public-id-design.md` — 买家公开编号设计方案（新增 `buyerNo=AIMM+14位数字`，保留内部 `User.id`；历史买家按注册时间回填；App 我的页展示复制；管理后台/卖家中心展示、复制和搜索，**买家公开编号权威来源**）
- `docs/superpowers/plans/2026-06-15-buyer-public-id.md` — 买家公开编号实施计划（Schema/sequence/回填脚本、买家 Auth 接入、App 我的页复制按钮、管理后台全页展示搜索、卖家中心隐私边界内展示搜索、验证与发布文档，**买家公开编号实施排程**）
- `docs/superpowers/specs/2026-05-18-large-text-virtual-nav-design.md` — 买家 App 大字体 / 显示大小 / Android 虚拟导航键 / iOS Dynamic Type 二轮适配设计方案（P0 支付成功逃生、P1 购物闭环、P2 全 App 巡检，**App 响应式二轮治理权威来源，补充 `docs/architecture/responsive-design.md`**）
- `docs/superpowers/plans/2026-05-18-large-text-virtual-nav.md` — 买家 App 大字体 / 显示大小 / Android 虚拟导航键 / iOS Dynamic Type 二轮适配实施计划（P0 支付成功、P1 购物闭环、P2 审计与 OTA 验证，**App 响应式二轮治理实施排程**）

### 审查报告 (`docs/superpowers/reports/`)
- `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md` — v1.0 上线链路审查报告（17 条链路 + 6 项横切关注点，30 个 T1 阻塞 + 48 个 T2 待补，**上线决策权威来源**）
- `docs/superpowers/reports/2026-04-11-drafts/` — 审查中间 draft 目录（18 个 draft 文件，按 L01-L17 + X1-X6 编号，每条链路的详细审查证据）

### 项目管理（根目录）
- `plan.md` — v1.0 上线冲刺路线图（6 批次 + 54 条 checkbox 待修 + 48 条 T2 + 17 条疑点，**活文档：每次修完打勾+每次新需求追加**）
- `docs/reference/plan-history-2026Q1.md` — 历史开发记录归档（Phase 1-10 全栈开发记录，2026-02 至 2026-03）

