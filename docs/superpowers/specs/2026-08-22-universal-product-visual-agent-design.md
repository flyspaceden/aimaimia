# AI Visual Agent v2：全品类、可计费、可接入的商品与菜品视觉服务

> 状态：**v2 设计稿，待按本设计重构实现。**
>
> 本文覆盖此前“商品图片优化”与“通用 Visual Agent”设计中关于产品目标、模型路由、商家付费、公共 API、Adapter、验真和上线门禁的部分。现有本地代码仅可作为受管资产、候选审核、预算/调用账本和 Client Key 的基础；它**不是**已经具备强大生成式美化能力的上线服务。
>
> 本文不授权数据库迁移、创建真实 Client Key、开通/订阅模型、真实付费调用、push、staging 部署或生产发布。

## 1. 一句话定义与成功标准

`AI Visual Agent` 是一个独立、可通过 API 接入的视觉服务：它理解一张业务图片应该保留真实场景、改成电商主图，还是只适合作营销图；给出清晰报价；在商家明确确认后调用受控模型；验证商品/菜品事实；把候选与完整审计记录交回接入系统审核采用。

它不是爱买买内部的“白底图按钮”。爱买买、华海餐厅和未来第三方系统都只是 Adapter。

```text
爱买买商品 Adapter ─┐
餐厅菜品 Adapter ───┼─> AI Visual Agent API / Core
第三方系统 Adapter ─┘       │
                                ├─ 免费诊断与规划
                                ├─ 图片额度报价 / 冻结 / 对账
                                ├─ 百炼图像编辑 Provider
                                ├─ 事实验证与风险路由
                                └─ 候选、审核、采用回调
```

成功不是“所有图片变白底”，而是：

1. 普通商家上传随手拍商品图后，能获得看起来更专业、能提升购买欲的候选。
2. 虾在厨房台、手环在床单、菜品在餐桌等合理实景默认保留生活感，不被粗暴改成白底。
3. 包装、型号、文字、价格、条码、二维码、数量、颜色、材质、可见瑕疵与食材新鲜度不被模型伪造或改变。
4. 每次付费调用都在调用前向付费商家说明档位、候选数和额度；调用后的费用、失败、未知结果可追溯。
5. 外部系统可用自己的 Client Key 接入，不能看到其他系统的图片、任务、余额或百炼 Provider Key。

## 2. 明确边界

### 2.1 允许实现的强效果

| 模式 | 商家看到的目标 | 是否可成为主图 |
|---|---|---|
| `REAL_SCENE_ENHANCE` | 保留餐桌/厨房/床单等实景，改善光线、反光、杂物干扰、构图与质感 | 验真通过后可以 |
| `CATALOG_STUDIO` | 干净棚拍、白底或中性电商背景、自然阴影 | 验真通过后可以 |
| `PRODUCT_RETOUCH` | 对明确允许的区域做受控反光/灰尘/曝光修复 | 严格验真后可以 |
| `MARKETING_SCENE` | 活动页、详情页、社媒图的氛围与创意场景 | **不能**取代事实主图，必须标记 AIGC |

### 2.2 永不允许的行为

- 自动发布、自动覆盖正式商品/菜单媒体。
- 以补光、去反光、美化为名改变包装文字、型号、条码、二维码、数量、颜色、材质、功能或可见瑕疵。
- 将严重模糊、遮挡、缺主体的图片“补造”为可信商品图；这类图只提示重拍。
- 让商家输入自由 prompt、模型 ID、Provider URL 或费用参数。
- 将百炼 Key 发给浏览器、卖家后台、餐厅前端、接入方或其用户。
- 以图片额度账户名义提供提现、转账或买家支付抵扣。

## 3. 商家体验：一个入口，先免费分析，再明确付费

### 3.1 爱买买商家端

1. 商家上传原图，平台创建受管源资产并完成免费诊断。
2. 点击“AI 美化”，系统展示建议卡，而不是直接调用模型：推荐方向、将改善什么、不会改变什么、档位/候选数/额度/余额，以及是否只能做营销图或必须重拍。
3. 商家选择方案，勾选“我理解将扣除 X 图片额度”，点击“确认生成”。
4. 服务端冻结额度并提交模型任务；商家可离开页面，回来查看状态。
5. 成功后展示原图与候选的并列比较、处理说明和事实确认项。
6. 草稿/未上架商品可显式采用；上架商品只提交 `ProductMediaRevision`，管理员审核通过才替换买家可见图。

