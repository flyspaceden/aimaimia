# 普通会员增长、分享码与成长系统设计方案

> 状态：正式设计修订稿，待实施计划
> 创建时间：2026-07-03
> 修订时间：2026-07-03
> 适用范围：买家 App / 官网落地页 / 后端 / 管理后台 / 平台红包 / 普通积分 / 成长值 / 普通分享码 / VIP 转化
>
> **For agentic workers:** 本文档是“普通会员增长、普通分享码、普通积分与成长值系统”的权威来源。本功能独立于现有 VIP 推荐码、VIP 树、普通分润树、团购分享码、消费积分 Reward 和平台红包 Coupon，但会按边界复用其中已存在的能力。

## 1. 背景

当前 App 已有团购、抽奖、新人红包、首单红包、普通奖励钱包、普通树、任务、签到、用户资料积分字段、成长值字段和消费积分抵扣。但这些能力没有形成一套面向普通用户的完整增长体系。

现有代码与产品状态有几个关键问题：

1. 推荐码链路是 VIP 专属。普通用户可以绑定推荐人，但不能拥有可传播的 App 级分享身份。
2. 团购和抽奖是活动入口，能制造短期转化，但不能替代每个普通用户都能持续发起的拉新机制。
3. `UserProfile.points` 和 `growthPoints` 字段已存在，任务和签到也能写入积分/成长值，但目前只是底层字段和局部页面能力，没有形成正式版可运营体系。
4. App 文案和入口仍容易让用户感觉“买 VIP 才有主要权益”，导致 VIP 像门槛，而不是升级。
5. 管理后台已有红包、抽奖、团购、普通/VIP 配置等运营能力，但缺少一个可配置、可审计、可统计的会员成长运营后台。

本设计的目标是整体优化增长漏斗：

```text
让人知道 App -> 下载注册 -> 登录活跃 -> 首单 -> 复购 -> 分享 -> 升级 VIP
```

最终产品定位：

```text
普通用户拥有完整基础权益和分享能力。
VIP 只做升级加速，不做入场门槛。
```

## 2. 核心结论

正式版新增三块能力，并由管理后台统一配置：

1. **普通分享码 / 新人福利码**
   每个正常买家用户都可以分享 App。普通分享码独立于 VIP 推荐码，不复用 `/r/{code}`，不进入 VIP 树，也不改变普通树节点位置。

2. **普通积分 + 成长值系统**
   普通积分用于兑换平台福利；成长值用于会员等级和身份成长。两者独立于现有消费积分 Reward。

3. **会员成长运营后台**
   后台可配置行为类别、行为奖励、等级体系、积分兑换、新人 7 日路径、普通分享奖励、风控上限和数据看板。

推荐正式版增长组合：

```text
新人：注册领新人红包 + 普通积分 + 成长值
普通用户：签到、任务、购物、评价、分享获得普通积分和成长值
邀请人：好友首单确认收货后获得红包 + 普通积分 + 成长值
VIP：在普通权益基础上获得加速和专属权益
```

## 3. 系统边界

| 系统 | 本设计关系 |
|---|---|
| VIP 推荐码 | 保持 VIP 专属，不下放，不复用字段 |
| VIP 树 | 不接入普通分享码 |
| 普通树 | 不按邀请关系插入，仍按首单后自动平衡入树 |
| 团购分享码 | 保持 `/gb/{code}` 独立链路，不复用 |
| 平台红包 Coupon | 用作新人红包、首单红包、积分兑换红包、邀请奖励红包 |
| 消费积分 Reward | 保持现有资金/准资金能力，不与普通积分混用 |
| 普通积分 | 新增长运营积分，不提现，不直接现金抵扣订单 |
| 成长值 | 新增会员成长值，不消耗，不提现，不兑换现金 |
| 数字资产 | 不下放给普通用户，作为 VIP 转化桥 |

三个“积分”必须在代码、后台和页面文案中严格区分：

| 名称 | 推荐前端文案 | 用途 | 现金属性 |
|---|---|---|---|
| 普通积分 | 积分 | 兑换红包、运费券、抽奖机会、VIP 抵扣券、装饰权益 | 无 |
| 成长值 | 成长值 | 等级、称号、头像框、权益解锁 | 无 |
| Reward 余额 | 消费积分 / 奖励钱包 | 普通商品抵扣、提现等现有能力 | 有或准资金 |

## 4. 非目标

第一版不做以下内容：

