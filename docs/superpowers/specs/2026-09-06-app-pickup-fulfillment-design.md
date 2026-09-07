# App 自提履约接入设计

> 日期：2026-09-06。核对基线：`origin/main@4a8b70e75d2d212b528bd8d3e7484870c7c7023e`。
> 状态：需求范围已确认；本文为待实施设计，不代表代码完成、部署或真机验收。
> 用户要求：App 接入与现有小程序一致的自提功能，支付沿用 App 配送的支付宝和微信。
> 配套：[实施清单](../plans/2026-09-06-app-pickup-fulfillment.md)。本文约束 App 接入；不重新定义共享自提、支付和售后规则。

## 1. 目标与已确认边界

用户可在 App 完成选择自提、支付、查看备货状态、展示凭证、到点核销的全过程，无需跳到小程序。覆盖普通商品（购物车及立即购买）、团购和 VIP 实物礼包。业务能力一致，界面沿用 React Native App 的组件与响应式规范，不复制 Taro 页面代码。

- 默认送货上门；同一次结算整体二选一，不新增配送与自提混合结算。
- 自提免运费，不要求收货地址；姓名去除首尾空白后至少 2 个字符、界面最多 20 个字符，手机号沿用小程序大陆手机号校验。服务端继续使用现有 DTO 校验。
- 按商品企业查询点位，所有参与结算企业均有可用点才可选择自提；每个企业选择一个点。
- 共用商家点位和授权平台中心仓；不改变商品归属、企业权限或后台管理方式。
- 多商家仍按后端现有规则拆单，各单独立凭证、独立核销。多个商家选择同一中心仓时，不合并订单或码；页面不得把商家数量直接称作实际地点数量，应显示“按商家选择自提点”，实际地点数按选中 point ID 去重。
- 普通商品奖励、赠品、平台红包和消费积分规则保持不变；仅履约、运费及由金额引起的抵扣上限变化。
- 团购活动、返利及售后规则保持不变；VIP 付款后开通权益，实物礼包核销后完成收货，继续禁止消费积分抵扣 VIP。
- Android 支付宝与微信沿用现有可用性开关；iOS 支付宝保持现状，微信仍不可用。本次不补 iOS 微信原生接入，不增加银行卡、到店付款或货到付款。
- 复用已有“订单已可自提”通知；不新增短信、独立系统推送渠道或承诺通知必达。

## 2. main 代码证据与缺口

| 证据文件 | 已有能力 / 接入缺口 |
|---|---|
| `miniapp/src/components/pickup-fulfillment.tsx`、`pickup-utils.ts` | 履约切换、点位选择、姓名手机号校验、点位可用性、营业时间及导航 |
| `miniapp/src/packages/commerce/checkout/index.tsx` | 普通商品自提和预结算 |
| `miniapp/src/packages/group-buy/checkout/index.tsx` | 团购独立自提结算 |
| `miniapp/src/packages/benefits/vip-gifts/index.tsx` | VIP 自提及支付草稿恢复 |
| `miniapp/src/packages/orders/pickup-pass/index.tsx` | 二维码、8 位短码、刷新及到点导航 |
| `app/checkout.tsx` | 普通/VIP 共用页面，仍强制地址；VIP 中断后主要提示等待 5 分钟，不能声称已有完整恢复 |
| `app/group-buy/checkout.tsx` | 团购仍以地址驱动预结算和提交 |
| `src/repos/OrderRepo.ts`、`src/types/domain/GroupBuy.ts` | 创建请求强制 addressId，缺 fulfillment；普通 preview 转发处也需补字段 |
| `app/orders/[id].tsx`、`src/utils/pickupOrder.ts`、`src/components/cards/OrderCard.tsx` | 已展示自提状态，但指引到小程序取码 |
| `backend/src/modules/order/order.controller.ts` | 已有买家点位、凭证、App 结算/续付接口；VIP pending 只有小程序专用入口 |
| `backend/src/modules/order/checkout.service.ts` | 普通/VIP 已支持 fulfillment 快照；通用 pending 排除 VIP，并返回 paymentScene 和 canResumeInCurrentScene |
| `backend/src/modules/group-buy/group-buy-checkout.service.ts` | 团购预结算和创建会话已有自提与零运费 |
| `backend/src/modules/pickup/pickup.service.ts` | 开关、授权校验、备货、核销、短时凭证及二维码图片；二维码当前有效期 5 分钟 |
| `backend/src/modules/notification/notification.registry.ts`、`src/utils/notificationRoutes.ts` | pickupReady 通知跳 ORDER_DETAIL；App 已有订单详情映射 |
| `src/constants/payment.ts` | 微信仅 Android 且环境开关启用时可用 |

这些是源码事实；本次未读取线上点位数据或验证生产运行配置。main 分支代码不等于已部署状态。

## 3. 页面及交互

### 3.1 共用结算组件