| 上传图 | 推荐 | 商家可选项 |
|---|---|---|
| 虾在厨房台面 | 保留真实场景、校正黄光、降低杂乱感 | 标准实景美化 15 额度；高质量实景 35 额度 |
| 智能手环在床单 | 保留生活场景、降低反光、突出手环 | 标准实景美化 15；专业精修 50 |
| 有完整包装、型号、条码的食品 | 严格保护包装事实 | 白底/棚拍 25；不允许自由主体重绘 |
| 严重模糊的商品 | 重拍 | 0 额度，不调用模型 |

### 3.2 餐厅与第三方体验

- 餐厅 Adapter 把“菜品名、摆盘、过敏原、价格文字、菜单版本、可发布位置”作为事实策略传给 Core；结果回到餐厅审核页，不进入爱买买商品表。
- 第三方先创建 Agent Client、获得一次性 Client Key，再实现 Adapter 或使用未来 SDK；其 Key 只能访问本 Client scope。
- 所有接入系统都遵循同一报价、冻结、结果、验真和 Webhook 状态机；业务发布规则由各自 Adapter 决定。

## 4. 图片额度与商家付费

### 4.1 账户定义

新增独立的 `VisualCreditAccount` / `VisualCreditLedger`，与以下系统**完全隔离**：买家 `RewardAccount` / `RewardLedger`、平台红包/优惠券、买家支付/提现/消费积分，以及接入系统自己的收入或结算账户。

图片额度仅表示购买/获赠的 Agent 服务额度，不可提现、转赠或抵扣商品订单。账户绑定 `tenantId + billingOwnerType + billingOwnerId`：爱买买映射到商户 Company，餐厅映射到餐厅经营主体，第三方由其 Adapter 显式提供受控账单主体。

### 4.2 欢迎额度与汇率

- 平台默认可为审核通过的新商家赠送 **200 图片额度**，展示服务价值为 **¥20**，即 `10 额度 = ¥1 服务面值`。
- 赠送通过幂等业务键 `WELCOME_200_V1:{tenant}:{billingOwner}` 完成，一名付费主体只可获得一次；v2 首期欢迎额度不过期。
- `creditsPerCNY`、赠送数、适用 Tenant 和启停都由平台后台管理；历史流水不因新汇率改写。未来若增加促销额度过期，必须引入不可变额度批次与 FIFO 扣减，不能定时扣减混合账户余额。

### 4.3 初始商家报价目录

以下是面向商家的**产品报价**，不是百炼成本承诺；平台管理员可按 Tenant、地区、分辨率、候选数和模型版本配置/停用。任何变更只作用于新 Quote。

| 档位 | 适用效果 | 默认候选 | 初始报价 | 建议模型路由 |
|---|---|---:|---:|---|
| 免费分析 | 质量、风险、推荐方向、重拍建议 | 0 | 0 | 本地规则 + 可选低成本视觉规划 |
| 标准美化 | 实景补光、背景整理、自然构图 | 1 | 15 额度 | `wan2.7-image` |
| 电商主图 | 棚拍/白底/中性电商背景 | 1 | 25 额度 | `wan2.7-image` 或受控 `qwen-image-3.0` |
| 高质量美化 | 多参考图、复杂场景、较强真实感 | 1 | 35 额度 | `wan2.7-image-pro` |
| 专业精修 | 文字/材质敏感图的高风险候选 | 1 | 50 额度 | `qwen-image-3.0-pro` 或 `wan2.7-image-pro` |
| 额外候选 | 同一已确认方案再生成一张 | 1 | 10–25 额度 | 与原方案相同 |

