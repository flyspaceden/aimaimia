# 全能商品视觉提升 Agent 设计

> 状态：**本地候选实现；免费计划、受控调用合同与预算隔离已写入代码，但 Provider 默认关闭、未部署、未运行迁移、未调用真实模型。本设计不能被视为任何 Provider、价格、额度或账单已验证的声明。**
>
> 本文是可独立接入的 **AI Visual Agent** 设计权威来源。它不属于爱买买、餐厅或任何单一业务系统；这些系统通过各自适配器接入。它补充并覆盖 [2026-08-21 商品图片优化设计](2026-08-21-product-image-optimization-design.md) 中“只做白底候选”的产品方向：默认保留合理实景，并可在可验证的边界内优化对象的光线、反光、噪声、清晰度、构图与轻微视觉瑕疵；绝不允许语义性地改业务事实。

## 1. 产品定义

这不是“让模型随意重画商品”的美图按钮，也不是“所有图变白底”。它是一个独立的 **AI Visual Agent**：识别图片和业务事实风险，推荐合适美化方向，按成本路由执行，再验证事实并将候选交回接入系统确认。

```text
接入系统的受管规范安全源
  → AI Visual Agent：免费诊断 / 风险档案 / 场景理解
  → 视觉计划（推荐方向、允许操作、预算、验真规则）
  → 免费确定性增强 或 受控图像编辑
  → OCR / QR / 主体 / 数量 / 颜色 / 结构验证
  → 候选对比、接入系统确认、审核、采用或回退
```

目标：

1. 大多数随手拍的业务图片看起来更专业、更有购买欲，同时保留真实感。
2. 床单上的手环、餐桌或厨房台上的虾等合理实景默认保留；白底只是一个选项。
3. 将模型成本压到“商家明确请求且免费处理不足”的图片上。
4. 所有候选保留源图、处理合同、模型/模板版本、验证报告和采用记录，并按租户隔离。

非目标：

- 不把严重模糊、遮挡、缺主体的图片伪造成可信商品图。
- 不添加/删除对象、配件、人物、认证、价格或功能。
- 不改由接入系统声明为事实保护区的文字、型号、条码、二维码、数量、颜色、材质、可见瑕疵或新鲜度。
- 不自动发布或替换接入系统中的正式媒体。

### 1.1 核心服务与业务适配器

```text
爱买买商品适配器 ─────┐
餐厅菜品/菜单适配器 ──┼→ AI Visual Agent Core → 百炼 / 其他 Provider
其他系统适配器 ──────┘
```

| 层 | 责任 | 不知道什么 |
|---|---|---|
| `AI Visual Agent Core` | 多租户认证、资产隔离、视觉计划、模型路由、预算、候选、验真、审计 | 不知道“商品/菜单/订单”的业务表结构 |
| Domain Adapter | 提供受管源图、业务事实策略、对象版本、采用/审核/回滚回调 | 不接触百炼 Key，不决定模型费用 |
| Provider Adapter | 百炼/其他模型的 submit/query/fetch、限流与用量 | 不知道租户业务事实或发布逻辑 |

当前爱买买的 `ProductVisualPlan` 是 **爱买买商品适配器的过渡实现**，不是未来 Agent Core 的公共数据模型。餐厅将以 `DishVisualAdapter` 提供菜名、摆盘事实、菜单价格文字和菜单发布规则；其他系统可实现同一 Adapter 合同。

## 2. 商家体验：一个入口，三种推荐方向

商品图片卡从“真实白底主图”升级为 **AI 美化**。上传后先返回免费诊断和推荐，只有点击“生成候选”才可能触发付费模型。

| 方向 | 适用场景 | 处理目标 | 发布边界 |
|---|---|---|---|
| `PRESERVE_REAL_SCENE`（默认） | 合理厨房台、餐桌、床单、户外、使用环境 | 补光、白平衡、轻度降噪/去反光/构图、减少干扰 | 可作为主图候选，需验真与确认 |
| `CATALOG_STUDIO` | 背景明显干扰、列表图需要统一 | 主体突出、干净棚拍/白底/中性背景、自然接触阴影 | 包装和电子产品走严格验真 |
| `PRODUCT_RETOUCH` | 主体清楚但偏暗、偏色、轻微灰尘/指纹/反光 | 先做有参数上限的确定性恢复；生成式主体精修只能是待人工确认的展示候选 | 禁止补造结构、文字、磨损事实 |
| `MARKETING_SCENE` | 详情页、活动页、社交传播 | 氛围、留白、创意场景 | 仅营销附图，标识 AIGC，人工审核 |