- 不给普通用户开放现有 VIP 推荐码。
- 不允许普通分享码产生 VIP 推荐收益。
- 不按普通分享关系改变普通树节点位置。
- 不做多级邀请、团队关系、排行榜或层级展示。
- 不把普通分享码用于团购付款。
- 不让普通积分直接抵扣订单现金金额。
- 不让普通积分提现。
- 不把普通积分计入 RewardAccount。
- 不改变团购、抽奖、VIP 礼包、数字资产和现有订单支付主流程。

## 5. 普通分享码设计

### 5.1 分享码定义

每个正常买家用户可拥有一个普通分享码。

建议新增独立概念：

```text
NormalShareCode
```

不要复用 `MemberProfile.referralCode`，因为该字段当前已经被定义为 VIP 推荐码，并且后端依赖它判断 VIP 推荐关系。

普通分享码第一版使用独立随机短码，不直接使用 `buyerNo`。`buyerNo` 可以用于页面展示和客服查询，但不承担增长归因和风控状态。

建议链接：

```text
https://app.ai-maimai.com/s/{code}
```

`/s/{code}` 表示普通分享落地页，和 VIP `/r/{code}`、团购 `/gb/{code}` 分离。

### 5.2 归因规则

用户打开 `/s/{code}` 后：

1. 官网落地页展示邀请人昵称或脱敏信息、App 下载入口和新人福利说明。
2. 未安装 App 时，写入 Cookie 与服务端延迟归因记录。
3. 已安装 App 时，Deep Link 打开 App 并保存 pending normal share code。
4. 用户注册或登录后，尝试绑定普通分享关系。

绑定限制：

- 不能绑定自己的普通分享码。
- 已绑定普通分享关系后不允许频繁换绑。
- 已有 VIP 推荐关系不被普通分享码覆盖。
- 普通分享关系不影响 VIP 购买时的 VIP 推荐人确认流程。
- 注销、封禁、非 ACTIVE 用户的分享码不可继续绑定。
- 管理后台可禁用某个用户的普通分享码。

### 5.3 邀请奖励规则

普通分享不在注册时给邀请人重奖励，避免刷号。注册可以给邀请人小额积分/成长值，核心奖励必须等好友首单确认收货后发放。

邀请人核心奖励触发条件：

```text
被邀请人完成首笔普通商品订单
订单已确认收货
订单无取消、退款、退货、换货成功
订单不是 VIP 礼包订单
订单不是团购订单
订单不是纯奖品或 0 元订单
```

第一版奖励：

- 邀请人：平台红包 + 普通积分 + 成长值。
- 被邀请人：新人红包 + 首单红包 + 普通积分 + 成长值。

资金型奖励不进入第一版。若未来开放普通奖励钱包或可提现余额，必须等售后窗口结束且无成功售后后发放。

奖励幂等键建议：

```text
NORMAL_INVITE_REGISTER:{inviteeUserId}
NORMAL_INVITE_FIRST_ORDER:{inviteeUserId}:{orderId}
```

## 6. 普通积分与成长值设计

### 6.1 资产定义

| 名称 | 是否可消耗 | 是否过期 | 作用 |
|---|---:|---:|---|
| 普通积分 | 是 | 是，默认 365 天 | 兑换平台福利 |
| 成长值 | 否 | 否 | 会员等级、身份权益、VIP 转化桥 |

普通积分第一版只能兑换平台福利：

- 平台红包。
- 运费券。
- 抽奖机会。
- VIP 礼包抵扣券。
- 头像框、称号等装饰权益。

成长值只累计，不消耗，不清零。第一版不做等级降级，避免用户反感。

### 6.2 默认会员等级

等级和门槛都必须可在管理后台配置。默认值如下：

| 等级 | 成长值门槛 | 定位 | 默认权益方向 |
|---|---:|---|---|
| 新芽会员 | 0 | 注册即有 | 基础签到、基础兑换 |
| 青苗会员 | 300 | 完成新手路径 | 解锁更多兑换 |
| 青穗会员 | 1000 | 有首单和复购 | 每月兑换额度提升 |
| 丰收会员 | 3000 | 稳定购买用户 | 头像框、称号 |
| 金穗会员 | 8000 | 高活跃用户 | 高阶红包兑换 |
| 星农会员 | 20000 | 高价值普通用户 | VIP 转化重点人群 |

