# 团购分享回馈设计方案

> 状态：设计已确认，待实施计划
> 创建时间：2026-06-21
> 适用范围：买家 App / 管理后台 / 后端 / Prisma Schema / 订单支付 / 售后 / 余额与流水
>
> **For agentic workers:** 本文档是“团购分享回馈”功能的权威来源。本功能独立于现有 VIP 推荐码、普通用户分润树、消费积分 Reward、平台红包 Coupon 和旧 `GroupModule` 考察团报名功能。

## 背景

平台需要新增一个独立的团购分享回馈功能。用户现金购买后台指定的团购商品后，在满足确认收货、售后期结束且无任何退换货的条件后，获得本次团购的分享码。其他用户通过该分享码现金购买同款团购商品并满足同样有效条件后，发起用户按后台配置档位获得团购返还。

本功能必须同时满足三个目标：

1. 让用户可以清楚看到自己的当前团购、分享码、进度和返还状态。
2. 即使用户已有当前团购，也能继续浏览团购商品，并可选择回到当前团购或主动结束后购买新团购。
3. 全链路避免敏感词、团队关系、层级展示和多级奖励，保持一级直接分享的合规边界。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 系统边界 | 新建独立 `group-buy` 模块，不复用旧 `GroupModule` |
| 参与用户 | 所有买家用户均可参与，不限 VIP |
| 商品来源 | 后台从平台商品 / 奖励商品池中指定固定 SKU 作为团购商品 |
| 购买方式 | 团购商品必须现金购买 |
| 禁止抵扣 | 禁止消费积分、团购返还余额、平台红包、优惠券、VIP 折扣和其他折扣用于团购支付 |
| 团购价格 | 后台配置特定团购价，用户按该价格购买 |
| 返还基数 | 后台配置的团购价，不含运费，不按实付优惠后金额重新计算 |
| 包邮规则 | 每个团购活动单独配置是否包邮 |
| 返还账户 | 新建独立“团购返还余额”账户和流水，可提现，可抵扣普通商品，不可抵扣团购商品 |
| 返还档位 | 后台可新增、删除、修改档位和比例，默认 10% / 20% / 70% |
| 档位总和 | 档位比例总和只要求大于 0，允许后台配置合计超过 100%；买家端仍不得使用“100% 免单”等营销表述 |
| 有效订单 | 确认收货、售后期结束、无任何退款 / 退货 / 换货 |
| 分享码生成 | 发起人的团购订单也必须有效后才生成分享码 |
| 同时参与限制 | 同一时间最多一个当前团购；用户可主动结束当前团购后购买新的团购商品 |
| 月度次数 | 每人每自然月发起次数后台可配置，默认 4 次 |
| 次数消耗 | 现金购买团购商品成功后立即消耗一次，后续放弃、终止、退换货或无效不退回 |
| 被分享人 | 通过分享码购买同款团购商品后，也同时开启自己的团购资格 |
| 终止功能 | 用户可随时结束本次分享；结束后不接收新的分享订单，既有订单继续按有效条件判断 |
| 自购限制 | 禁止用户通过自己的分享码购买 |
| 关系展示 | 只展示一级直接分享订单，不展示团队、下级链路或排行榜 |

## 非目标

第一版不做以下内容：

- 不做多级关系、团队统计、关系树、榜单或跨级返还。
- 不把团购接入现有 VIP 推荐码 `/r/{code}`；团购使用独立 `/gb/{code}`。
- 不让团购商品进入普通购物车结算。
- 不让团购返还余额购买团购商品。
- 不支持同一用户同时拥有多个当前团购。
- 不做复杂的 A/B 互刷识别；第一版只做自购拦截和“同一时间一个当前团购”的系统限制。
- 不改变普通商品、VIP 礼包、平台红包、消费积分和普通/VIP 分润的现有规则。

## 合规口径

### 用户端和后台可用词

页面和接口展示统一使用以下口径：

- 团购
- 分享
- 分享码
- 直接推荐好友
- 购物回馈
- 返还货款
- 团购返还余额
- 我的团购
- 团购商品
- 结束本次分享

### 页面禁止词

买家 App、管理后台、分享文案、弹窗、Banner、活动细则中不得出现以下导向：

- 下线、团队、层级、二代、管道收益、分销提成
- 佣金、提成、收益、赚钱、副业、商机、躺赚、稳赚
- 必成功、零风险、财富自由、月入过万
- 100% 免单、拉人赚钱、无限返利

注：本节作为合规检查清单列出禁用方向，实际页面文案不得使用这些词作为营销内容。

### 合规展示原则

1. 只展示本人直接分享进度，不展示好友的再分享关系。
2. 只写“返还货款 / 购物回馈 / 团购返还”，不写“佣金 / 收益 / 赚钱”。
3. 首页入口、活动页、购买确认页都要展示关键限制：现金购买、同款商品、售后期结束、无退换货、活动不保证达成。
4. 不做强制分享；用户可以正常购买商品、正常退换货，也可以随时结束本次分享。
5. 不做排行榜、业绩榜、团队数据、多人收益对比。

## App 端交互设计

