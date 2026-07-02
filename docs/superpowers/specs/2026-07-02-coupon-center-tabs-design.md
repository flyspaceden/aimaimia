# Coupon Center Tabs Design

## Goal

买家 App 的“领券中心”不再只是一张混合列表，而是用内部 Tab 区分“可领取”“已领取”“进行中”。默认仍优先展示真正可以领取的红包，已领过或已领完的活动不再干扰领取动作，同时用户仍能查到自己从哪些活动领过红包。

## User Experience

红包页保留外层主 Tab：

- 我的红包
- 领券中心

进入“领券中心”后新增内层 Tab：

- 可领取：默认 Tab，只展示当前用户还能领取的活动。活动被领完后立刻从这里消失；用户已达到每人限领后也从这里消失。
- 已领取：展示当前用户从领券中心领过的活动记录。重点是“领取来源记录”，不是替代“我的红包”列表。每条记录展示活动名、已领取数量、红包可用/已使用/已过期状态摘要和有效期信息，可继续引导去使用。
- 进行中：展示仍在活动期内的主动领取活动。包含可领取、已领取、暂不满足条件、已领完等状态，用标签和按钮状态说明当前为什么能领或不能领。

按钮行为：

- `CLAIMABLE`：显示“立即领取”，可在“可领取”和“进行中”两个 Tab 内点击领取。
- `CLAIMED`：显示“已领取”，不可重复点击；如果仍有可用红包，可显示“去使用”辅助动作。
- `SOLD_OUT`：显示“已领完”，不可点击。
- `NOT_ELIGIBLE`：显示具体原因，不可点击。
- `ENDED`：正常不进入“可领取”和“进行中”；仅在“已领取”来源记录里用作历史状态展示。

“已领取”Tab 是来源记录页，不提供继续领取。对于 `maxPerUser > 1` 且用户未领满的活动，该活动可以同时出现在“可领取”和“已领取”：用户要继续领取时从“可领取”或“进行中”操作，“已领取”只展示已领记录和“去使用”入口。

领取成功后刷新三个领券中心列表、角标提醒、“我的红包”和结算可用红包。领取失败如果是库存耗尽、活动结束、活动暂停或已达每人限领，展示后端错误文案并刷新三个领券中心列表、“我的红包”和结算可用红包，避免用户继续看到过期状态。

普通网络/服务器失败时展示“领取失败，请稍后重试”；保留当前列表，后台刷新成功后再替换。

## Backend Behavior

现有 `GET /coupons/available` 只适合“可领取”列表。为避免前端自己推断复杂状态，后端新增带视图参数的领券中心查询：

- `GET /coupons/center?view=claimable`，默认 view
- `GET /coupons/center?view=claimed`
- `GET /coupons/center?view=active`

`view` 只能是 `claimable | claimed | active`；非法值返回 400，文案为“领券中心分类无效”。

返回数组，不分页。第一版领券中心活动数量由运营配置控制，保持简单；未来活动量上来后再加分页。

```typescript
type CouponCenterView = 'claimable' | 'claimed' | 'active';

type CouponCenterDisplayStatus =
  | 'CLAIMABLE'
  | 'CLAIMED'
  | 'SOLD_OUT'
  | 'NOT_ELIGIBLE'
  | 'ENDED';

interface CouponCenterClaimSummaryDto {
  total: number;
  available: number;
  used: number;
  expired: number;
  reserved: number;
  revoked: number;
  nearestExpiresAt: string | null; // 当前用户已领红包中，仍可使用红包的最近过期时间；没有可用红包则为 null
}

interface CouponCenterCampaignDto {
  id: string;
  name: string;
  description: string | null;
  discountType: 'FIXED' | 'PERCENT';
  discountValue: number; // FIXED 为元；PERCENT 为 0-100 的折扣百分比
  maxDiscountAmount: number | null; // 元
  minOrderAmount: number; // 元
  remainingQuota: number;
  userClaimedCount: number;
  maxPerUser: number;
  startAt: string;
  endAt: string | null;
  distributionMode: 'CLAIM';
  canClaim: boolean;
  displayStatus: CouponCenterDisplayStatus;
  statusLabel: string;
  ineligibleReason: string | null;
  claimedSummary: CouponCenterClaimSummaryDto;
}
```

过滤规则：

- 三个 view 都只处理 `distributionMode=CLAIM` 的主动领取活动。`AUTO`、`MANUAL` 不进入领券中心。
- `claimable`：只返回 `status=ACTIVE`、在活动时间内、`canClaim=true`、库存未领完、用户资格满足的活动。
- `claimed`：只返回当前用户领取过的主动领取活动；一张活动卡对应一个 campaign，不按实例拆卡；即使活动已经 `ENDED` 或 `PAUSED`，只要用户领过仍保留为历史来源记录；`AVAILABLE`、`RESERVED`、`USED`、`EXPIRED`、`REVOKED` 都计入 `total`，并分别进入摘要字段。
- `active`：只返回 `status=ACTIVE` 且在活动时间内的主动领取活动。包含可领取、已领取、暂不满足条件、已领完等状态，但必须展示清楚状态。
- `DRAFT` 不进入三个 view。`PAUSED` 不进入 `claimable` 和 `active`，但用户领过时保留在 `claimed` 作为历史来源记录。如果用户点领取时活动刚被暂停，由领取接口返回错误并触发前端刷新。