示例：

- **虾在厨房台面**：推荐保留实景增强，减少无关杂物、纠正偏黄光、让虾的纹理更清楚；不得增减数量、改变品种特征、包装或“新鲜度”事实。
- **黑色手环在床单上**：推荐保留实景/商品局部优化，保留生活感，降低屏幕反光、校正角度、压低过度褶皱干扰；表盘、腕带颜色、孔位和结构不可变。
- **料理机在杂乱桌面**：可推荐目录主图；若发现型号、刻度、控制面板，必须 OCR/结构核验通过后才可采用。

商家只选择方向和候选，不输入自由提示词、模型名或费用参数。系统展示“为什么推荐”“将改变什么”“不允许改变什么”“预计是否扣费”。

## 3. 真实性分级与验真

“可优化商品本体”不等于“允许改变商品”。本设计把摄影级恢复与语义性改物分开。

| 风险等级 | 典型商品 | 允许 | 禁止 |
|---|---|---|---|
| `STRICT_FACTS` | 包装食品、美妆、型号电子、条码/二维码图、二手瑕疵图 | 有参数上限的全局摄影变换，或原主体像素回贴后只编辑背景 | 任何文字、包装、型号、颜色、结构、瑕疵变化 |
| `CONSERVATIVE_FACTS` | 手环、家电、鞋包、珠宝、多件套 | 有参数上限的去反光、光线/透视改善、原主体回贴棚拍 | 改接口、孔位、屏幕、材质、配件数量 |
| `STANDARD_FACTS` | 杯具、厨具、普通日用品 | 实景增强、背景整理、目录主图 | 改品牌、结构、颜色、功能 |
| `ORGANIC_FACTS` | 果蔬、鱼虾、肉类、散装农品 | 光线、卫生感、构图、背景干扰改善 | 改数量、色泽、新鲜度、品种特征 |
| `MARKETING_ONLY` | 服饰搭配、生活方式图 | 创意候选 | 不能直接用作商品事实主图 |
| `RETAKE_REQUIRED` | 严重模糊、遮挡、多主体无法识别 | 重拍引导 | 不调用生成模型 |

每个候选至少经过：

1. 原图/候选 OCR 比对：型号、规格、容量和包装文字不一致即拒绝。
2. 二维码和一维条码均用本地专用解码器与区域比对：解码值变化即拒绝；疑似条码但无法解码时转人工，不能让 OCR 或生成模型替代条码事实判断。
3. 商品主体、配件与连通域数量检查：缺失、裁切或新增主体即拒绝。
4. 主体颜色、边缘、关键区域差异检查；低置信度转人工复核。
5. 视觉理解模型只输出“可能变化清单”，不能当作真实性证明。
6. 通过后仍需商家确认数量/配件、文字/二维码、颜色/规格/材质和可见瑕疵。

## 4. 免费优先与模型路由

### 4.1 免费层

所有上传图先运行现有受管资产、哈希、安全扫描与 `ProductImageQualityService`，扩展为场景适配、主体占比、曝光、色温、噪声、眩光、倾斜、背景干扰和重拍建议。

`FREE_TUNE` 只允许确定性处理：EXIF 校正、4:5 裁切预览、小范围亮度/白平衡/对比度、降噪、轻微锐化、压缩伪影抑制。每个风险等级要在处理合同中记录算子、强度、色相/饱和度上限、作用区域和 mask 版本；包装、电子、食品和二手商品不能以“补光”名义放宽可见瑕疵、屏幕/文字或色泽事实。

首期 `FreeTunePolicy` 的默认硬边界如下；未命中任一策略时只做诊断和重拍建议：

| 风险等级 | 允许算子/区域 | 禁止与上限 |
|---|---|---|
| `STRICT_FACTS` | 方向校正、等比例缩放、裁切；仅背景可做有限亮度调整 | 受保护主体区域像素必须 0 改动；不得做白平衡、锐化、降噪或局部修瑕 |
| `ORGANIC_FACTS` | 主体可做全局亮度曲线，背景可做降噪 | 主体曝光不超过 ±0.15 EV、对比度不超过 5%、色相/饱和度必须为 0；白平衡仅在有高置信中性锚点时允许 |
| `CONSERVATIVE_FACTS` | 几何校正、背景降噪、受保护主体有限全局亮度 | 主体曝光不超过 ±0.20 EV、色相/饱和度必须为 0；不得做局部去瑕/锐化/生成补全 |
| `STANDARD_FACTS` | 有界亮度、白平衡、降噪、锐化和背景整理 | 每个算子需记录参数；不允许生成式主体改造，超过策略值转 `DISPLAY_ENHANCED` 或人工审核 |

