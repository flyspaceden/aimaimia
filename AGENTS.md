# 爱买买 — 项目执行规则

多商户农业电商平台：买家 App、微信小程序、卖家后台、管理后台，共用 NestJS 后端。
本文件保留全局纪律、业务边界及文档入口；完整索引见 `docs/README.md`，按任务读取。

## 1. 执行纪律

- 新需求先复述范围并提出方案；用户已明确授权的范围不重复确认。业务规则、资金口径、数据删除或发布范围不明确时必须确认；普通实现细节遵循现有约定。
- 先读相关代码与设计，再修改。禁止猜测性修复；同一 Bug 连续两次修复失败后停止改代码，分析根因并向用户说明，得到确认后再继续。
- 保留用户已有修改，不覆盖、不夹带无关改动。范围扩大需确认；历史数据迁移、回填和重算须有明确授权。
- 独立且不冲突的任务可并行；不同 Agent 不同时修改同一文件，有依赖的步骤顺序执行。
- 每项实现完成后进行独立只读 Agent 审查；主 Agent 复核并修复 High/Critical，说明 Medium 的处理决策，Low 可记录暂缓。工具不可用时明确报告审查缺口，不宣称完成独立审查。
- 凭据不得写入可提交文件。新增或变更凭据及时更新本地 `docs/operations/密码本.md`；提交前确认其受 gitignore 保护，其他文件只用占位符。
- 实际服务器部署、数据库、进程、证书、Nginx 或第三方回调变更后，立即更新本地忽略的 `docs/operations/阿里云部署.md`。

## 2. 核心业务边界

- **Reward、Coupon、数字资产独立**：消费积分支持提现及普通商品部分抵扣；平台红包可叠加；VIP 礼包禁止消费积分抵扣。数字资产不与奖励余额或分润计数混用。
- **金额口径**：现有业务金额存储/API 主要为 Float/元，具体字段以 Schema 为准；计算复用现有金额工具及舍入规则，不据此直接做浮点资金累计，也不擅自改为分单位存储。
- **身份与权限**：内部 `User.id` 不变；买家展示/复制/搜索使用 `buyerNo=AIMM+14位数字`。解析公开编号后仍须执行原权限校验；纯卖家员工、管理员不生成买家编号。
- **认证隔离**：买家、管理端、卖家端使用独立认证链路；管理与卖家分别使用独立 JWT Secret、Strategy、Guard。商户身份来自认证上下文，查询必须按 `companyId` 隔离。
- **推荐与分润**：只有 VIP 可展示、分享有效推荐码；普通用户可绑定推荐人。普通树、VIP 树、VIP 直推及订单队列奖励保持各自规则与配置，不合并计算链路。
- **树结构**：VIP 为 A1–A10 独立子树；有推荐人落入其子树，直连满后按层选 `childrenCount` 最少节点，同数按树顺序。普通树为单个平台根节点、轮询平衡插入；两套层级、冻结及过期参数独立。
- **利润结构**：普通树为六项；当前本地 VIP 配置为七项，含直推佣金。分配比例须合计 100%，实际值读取配置；不能套用旧六分摘要删除直推项。队列奖励的实施/启用状态另行核实。
- **定价与订单**：普通商品售价按成本乘平台加价配置计算，奖励商品由管理员定价。CheckoutSession 在支付成功后原子建单为 PAID，不恢复 PENDING_PAYMENT 订单模型。
- **库存**：加购、复购、勾选和结算前拦截已知库存不足；支付回调并发后允许普通商品负库存并通知补货，不自动退款。
- **赠品与奖品**：THRESHOLD_GIFT 按勾选非奖品金额解锁并随单包含。奖品从入购物车计时过期；删奖品为预期行为，`wonCount` 不回退、过期名额不释放。奖品归平台公司，普通搜索排除奖励商品。
- **VIP 赠品与草稿**：一个赠品方案可含多个商品，价格由 SKU 数量汇总，不存冗余总价；DRAFT 不进入默认商品列表、审核及买家查询，提交必须完整校验。局部 UI、配额和保存时序见功能设计。
- **运费**：平台统一对接顺丰并承担履约运费；买家满额包邮，否则按平台首重/续重规则整单计费一次，支付后按子订单金额分摊；商户协商价不进入代码。自提改动按对应设计核对适用范围。
- **支付**：新增支付通道保留已有通道行为；退款及退货运费按原订单通道处理。微信取消/过期先查单再关单，已支付则主动建单；入口及可用性读取对应客户端配置和服务状态，不从历史开关推断上线。
- **数字资产**：累计消费、V2 和冻结消费资产存在后续覆盖关系，不再按“第一版仅累计消费”概括全部功能；按 `docs/README.md` 中 V2/冻结设计读取，确认收货释放、退款作废或扣回，不把冻结余额当正式余额。