等级门槛只能递增，不能重复。已有用户正在使用的等级不能硬删除，只能停用或改展示。

### 6.3 默认行为奖励

行为类别和数值都必须可在管理后台配置。默认值如下：

| 行为 | 类别 | 普通积分 | 成长值 | 默认限制 |
|---|---|---:|---:|---|
| 注册成功 | 新手 | 30 | 50 | 终身 1 次 |
| 完善资料 | 新手 | 20 | 30 | 终身 1 次 |
| 绑定微信/手机号 | 新手 | 30 | 50 | 终身 1 次 |
| 每日签到 | 日常 | 5-30 | 0-20 | 每日 1 次，连续递增 |
| 浏览 3 个商品 | 日常 | 5 | 5 | 每日 1 次 |
| 收藏商品/店铺 | 日常 | 5 | 5 | 每日 2 次 |
| 分享商品/活动 | 分享 | 5 | 5 | 每日 3 次 |
| 首单确认收货 | 购物 | 100 | 200 | 终身 1 次 |
| 评价商品 | 购物 | 20 | 20 | 每订单 1 次 |
| 复购确认收货 | 购物 | 50 | 100 | 每月 5 次 |
| 邀请好友注册 | 邀请 | 20 | 20 | 每日 5 人 |
| 好友首单确认收货 | 邀请 | 200 | 300 | 每月 20 人 |
| 购买 VIP | VIP 转化 | 0 | 500 | 终身 1 次 |

说明：

- 注册、签到、浏览给小奖励，降低入门门槛。
- 首单、复购、好友首单给大奖励，引导购买和分享。
- 分享类奖励必须有日上限，避免刷分享。
- 购物类奖励必须支持退款/退货/换货冲正。

### 6.4 积分兑换默认项

兑换物必须可在管理后台配置。默认值如下：

| 兑换物 | 消耗积分 | 限制 |
|---|---:|---|
| 2 元红包 | 200 | 满 29 可用 |
| 5 元红包 | 500 | 满 59 可用 |
| 10 元红包 | 1000 | 满 99 可用 |
| 运费券 | 300 | 每月限 1 张 |
| 抽奖机会 | 100 | 每周限 2 次 |
| VIP 礼包抵扣券 20 元 | 2000 | 每月限 1 张，不可提现 |
| 头像框/称号 | 300-1000 | 装饰权益 |

红包、运费券、VIP 抵扣券应复用 Coupon 系统，不新建优惠券模型。积分兑换成功后，由成长系统扣积分，再调用红包系统发放对应 Coupon。

VIP 礼包抵扣券是降低 VIP 心理门槛的关键能力。它的文案应是：

```text
你在普通会员成长中攒出了升级机会。
```

不能写成现金返现或提现。

## 7. 新用户 7 日路径

新用户 7 日路径优先复用红包、行为规则、签到、任务和普通商品订单能力。

| 时间 | 主目标 | 用户动作 | 系统激励 |
|---|---|---|---|
| 第 0 天 | 注册登录 | 通过普通分享码下载注册 | 新人红包 + 注册积分 + 成长值 |
| 第 1 天 | 首次活跃 | 签到、浏览精选商品 | 签到积分 + 浏览任务 |
| 第 2 天 | 建立兴趣 | 收藏商品或店铺、加购 | 积分 + 成长值 |
| 第 3 天 | 首单下单 | 使用新人红包或首单红包下单 | 首单红包抵扣 |
| 第 4 天 | 履约信任 | 查看订单、物流、客服入口 | 成长值 |
| 第 5 天 | 收货价值 | 确认收货、评价 | 首单积分 + 成长值 + 评价奖励 |
| 第 6-7 天 | 分享裂变 | 分享新人福利码 | 邀请注册奖励，好友首单后核心奖励 |

App 不应一进来就主推 VIP。VIP 应在以下时机出现：

- 用户完成首单确认收货后。
- 用户积分接近 VIP 抵扣券兑换门槛时。
- 用户达到青穗/丰收等级后。
- 用户分享或复购活跃后。

## 8. VIP 转化设计

VIP 页面从“未购买则缺少资格”调整为“普通权益升级加速”。

普通用户看到：

- 当前等级。
- 当前普通积分。
- 当前成长值。
- 本月已省金额。
- 可兑换 VIP 抵扣券进度。
- 升级 VIP 后可获得的增量权益。

VIP 增量权益建议：

