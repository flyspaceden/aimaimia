# AI Visual Agent staging 验收与回滚手册

> 日期：2026-08-27
>
> 状态：本地交付包，未 push、未部署、未迁移 staging、未调用真实付费模型
>
> 版本规则：发布候选必须取执行时 `git rev-parse HEAD` 的 40 位 exact SHA；不得把本文提交前的中间 SHA 当作发布 SHA。

## 1. 本轮验收目标

验证同一套通用 AI Visual Agent Core 能安全服务爱买买商家、餐厅或第三方 Adapter，并证明以下链路真实可用：

1. 商家上传受管原图后先获得免费诊断和推荐方向，不自动扣额度。
2. 商家选择平台费率档，看到候选数、所需额度和当前余额后再次确认。
3. 服务端冻结额度并通过白名单模型生成私有候选；浏览器不能提交 Provider Key、任意模型、任意 URL 或自由 prompt。
4. 几何、二维码、条码和可选 OCR 验真先于候选采用；明确事实错误必须自动拒绝。
5. 商家显式采用后，已上架商品立即以 CAS 替换图片，不等待平台预审批。
6. 平台管理员可配置欢迎额度、费率、六层预算、Client Key，并对事后巡检图片执行有版本保护的回滚。
7. Provider 结果不确定时进入 `RECONCILING`，不得重复提交或提前退回预算。

## 2. 当前已证实与未证实

| 层级 | 当前证据 | 状态 |
|---|---|---|
| 本地代码 | 后端 AI 图片模块 34 suites / 201 tests、Nest build、Prisma validate 通过 | 已完成 |
| 全量空库迁移 | PostgreSQL 18 新空库从第 1 个开始应用 138 个迁移；`migrate status` 为最新 | 已完成 |
| AI Schema 漂移 | 迁移库与 Prisma Schema 比对后，AI 图片表/字段/索引无漂移 | 已完成 |
| 主干历史漂移 | 仍存在 AuthProvider、MiniProgram、QueueReward 等非 AI 历史漂移 | 独立问题，不混入本候选 |
| staging secret | 未写入、未读取、未验证 | 未完成 |
| staging 数据库 | 未备份、未迁移 | 未完成 |
| 百炼真实调用 | 未启用模型、未扣费、未生成真实候选 | 未完成 |
| 40 张授权样本 | 仅建立样本矩阵，尚未获得图片授权并执行 | 未完成 |
| 手机真机 | 当前没有已连接手机/模拟器；测试 URL 也尚未部署 | 未完成 |

## 3. 发布前硬门禁

- 用户明确批准 push 和 staging 部署；当前授权不包含这两项。
- feature 分支以最新 `origin/main` 为基线，PR base 必须是 `main`；不得整体 merge 旧 `staging`。
- 候选 diff 只允许 AI 图片相关 backend、seller、admin、migrations、docs；不得夹带 App、miniapp、Delivery、H5。
- 记录 candidate exact SHA、Git tree、CI run、构建产物 digest、迁移数和部署后 API/Admin/Seller marker。
- 在 staging 数据库先执行备份和 `prisma migrate status`；如发现同名迁移已以不同 checksum 应用，立即停止，不得使用 `migrate resolve` 掩盖。
- 所有模型执行开关保持关闭完成首次部署和无模型回归；Provider Key 只存 secret store，禁止写入 Git、命令参数、截图或日志。
- 40 张样本必须逐张确认商家授权；生产商品图片不得因“能访问”而默认获得模型训练或评测授权。

## 4. staging 配置顺序

### 4.1 第一次部署：只上线能力，模型全部关闭

```dotenv
AI_VISUAL_AGENT_ENABLED=false
AI_VISUAL_AGENT_WAN_ENABLED=false
AI_VISUAL_AGENT_WAN_EXECUTION_ENABLED=false
AI_VISUAL_AGENT_QWEN_IMAGE_ENABLED=false
AI_VISUAL_AGENT_QWEN_IMAGE_EXECUTION_ENABLED=false
AI_VISUAL_AGENT_QWEN_OCR_ENABLED=false
AI_VISUAL_AGENT_QWEN_OCR_EXECUTION_ENABLED=false
AI_VISUAL_AGENT_CANDIDATE_OCR_VERIFY_ENABLED=false
```

先验证受管上传、免费诊断、报价不可执行、额度/费率/预算后台、Client Key 签发与撤销、商家立即采用确定性候选、管理员事后回滚。

### 4.2 Provider 预检：仍不执行付费请求

- 在百炼北京业务空间确认 workspace、模型可见性、计费规则、并发/频率限制和结果文件域名。
- 只把 workspace ID、Provider Key、OCR 哈希 secret、Adapter Evidence secret 写入 staging secret store。
- `AI_VISUAL_AGENT_BAILIAN_RESULT_HOST_SUFFIXES` 只允许实际验证过的精确结果域；不得配置宽泛 `aliyuncs.com`。
- 管理后台为 PLATFORM / PROVIDER / TENANT / CLIENT / EXTERNAL_OBJECT / ACTOR 六层分别建立正数预算；任一层缺失即保持 fail-closed。
- 为试点 Client 建立欢迎额度和费率卡，但先保持模型执行开关关闭。

### 4.3 付费 canary：单模型、单 Client、小预算