### App 视觉方向

团购页不能做成发现页的搜索 / 筛选 / 瀑布流，也不能照搬 VIP 礼包页的金色会员空间。它的定位是“平台精选团购货架 + 个人分享进度台”：商品数量少、单品价格明确、购买决策重，所以视觉要像高级商品图录，而不是普通商品流。

设计主题：

- 主题名：`精选团购货架`
- 受众：已经有购买意愿、但需要理解规则和商品价值的买家
- 页面唯一任务：让用户在当前团购状态和可买团购商品之间清楚切换，并愿意进入某个商品的付款页

视觉 Token：

| 角色 | 颜色 | 用途 |
|---|---|---|
| Porcelain | `#F7FAF7` | 页面主背景，保持清爽，不用发现页的普通白底列表感 |
| Pine | `#12372A` | 标题、主操作、深色信息面 |
| Tide | `#2F6F73` | 次级强调、分享码区、状态标签 |
| Coral | `#E65A46` | 团购价、当前行动点、重要提示 |
| Brass | `#C6A15B` | 商品标签边线、进度刻度、规则提示 |
| Mist | `#DDE7DE` | 分隔、禁用、规则说明底色 |

字体角色：

- Display：沿用系统中文字体，但标题使用更克制的高字重，例如 `fontWeight: '800'`，字号 26-30，字距为 0，不做负字距。
- Body：沿用 `typography.bodyMd/bodySm`，用于规则和商品说明，最大字体倍率按响应式规范控制。
- Utility：金额、进度、分享码使用 `monoFamily` 或 `priceTextProps`，强调可核对的数据感，避免营销化。

标志性元素：`精选团购商品卡`。

团购商品不是普通 `ProductCard`。每个团购商品使用一张大卡展示，主图占明确视觉比例，右侧展示团购价、包邮 / 运费、配送 / 售后标签和购买按钮。用户在卡片内即可完成浏览和购买决策，不需要先点选商品再回到页面上方查看详情。

页面结构草图：

```text
没有当前团购
┌────────────────────────┐
│  团购                 │
│  平台精选 · 现金购买   │
├────────────────────────┤
│  [精选团购商品卡]      │
│  商品图 + 商品信息      │
│        ┌ 价格信息 ┐    │
│        │ ¥1000    │    │
│        │ 包邮/运费 │    │
│        │ 购买按钮  │    │
├────────────────────────┤
│  规则摘要  商品细节     │
│  底部固定：查看并购买   │
└────────────────────────┘

有当前团购
┌────────────────────────┐
│  我的团购 | 团购商品    │
├────────────────────────┤
│  我的团购：状态面板     │
│  分享码 / 待生成说明    │
│  进度轨：1 / 2 / 3      │
│  复制链接 / 结束本次分享 │
└────────────────────────┘
第二 Tab 仍展示同一套精选团购商品卡。
```

自审结论：

- 不使用发现页的双列瀑布流、分类 chip、搜索框作为主结构。
- 不使用 VIP 页的香槟金全屏会员氛围；只保留“专属空间”的大卡、底部 CTA 和轻动效思路。
- 不使用现金、红包、暴富类素材；主视觉必须来自真实商品图、规格和规则吊牌。
- 动效只保留一处：精选团购商品卡进入页面时轻微上浮，分享进度轨状态变化时做一次短促高亮；避免全页粒子和过度光效。

### 首页入口

买家 App 首页底部导航新增“团购”入口。

点击后根据用户当前状态进入团购首页：

| 用户状态 | 默认展示 |
|---|---|
| 没有当前团购 | 直接展示“团购商品”列表 |
| 已购买团购但待生成分享码 | 双 Tab，默认“我的团购” |
| 已生成分享码且进行中 | 双 Tab，默认“我的团购” |
| 已结束本次分享但仍有既有订单待观察 | 双 Tab，默认“我的团购”摘要 |
| 已完成 / 已失效且无待观察订单 | 直接展示“团购商品”列表 |

### 团购首页结构

用户存在当前团购或待观察团购时，页面使用两个 Tab：

1. `我的团购`
   - 展示当前团购状态。
   - 展示分享码 / 二维码 / 分享链接，前提是分享码已生成。
   - 展示有效进度、待确认订单和已返还金额。
   - 展示“结束本次分享”或“放弃本次团购资格”操作。

2. `团购商品`
   - 始终展示当前正在进行的团购商品。
   - 用户可以进入商品详情。
   - 用户已有当前团购时，点击购买会被拦截，引导继续分享或结束后购买。

用户没有当前团购时，可直接展示商品列表，不强制显示空的 `我的团购` Tab。

状态占用规则：

- `待生成分享码` 和 `分享进行中` 占用当前团购，购买新团购前必须继续等待 / 继续分享，或主动放弃 / 结束。
- `已结束但仍有既有订单待观察` 不再占用当前团购，用户可购买新团购；页面仍默认展示摘要，是为了让用户看清旧团购后续返还结果。
- `已完成`、`已失效`、`已放弃` 不占用当前团购。

### 团购商品列表