新增 `src/components/checkout/FulfillmentSelector.tsx` 和 `PickupSelectionPanel.tsx`（计划路径）：履约选择、点位列表、中心仓标记、营业时间、取货须知、导航、姓名手机号。复用设计令牌、Screen、错误反馈和大字体适配工具。

配送显示原地址区；自提显示取货人和按企业分组点位。可从已加载的选中地址填充空白姓名手机号，但不得覆盖用户编辑；没有地址或地址接口失败，不阻塞有效自提。查询期间展示加载状态，失败可重试，无点禁用并说明原因。

普通商品企业集合取真实待结算商品（包括按现有规则随单的赠品/奖品）；VIP 从已选择礼包明细归属提取，不硬编码平台企业 ID；团购从活动归属提取。预结算剔除商品后同步企业集合及选择，已无商品的企业选择必须移除。

切换履约方式保留当前页面的有效输入，但立即使旧报价失效。自提点停用/授权撤回时刷新点位并提示重新选择；退回配送必须重新校验地址和报价，不能自动继续支付。

### 3.2 三类结算

| 类型 | 接入位置 | 必须保持 |
|---|---|---|
| 普通商品 | `app/checkout.tsx` 普通分支 | 购物车/立即购买、商品排除、红包、积分、备注、服务端报价 |
| VIP | `app/checkout.tsx` VIP 分支；检查 `app/vip/gifts.tsx` 及礼包选择 store 的明细传递 | 礼包选择、协议、付款开通权益、原价格规则；不借普通商品 preview 重新定价 VIP |
| 团购 | `app/group-buy/checkout.tsx` | 独立活动校验、分享参数、资格/库存及预结算 |

可导航到地址/红包页后返回，履约信息仍保留。App 被关闭后的支付恢复以服务端会话为准，不能把本地草稿当支付事实。

### 3.3 订单与成功页

复用现有自提展示，删除“请到小程序取码”。READY 时列表/详情可进入凭证页；PREPARING 仅展示备货中。保留后端允许的取消入口，自提不出现物流、改配送地址、手动确认收货按钮；缺关联数据时展示异常，不能降级为配送。

成功页补充“商家备好后可查看取货凭证”。VIP 成功页保留会员中心入口，同时让用户可以找到实物礼包订单；多商家跳对应订单列表，不能只暴露首单凭证。

### 3.4 取货凭证页

计划路径：`app/orders/pickup-pass/[id].tsx`。本人鉴权后请求服务器凭证；优先显示返回的 PNG，不必增加二维码原生依赖。展示 8 位短码（可复制）、脱敏取货人、地址、营业时间、须知及二维码有效期。

- 前台约 15 秒重新读取；回到前台立即刷新。按 expiresAt 判断过期，不把“二维码有效期”解释成必须在 5 分钟内到店。
- 过期、服务端拒绝、核销/退款/注销或切换账号后立即撤下旧码。请求失败不能继续无限显示缓存凭证。
- 二维码加载失败可重试，仍可使用当前有效响应中的人工短码；说明是人工取货码，不把短码称为二维码的 5 分钟有效期。
- 缓存设为短生命周期，不持久化凭证；账号与 orderId 隔离，离开页清理。图片异步加载用版本标记防止旧请求覆盖新码。
- 页面只展示买家凭证，不添加扫码核销或相机权限。二维码不可自行生成永久取货链接。
- 导航使用现有点位坐标/地址，通过系统地图或安全 URL 打开；不请求用户定位权限。上线前核对 provider/坐标系，不能直接把未知坐标转换或当另一坐标系使用；无可靠坐标时允许复制地址/地址搜索并提示，不显示错误定位。

## 4. 数据与接口

复用订单已有 FulfillmentMode 类型；计划新增 `src/types/domain/Fulfillment.ts` 保存选择、点位组及 PickupPass 契约，并从类型入口导出，避免重复定义。

```ts
type FulfillmentInput =
  | { mode: 'DELIVERY'; addressId: string }
  | {
      mode: 'PICKUP';
      recipientName: string;
      recipientPhone: string;
      selections: Array<{ companyId: string; pickupPointId: string }>;
    };
```

| HTTP 与路径（相对现有 API 前缀） | 设计 |
|---|---|
| `GET /orders/pickup-points?companyIds=...` | 复用，按企业返回授权点位组 |
| `POST /orders/preview` | App Repo 增加 fulfillment 转发；报价返回值按现有后端契约映射 |
| `POST /orders/checkout` | 自提传 fulfillment，省略配送 addressId；保留 paymentChannel、幂等键及业务参数 |
| `POST /orders/vip-checkout` | 同上，保留 packageId/giftOptionId |
| `POST /group-buy/checkout/preview`、`POST /group-buy/checkout` | 同上，保留 activityId/shareCode 等原参数 |
| `GET /orders/:id/pickup-pass` | 复用无缓存、本人订单鉴权、服务器生成凭证 |
| `GET /orders/checkout/me/pending` | 现有非 VIP 合同不变；App 类型补齐 GROUP_BUY、paymentScene、canResumeInCurrentScene |
| `POST /orders/checkout/:sessionId/resume` | 复用 APP 场景、原会话及服务端支付参数；不重新提交履约信息 |
| `GET /orders/vip-checkout/me/pending` | **拟新增最小 App VIP 恢复入口，当前不存在**；服务端固定 APP、当前买家、VIP_PACKAGE，仅返回恢复所需摘要；复用原会话有效期，不延长 |

