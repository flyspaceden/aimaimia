# Coupon Claim Notification Design

## Goal

当买家有新的可领取平台红包时，在消息中心生成未读提醒，并在红包页的“领券中心”入口显示数字角标；买家进入“领券中心”后清除角标。

## Scope

- 只提醒 `distributionMode=CLAIM` 且当前买家有资格领取的红包活动。
- 已领取、已达到每人限领、配额已满、未到活动时间、已结束、资格不满足的活动不计入提醒。
- 现有 `coupon.granted` 继续表示“红包到账”，本方案新增“可领取红包”提醒，避免和已到账红包混淆。

## Backend Design

新增用户维度的领券中心已看状态，记录买家最近一次查看领券中心的时间。后端计算当前可领取活动时，将 `createdAt > lastSeenAt` 或 `startAt > lastSeenAt` 的活动计为“新可领”，避免提前创建、未来才开始的活动在真正可领取时漏掉提醒。

新增接口：

- `GET /api/v1/coupons/claimable-alert`：返回 `{ count, campaignIds }`，并为新可领活动生成一条消息中心通知。
- `POST /api/v1/coupons/claimable-alert/read`：把当前时间记录为已查看领券中心。

消息中心新增事件：

- `coupon.claimableAvailable`
- 标题：`有新的红包可领取`
- 内容：`领券中心有 X 个新红包，先到先得。`
- 跳转：`COUPONS`

通知使用稳定幂等 key：`coupon-claimable:{userId}:{campaignIdsHash}`，同一批新活动不会重复刷消息。

## App Design

红包页打开时即请求 `claimable-alert`，不等用户切到领券中心。主 Tab “领券中心”显示数字角标：

- `0`：不显示
- `1-99`：显示数字
- `>99`：显示 `99+`

用户点击并进入“领券中心” Tab 后，调用 `claimable-alert/read`，并刷新提醒摘要，角标消失；如果标记已读失败，App 会做有限短重试，连续失败后可在本屏切出再进入领券中心时重试。领券中心列表使用 `GET /coupons/center`。

## Testing

- 后端测试：新可领活动会返回 count，并创建一条消息；进入领券中心后 count 归零。
- 前端静态/组件相关测试：红包页存在提醒接口调用、数字角标和进入领券中心后标记已读逻辑。
- 回归测试：现有领取、手动发放、红包到账通知不受影响。