团购商品列表不使用普通双列瀑布流，也不使用“点击小卡后顶部大卡变化”的结构。默认使用纵向精选团购商品卡，每张卡自己承载商品图、价格、配送标签和购买按钮。

- 1 个活动：首屏直接展示完整商品卡。
- 2-6 个活动：纵向精选商品卡列表，顶部可展示轻量分类筛选 chip。
- 6 个以上活动：保留纵向精选商品卡列表，增加分类 / 活动期筛选；仍不做瀑布流。

商品卡展示：

- 商品图、商品名、规格摘要。
- 团购价。
- 是否包邮。
- 配送 / 售后标签，例如 `冷链配送`、`7 天售后`、`24h 质量售后`。
- 购买按钮。
- 简短限制提示，例如“现金购买；不可使用积分、红包、团购返还余额”。

商品卡不展示返还基数、返还档位比例，也不提供卡片内“查看规则”展开入口。完整活动细则通过页面顶部规则入口和底部规则区承载。

商品图要求：

- 使用真实商品图或后台商品主图。
- 商品图必须可检查商品本身，不使用暗色遮罩、强模糊或纯氛围图。
- 生鲜 / 高客单商品优先展示完整主体和规格参照，避免只截局部纹理。

点击商品进入团购商品详情页。

### 团购商品详情页

详情页延续精选团购商品卡的视觉语言，但信息更完整：

- 商品基础信息、SKU、团购价。
- 运费规则：包邮或按平台运费规则计费。
- 商品规格：重量、数量、产地 / 企业、发货方式，如后端有字段则展示真实字段，无字段不虚构。
- 购买条件提示：现金购买、不可抵扣、同一时间一个当前团购。
- 分享条件说明：展示“需直接分享有效好友购买同款并完成订单条件”，不在买家主页面展示返还档位百分比。
- 活动规则摘要。
- 关键限制：
  - 仅现金购买。
  - 不可使用消费积分、团购返还余额、红包、优惠券或 VIP 折扣。
  - 返还按活动设定货款口径计算，不含运费。
  - 分享码需在本人订单有效后生成。
  - 好友订单也需有效后才计入。

购买按钮进入团购专用确认页，不进入普通购物车。

底部固定栏：

- 左侧展示团购价和运费摘要，金额使用 `priceTextProps`。
- 右侧主按钮为 `现金购买` 或 `查看并购买`。
- 如果用户已有当前团购且该状态占用购买资格，按钮触发继续分享 / 结束后购买弹窗。
- 正文 `ScrollView` 必须预留底部固定栏高度，遵守 `docs/architecture/responsive-design.md` 的 bottom inset 规范。

### 用户已有当前团购时点击购买

如果用户已有当前团购，且状态仍属于当前占用状态，点击团购商品购买时弹窗只保留两个动作：

1. `继续分享`
   - 关闭商品购买意图。
   - 切回 `我的团购` Tab。
   - 展示当前分享码、进度和待确认订单。

2. `结束本次分享并购买`
   - 进入二次确认。
   - 用户确认后终止当前团购分享码。
   - 终止完成后进入所选商品付款页。

不提供“暂不购买”按钮。用户不购买时可自行返回、关闭弹窗或切换页面。

弹窗视觉：

- 使用底部 Sheet，不用居中营销弹窗。
- 标题：`当前已有团购`
- 正文只解释规则：`同一时间仅可参与一个团购。你可以继续分享本次团购，或结束后购买新的团购商品。`
- 主按钮：`继续分享`
- 次按钮：`结束本次分享并购买`
- 不展示第三个取消按钮。

### 待生成分享码阶段的购买拦截

用户刚买团购商品后，还未确认收货、售后期未结束或存在售后检查未完成时，状态为 `待生成分享码`。此时尚未展示分享码。

若用户在 `团购商品` Tab 点击购买新团购商品，弹窗动作改为：

1. `继续等待`
   - 回到 `我的团购` Tab，展示当前订单进度。

2. `放弃本次团购资格并购买`
   - 二次确认后放弃当前团购资格。
   - 当前已购商品正常履约，退换货规则照旧。
   - 即使后续该订单确认收货且无退换货，也不再生成本次分享码。
   - 本月发起次数不退回。
   - 放弃完成后进入新团购商品付款页。

### 我的团购状态

`我的团购` 至少覆盖以下状态：

| 状态 | 展示重点 | 用户操作 |
|---|---|---|
| 待支付 | 团购确认页未支付或支付中 | 继续支付 / 取消 |
| 待生成分享码 | 订单履约中，需确认收货且售后期结束 | 查看订单 / 放弃资格 |
| 分享进行中 | 分享码已生成，等待直接推荐好友订单有效 | 分享码 / 复制链接 / 结束本次分享 |
| 名额待确认 | 已有待确认好友订单，占用名额但尚未有效 | 查看进度 / 结束本次分享 |
| 已完成 | 有效好友订单达到档位上限，返还完成或待到账 | 查看明细 |
| 已结束 | 用户主动结束，不再接收新好友订单 | 查看既有订单观察结果 |
| 已失效 | 本人订单发生退换货、活动过期或管理员关闭 | 查看原因 |