1. 先只启用 `wan2.7-image` 标准档，不同时打开四个模型。
2. 仅允许已授权样本的试点 Client 和测试账单主体；平台日预算设为 12 张 canary 的上限并保留余量。
3. 按 shadow 表先跑 8 张标准美化（120 额度），再审查效果、事实和实际 Provider 成本。
4. 标准档通过后，把 `AI_VISUAL_AGENT_WAN_ALLOWED_MODELS` 显式扩为 `wan2.7-image,wan2.7-image-pro`，再启用 `wan2.7-image-pro` 费率档跑 4 张高质量样本（140 额度）。
5. 12 张总商家报价为 260 额度（展示服务面值 ¥26），但 Provider 实际成本必须读取 `ProviderCostRecord`/控制台账单，不得用商家额度倒推。
6. 任一事实错误、重复扣费、来源漂移、未知调用未进入对账或实际费用越界，立即关闭执行开关并停止扩大样本。

## 5. staging 执行步骤

### A. 候选与 CI

1. 获批后只 push 当前 feature 分支，创建 base=`main` 的 Draft PR。
2. 记录 PR head exact SHA；CI、独立审查、migration 检查、backend/seller/admin build 必须对同一 SHA 通过。
3. 将同一 SHA 临时提升为 `staging-next`，不得从 `origin/staging` tip 构造候选，也不得在 `staging-next` 上开发。

### B. 数据库

1. 对 staging 数据库做可恢复备份并记录备份 ID、时间、校验结果。
2. 只读运行 `npx prisma migrate status`，核对历史迁移和 checksum。
3. 在 staging 数据库的旁路克隆再次运行 `npx prisma migrate deploy` 与关键查询。
4. 旁路通过后才在维护窗口对 staging 正库运行 `migrate deploy`。
5. 验证 138 个迁移均已完成，并确认 VisualCredit、VisualAgent、ProductImage、ProductMediaRevision 表和索引存在。

### C. 商家端验收

- 上传海鲜、智能手环、服装、家居和餐品等不同类别真实图片。
- 免费分析不得出现额度冻结；推荐可以保留真实场景，也可以建议棚拍/白底，不能统一强制白底。
- 付费前必须展示“模型服务会消耗图片额度”、档位、候选数、扣除额度、当前/预计余额。
- 刷新页面后任务仍可恢复；失败原因可见；Provider 未受理时额度自动释放。
- 候选事实通过后，商家点击采用立即更新上架图片并产生历史版本；没有平台预审批步骤。
- 同一采用请求重复提交只生效一次；商品已被其他操作换图时，旧候选不得覆盖新版本。

### D. 平台管理员验收

- 欢迎额度、服务面值、费率、适用方向/风险、模型档、启停和生效时间可管理。
- 六层预算缺一时请求失败；新活动版本不会与旧活动版本冲突或形成空窗。
- 管理员可看到最小化对账摘要，不看到 Provider Key、OCR 原文、条码内容或对象存储内部凭据。
- 事后巡检可按原因回滚商家图片并通知商家；若商家已再次换图，回滚应冲突而非覆盖。
- `RECONCILING` 只能用控制台/账单证据关闭；未计费则退回商家额度，计费异常则熔断对应模型预算。

### E. 公共 API 验收

- Client Key 只返回一次，数据库只存 prefix + hash；撤销、过期、错误 scope 均返回拒绝。
- Adapter Evidence HMAC 必须绑定 Client、Key ID、对象版本、账单主体、源摘要、nonce 和过期时间。
- 重放 nonce、跨 Tenant/Client、篡改对象版本或费用、任意 URL/prompt/model 都被拒绝。
- 外部系统只需要实现通用受管资产与 adopt/发布回调，不需要获得百炼 Key；每接一个系统不需要复制 Agent Core。

## 6. 真机与真实浏览器清单

测试 URL 部署后，用桌面 Chrome 和至少一台真实手机覆盖：

- 商家后台：上传 → 免费分析 → 选择标准档 → 确认 15 额度 → 等待 → 对比 → 采用 → 刷新仍显示新图。
- 网络中断：确认后立即断网/刷新，不得重复扣额度或重复调用 Provider。
- 额度不足：按钮禁用或返回明确提示，不产生调用。
- 手机窄屏：原图/候选对比、费用确认、事实确认和采用按钮不遮挡、不误触。
- 管理后台：费率修改只影响新 Quote；预算停用立即阻断新请求；图片回滚与通知可追踪。

## 7. 回滚与熔断

### 立即止损

1. 关闭对应 `*_EXECUTION_ENABLED`；必要时再关闭 `AI_VISUAL_AGENT_ENABLED`。
2. 停止签发新 Quote，保留现有 Invocation、Quote、Ledger 和 Provider 证据。
3. 将所有未知 Provider 结果保持 `RECONCILING`，禁止人工改成普通失败后重试。
4. 对已发布违规图使用管理员版本保护回滚；不得覆盖商家后来上传的新图。

### 代码回退

- staging-next 回到上一个已验证 exact SHA，重新验证 API/Admin/Seller marker。
- 本轮迁移为加表、加枚举值、加索引和可空关联；功能关闭后旧代码不应读取新表。不要在事故中直接删表或倒序删除枚举。
- 如必须做数据库结构回退，先保留调用/额度/审计流水并另写经审查的 forward migration；禁止手工修改 `_prisma_migrations`。

## 8. 验收通过条件

- 40 张授权样本完成硬门禁和评分；所有事实硬错误为 0。
- 标准档和高质量档在各主要类别均有可售提升，且不是简单统一白底。
- 12 张 canary 的 Quote、冻结、Provider 记录、结算/释放和账单可逐笔对上；重复计费为 0。
- 商家端、平台后台、公共 API 的关键路径在同一 staging exact SHA 上完成。
- 无 Critical/High 缺陷；Medium 有明确 owner 和是否阻断结论。
- 用户再次明确批准后，才可讨论 main 合并或生产发布；staging 通过不等于生产完成。