- 普通商品消费积分抵扣比例从 10% 到 15%。
- VIP 礼包和专属赠品。
- 数字资产激活。
- VIP 推荐码和 VIP 推荐权益。
- VIP 每日签到积分加成，例如 1.2 倍。
- VIP 购物成长值加成，例如 1.5 倍。
- VIP 专属周任务。

VIP 不再作为基础分享、基础签到、基础积分、基础成长的门槛。

## 9. App 端设计

### 9.1 我的页

我的页需要从“VIP 转化中心”调整为“普通会员权益先展示，VIP 作为升级入口”。

建议结构：

1. 身份卡：昵称、买家编号、普通会员等级、成长进度。
2. 成长模块：签到、任务、普通积分、成长值。
3. 新人福利码：普通分享二维码、复制、系统分享。
4. 积分兑换入口：可兑换红包、运费券、抽奖机会、VIP 抵扣券。
5. 钱包概览：消费积分、普通奖励、团购返还余额按账户说明展示。
6. VIP 升级提示：基于用户已有普通权益给出差异化提示。

### 9.2 会员成长中心

新增或改造 `/me/growth`：

- 当前等级和成长进度。
- 普通积分余额。
- 今日可做任务。
- 新人 7 日路径。
- 积分兑换入口。
- 成长值明细。
- 积分明细。
- VIP 升级桥。

### 9.3 新人福利码页

普通用户页面展示：

- 我的新人福利码。
- 二维码。
- 复制链接。
- 分享给好友。
- 已邀请注册人数。
- 已完成首单人数。
- 待发放奖励。
- 已到账奖励。
- 规则说明。

VIP 用户页面可以同时展示：

- 普通新人福利码：用于普通 App 拉新。
- VIP 推荐码：用于 VIP 推荐权益。

两者必须用不同标题、不同路径、不同规则说明。

### 9.4 积分兑换页

新增或改造 `/me/points-exchange`：

- 红包兑换。
- 运费券兑换。
- 抽奖机会兑换。
- VIP 礼包抵扣券兑换。
- 装饰权益兑换。
- 兑换记录。
- 即将过期积分提醒。

## 10. 管理后台设计

### 10.1 菜单位置

在管理后台“运营活动”下新增一级菜单：

```text
会员成长
```

建议子页面：

| 页面 | 作用 |
|---|---|
| 会员成长总览 | 注册、活跃、首单、复购、分享、VIP 转化数据 |
| 行为规则 | 配置每个行为给多少积分/成长值、上限、开关 |
| 行为类别 | 配置新手、日常、购物、分享、邀请、VIP 转化等分类 |
| 等级体系 | 配置等级名称、成长值门槛、权益、头像框、称号 |
| 积分兑换 | 配置积分可兑换红包、运费券、抽奖机会、VIP 抵扣券 |
| 新人路径 | 配置新用户 7 日任务路径 |
| 分享码管理 | 查看普通分享码、邀请关系、禁用异常分享码 |
| 用户成长记录 | 查某个用户积分、成长值、流水、兑换、冲正 |
| 风控与异常 | 查刷签到、刷分享、刷邀请、同设备批量注册 |
| 成长设置 | 全局开关、积分有效期、每日总上限、过期提醒 |

### 10.2 行为规则页

行为规则页是核心配置页面。每一行是一个后端已注册的真实行为事件。

字段：

| 字段 | 说明 |
|---|---|
| 行为编码 | 后端事件，如 `REGISTER`、`FIRST_ORDER_RECEIVED` |
| 行为名称 | 后台展示，如“完成首单” |
| 类别 | 新手 / 日常 / 购物 / 分享 / 邀请 / VIP 转化 |
| 普通积分 | 发放多少可消耗积分 |
| 成长值 | 发放多少不可消耗成长值 |
| 发放时机 | 立即 / 确认收货后 / 售后窗口后 |
| 每日上限 | 防刷 |
| 每周上限 | 控制频次 |
| 每月上限 | 控制成本 |
| 终身上限 | 注册、首单这类一次性行为 |
| 是否启用 | 活动开关 |
| 生效时间 | 支持限时运营 |
| 适用用户 | 普通 / VIP / 全部 |
| VIP 加成 | 是否给 VIP 加倍 |
| 风控策略 | 同设备、同手机号、同订单、同分享目标限制 |
| 备注 | 管理员说明 |

后台允许配置数值、上限、类别、文案、开关，但不允许运营凭空创建后端未实现的行为编码。新增行为编码必须通过代码注册后才能在后台启用。