`我的团购` 视觉结构：

- 顶部为当前状态面板，深 Pine 底，展示商品名、状态、关键下一步。
- 分享码已生成时，二维码放在白色“分享凭证”区域内，旁边展示分享链接和复制按钮。
- 待生成分享码时，不展示空二维码，改成时间线：`已付款 -> 待确认收货 -> 售后期结束 -> 生成分享码`。
- 进度使用三段轨道或按后台档位数量动态生成轨道，每段展示“等待中 / 待完成 / 已确认 / 已失效”。这是状态信息，不做排行榜，也不展示返还百分比。
- 终止操作放在页面下方的次级区域，不和主分享按钮并列抢视觉；点击后再二次确认。
- `我的团购` 页面不提供“继续分享”按钮。分享码、二维码、复制链接和系统分享入口已经在分享凭证区展示，重复按钮会回到同一页面，属于冗余操作。

进度轨文案示例：

```text
第 1 位有效好友  已确认
第 2 位有效好友  待完成
第 3 位有效好友  等待中
```

如果后台档位不是三档，App 按档位数组动态渲染，不写死 3 段。

### 分享码展示

分享码只在发起人的团购订单有效后生成。

展示内容：

- 二维码。
- 分享链接：`https://app.ai-maimai.com/gb/{code}`。
- 可复制分享文案。
- 当前活动商品。
- 进度：例如 `1/3`、`2/3`。

分享文案示例：

```text
我在爱买买参加了一个团购分享活动，你通过这个链接购买同款商品，我可以获得本次购物回馈。商品服务和售后规则正常适用。
```

分享文案不得承诺一定返还，不得出现赚钱、收益、团队、下级等导向。

### 分享码落地页

其他用户打开 `/gb/{code}` 后：

1. 未登录用户先登录 / 注册，登录后继续回到团购确认页。
2. 已登录用户进入团购专用付款确认页。
3. 页面标识“由某用户分享”，不展示对方手机号等隐私信息。
4. 后端校验：
   - 分享码存在且可用。
   - 分享码不属于当前用户。
   - 活动仍可购买。
   - 当前用户没有另一个占用中的团购资格。
   - 购买商品与分享码绑定活动一致。

通过分享码购买成功后：

- 该订单成为发起人的直接分享候选订单。
- 购买人也同时开启自己的团购资格，进入 `待生成分享码` 状态。
- 购买人的分享码仍要等自己的订单有效后才生成。

## 业务状态规则

### 发起人订单有效条件

用户现金购买团购商品成功后，系统创建团购实例，但不立即生成分享码。

分享码生成必须同时满足：

1. 订单已确认收货。
2. 售后期已结束。
3. 订单及对应商品行没有任何退款、退货、换货、取消或成功售后。
4. 活动未被管理员强制作废该实例。
5. 用户没有主动放弃本次团购资格。

如果本人团购订单发生任何退换货或退款，本次团购资格失效，不生成分享码；如果分享码已生成后发生管理员特殊退款或补偿售后，分享码应被禁用，未释放的返还全部作废。

### 好友订单有效条件

直接分享候选订单必须同时满足：

1. 通过该分享码购买。
2. 购买同一团购活动的同一 SKU。
3. 买家不是分享码所有人。
4. 现金支付成功。
5. 订单确认收货。
6. 售后期结束。
7. 无任何退款、退货、换货或取消。

一旦发生任何退换货，该候选订单不计入有效名额，已占用名额释放，分享码可继续等待新的直接分享订单，除非用户已主动结束。

### 名额与档位计算

档位按最终有效的直接分享订单顺序计算：

- 第 1 个有效订单使用第 1 档。
- 第 2 个有效订单使用第 2 档。
- 第 3 个有效订单使用第 3 档。

后台允许配置任意数量档位，比例总和只要求大于 0，允许合计超过 100%。默认三档为 10%、20%、70%。买家端只展示进度和条件，不展示返还档位百分比。

为避免并发超收，分享码同一时间最多允许存在“档位数”数量的候选或有效直接推荐订单。名额判断必须以 `GroupBuyReferral` 明细为准，不得只依赖实例计数字段；候选订单退款、退货、换货或取消后释放候选名额。达到档位数个有效订单后，团购实例完成，分享码永久失效。

### 终止规则

用户可随时结束当前团购。

如果状态为 `待生成分享码`：

- 操作名为“放弃本次团购资格”。
- 后续不生成分享码。
- 已购买商品正常履约，售后规则照旧。
- 本月发起次数不退回。

如果状态为 `分享进行中` 或 `名额待确认`：

- 操作名为“结束本次分享”。
- 分享码立即禁用，不再接受新直接分享订单。
- 结束前已成功支付的直接分享候选订单继续观察。
- 这些既有订单后续满足有效条件时，仍按对应有效顺序释放返还。
- 未达成的档位不产生返还。
- 用户结束后可购买新的团购商品，前提是本月次数未用完。

### 月度次数

每个买家每自然月可发起团购次数由后台配置，默认 4 次。

计数口径：