`claimedSummary` 口径：

- 对用户没有领取过的活动，所有数量为 0，`nearestExpiresAt=null`。
- `total` 为当前用户对该活动拥有的全部红包实例数。
- `available`、`reserved`、`used`、`expired`、`revoked` 分别按实例状态计数。
- `nearestExpiresAt` 只从当前用户该活动下 `AVAILABLE` 状态且 `expiresAt > now` 的实例中取最早过期时间；没有则为 `null`。
- `userClaimedCount` 与每人限领判断沿用现有后端口径，统计当前用户该活动下所有红包实例状态，包括 `AVAILABLE`、`RESERVED`、`USED`、`EXPIRED`、`REVOKED`。

排序规则：

- `claimable`：按 `createdAt desc`，新活动优先。
- `active`：先按 `displayStatus` 排序（`CLAIMABLE`、`CLAIMED`、`NOT_ELIGIBLE`、`SOLD_OUT`），同状态内按 `createdAt desc`。
- `claimed`：按当前用户最近一次领取该活动的时间 `issuedAt desc`。

现有 `GET /coupons/available` 保留兼容，可内部复用 `center?view=claimable` 的查询逻辑。

### Display Status Precedence

同一个活动可能同时满足多个条件，后端按以下优先级计算 `displayStatus`：

1. `claimed` view 中活动不在活动期内或活动状态为 `ENDED`：`ENDED`，但仍返回历史记录
2. `claimed` view 中用户领取过且活动未结束：`CLAIMED`，即使活动状态为 `PAUSED` 或 `maxPerUser > userClaimedCount`，该 Tab 也保持只读
3. `claimable` / `active` view 中活动不在活动期内或活动状态不是 `ACTIVE`：不进入列表；领取接口返回具体错误
4. 用户已达到 `maxPerUser`：`CLAIMED`
5. 总库存已领完：`SOLD_OUT`
6. 用户资格不满足：`NOT_ELIGIBLE`
7. 其他情况：`CLAIMABLE`

状态文案：

| `displayStatus` | `statusLabel` | `canClaim` |
|-----------------|---------------|------------|
| `CLAIMABLE` | `立即领取` | `true` |
| `CLAIMED` | `已领取` | `false` |
| `SOLD_OUT` | `已领完` | `false` |
| `NOT_ELIGIBLE` | 后端资格原因，如 `暂不满足累计消费领取条件` | `false` |
| `ENDED` | `已结束` | `false` |

## Interaction With New Coupon Badge

领券中心角标仍只统计“可领取”的新活动。已领取和已领完活动不计入角标。用户进入“领券中心”时仍标记角标已读。

## Edge Cases

- 活动总库存领完：从“可领取”消失；在“进行中”显示“已领完”直到活动结束。
- 用户领满每人限领：从“可领取”消失；在“已领取”显示；在“进行中”显示“已领取”。
- 每人限领大于 1：只要用户还没领满且库存充足，仍留在“可领取”；如果用户已经领过，也同时出现在“已领取”，但“已领取”只读。
- 用户资格暂不满足：不出现在“可领取”，但可出现在“进行中”，显示具体原因。
- 活动结束或暂停：不出现在“可领取”和“进行中”；如果用户领过，仍可在“已领取”里看到来源记录。已结束活动展示 `ENDED`，暂停活动展示 `CLAIMED` 和已领取摘要。
- 列表加载后发生并发变化：领取接口仍是最终裁决；失败后前端刷新 `claimable`、`claimed`、`active` 三个列表和角标。

## Testing

- 后端测试覆盖三种 view 的过滤规则。
- 后端测试覆盖非法 `view` 返回 400。
- 后端测试覆盖 `AUTO`、`MANUAL`、`DRAFT` 不进入领券中心；`PAUSED` 只在用户领过时进入 `claimed`。
- 后端测试覆盖状态优先级：已领取优先于已领完，已结束仅在已领取历史里展示。
- 后端测试覆盖排序：可领取按新活动优先，进行中按状态优先，已领取按最近领取时间优先。
- 后端测试覆盖“库存领完立即从可领取消失”。
- 后端测试覆盖“用户已领满后从可领取消失，但进入已领取和进行中”。
- 后端测试覆盖已领取摘要聚合：可用、锁定、已使用、已过期、已撤销。
- 前端静态测试覆盖领券中心内层 Tab、三个 view 请求、状态标签、领取成功和领取失败后的刷新。
- 前端测试/静态检查覆盖空态和错误态文案。