### 10.3 行为类别页

行为类别用于组织任务和 App 展示。

默认类别：

| 类别编码 | 展示名 | 用途 |
|---|---|---|
| NEWBIE | 新手任务 | 注册、完善资料、绑定账号 |
| DAILY | 日常活跃 | 签到、浏览、收藏 |
| SHOPPING | 购物成长 | 首单、复购、评价 |
| SHARE | 分享任务 | 分享商品、活动、App |
| INVITE | 邀请好友 | 好友注册、好友首单 |
| VIP | VIP 转化 | 购买 VIP、VIP 周任务 |

类别可排序、可改展示名、可配置图标和颜色，但不能删除已有规则正在使用的类别。

### 10.4 等级体系页

等级配置字段：

| 字段 | 说明 |
|---|---|
| 等级编码 | 系统内部标识 |
| 等级名称 | 新芽会员、青苗会员等 |
| 成长值门槛 | 必须递增 |
| 等级权益说明 | App 展示文案 |
| 头像框 | 可选 |
| 称号 | 可选 |
| 每月兑换额度 | 控制高等级权益 |
| 可兑换权益 | 关联积分兑换项 |
| 状态 | 启用 / 停用 |

校验规则：

- 门槛必须从低到高递增。
- 最低等级门槛必须为 0。
- 不能出现两个同门槛等级。
- 已有用户命中的等级不能硬删除。
- 修改门槛前后台要提示影响人数。

### 10.5 积分兑换页

兑换项字段：

| 字段 | 说明 |
|---|---|
| 兑换类型 | 红包 / 运费券 / 抽奖机会 / VIP 抵扣券 / 装饰权益 |
| 展示名称 | App 展示 |
| 消耗积分 | 兑换需要多少普通积分 |
| 关联红包活动 | 选择现有 CouponCampaign |
| 总库存 | 可选 |
| 每日库存 | 可选 |
| 每人每日限制 | 防刷 |
| 每人每月限制 | 控制成本 |
| 等级门槛 | 例如青穗会员以上可兑 |
| 生效时间 | 上架时间 |
| 过期时间 | 下架时间 |
| 状态 | 上架 / 下架 |

红包类兑换流程：

```text
用户点击兑换
-> 成长系统校验积分余额、等级、库存、频次
-> 事务内扣普通积分
-> 调用 Coupon 系统发放对应红包
-> 写入兑换记录和积分流水
```

若红包发放失败，积分扣减必须回滚。

### 10.6 新人路径页

新人路径页给运营配置 App 新用户 7 日任务，不让运营在一堆规则里拼。

字段：

| 字段 | 说明 |
|---|---|
| 第几天 | 第 0 天到第 7 天 |
| 主标题 | App 展示 |
| 任务说明 | App 展示 |
| 关联行为规则 | 引用行为规则 |
| 关联红包活动 | 可选 |
| 排序 | 同一天多任务排序 |
| 是否必做 | 决定路径进度 |
| 状态 | 启用 / 停用 |

底层仍然引用行为规则和红包活动，不单独发奖励。

### 10.7 分享码管理页

字段：

| 字段 | 说明 |
|---|---|
| 用户 | 昵称、手机号脱敏、buyerNo |
| 普通分享码 | `/s/{code}` |
| 状态 | 正常 / 禁用 |
| 注册邀请人数 | 被绑定人数 |
| 首单人数 | 已完成首单人数 |
| 待发奖励 | 待确认收货或待发放 |
| 已发奖励 | 红包/积分/成长值 |
| 异常标记 | 同设备、短时批量、退款高 |

操作：

- 禁用分享码。
- 恢复分享码。
- 查看邀请明细。
- 查看奖励流水。
- 标记异常。

### 10.8 用户成长记录页

用于客服和运营排查。

可按用户查询：

- 普通积分余额。
- 累计获得积分。
- 已使用积分。
- 即将过期积分。
- 成长值累计。
- 当前等级。
- 积分流水。
- 成长值流水。
- 兑换记录。
- 管理员调整记录。
- 被冲正记录。

管理员手动调整必须填写原因，并进入审计日志。

### 10.9 风控与异常页

默认异常类型：

- 同设备批量注册。
- 同手机号段批量注册。
- 同邀请人短时间大量注册。
- 邀请用户首单后高退款率。
- 分享任务短时间高频完成。
- 积分兑换异常高频。
- 管理员手动调整异常。