- 团购现金支付成功后立即消耗一次。
- 自己购买后退换货、放弃资格、结束分享、活动过期、未推荐满均不退回次数。
- 通过他人分享码购买同款团购商品，也算该买家的新一次团购发起。
- 管理后台可调整全局月度次数，但不追溯已消耗记录。

### 活动状态变更

活动暂停、结束或下架只影响新的购买和新的分享码落地页校验，不追溯影响已经支付成功的团购实例。

- 已支付的发起订单继续履约。
- 已生成的分享码在活动结束后不再接受新的分享购买。
- 活动结束前已经支付成功的直接分享候选订单继续观察，满足有效条件后仍按实例快照释放返还。
- 已创建实例使用创建时的团购价、包邮配置和档位快照，不受后台后续改价或改档影响。

## 后端架构

### 模块边界

新增 `backend/src/modules/group-buy`，负责：

- 团购活动读取和校验。
- 团购专用确认页创建。
- 分享码生成、校验和失效。
- 团购实例状态机。
- 直接分享候选订单记录。
- 返还档位计算和流水释放。
- 与订单、售后、支付、提现和抵扣系统的集成点。

旧 `backend/src/modules/group` 保持现有考察团 / 报名语义，不参与本功能。

### 专用结算流

团购购买不进入普通购物车，使用团购专用 checkout：

1. App 请求创建团购确认单。
2. 后端校验活动、SKU、库存、当前团购占用、月度次数、分享码。
3. 创建只允许现金支付的 checkout session 或团购 payment intent。
4. 支付成功回调中使用 Serializable 事务：
   - 创建 `Order` / `OrderItem`。
   - 标记订单为团购订单。
   - 创建买家的 `GroupBuyInstance`，状态为 `QUALIFICATION_PENDING`。
   - 若通过分享码购买，创建发起人的 `GroupBuyReferral` 候选记录。
   - 消耗买家当月发起次数。

团购订单仍复用现有订单详情、物流、确认收货和售后能力。

### 金额与优惠拦截

团购确认单必须强校验：

- `rewardDeductionAmount = 0`
- `groupBuyRebateDeductionAmount = 0`
- `couponDiscount = 0`
- `vipDiscountAmount = 0`
- 其他促销折扣为 0

订单商品金额为活动团购价。运费根据活动包邮配置决定：

- 包邮：用户支付团购价，返还基数为团购价。
- 不包邮：用户支付团购价 + 平台运费规则计算出的运费，返还基数仍为团购价；运费必须在团购 checkout 时锁定到 `CheckoutSession.shippingFee` 和团购实例快照，不得静默按 0 元处理。

### 订单标记

团购订单必须在订单侧留下可查询标记，实施时可选择新增字段或独立关联表，但必须满足：

- 能区分普通订单、团购发起订单、通过分享码购买的团购订单。
- 能从订单追溯到 `GroupBuyInstance`、`GroupBuyActivity` 和 `GroupBuyReferral`。
- 管理后台订单详情能展示团购活动、分享码、分享用户和有效性状态。
- 售后、退款、物流和确认收货逻辑可通过订单标记回调团购模块。

### 售后联动

团购模块监听或被调用于以下节点：

1. 订单确认收货。
2. `Order.returnWindowExpiresAt` 到期。
3. 售后申请创建。
4. 售后退款、退货、换货成功。
5. 订单取消或退款成功。

释放返还时不得只看 `RECEIVED`，必须同时确认售后期结束且无任何退换货。

由于确认收货时售后期通常尚未结束，团购模块必须有补偿扫描任务，定期扫描已到售后期截止时间、发生售后/退款或状态已取消/退款的团购相关订单，并重新执行分享码生成、候选推荐释放或失效判断。

## 数据模型设计

以下为设计级模型，字段命名可在实施时按 Prisma 校验微调。

### 枚举

```prisma
enum GroupBuyActivityStatus {
  DRAFT
  ACTIVE
  PAUSED
  ENDED
}

enum GroupBuyInstanceStatus {
  QUALIFICATION_PENDING
  SHARING
  COMPLETED
  TERMINATED
  QUALIFICATION_ABANDONED
  QUALIFICATION_INVALID
  EXPIRED
}

enum GroupBuyCodeStatus {
  PENDING
  ACTIVE
  DISABLED
  COMPLETED
  EXPIRED
}

enum GroupBuyReferralStatus {
  CANDIDATE
  VALID
  INVALID
  VOIDED
}

enum GroupBuyRebateLedgerType {
  PENDING_REBATE
  RELEASE
  VOID
  WITHDRAW
  DEDUCT
  REFUND_RETURN
  ADMIN_ADJUST
}

enum GroupBuyRebateLedgerStatus {
  PENDING
  AVAILABLE
  RESERVED
  COMPLETED
  VOIDED
  FAILED
}
```

### 团购活动