### 4.2 百炼模型组合（启用时重新核验）

Agent 编排留在本系统后端；**不使用百炼 Managed Agents**，因为图片任务无状态且异步，托管 Agent 还会产生会话时长费用。

| 层 | 建议能力 | 模型/服务 | 路由理由 |
|---|---|---|---|
| 视觉计划 | 类目、场景质量、风险等级、推荐方向、禁止区 JSON | `qwen3.7-flash` | 支持图像输入和结构化输出，低成本，仅作计划不生成图 |
| 事实保护 | 包装/型号/规格前后文字比对 | P3 固定 `qwen-vl-ocr-2025-11-20` | 专门 OCR；只在文字风险图和验真阶段调用；`latest` 只能作为重新评测后的显式配置变更 |
| 默认真实美化 | 保留实景补光、去轻微干扰、反光改善、构图、图生图候选 | `wan2.7-image` | 支持图生图、编辑、多图参考与边界框，适合“保留床单/餐桌/厨房台面” |
| 文字/材质敏感对照 | 包装、电子细节的受控编辑候选 | `qwen-image-3.0` | 文字渲染、真实材质和指令遵循更强，但必须走严格验真 |
| 人工高质量档 | 高价值商品、多角度参考、复杂局部编辑 | `wan2.7-image-pro` | 仅商家主动选择，不做默认自动升级 |
| 主体/局部试点 | 精确 mask、低风险杂物去除 | `image-instance-segmentation` + `image-erase-completion` | 当前免费体验且限流低，只做试点评估，不作为生产主链路 |

官方资料（价格、可见模型、配额和地区均会变化，**在启用当天以北京业务空间和官方列表为准**）：