可执行操作：

- 禁用用户普通分享码。
- 暂停用户获得分享奖励。
- 冻结普通积分兑换。
- 手动冲正积分/成长值。
- 导出异常列表。

### 10.10 成长设置页

全局设置：

| 设置 | 默认建议 |
|---|---|
| 成长系统总开关 | 关闭，灰度打开 |
| 普通积分有效期 | 365 天 |
| 积分过期提醒 | 到期前 30 天 |
| 每日积分总获取上限 | 300 |
| 每月积分总获取上限 | 3000 |
| 每日分享奖励人数上限 | 5 |
| 每月好友首单奖励人数上限 | 20 |
| VIP 签到积分加成 | 1.2 |
| VIP 购物成长值加成 | 1.5 |
| 退款冲正开关 | 开启 |
| 异常用户自动暂停兑换 | 第一版关闭，人工处理 |

## 11. 后端设计

### 11.1 数据模型建议

实施时命名可按 Prisma 风格调整，但必须包含账户、流水、规则、等级、兑换和分享关系。

```prisma
model GrowthAccount {
  id                  String   @id @default(cuid())
  userId              String   @unique
  pointsBalance       Int      @default(0)
  pointsTotalEarned   Int      @default(0)
  pointsTotalSpent    Int      @default(0)
  growthValue         Int      @default(0)
  currentLevelCode    String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

model GrowthLedger {
  id              String   @id @default(cuid())
  userId          String
  accountId       String
  type            String
  behaviorCode    String?
  pointsDelta     Int      @default(0)
  growthDelta     Int      @default(0)
  status          String   @default("POSTED")
  idempotencyKey  String   @unique
  refType         String?
  refId           String?
  expiresAt       DateTime?
  meta            Json?
  createdAt       DateTime @default(now())
}

model GrowthBehaviorCategory {
  id          String   @id @default(cuid())
  code        String   @unique
  name        String
  icon        String?
  color       String?
  sortOrder   Int      @default(0)
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model GrowthBehaviorRule {
  id                  String   @id @default(cuid())
  code                String   @unique
  name                String
  categoryCode        String
  pointsReward        Int      @default(0)
  growthReward        Int      @default(0)
  grantTiming         String
  dailyLimit          Int?
  weeklyLimit         Int?
  monthlyLimit        Int?
  lifetimeLimit       Int?
  applicableUserType  String   @default("ALL")
  vipPointsMultiplier Float?
  vipGrowthMultiplier Float?
  riskPolicy          Json?
  startAt             DateTime?
  endAt               DateTime?
  enabled             Boolean  @default(true)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

model GrowthLevel {
  id              String   @id @default(cuid())
  code            String   @unique
  name            String
  threshold       Int
  benefits        Json?
  avatarFrameType String?
  titleLabel      String?
  sortOrder       Int      @default(0)
  enabled         Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model GrowthExchangeItem {
  id                  String   @id @default(cuid())
  type                String
  name                String
  pointsCost          Int
  couponCampaignId    String?
  stockTotal          Int?
  stockDaily          Int?
  perUserDailyLimit   Int?
  perUserMonthlyLimit Int?
  requiredLevelCode   String?
  startAt             DateTime?
  endAt               DateTime?
  status              String   @default("ACTIVE")
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

model GrowthExchangeRecord {
  id              String   @id @default(cuid())
  userId          String
  itemId          String
  pointsCost      Int
  status          String
  couponInstanceId String?
  idempotencyKey  String   @unique
  createdAt       DateTime @default(now())
}
```

普通分享模型：