```prisma
model GroupBuyActivity {
  id             String                 @id @default(cuid())
  title          String
  productId      String
  skuId          String
  price          Float
  freeShipping   Boolean                @default(false)
  status         GroupBuyActivityStatus @default(DRAFT)
  startAt        DateTime?
  endAt          DateTime?
  displayOrder   Int                    @default(0)
  ruleSummary    String?
  createdAt      DateTime               @default(now())
  updatedAt      DateTime               @updatedAt
  deletedAt      DateTime?

  tiers          GroupBuyTier[]
  instances      GroupBuyInstance[]

  @@index([status, startAt, endAt])
  @@index([productId, skuId])
}
```

### 返还档位

```prisma
model GroupBuyTier {
  id          String @id @default(cuid())
  activityId  String
  sequence    Int
  percent     Float
  label       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  activity    GroupBuyActivity @relation(fields: [activityId], references: [id], onDelete: Restrict)

  @@unique([activityId, sequence])
  @@index([activityId])
}
```

保存活动时必须校验：

- 至少 1 个档位。
- `sum(percent) == 1.0`，使用分 / basis points 或 Decimal 思路避免浮点误差。
- `sequence` 从 1 连续递增。

### 团购实例

```prisma
model GroupBuyInstance {
  id                      String                 @id @default(cuid())
  userId                  String
  activityId              String
  initiatorOrderId         String
  initiatorOrderItemId     String?
  status                  GroupBuyInstanceStatus @default(QUALIFICATION_PENDING)
  priceSnapshot           Float
  shippingFeeSnapshot     Float                  @default(0)
  freeShippingSnapshot    Boolean                @default(false)
  tierSnapshot            Json
  monthlyBucket           String                 // YYYY-MM
  quotaConsumedAt         DateTime
  qualificationReadyAt    DateTime?
  codeGeneratedAt         DateTime?
  terminatedAt            DateTime?
  terminatedBy            String?
  terminateReason         String?
  completedAt             DateTime?
  invalidReason           String?
  createdAt               DateTime               @default(now())
  updatedAt               DateTime               @updatedAt

  activity                GroupBuyActivity        @relation(fields: [activityId], references: [id], onDelete: Restrict)
  code                    GroupBuyCode?
  referrals               GroupBuyReferral[]
  rebateLedgers           GroupBuyRebateLedger[]

  @@index([userId, status])
  @@index([activityId, status])
  @@index([initiatorOrderId])
  @@index([monthlyBucket, userId])
}
```

### 分享码

```prisma
model GroupBuyCode {
  id          String             @id @default(cuid())
  instanceId  String             @unique
  code        String             @unique
  status      GroupBuyCodeStatus @default(PENDING)
  generatedAt DateTime?
  disabledAt  DateTime?
  disabledReason String?
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  instance    GroupBuyInstance   @relation(fields: [instanceId], references: [id], onDelete: Restrict)
  referrals   GroupBuyReferral[]

  @@index([status])
}
```

### 直接分享候选订单

```prisma
model GroupBuyReferral {
  id                  String                 @id @default(cuid())
  instanceId           String
  codeId               String
  referredUserId       String
  referredOrderId      String
  referredOrderItemId  String?
  status              GroupBuyReferralStatus @default(CANDIDATE)
  effectiveSequence   Int?
  effectiveAt         DateTime?
  invalidAt           DateTime?
  invalidReason       String?
  createdAt           DateTime               @default(now())
  updatedAt           DateTime               @updatedAt

  instance            GroupBuyInstance       @relation(fields: [instanceId], references: [id], onDelete: Restrict)
  code                GroupBuyCode           @relation(fields: [codeId], references: [id], onDelete: Restrict)
  rebateLedger        GroupBuyRebateLedger?

  @@unique([instanceId, referredOrderId])
  @@index([instanceId, status])
  @@index([referredUserId, createdAt])
  @@index([referredOrderId])
}
```

`effectiveSequence` 只在订单成为有效订单时分配，按最终有效顺序决定 10% / 20% / 70% 等档位。

### 团购返还账户

```prisma
model GroupBuyRebateAccount {
  id             String   @id @default(cuid())
  userId          String   @unique
  balance         Float    @default(0)
  frozen          Float    @default(0)
  totalReleased   Float    @default(0)
  totalWithdrawn  Float    @default(0)
  totalDeducted   Float    @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  ledgers         GroupBuyRebateLedger[]

  @@index([balance])
}
```

### 团购返还流水

```prisma
model GroupBuyRebateLedger {
  id              String                     @id @default(cuid())
  accountId       String
  userId          String
  instanceId      String?
  referralId      String?                    @unique
  orderId         String?
  type            GroupBuyRebateLedgerType
  status          GroupBuyRebateLedgerStatus
  amount          Float
  balanceAfter    Float?
  tierSequence    Int?
  tierPercent     Float?
  idempotencyKey  String                     @unique
  reason          String?
  meta            Json?
  createdAt       DateTime                   @default(now())
  updatedAt       DateTime                   @updatedAt

  account         GroupBuyRebateAccount      @relation(fields: [accountId], references: [id], onDelete: Restrict)
  instance        GroupBuyInstance?          @relation(fields: [instanceId], references: [id], onDelete: Restrict)
  referral        GroupBuyReferral?          @relation(fields: [referralId], references: [id], onDelete: Restrict)

  @@index([userId, createdAt])
  @@index([accountId, createdAt])
  @@index([instanceId])
  @@index([orderId])
  @@index([status, createdAt])
}
```