北京业务空间当前官方页面列出 `wan2.7-image` / `wan2.7-image-pro` 输出价约 ¥0.20 / ¥0.50 每张；Qwen 图像档位按模型与分辨率分别计费。Provider 价格、免费额度、地区与模型可见性会变化，因此**只能在启用日通过官方模型列表和价格页重新同步为 Provider 成本，不得直接把这些价格写死为商家报价**。参考：[万相 2.7 API](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)、[万相编辑说明](https://help.aliyun.com/zh/model-studio/wan-image-edit)、[Qwen Image](https://help.aliyun.com/zh/model-studio/qwen-image-api)、[官方价格](https://help.aliyun.com/zh/model-studio/model-pricing)。

### 4.4 资金与任务状态机

```text
可用额度
  → QUOTE_ISSUED（报价有效，未扣费）
  → MERCHANT_CONFIRMED
  → RESERVED（冻结报价额度，任务获得同一报价快照）
  → PROVIDER_SUBMITTED / RUNNING
  → SUCCEEDED + VERIFIED → SETTLED（按已锁定商家报价扣除）
  → DECLINED_BEFORE_ACCEPT → RELEASED（全额释放）
  → UNKNOWN / Provider failed with billing unknown → RECONCILING（继续冻结，不可重发）
  → 对账明确未计费 → RELEASED；明确已计费 → SETTLED；异常 → BILLING_EXCEPTION
```

规则：

1. 余额不足时不能创建付费任务；不允许负额度或平台静默垫付。
2. Quote 必须包含 `rateCardVersion`、额度、候选数、模型档位、输出规格、有效期、展示文案和风险类别；商家确认的正是这个不可变 Quote。
3. Provider 成本与商家扣费分别记账：前者是 `ProviderCostRecord`，后者是 `VisualCreditLedger`；不能用其中一项推断另一项。
4. Provider 已接受任务或结果/费用未知时不可重复发起同一生成；只允许用同一 Provider idempotency key 查询与对账。
5. 验真拒绝不自动等于退款：若 Provider 已成功计费，按商家展示的“已生成但未采用”规则结算；若 Provider 未接受或明确未计费则释放。投诉/人工补偿必须另写 `MANUAL_ADJUST` 流水和原因。

### 4.5 平台后台能力

平台后台新增“AI Visual Agent 管理”：

- Tenant / Client / 可撤销 Client Key（Key 仅显示一次）；
- 商家图片额度账户、赠送、充值记录、冻结、结算、释放、异常与人工调整；
- 新商家 200 额度活动的适用范围、幂等发放与暂停；
- 模型白名单、地区/业务空间、Rate Card、每档报价、每次候选数和总预算；
- Provider 成本、商家扣费、`RECONCILING` 队列、失败原因与对账证据；
- 任务质量、采用率、投诉率、模型/场景/类目维度效果与成本报表。

所有额度调整和 Key 管理要求专用高权限、原因、审计日志与双人复核策略；不能由普通商品审核员或商家自行改价。

## 5. 模型路由：百炼优先，Provider 可插拔

### 5.1 为什么百炼是首选

当前平台在阿里云，北京业务空间可使用独立业务空间 endpoint 和同地域 Key；万相 2.7 支持图像编辑、多图参考、交互式框选编辑，编辑模式输出可选 1K/2K。它最适合作为默认强效果模型。千问图像 3.0 同时支持图生图/编辑，文字渲染、真实材质与语义遵循能力更强，适合包装/电子/材质敏感的专业档。

首期不使用百炼托管 Agent：本服务需要自己的异步任务、费用冻结、验真、审核和跨系统回调，托管会话 Agent 不能替代这些控制点。

### 5.2 Provider 目录与路由原则

| Provider profile | 默认用途 | 输入/输出 | 绝不用于 |
|---|---|---|---|
| `BAILIAN_WAN_STANDARD` | 标准实景、目录主图、低成本多参考 | 受管图 + 服务端模板；1K/2K | 文字/型号高风险图的自动主图 |
| `BAILIAN_WAN_PRO` | 高质量实景、复杂融合、专业场景 | 受管源图 + 可选参考图；最高 2K 编辑 | 自动升级、营销图替换事实主图 |
| `BAILIAN_QWEN_IMAGE` | 文字/材质/说明书敏感候选 | 受管源图 + 严格模板 | 未经 OCR/结构验真的包装主图 |
| `BAILIAN_QWEN_OCR` | 前后文字/型号/规格核验 | 私有受管图 | 向浏览器返回 OCR 原文 |
| 未来外部 Provider | 仅在适配器与预算/验真通过后 | 同一 Provider Contract | 绕过 Quote、账本或隔离 |

模型选择完全由服务器根据风险档、模式、地区、Rate Card、预算和评测结果确定。商家只看到“标准美化 / 电商主图 / 高质量 / 专业精修”，看不到可被滥用的自由 prompt。

### 5.3 Provider 安全合同

```ts
interface ImageEditProvider {
  readonly provider: string;
  preflight(input: ProviderInput): Promise<void>;
  submit(input: ServerOnlyEditRequest): Promise<ProviderSubmission>;
  query(providerTaskId: string): Promise<ProviderTaskState>;
  fetch(providerTaskId: string): Promise<ProviderOutput>;
  reconcile(input: ReconciliationRequest): Promise<ProviderBillingEvidence>;
}
```

- 只传服务端重新下载、规范化和扫描后的受管图片；禁止客户端任意 URL。
- 百炼 Key、业务空间 ID、Provider 原始 URL、原始响应和提示词只在服务端密钥管理/审计脱敏区保存。
- Provider 允许域名白名单、短期下载、20MB/像素上限、MIME 解码、重定向限制和 SSRF 防护为必经步骤。
- `submit/query/fetch/reconcile` 都使用持久化 Provider idempotency key 与租约；网络超时进入 `RECONCILING`，不能“再试一次”造成重复收费。

## 6. 通用 API 与 Adapter 合同

### 6.1 API 形态

```text
POST /visual-agent/v1/assets
POST /visual-agent/v1/visual-plans
POST /visual-agent/v1/quotes
POST /visual-agent/v1/tasks/:taskId/confirm
GET  /visual-agent/v1/tasks/:taskId
POST /visual-agent/v1/tasks/:taskId/adopt-intents
GET  /visual-agent/v1/credits
POST /internal/providers/:provider/callback
```

认证使用 `X-Visual-Agent-Key` 或 `Authorization: VisualAgent ...`。请求 scope 永远由 Key 推导：`tenantId + clientId + adapterNamespace`。任一资源读取、取消、采用、下载和 Webhook 关联都必须带这三个条件；scope 不匹配统一返回 404，不泄露资源是否存在。

当前代码中 `GET /visual-agent/v1/session` 仅完成 Key scope 验证；上述资产、报价、任务、额度 API 是本设计要求的后续实现，不能把尚未存在的 HTTP 路由称为完成。

### 6.2 Adapter 合同

```ts
interface DomainVisualAdapter {
  readonly adapterType: string;
  resolveSource(ref: ExternalAssetRef): Promise<VerifiedSource>;
  getFactPolicy(objectId: string): Promise<FactPolicy>;
  getObjectVersion(objectId: string): Promise<string>;
  verifyCandidate(input: CandidateForVerification): Promise<AdapterVerification>;
  createAdoptIntent(input: AdoptIntent): Promise<AdapterAdoptIntent>;
  applyApprovedCandidate(input: ApprovedCandidate): Promise<void>;
}
```

- 爱买买 Adapter 映射 `Company` 图片额度账户、`Product`、SKU、包装/二维码、`ProductMediaRevision + mediaVersion` CAS。
- 餐厅 Adapter 映射餐厅经营主体额度、菜品、摆盘、菜单价格文字、过敏原和菜单发布版本。
- 外部 Adapter 必须提供服务端签名的 `AdapterEvidenceEnvelope`：`tenantId/clientId/namespace/objectId/objectVersion/sourceHash/factPolicy/issuedAt/expiresAt/signature`。Core 复算源哈希并验证签名后才落库。
- Client Key 不能伪造事实策略、对象版本、验真结果、结算、任务终态或采用结果。

## 7. 数据模型与不可变证据

```text
VisualAgentTenant / VisualAgentClient / VisualAgentClientKey
VisualAsset                  # 隔离源图、规范化哈希、来源 envelope
VisualPlan                   # 场景/风险/允许模式/禁止区/模型候选
VisualQuote                  # 商家已看到的档位、额度、模型 profile、候选数、有效期
VisualTask                   # provider、租约、状态、idempotency、quote snapshot
VisualCandidate              # 输出、AIGC 标识、来源、验真报告、角色
VisualTaskEvidence           # OCR、二维码、条码、数量、颜色、结构、mask、版本
VisualCreditAccount / Ledger # 商家图片额度
VisualRateCard               # 管理后台配置的商家报价
VisualBudgetPolicy           # 平台/Provider/Tenant/Client/Object/Actor 六层上限
VisualProviderCostRecord     # Provider 原始成本与对账证据（脱敏）
```

`FactPolicy` 至少声明：保护文本区域、二维码/条码区域、商品主体/配件数量、颜色锚点、结构关键点、可见瑕疵和允许发布位置。

候选角色固定为：

- `FACT_MAIN_IMAGE`：可成为主图，必须通过最高级事实验证并保留原图证据。
- `DETAIL_IMAGE`：可展示局部但仍需验真。
- `MARKETING_IMAGE`：必须 AIGC 标识，不可成为事实主图。
- `EVIDENCE_IMAGE`：原实拍证据，不被替换或压缩丢失。

## 8. 强效果必须配套的验真

生成能力越强，验真越不能弱。每个候选必须至少经历：

1. 源图/候选 OCR 的文字、型号、规格、容量、价格与包装信息比对。
2. 二维码与一维条码的区域/值比对；疑似但不可解码时只能转人工。
3. 主体实例、配件和连通域数量比对；新增、缺失或裁切商品拒绝。
4. 关键结构、边缘、屏幕、孔位、按钮、标签、瑕疵和颜色锚点差异检查。
5. 有机品类（鱼虾、肉、水果）不得用视觉“新鲜度提升”掩盖原始色泽、损伤或数量。
6. 低置信、冲突或 Provider 输出无法获取时拒绝自动采用；营销图可保留为待人工审核，但不能升格主图。
7. 商家确认与接入系统审核是最后一道门，不替代算法验证。

## 9. 管理、监控与质量评测

上线前必须准备至少 40 张已授权 shadow 样本，覆盖：厨房台海鲜、包装食品、手环/手表、家电、鞋包、美妆、菜品、强反光、低光、密集文字/二维码、多件套和真实背景。

对每个模型/模式记录商业美感评分、商品主体保真评分、文字/条码准确率、错误拒绝率、单图耗时、Provider 实际成本、商家额度报价、采用率、投诉/回滚率，以及“真实场景被不必要白底化”的比例。

任何一个严格事实样本出现未拦截的文字/数量/型号变化，相关模型 profile 立即自动停用，并保留未完成任务在 `RECONCILING` 或人工队列，不能静默重试。

## 10. 分阶段实现与完成定义

| 阶段 | 交付 | 完成定义 | 当前状态 |
|---|---|---|---|
| A | 受管资产、私有候选、审核/回滚、基础 Core | 原图可追溯，候选不自动发布 | 已有基础代码 |
| B | `VisualCredit*`、Rate Card、200 欢迎额度、Quote/冻结/对账 | 商家看到报价后才能付费生成，账务可审计 | 待实现 |
| C | 万相/Qwen 实际 Provider 任务、下载、验真、回调/轮询 | 真实付费调用不会重复计费或越权发布 | 待实现，需授权 |
| D | 卖家/管理员完整额度与候选 UI | 商家可充值/查看流水，平台可配置模型、价目和预算 | 待实现 |
| E | 餐厅 Adapter 与公共 SDK/API | 不复用爱买买表/权限，Client Key scope 隔离通过 | 待实现 |
| F | shadow 评测、staging、真实账单和人工验收 | 同一 exact SHA 完成端到端验证 | 待授权 |

## 11. 启用门禁

下列条件全部满足并由负责人确认前，`AI_VISUAL_AGENT_ENABLED`、具体 Provider 开关和付费任务入口必须保持关闭：

1. 北京业务空间、模型列表、区域 endpoint、Provider Key、限流与实时价格复核。
2. `VisualCredit` 账户/Quote/冻结/释放/对账/人工补偿已完成独立审查。
3. 40 张授权 shadow 样本和商家/管理员流程完成验收。
4. 平台/Provider/Tenant/Client/Object/Actor 六层预算都配置正整数上限，且异常自动停用。
5. staging 用同一候选 SHA 完成真实 Provider 请求、成本对账、候选审核、回滚和错误恢复；生产发布另获授权。

## 12. 当前代码与本设计的差距

当前本地候选已具备：受管媒体、质量计划、确定性白底与轻调、候选审核、部分 OCR/条码门禁、调用账本、预算策略、Provider 适配骨架、Client Key 与可信 Adapter reservation bridge。

但它尚未实现本设计定义的 `VisualCreditAccount/Ledger`、商家报价与确认、真实模型执行闭环、模型输出验真、餐厅 Adapter、公共资产/任务 API、40 张评测或真实 Provider 成本对账。因此不得把当前基础候选描述为“强大的全品类 AI 美化服务已上线”。