```prisma
model NormalShareProfile {
  id          String   @id @default(cuid())
  userId      String   @unique
  code        String   @unique
  status      String   @default("ACTIVE")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model NormalShareBinding {
  id             String   @id @default(cuid())
  inviterUserId  String
  inviteeUserId  String   @unique
  code           String
  source         String
  boundAt        DateTime @default(now())
  firstOrderId   String?
  rewardStatus   String   @default("PENDING")
  rewardIssuedAt DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

`UserProfile.points`、`growthPoints`、`level`、`levelProgress` 可作为 App 读模型缓存，但权威账务必须是 `GrowthAccount` 和 `GrowthLedger`。

### 11.2 事件接入

后端只允许处理已注册行为编码。默认事件：

```text
REGISTER
COMPLETE_PROFILE
BIND_PHONE_OR_WECHAT
CHECK_IN
BROWSE_PRODUCTS
FAVORITE_ITEM
SHARE_CONTENT
FIRST_ORDER_RECEIVED
REVIEW_ORDER
REPURCHASE_RECEIVED
NORMAL_INVITE_REGISTER
NORMAL_INVITE_FIRST_ORDER
VIP_PURCHASE
```

事件处理流程：

```text
业务事件发生
-> GrowthEventService.receive(event)
-> 查 GrowthBehaviorRule
-> 校验启用、时间、用户类型、频次上限、风控策略
-> 计算普通积分和成长值
-> Serializable 事务内写 GrowthLedger + 更新 GrowthAccount
-> 更新 UserProfile 读模型缓存
-> 触发等级变化通知
```

### 11.3 冲正与过期

退款、退货、换货成功后，需要冲正购物类奖励：

```text
FIRST_ORDER_RECEIVED / REPURCHASE_RECEIVED / REVIEW_ORDER
```

冲正不能删除原流水，必须新增反向流水：

```text
type = POINTS_REVERSE / GROWTH_REVERSE
refId = 原订单或原流水
```

普通积分过期：

- 每日定时任务扫描 `expiresAt < now` 且未消耗的积分批次。
- 创建 `POINTS_EXPIRE` 流水。
- 扣减 `GrowthAccount.pointsBalance`。
- App 提前 30 天提醒即将过期。

成长值不过期，不自动扣减。

## 12. API 建议

买家端：

```text
GET  /growth/me
GET  /growth/tasks
POST /growth/events/share
GET  /growth/ledger
GET  /growth/exchange/items
POST /growth/exchange/:itemId
GET  /growth/exchange/records

GET  /normal-share/me
POST /normal-share/bind
GET  /normal-share/stats
GET  /normal-share/records
```

官网/落地页：

```text
POST /normal-share/deferred/create
GET  /normal-share/deferred/resolve
```

管理后台：

```text
GET   /admin/growth/dashboard
GET   /admin/growth/categories
POST  /admin/growth/categories
PATCH /admin/growth/categories/:id
GET   /admin/growth/behavior-rules
POST  /admin/growth/behavior-rules
PATCH /admin/growth/behavior-rules/:id
GET   /admin/growth/levels
POST  /admin/growth/levels
PATCH /admin/growth/levels/:id
GET   /admin/growth/exchange-items
POST  /admin/growth/exchange-items
PATCH /admin/growth/exchange-items/:id
GET   /admin/growth/new-user-path
PUT   /admin/growth/new-user-path
GET   /admin/growth/users/:userId
GET   /admin/growth/risk-events
POST  /admin/growth/users/:userId/adjust
GET   /admin/growth/settings
PATCH /admin/growth/settings