## 返还释放流程

### 创建待返还记录

好友订单支付成功后只创建候选关系，不立即给发起人展示可用余额。

当候选订单确认收货、售后期结束且无任何退换货时：

1. Serializable 事务重新锁定团购实例。
2. 校验实例未失效，且该候选仍为 `CANDIDATE`。
3. 统计当前 `VALID` 数量，分配下一个 `effectiveSequence`。
4. 按活动档位快照计算金额：`round(priceSnapshot * tierPercent, 2)`。
5. 创建 `GroupBuyRebateLedger`。
6. 增加 `GroupBuyRebateAccount.balance`。
7. 标记候选为 `VALID`。
8. 若有效数量达到档位数，实例 `COMPLETED`，分享码 `COMPLETED`。

### 失效处理

任意候选订单发生退款、退货、换货、取消或成功售后：

- 如果仍是 `CANDIDATE`：标记 `INVALID`，释放候选名额。
- 如果已 `VALID` 且返还已释放：第一版应避免这种情况，因为释放必须等售后期结束；若管理员特殊退款导致发生，写 `VOID` 或冲正流水，并扣回可用余额，不足时进入人工处理队列。

### 终止后的释放

实例 `TERMINATED` 后：

- 不再接受新候选订单。
- 终止前已支付的候选订单继续观察。
- 候选订单有效后仍释放对应返还。
- 所有候选订单最终变为 `VALID` 或 `INVALID` 后，实例保持 `TERMINATED`，后台展示最终实际返还金额。

## 团购返还余额使用

团购返还余额是独立账户，但能力与消费积分类似：

1. 可提现到支付宝，税务处理和通道在实施计划中与现有提现链路对齐。
2. 可抵扣普通商品订单。
3. 不可抵扣团购商品。
4. 不与 `RewardAccount` 合并展示或合并扣减。
5. 用户注销、提现处理中、订单退款等资金安全规则需在实施计划中逐项接入。

普通商品结算页增加“团购返还余额抵扣”入口时，必须与消费积分抵扣分开显示，避免语义混淆。

## 管理后台设计

新增一级菜单：`团购管理`。

### 团购活动

用于配置可购买的团购商品。

字段和操作：

- 活动名称。
- 选择平台商品 / SKU。
- 团购价。
- 是否包邮。
- 活动开始 / 结束时间。
- 活动状态：草稿、启用、暂停、结束。
- 返还档位配置。
- 排序和上下架。
- 规则摘要。

约束：

- 只能选择平台商品。
- 商品或 SKU 被启用团购活动引用时，不允许删除或下架到不可购买状态，除非先暂停 / 结束团购活动。
- 修改团购价或档位只影响新实例；已创建实例使用快照。

### 团购实例

用于查看每个用户的一次团购。

列表字段：

- 实例 ID。
- 用户公开编号 / 昵称。
- 活动商品。
- 发起订单号。
- 状态。
- 分享码。
- 当前有效进度。
- 候选订单数。
- 已返还金额。
- 创建时间。
- 分享码生成时间。
- 结束时间。

详情页：

- 发起人订单状态、物流、售后状态。
- 分享码状态。
- 直接分享候选订单列表。
- 每个候选订单的有效 / 无效原因。
- 档位快照和返还流水。
- 终止记录：操作者、时间、原因。

后台只展示一级直接分享订单，不画关系树，不展示好友的再分享数据。

### 团购订单

用于按订单视角追踪团购链路。

筛选：

- 活动。
- 订单角色：发起订单 / 通过分享购买订单。
- 订单状态。
- 售后状态。
- 是否计入有效名额。
- 支付时间 / 确认收货时间 / 售后期结束时间。

列表字段：

- 订单号。
- 买家。
- 活动商品。
- 团购价。
- 运费。
- 是否包邮。
- 支付渠道。
- 关联团购实例。
- 关联分享码。
- 分享用户。
- 有效性状态和原因。

### 团购返还流水

用于财务和客服查询。

字段：

- 用户。
- 账户余额。
- 流水类型。
- 金额。
- 状态。
- 来源团购实例。
- 来源订单。
- 档位和比例。
- 创建时间。
- 释放 / 作废原因。

禁止在后台文案中使用“佣金、提成、收益”等词，统一写“返还货款 / 团购返还”。

### 全局规则配置

团购管理中增加规则配置：

- 每人每自然月发起次数，默认 4。
- 分享码有效期策略。
- 活动页规则文案。
- 提现税费和抵扣规则引用现有资金配置或独立配置。

## API 设计草案

买家端：

- `GET /group-buy/activities`：团购商品列表。
- `GET /group-buy/activities/:id`：团购商品详情。
- `GET /group-buy/me/current`：当前团购状态。
- `POST /group-buy/checkout`：创建团购专用确认单。
- `POST /group-buy/checkout/:id/pay`：发起现金支付。
- `GET /group-buy/codes/:code/landing`：分享码落地信息。
- `POST /group-buy/me/current/terminate`：结束本次分享。
- `POST /group-buy/me/current/abandon`：放弃待生成分享码资格。
- `GET /group-buy/me/rebate-account`：团购返还余额。
- `GET /group-buy/me/rebate-ledgers`：团购返还流水。