## 3. 开发与验证

- 修改前判断是否涉及并发、资金、库存、状态机或认证；涉及时逐项执行 `docs/issues/tofix-safe.md` 安全检查清单，并更新新问题或已修复状态。
- 金额、库存、奖励、支付的数据库状态写入遵循项目 Serializable 事务要求，并检查事务内 CAS、幂等和重试；纯展示或格式调整不适用事务要求。
- UI 开发先读对应客户端设计与响应式规范；使用可用设计技能辅助。原 `/ui-ux-pro-max` 不可用时遵循项目规范及可用替代技能，不虚构已调用。
- 后端改动验证 TypeScript、相关 API/业务测试；涉及 Prisma 时运行 `npx prisma validate`，迁移另做演练。前端改动验证 TypeScript 和页面渲染；按影响范围检查 API、类型、状态、路由及跨端兼容。
- App 新页面、Code Review、OTA 前执行响应式规范中的适用检查与场景；自动化通过不等于真机验收。
- 测试按改动风险选择；纯文档改动检查引用、规则一致性和敏感信息。各端审查细则见 `docs/testing/code-review-checklist.md`。
- 完成任务后更新受影响客户端/业务设计文档及 `plan.md` 对应进度，并说明下一步；无设计或进度变化不追加重复记录。客服改动同步 `docs/features/智能客服.md`，AI 改动同步 `docs/ai/ai.md`。

## 4. Git 与发布门禁

- `origin/main` 是唯一长期产品基线；测试分支只承载测试候选。业务代码从最新 main 建短期干净 `codex/*`（或指定 feature）worktree；禁止在 main、staging、原始脏目录或固定微信测试目录开发。
- 禁止整体 merge/覆盖长期分叉的 staging 与 main，禁止目录级 ours/theirs 掩盖语义冲突；旧 staging 的保全引用、锁定及测试候选绑定不得擅改，解锁/强推须单独授权。
- 固定微信测试目录只在远端候选部署后用经核实的同步脚本 fast-forward；跨分支切换须用户批准、archive branch + tag + delivery 分支三重保全，按精确旧/新 SHA 执行 rebind 并保留旧目录。完成后 HEAD 等于选定远端测试分支且工作树干净。
- **push、上测试、生产部署、App OTA/Build、小程序发布按明确授权范围执行**；执行前说明改动及影响，已有授权不重复询问，不把 push 授权扩大成生产或客户端发布授权。
- 一个逻辑改动一个 commit，使用 `type(scope): 描述`。推 main 前说明回滚路径；迁移、删字段、改枚举或利润公式须说明额外数据回退步骤，不能只用 git revert 代表完整回滚。
- App 默认范围为 `app/`、根 `src/`；小程序为 `miniapp/`。共享后端变更检查两端兼容，不夹带另一客户端代码或发布。GitHub push 不等于 App EAS/商店或小程序审核发布。
- PR、CI、测试部署、数据库演练、真机、main 合并、production approval、服务器与客户端发布分别报告。SHA 改变后不得沿用旧测试、attestation 或真机结论作为新版本验收。
- 发布后审计 main 与实际测试候选的双向差异；hotfix 同步至活跃候选和获准更新的测试分支，不触碰冻结分支。未发布功能保留独立 feature 分支。
- 发布前读运维文档，并核对目标 checkout 的 workflow、远端权限和候选 SHA。**旧本地 staging 的部分运维文档仍写 staging 开发/整体合并等旧流程，不能据此绕过上述规则。** 缺失脚本或发布文档先核实来源，不使用旧流程替代；差异见 `docs/README.md`。