普通/VIP/团购核心自提不要求新增表或 migration。为达到 VIP 支付中断恢复一致性，允许在 OrderController/CheckoutService 增加 App 专用只读 pending 入口，复用既有 resume/status/active-query；不得改变小程序 pending 过滤规则或在客户端指定任意用户和场景。

预览请求 key 必须包含履约方式、企业点位选择、取货人、商品集合和优惠参数。有效输入变化后旧报价不能提交，最新请求成功才解除禁用；重试复用同一次请求的幂等键，真正更换结算输入时才生成新键。若先前请求结果未知，先查原会话/待支付，不能靠换键重建单。

新增的非敏感摘要字段如确有展示需要，应最小扩展并保留老客户端兼容；不得向客户端返回密钥或完整支付凭据缓存。

## 5. 支付恢复与跨端

支付 SDK、后端回调/主动查单、资金锁和原路退款继续复用，履约方式不选择支付场景；App 调 APP 端点，不调用 mini-program 支付参数。

- 待支付页目前忽略路由 sessionId，仅查询最新 pending。本次必须读取目标 ID，查询结果不匹配时停止展示/续付并重新发现目标，不能悄悄替换为另一笔会话。VIP 使用专用发现入口，不借通用 pending 查询。
- 普通/团购：继续已有待支付入口，按服务端 bizType 路由；尊重 paymentScene、canResumeInCurrentScene。小程序会话可以提示回原端处理，不直接调用 App SDK，也不新增自动跨端换单。
- 团购取消支付后的详情返回路径补充恢复入口；VIP 未安装微信时必须进入 VIP 专用恢复，修复目前跳通用 pending 导致误报过期的入口。
- VIP：进入礼包结算时查询 App VIP pending；有会话时先提供查询结果、继续原支付和受控取消入口。关闭 App 后回来仍能发现服务端会话，不依赖仅内存 sessionId。
- VIP 若用户改了礼包/点位/取货人，必须先处理原会话；原会话关闭并确认未支付后才重新报价/创建，不能改已锁定快照。仅提供旧会话摘要时，页面明确“恢复原结算”，不能把新选择当作原订单展示。
- SDK 取消、超时、网络错误不等于未支付；复用 active-query/status 确认流程，未知结果提示处理中，避免重复建单。支付完成以服务端状态为准。
- 恢复使用原支付渠道；不新增未完成会话内切换支付宝/微信的能力。取消后重新结算是否可用由原后端状态裁决。
- 核对 VIP 恢复后的订单导航、会员信息/订单缓存刷新，不能把已付但权益/建单仍处理中显示成失败或再次扣款。

## 6. 履约、售后与安全

| 状态 | App 行为 |
|---|---|
| PREPARING | 备货中；普通商品遵循现有取消资格；无取货码 |
| READY | 待自提，展示有效凭证；买家普通取消入口关闭，提示联系商家/客服 |
| PICKED_UP | 已取货，后端订单 RECEIVED；不再展示码 |
| VOID / CANCELED | 凭证失效或自提取消，沿用真实订单/退款状态，不能由凭证状态推断已到账 |

核销仍由授权卖家或管理员完成，复用事务、CAS、幂等和收货副作用。团购/VIP 不新增普通商品直接取消能力；已取货后依现有售后资格办理，不新增门店退换货专属流程。退款走原渠道，消费积分/红包回退及分润、数字资产处理不在 App 重算。

重点验证：用户 A 不能取用户 B 的码；异步旧报价不能覆盖新履约；账号切换不残留信息；二维码过期/重复核销/退款竞态不产生错误收货；中心仓授权取消后不能新建非法会话。若暴露资金、状态或安全问题，记录至 `docs/issues/tofix-safe.md` 并修复必要接入缺陷，不扩大业务规则。

## 7. 范围外与交付判定

不改小程序 UI、卖家/管理后台业务规则、顺丰、支付供应商配置、利润分配、套餐权益、独立 Delivery 系统。不自动推送、合并、部署、OTA 或构建发布；发布阶段另按仓库操作规范执行。当前没有需要用户决定的新业务问题；实现中若需要改变上述边界再提问。

完成定义：三类业务在 App 自提付款后，能在 App 看到状态和凭证，现有后台核销后同步完成；配送回归通过。代码检查、后台联调、Android 支付宝/微信真机、iOS 支付宝及微信禁用验证、发布分别记录。缺少真机或支付测试条件时必须保留“待验收”，不能由编译通过推断完成。