管理后台：

- `GET /admin/group-buy/activities`
- `POST /admin/group-buy/activities`
- `PATCH /admin/group-buy/activities/:id`
- `GET /admin/group-buy/instances`
- `GET /admin/group-buy/instances/:id`
- `GET /admin/group-buy/orders`
- `GET /admin/group-buy/rebate-ledgers`
- `GET /admin/group-buy/settings`
- `PATCH /admin/group-buy/settings`

## 并发与安全

以下操作必须使用 Serializable 事务或等价 CAS 保护：

1. 创建团购 checkout 并校验当前占用。
2. 支付成功后创建团购实例、候选关系、月度次数。
3. 分享码生成。
4. 通过分享码购买并占用候选名额。
5. 候选订单转有效并释放返还。
6. 候选订单失效并释放名额。
7. 用户结束本次分享。
8. 团购返还余额提现、抵扣和冲正。

关键幂等键：

- 支付回调：`GROUP_BUY_ORDER:{paymentId}`。
- 分享候选：`GROUP_BUY_REFERRAL:{instanceId}:{orderId}`。
- 返还释放：`GROUP_BUY_REBATE:{referralId}`。
- 售后作废：`GROUP_BUY_VOID:{orderId}:{afterSaleId}`。
- 终止操作：`GROUP_BUY_TERMINATE:{instanceId}:{requestId}`。

## 与现有系统关系

### 与旧 GroupModule

旧 `GroupModule` 是考察团 / 报名人数 / 目的地 / 截止日期语义，不承载本功能。新功能命名为 `group-buy`，避免冲突。

### 与 VIP 推荐码

VIP 推荐码仍使用现有 `/r/{code}` 和 VIP 规则。团购使用 `/gb/{code}`，不复用 VIP 推荐码，也不要求用户是 VIP。

### 与 Reward 消费积分

团购返还余额不进入 `RewardAccount`。普通商品结算可同时支持消费积分和团购返还余额，但要分别展示、分别记账、分别对账。

### 与 Coupon 平台红包

团购购买禁止使用平台红包。普通商品结算中，团购返还余额是否可与平台红包叠加，实施计划阶段按现有普通商品优惠顺序设计，但不得影响团购购买禁用规则。

### 与售后

现有普通商品确认收货后仍可在售后窗口内申请售后。因此团购分享码生成和返还释放都必须等待 `returnWindowExpiresAt` 过期并确认无售后，而不是只看确认收货。

## 测试验收

### 后端测试

- 活动配置校验：档位总和必须等于 100%。
- 团购购买禁止所有抵扣和优惠。
- 每月次数购买成功即消耗，不因退款或放弃退回。
- 同一用户同时只能有一个占用中的团购。
- 待生成分享码阶段可放弃资格并购买新团购。
- 发起人订单确认收货但售后期未过，不生成分享码。
- 发起人订单售后期过且无退换货，生成分享码。
- 自己扫码自己的分享码被拒绝。
- 好友订单售后期过且无退换货后计入有效名额。
- 好友订单发生任意退换货后不计入。
- 用户结束分享后，不接受新候选订单；既有候选订单继续观察。
- 达到档位数个有效订单后，分享码完成并失效。
- 团购返还余额释放、提现、普通商品抵扣、团购商品禁用抵扣。
- 并发扫码购买时不超过候选名额上限。

### App 测试

- 无当前团购时，入口直接展示团购商品。
- 有当前团购时，入口默认展示 `我的团购`。
- 第二个 Tab 始终可浏览团购商品。
- 有当前团购时点击购买，只显示 `继续分享` 和 `结束本次分享并购买`。
- 待生成分享码时点击购买，显示 `继续等待` 和 `放弃本次团购资格并购买`。
- 分享码二维码和链接可复制。
- `/gb/{code}` 未登录登录后回到付款页。
- 分享码无效、本人扫码、活动结束、当前已有团购时都有明确提示。

### 管理后台测试

- 活动增删改查、启停、档位配置。
- 被活动引用的 SKU 删除 / 下架保护。
- 实例列表和详情展示准确。
- 订单列表可查发起订单和分享购买订单。
- 返还流水可按用户、活动、订单、状态筛选。
- 页面无敏感词、无团队树、无榜单。

## 上线前检查清单

- 页面没有多级、团队、下级、佣金、收益、赚钱等敏感表达。
- 首页、团购详情、付款确认页均展示关键限制。
- 团购购买链路完全禁止所有非现金抵扣和优惠。
- 分享码生成和返还释放都等待售后期结束。
- 任意退货、换货、退款都会使对应资格或候选订单失效。
- 同时一个当前团购的限制在后端强制，不只依赖前端。
- 月度次数在支付成功事务内消耗。
- 所有资金、名额、状态迁移使用 Serializable 或 CAS。
- 管理后台能从活动、实例、订单、流水四个维度追踪每一笔数据。