## 5. 代码约定

- App：`src/repos/` 返回 `Result<T>`，页面通过 React Query 调用；使用 `<Screen>`、设计令牌和 Skeleton/Empty/Error 三态。组件 PascalCase，工具/常量 camelCase，注释用中文。
- 管理/卖家后台：使用 ProTable/ProForm/ProLayout，各用统一 axios 客户端与对应 JWT；管理端 `PermissionGate` 控制 UI，后端仍执行权限校验。
- 两个 Web 后台均通过 `App.useApp()` 获取 message、modal、notification，禁止静态调用；`<Modal>` JSX 可正常使用。
- 管理 Controller 用 `@Public()` 跳过买家 Guard，再显式使用 `AdminAuthGuard`、`PermissionGuard`；卖家同理使用 `SellerAuthGuard`、`SellerRoleGuard`，不得只保留 `@Public()`。
- 卖家使用 `@CurrentSeller()` 注入认证上下文；写操作按现有 `@AuditLog()` 约定记录 before/after。保留超管权限豁免的现有范围，不扩大到跨端认证或商户身份。
- 依赖版本以 package.json 和锁文件为准；升级需明确范围并验证兼容性。支付、地图、AI 等占位或配置控制的能力，不因暂未启用而删除。

## 6. 项目与文档入口

技术栈：App 为 React Native/Expo；卖家与管理端为 React/Vite/Ant Design；后端为 NestJS/Prisma/PostgreSQL/Redis。具体版本查各 package.json。

| 路径 | 用途 |
|---|---|
| `app/`、`src/` | 买家 App 路由、组件、类型、Repository、状态及主题 |
| `miniapp/` | 微信小程序；旧本地 staging 缺失，本次 main 基线存在 |
| `backend/prisma/`、`backend/src/modules/` | Schema、迁移、后端模块 |
| `seller/`、`admin/` | 卖家及管理后台 |
| `docs/README.md` | 完整索引、覆盖关系、已知缺失与版本差异 |

| 任务 | 先读（路径相对仓库根目录） |
|---|---|
| 数据/API | `docs/architecture/data-system.md`、`docs/architecture/backend.md`，对照实际 Schema/API |
| App UI | `docs/architecture/frontend.md`、`docs/architecture/responsive-design.md`及其大字体补充方案 |
| 卖家/管理 UI | `docs/architecture/seller.md`、`docs/architecture/admin-frontend.md`；seller 覆盖 sales 的前端/隐私部分 |
| 业务功能 | `docs/README.md` 中相应 features、specs、plans；按明确覆盖关系读取 |
| 安全/审查 | `docs/issues/tofix-safe.md`、`docs/testing/code-review-checklist.md` |
| Git/部署/OTA | `docs/operations/branch-strategy.md`、`docs/operations/github操作.md`、`docs/operations/版本管理.md`、`docs/operations/app-发布与OTA手册.md`；同时遵守第 4 节 |

## 7. 文档维护

- 新增正式文档只登记到 `docs/README.md`，说明用途、范围及替代关系；本文件仅在全局纪律、业务边界或入口变化时更新。
- Schema/API/配置说明当前实现，批准设计说明目标要求，计划和报告分别说明步骤与版本证据。冲突时报告偏差，不擅自覆盖业务规则；新文档只在明确范围内替代旧文档。
- 法律文本以 `src/content/legal/` 原文为准，变更后重新导出审核 Word。
- 避免在本文件复制数量统计、完成状态、开关值、服务器版本、历史 SHA 和凭据；这些由对应计划、配置与运维记录维护。
- 本文件目标不超过 18 KiB；增长时优先把局部细节移至对应文档，并保留必读入口。