GET   /admin/normal-share/bindings
GET   /admin/normal-share/reward-records
POST  /admin/normal-share/:userId/disable
POST  /admin/normal-share/:userId/enable
```

## 13. 权限与审计

新增权限建议：

```text
growth:read
growth:manage_rules
growth:manage_exchange
growth:adjust_user
growth:risk
normal_share:read
normal_share:manage
```

所有以下操作必须进入审计日志：

- 修改行为规则。
- 修改等级体系。
- 修改兑换项。
- 修改新人路径。
- 修改成长系统设置。
- 手动调整用户积分/成长值。
- 禁用或恢复普通分享码。
- 冲正异常奖励。

管理员手动调整用户积分/成长值必须填写原因，且不可物理删除原流水。

## 14. 风控与正式版安全

最低要求：

- 所有积分和成长值发放必须有 `idempotencyKey`。
- 所有积分扣减、兑换、冲正必须在事务内完成。
- 涉及积分余额变动使用 Serializable 隔离级别。
- 普通分享绑定 `inviteeUserId` 唯一。
- 好友首单奖励按 `inviteeUserId + orderId` 唯一。
- 购物类奖励退款/退货/换货成功后冲正。
- 分享、浏览、收藏类任务必须有每日上限。
- 注册奖励每设备/手机号/账号只给一次。
- 同设备、同手机号、同支付账号异常重复邀请进入风控列表。
- 禁用分享码后不能产生新绑定，但历史记录保留。

禁止项：

- 普通积分不得提现。
- 普通积分不得直接抵扣订单现金。
- 普通积分不得写入 RewardAccount。
- 成长值不得兑换现金。
- 成长值不得影响普通树或 VIP 树收益。

## 15. 合规与页面文案边界

普通分享码和成长系统页面可使用：

- 新人福利码
- 分享给好友
- 好友注册
- 好友首单
- 平台奖励
- 红包
- 积分
- 成长值
- 普通会员权益
- 等级成长
- 兑换福利

避免使用：

- 拉人赚钱
- 团队收益
- 下级
- 多级返利
- 躺赚
- 保证赚钱
- 佣金
- 提成
- 财富自由

普通分享码是 App 拉新福利，不是分销关系。

## 16. 分阶段实施建议

### Phase 1：成长系统底座与后台配置

目标：建立正式版账户、流水、行为规则、等级、兑换项和后台管理能力。

范围：

- 新增 GrowthAccount / GrowthLedger 等模型。
- 新增行为类别、行为规则、等级体系、兑换项模型。
- 管理后台新增“会员成长”菜单。
- 完成行为规则、等级体系、积分兑换、成长设置页面。
- 完成审计和权限。

### Phase 2：App 会员成长中心

目标：让普通用户看到自己的权益。

范围：

- 我的页展示等级、成长值、普通积分。
- 新增会员成长中心。
- 恢复签到和任务入口。
- 新增积分兑换页。
- 钱包空状态和 VIP 文案调整。

### Phase 3：普通分享码与新人福利路径

目标：让每个普通用户都能分享 App。

范围：

- 新增普通分享码模型和 API。
- 新增 `/s/{code}` 官网落地页。
- App 新增新人福利码页。
- 注册后绑定普通分享关系。
- 新人红包复用现有 `REGISTER`。
- 好友首单确认收货后发邀请奖励。

### Phase 4：购物、评价、复购和冲正闭环

目标：把成长激励接入真实交易。

范围：

- 首单确认收货发积分/成长值。
- 评价发积分/成长值。
- 复购确认收货发积分/成长值。
- 退款/退货/换货成功冲正。
- 用户成长记录页可查明细。

### Phase 5：VIP 转化桥和数据看板

目标：让 VIP 成为自然升级。

范围：

- VIP 抵扣券兑换。
- VIP 加成任务。
- VIP 页展示普通成长成果和升级增量。
- 管理后台看注册、首单、分享、复购、VIP 转化漏斗。

## 17. 验证清单

后端：

- 普通分享码生成唯一。
- 普通用户可绑定普通分享码。
- 自己绑定自己被拒绝。
- VIP 推荐关系不被普通分享码覆盖。
- 被邀请人首单确认收货后只奖励一次。
- 团购订单、VIP 礼包订单、0 元订单不触发普通邀请首单奖励。
- 普通积分、成长值、Reward 余额三者完全隔离。
- 积分兑换红包失败时积分扣减回滚。
- 退款/退货/换货成功后购物类成长奖励冲正。
- 积分过期任务只扣普通积分，不影响成长值和 Reward。

App：

- 普通用户能看到新人福利码。
- VIP 用户能区分普通新人福利码和 VIP 推荐码。
- 我的页能看到普通积分、成长值、等级。
- 任务和签到入口可见。
- 积分兑换页能区分红包、运费券、抽奖机会、VIP 抵扣券。
- 钱包页面不把普通积分和消费积分混在一起。
- 大字体和小屏下二维码、按钮、规则文案不重叠。

管理后台：

- 能配置行为类别、行为规则、积分、成长值和上限。
- 能配置等级体系并校验门槛递增。
- 能配置积分兑换项并关联红包活动。
- 能配置新人 7 日路径。
- 能查看用户积分、成长值、流水、兑换和冲正。
- 能禁用异常分享码。
- 能查看注册、首单、复购、分享、VIP 转化数据。
- 所有关键配置变更和手动调整进入审计日志。

## 18. 推荐优先级

推荐先做 Phase 1 和 Phase 2。

原因：

1. 普通积分和成长值要推正式版，必须先有账户、流水、后台规则和审计。
2. App 需要先展示普通用户基础权益，降低 VIP 门槛感。
3. 普通分享码和好友首单奖励依赖成长系统规则，适合在底座稳定后接入。
4. VIP 转化桥要建立在普通用户已经有积分、等级、兑换和购买行为之后。

最终产品口径：

```text
普通会员也可以领福利、做任务、攒积分、升等级、分享新人福利码。
VIP 不是入场门槛，而是普通会员体验后的升级加速权益。
```