- [图像模型能力](https://help.aliyun.com/zh/model-studio/image-model)
- [Qwen 图像编辑 API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)
- [Qwen Image Edit 使用指南](https://help.aliyun.com/zh/model-studio/qwen-image-edit-guide)
- [Qwen OCR](https://help.aliyun.com/zh/model-studio/qwenvl-ocr)
- [模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)
- [模型限流](https://help.aliyun.com/zh/model-studio/rate-limit)
- [查询模型列表 API](https://help.aliyun.com/zh/model-studio/list-models)

设计估算（非账户承诺）：北京当前官方页面列出 `wan2.7-image` 约 0.20 元/成功图、`wan2.7-image-pro` 约 0.50 元/成功图；两者当前按 5 RPS / 5 个处理中任务保守排队。`qwen-image-3.0` 单输入单 1K 候选约为 0.02 元输入加 0.18 元输出，当前以 20 次/分钟和最多 10 个异步处理中任务作为上限。`qwen3.7-flash` 当前按输入 0.2 元/百万 Token、输出 0.8 元/百万 Token，容量以 30,000 RPM / 5,000,000 TPM 为上限；OCR 固定版本的限流和 Token 计费以启用日官方页为准。OCR 按 Token 计费，不能在没有实际图片分辨率和输出长度时伪造固定单价。

### 4.3 硬成本门禁

1. 默认只产 **1 个** 候选；二次候选必须商家主动点击。
2. 免费诊断和 `FREE_TUNE` 不调用模型；仅在 Provider 明确未接受且未计费时释放预占。Provider 已有用量/成功结果时，即使本平台验真拒绝也结算；超时、取消或查询未知进入 `RECONCILING` 后再对账。
3. 默认标准候选按 20 分预占，Pro 按 50 分预占；账本继续使用现有 `RESERVED → SETTLED | RELEASED`。
4. Platform、Provider、Agent Tenant、Client、外部对象、调用主体、日/周所有适用层的上限均必须是正数才允许调用；任一层缺失或为 0 均拒绝调用，不解释为不限额。爱买买的企业/商品/员工只是该映射的一种实现。
5. 初期建议：每任务上限 0.50 元、staging 每日上限 30 元、生产每日上限 100 元；这些是待负责人确认的建议，不能在本次设计直接写入环境变量。
6. 队列保守低于 Provider 限流，429 指数退避；同一源图 + 意图 + 模型 + 参数复用幂等键，不能重复扣费。

开源分割、超分、去噪模型只能作为 `ProductSegmenter` / `FreeTuneEngine` 插件候选。它们仍有 GPU、许可证、隐私、冷启动和运维成本，未经审查不得以“免费模型”名义直接部署生产。百炼 `image-instance-segmentation` 和 `image-erase-completion` 的免费试点额度耗尽后必须停止该路线或回退重拍；不得自动降级到未经批准的生成模型。

## 5. 架构、数据与接口

### 5.0 多租户 Agent Core

AI Visual Agent 以单独服务/模块运行，使用自己的服务级身份、客户 API Key、租户预算和审计边界。**阿里云百炼 Key 永远只由 Agent Core 持有；爱买买、餐厅和其他系统只持有自己的 Agent Client Key。**

```text
AgentTenant
  id, name, status, defaultPolicyVersion, budgetScope

AgentClient
  tenantId, adapterNamespace, name, allowedAdapters, rateLimit, status

AgentClientKey
  clientId, keyPrefix, keyHash, expiresAt, revokedAt, lastUsedAt

VisualAssetRef
  tenantId, ownerClientId, adapterNamespace, externalObjectId, sourceHash, isolatedObjectKey, metadata

VisualPlan / VisualTask / VisualCandidate / VisualInvocationLedger
  tenantId, ownerClientId, adapterNamespace, externalObjectId, policy/version snapshots, audit links
```

- Client Key 仅用于调用 Agent Core API，按租户、**Client、Adapter namespace**、额度和限流隔离；只存 hash，创建时仅显示一次。
- `AgentClient.allowedAdapters`、`adapterNamespace` 与 `DomainVisualAdapter.adapterType` 必须精确匹配。Core 只加载认证 Client allowlist 中、namespace 相同的 Adapter；其他 Adapter 类型或 namespace 一律拒绝，不能因同租户而互调。
- Core 的每一条 Asset/Plan/Task/Candidate/Invocation 都绑定 `tenantId + ownerClientId + adapterNamespace`。任一 Client 的按 ID 读取、取消、采用或下载都必须由认证 Key 派生这三个 scope 过滤；不匹配一律返回 404，不能因为知道 taskId 跨系统读取。
- 外部系统不能传任意公开 URL。可使用 Agent 的受管上传接口，或传由 Adapter 服务身份签发、短时、白名单校验的读取引用；Core 必须**立即**下载、限大小解码、扫描、规范化、重算哈希并转存到自己的隔离对象。结果 `sourceHash` 必须与 `AdapterEvidenceEnvelope.sourceHash` 完全一致，否则拒绝并不落库，之后不依赖外部 URL。
- 跨 Adapter 的 `sourceHash` 固定为 `normalizedSourceSha256`：`normalized-rgba-srgb-v1`。输入是图像解码后、按 EXIF 方向旋转、转换到 sRGB、去除元数据后的 `width || height || unpremultiplied RGBA pixel bytes`；头部字段使用固定大端编码。Adapter SDK 与 Core 使用同一规范化库/版本，Envelope 签署该 hash 和算法版本；Core 重算不一致即拒绝，不允许用原文件 bytes、JPEG 重编码 bytes 或对象存储 ETag 代替。
- `externalObjectId` 由业务系统解释；Core 只将它用于幂等、审计和回调关联。
- 任何租户不得查看另一租户的源图、候选、计划、账本、模型用量或错误详情。

### 5.1 复用已有安全底座

爱买买现有 `SellerMediaAsset`、`ProductImageOptimization`、`ProductImageArtifact`、`ProductImageAssetLineage`、`ProductImageBudgetLedger`、`ProductMediaRevision` 已具备资产归属、候选、租约、幂等、预算、审核和回滚基础，必须作为 **爱买买 Adapter** 复用。当前真实实现仍仅是透明前景的确定性白底候选，不能误称为通用美化或通用 Core。

扩展 `ProductImageOptimization`，而非另建绕开审计的任务表：

```text
kind: FREE_TUNE | REAL_SCENE_ENHANCE | CATALOG_STUDIO | PRODUCT_RETOUCH | MARKETING_SCENE
visualMode: PRESERVE_REAL_SCENE | CATALOG_STUDIO | PRODUCT_RETOUCH | MARKETING_SCENE
riskTreatment: FACT_PRESERVING | DISPLAY_ENHANCED
riskProfile: STRICT_FACTS | CONSERVATIVE_FACTS | STANDARD_FACTS | ORGANIC_FACTS | ...
sceneAnalysis: Json
verificationReport: Json
providerTaskId: String?                 # 永不下发浏览器
providerRequestHash: String?
candidateClass: MAIN_IMAGE | DETAIL_IMAGE | MARKETING_IMAGE
```

新增 Artifact 语义：`ANALYSIS_SNAPSHOT`、`SEGMENT_MASK`、`PROTECTED_REGION`、`MODEL_OUTPUT_RAW`、`VERIFIED_CANDIDATE`。Provider 原始输出永远不能直接成为可采用媒体；只有重新下载、解码、扫描并验真后才能成为 `VERIFIED_CANDIDATE`。

`ProductMediaVisualOrigin` 后续增加 `AI_REAL_SCENE_ENHANCED`、`AI_CATALOG_STUDIO`、`AI_DISPLAY_ENHANCED`、`AI_MARKETING`。`DISPLAY_ENHANCED` 是“模型直接动过商品本体、不能被自动证明事实未变”的持久化风险类别：只能是 `DETAIL_IMAGE` 或 `MARKETING_IMAGE`，必须标识 AIGC 且人工审核，不能设为 `MAIN_IMAGE`。营销图也不得设为主图；已上架商品仍由 `ProductMediaRevision` 和 `mediaVersion` CAS 发布。

### 5.2 服务端 Provider 合同

```ts
interface ProductVisualEditProvider {
  isAvailable(): boolean;
  submit(input: {
    source: Buffer;                 // 服务端验证后的受管资产，不接受任意 URL
    protectedMask?: Buffer;
    visualPlan: ServerOnlyPlan;     // 固定模板、风险规则与已批准参数
    idempotencyKey: string;
  }): Promise<{ providerTaskId: string }>;
  query(id: string): Promise<'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'>;
  fetch(id: string): Promise<{ output: Buffer; mimeType: string; usageCents: number }>;
}
```

Provider URL 仅允许官方白名单域名、短期下载、大小限制和服务端读取。结果必须重新走 MIME/解码/规范化/安全扫描/验证，模型 Key、原始任务响应、自由 prompt 和对象存储 URL 一律不下发浏览器。

### 5.3 Agent Core API 与系统适配器

Agent Core 的公共 API 采用版本化、域中性契约：

```text
POST /v1/assets
  externalObjectRef, source upload 或 adapter-signed shortFetchRef
  # Client 不能提交 factPolicy/objectVersion；Core 在同步导入时向可信 Adapter 解析

POST /v1/visual-plans
  assetId, requestedDirection?
  # Core 从受管 Asset 和 Adapter 获取事实策略、对象版本与当前规则

POST /v1/visual-tasks
  planId, visualMode, idempotencyKey

GET /v1/visual-tasks/:id
POST /v1/visual-tasks/:id/adopt-intent
```

认证后的 Client Key 只可访问自身 scope 的资源。所有 `GET` / `POST` / 采用操作隐式加：

```text
WHERE tenantId = auth.tenantId
  AND ownerClientId = auth.clientId
  AND adapterNamespace = auth.adapterNamespace
```

任何 scope 不匹配都返回 404，审计记录不泄露资源是否存在。Core 对 `(tenantId, ownerClientId, adapterNamespace, externalObjectId, sourceHash)` 建索引，对每个有效计划/任务使用相同 scope 的幂等约束。

Provider 回调不属于 Client API：

```text
POST /internal/providers/:provider/callback
  # 仅 Provider 身份可调用：验签、mTLS/来源限制、eventId 去重、task scope 校验
```

Client Key 无权写入结果、用量、账本或任务终态。

每个 Adapter 至少实现：

```ts
interface DomainVisualAdapter {
  adapterType: string;
  resolveSource(input: ExternalAssetRef): Promise<VerifiedSource>;
  getFactPolicy(externalObjectId: string): Promise<FactPolicy>;
  getObjectVersion(externalObjectId: string): Promise<string>;
  prepareAdoption(input: VerifiedCandidate): Promise<AdoptionIntent>;
  applyApprovedCandidate(input: ApprovedCandidate): Promise<void>;
}
```

Adapter 以受信服务身份提供不可篡改的 `AdapterEvidenceEnvelope`：`tenantId, clientId, adapterNamespace, externalObjectId, objectVersion, factPolicy, sourceHash, issuedAt, expiresAt, signature`。Core 验证签名、时效、Client/namespace 对应关系后才导入资产；计划、执行与采用均重新向 Adapter 查询对象版本和事实策略，拒绝陈旧或规则放宽的请求。

- `AimaiProductVisualAdapter` 映射商品、SKU、包装/二维码、`ProductMediaRevision` 与 `mediaVersion` CAS。
- `RestaurantDishVisualAdapter` 映射菜品、摆盘、菜单价格文字、过敏原/菜品名称和餐厅菜单发布版本。
- 适配器的采用回调必须重验业务对象版本，不能因 Agent 候选成功而直接覆盖业务媒体。

### 5.4 爱买买过渡 API 与 UI

```text
POST /seller/products/:productId/visual-enhancements/plan
  sourceAssetId, requestedDirection?       # 仅诊断/计划，不扣模型费用

POST /seller/products/:productId/visual-enhancements
  sourceAssetId, visualMode, planVersion, idempotencyKey
  # 后端重算计划；浏览器不能指定模型、prompt、费用

GET /seller/product-visual-enhancements/:id
  # 状态、私有候选、验证摘要、预计/实际费用、审核状态

POST /seller/product-visual-enhancements/:id/adopt
  # 事实确认 + candidateClass；上架商品创建 revision
```

旧白底 API 保持兼容。爱买买 UI 先显示“自然实景 / 极简主图 / 商品精修 / 营销图”与 Agent 推荐理由；不让模型、提示词和预算细节暴露成商家自由输入。它未来通过 `AimaiProductVisualAdapter` 转发到 Core，而不是把百炼逻辑复制到卖家后台。

## 6. 状态、审核与管理

```text
REQUESTED → PLANNED → QUEUED → RUNNING → VERIFYING → SUCCEEDED
                      │                    ├→ REJECTED | FAILED | EXPIRED | CANCELLED
                      └→ RECONCILING ──────┘
SUCCEEDED → AdapterReview(PENDING) → ADOPTED | REJECTED
```

`RECONCILING` 是提交/查询结果未知的不可重发活跃状态：保留同源图去重锁和预算预占，不会被普通 lease reaper 标为失败；只能用同一 provider idempotency key 查询到明确计费/终态后离开。实现前不宣称上述新枚举已经存在；现阶段可复用当前任务状态和关联 revision。每个状态转移须有 lease token、条件更新、幂等键和预算终态。

Core 管理端新增：策略/模型白名单/预算配置、资产谱系与验证报告、候选审核、投诉/恢复、租户/Client/模型/样式维度成本与采用率。各 Adapter 的业务客户端仅展示已采用结果，并按自身 `MediaPolicy` 显示 AIGC 标识和证据入口规则。爱买买的 `ProductMediaRevision + mediaVersion` CAS 是其中一个 Adapter 实例。

## 7. 分期和验收

| 阶段 | 交付 | 不做什么 | 验收 |
|---|---|---|---|
| P0 | 本设计、模型/成本/评测决策 | 不开通模型 | 文档审查 |
| P1a（已开始） | 免费场景推荐、保留实景 UI、计划快照 | 不修改图片、不调用模型 | 合理实景不被误导为白底 |
| P1b | `FREE_TUNE` 确定性执行与参数合同 | 不调用生成模型 | 风险等级参数边界、原图/候选/回滚验证 |
| P2（进行中） | Provider、持久化调用/六层预算/租约与验真合同，默认关闭 | 不写部署 Key/不计费 | 账务 Mock、并发、SSRF、账本测试 |
| P3 | 百炼北京小样 shadow 评测 | 不给普通商家开放 | 至少 40 张授权样本、成本/事实错误报告 |
| P4 | 白名单商家试点 | 不自动发布 | 转化、退款、投诉指标达标 |
| P5 | Pro/营销图/其他 Provider 插件 | 不降低主图真实性 | 分品类审批 |

评测样本至少覆盖：厨房台/餐桌海鲜、包装食品、美妆、手环、家电、鞋包、多件套、强反光、低光、文字/二维码密集图。逐张人工记录商品事实是否变化、实景是否被不必要白底化、可用性评分、时间与实际成本。

## 8. 真实性、异步计费与回滚执行附录（实施前置条件）

本节是 P1/P2 的硬约束，不是可选优化。

### 8.1 规范坐标、受保护区与最终合成

上传规范安全源是唯一坐标原点，所有框、OCR、二维码、条码、主体 mask、多件套连通域均按其 `width × height` 的归一化坐标保存。任何裁切、旋转、透视、缩放都必须产生可逆几何变换矩阵。

```text
规范源
  → OCR/QR/条码框 + 主体/配件 mask + 连通域快照
  → ProtectedRegion Artifact（版本、坐标、哈希、几何矩阵）
  → 模型输入：保护区遮罩/替换后的副本，或仅允许背景输入
  → Provider 原始输出（隔离）
  → 最终合成：丢弃输出保护区 + 原规范源像素按矩阵回贴
  → 在同一坐标系验证文字、QR/条码、主体与配件
```

- `STRICT_FACTS` / `ORGANIC_FACTS` 的模型路径必须是“原主体像素回贴 + 只编辑背景/非保护区”；模型不得接触可读文字、二维码、条码和受保护主体像素。
- 商品本体的生成式精修不可能被自动证明“绝未改变”。它只能是带风险提示的 `DISPLAY_ENHANCED` 候选，经商家明确确认与人工审核后才能作为展示图；包装、二手、食品和高风险电子默认禁止这一路径。
- 多件套必须保存每个组件连通域；任一组件被裁掉、合并、复制或新增时直接拒绝。

### 8.2 原始输出隔离

`MODEL_OUTPUT_RAW` 只作为 Core 私有 Artifact/隔离对象存在，不能创建为可被任何 Client 预览的 Adapter 候选资产。只有完成下载、解码、内容扫描、保护区回贴和验证后，才创建 `VERIFIED_CANDIDATE` 受管资产。

Client 预览、业务媒体、审核页和公开媒体路由必须拒绝 `QUARANTINED_RAW` / 未验证 Artifact；任何原始输出过期、外部对象删除或验证失败均按留存策略隔离或清理，不能绕过私有访问门禁。

### 8.3 异步队列、租约和供应商对账

P2 必须使用独立异步 worker（Redis 队列或等价可靠队列），不能在 HTTP 请求内等待模型完成。任务有 provider idempotency key、providerTaskId、lease token/generation、心跳/续租、指数退避、死信与人工恢复入口。

```text
未提交 Provider                         → RELEASED
Provider 明确未接受且未计费             → RELEASED
Provider 返回成功/用量/可下载结果       → SETTLED（即使本平台验真 REJECTED）
提交或查询结果未知                      → RECONCILING，继续占用预算且禁止重发
实际费用 > 预占                          → BILLING_EXCEPTION，关闭该 Provider 并人工对账
取消/超时                               → 先 query Provider；不得假设未收费
```

网络超时和回调丢失不能直接释放或创建新任务；只能使用同一 provider idempotency key 查询并收口。Provider callback 若存在，必须验签、去重和限制来源；否则 worker 轮询到终态。

### 8.4 调用级账本与预算策略

Core 的通用账本不能使用爱买买的 `ProductImageBudgetLedger` 作为公共模型；后者仅是 `AimaiProductVisualAdapter` 的过渡账本。Core 需要支撑多模型、多次 OCR/分割/生成与租户/Client/外部对象/Actor/日/周限制，因此 P2 新增：

```text
VisualBudgetPolicy
  scope: PLATFORM | PROVIDER | TENANT | CLIENT | EXTERNAL_OBJECT | ACTOR
  provider/model/mode, perTask/day/week cap, timezone, effectiveFrom/version

VisualInvocationLedger
  visualTaskId, tenantId, ownerClientId, adapterNamespace, externalObjectId, actorId, provider, model, operation
  state: RESERVED | RECONCILING | SETTLED | RELEASED | BILLING_EXCEPTION
  reservedCents, actualCents, providerTaskId, policyVersion, createdAt
```

中国业务预算周期统一以 `Asia/Shanghai` 计算。每一次计划、OCR、分割、生成或重试都单独记调用级流水；在 Serializable 事务内检查全部适用 policy，再创建预占。Actor 必须来自认证 Client + AdapterEvidenceEnvelope/Adapter 查询，不能由 Client body 自报。任一 `BILLING_EXCEPTION` 自动关闭对应 Provider 与模式，保留审计，不自动透支。Core 同时强制平台/Provider/Client 总预算，避免单个接入系统耗尽共享模型容量；每个 Adapter 将自身的 Company/Product/Staff 等字段映射为 Core 的 Tenant/External Object/Actor。

### 8.5 计划快照、候选数与九图上限

`/plan` 返回并持久化 `planId + planHash + visualAssetId + sourceHash + externalObjectId + riskProfile + allowedOperations + protectedRegionVersion + modelPolicyVersion + expiresAt`。执行端重新验证全部字段；源图、对象版本、Adapter 事实策略、规则、预算收紧或计划过期时拒绝执行，不能只信任浏览器传来的 `planVersion`。

- 默认一张候选；再次生成是新的有成本 variant，必须商家主动确认且有独立幂等键。
- 同一源图/意图/模型/参数命中已验证成功缓存时可复用；验真失败不复用为可采用候选。
- Core 不假设“商品”或固定图数。Adapter 必须声明 `MediaPolicy`（主图/详情/营销/证据角色、最大数量、排序限制）；候选采用前由 Adapter 模拟最终媒体集合，超限时明确要求业务用户选择保留/移除，而不是静默丢图。爱买买当前 `MediaPolicy` 的最大值为 9。
- 多图多任务用任务中心按源图聚合，不再只恢复一个任务。

### 8.6 媒体用途、不可变版本与买家契约

Core 的通用候选角色为 `PRIMARY_DISPLAY`、`SUPPORTING_DISPLAY`、`MARKETING_DISPLAY`、`EVIDENCE`；Adapter 映射为自身媒体字段和排序规则。爱买买的映射为 `MAIN_IMAGE`、`DETAIL_IMAGE`、`MARKETING_IMAGE`、`EVIDENCE_IMAGE`。约束：

1. `MARKETING_DISPLAY` 不能成为 `PRIMARY_DISPLAY`，不能取代任何事实主展示图；爱买买 Adapter 将此实现为 `MARKETING_IMAGE` 不能是 `sortOrder=0`。
2. 每个 AI 的 `PRIMARY_DISPLAY` 至少关联一张原始 `EVIDENCE`；爱买买 Adapter 映射为 `EVIDENCE_IMAGE`。
3. Adapter 的采用事务必须在通过前写入不可变 `baseMediaSnapshot` 和 `ApprovedMediaVersionSnapshot`，包含完整旧/新媒体、处理任务、审核人和时间。对爱买买而言，这些快照、候选采用、媒体删除/创建、`mediaVersion` CAS、`ProductMediaRevision` 状态必须在**同一个 Serializable 事务**内提交；任一 CAS/快照写入失败则整笔回滚。
4. 具备权限的接入系统管理端可恢复任一已批准快照，恢复也走新的 Adapter CAS/revision，绝不原地覆盖审计。
5. 接入系统的公开 DTO、客户端类型和详情页同步下发来源/角色/AIGC 标识；不得暴露原始 Provider 输出或 Core 内部验证数据。

### 8.7 留存和删除

规范安全源、采用记录、预算与审核快照按平台合规留存策略保存；隔离 raw 输出、mask、OCR/验证中间件、失败候选有明确访问权限和保留期。外部对象删除后，任务保留审计但失效，未采用候选和 raw 输出不可预览；若 Provider 仍处于 `RECONCILING`，其账务责任继续由平台对账 worker 收口。

## 9. Agent 服务与 Provider 开通门槛

以下全部得到负责人明确确认前，Core 的 `AI_VISUAL_AGENT_ENABLED`、每个 Adapter 的执行开关与具体 Provider 开关继续为 `false`：

1. 北京业务空间实际可见模型、Core 专用 Provider API Key、配额、账单和告警。
2. Provider Key 仅保存到 Core 的本地密码本/部署密钥管理，不写入 Git、日志、截图或本文档；它的 staging 名称使用中性 `ai-visual-agent-staging`，绝不使用接入系统名称。
3. 所有适用 scope（`PLATFORM`、`PROVIDER`、`TENANT`、`CLIENT`、`EXTERNAL_OBJECT`、`ACTOR`）的 per-task/day/week 正整数预算，以及异常自动关闭策略；任一必需层缺失即拒绝调用。
4. 授权评测样本、商品事实人工验收人和试点企业。
5. staging 的下载、扫描、验真、失败释放、审核、回滚及真实账单验证。

创建 API Key 只解决 Core → Provider 的权限；爱买买、餐厅和其他系统必须再各自创建可撤销的 Agent Client Key，不能共享 Provider Key。本文不授权任何生产部署、迁移、模型订阅、费用支出或自动发布。

### 9.1 2026-08-22 本地 P2.2 账务边界

`VisualAgentInvocation`、`VisualAgentBudgetPolicy`、`VisualAgentBudgetReservation` 和对应 migration 已写入本地代码，但**未执行 migration、未导入 AppModule、未部署**。每次提交须先持久化同一个 scope/idempotency 记录、六份预算预占和单次 lease；价格只能从六份策略一致的 `reserveCents` 得出，任何金额策略缺失/冲突/非正数均拒绝。提交前再次验证规范源哈希、计划哈希、方向、租约与策略熔断；`UNKNOWN` 不释放预占也不能再次 acquire，submit/query lease 过期进入 `RECONCILING`。实际成本超过预占或人工账单异常会关闭该 Provider/model 策略，旧的 `RESERVED` 任务在出网前被释放。百炼尚未提供被本设计依赖的 submit 幂等承诺，因此 submit 超时但未知 taskId 的记录只能 `RECONCILING` 并人工对账。Provider 原始输出下载器在受控 egress/固定连接与隔离 Artifact 到位前故意不实现，不能把短期 URL 直接交给业务系统或浏览器。
