# 数字资产 App 页面视觉与规则隐藏设计

日期：2026-06-19

## 背景

买家 App 的 `/me/digital-assets` 已经具备数字资产总额、种子资产、消费资产、累计消费金额和最近流水展示。现有页面仍直接展示「消费资产规则」「VIP 种子资产规则」「当前档位 xN」「VIP 套餐规则」等信息。

这些内容会把平台数字资产的配置口径、档位策略和推荐资产设计暴露给前台用户，容易被竞品照抄，也容易被外部拿规则细节攻击。App 前台需要保留用户能理解的资产结果，但不展示内部获得规则。

本次只改买家 App 数字资产页面，不改管理后台规则配置能力，不改后端结算规则。

## 目标

1. App 数字资产页视觉升级为用户确认的 C v2「农业科技感」方向。
2. 页面保留「数字资产总额」「种子资产」「消费资产」「累计消费金额」。
3. 页面保留最近 5 条资产流水，并用不同颜色区分不同类型。
4. 页面删除所有获得规则、倍率、档位、套餐资产数量和资产说明区块。
5. 普通用户页面同步高级化，但不解释数字资产形成规则。

## 非目标

1. 不修改数字资产后台配置页。
2. 不修改 VIP 档位、推荐种子资产、消费资产倍率、退款扣回等后端规则。
3. 不新增兑换、利息、股权、未来权益等长期模块。
4. 不改 `/me/consumption-records` 的全量流水页面结构，除非实现时需要同步少量颜色或命名一致性。

## 前台信息隐藏规则

App `/me/digital-assets` 页面不得展示以下内容：

- 「消费资产规则」
- 「VIP 种子资产规则」
- 「当前档位」
- `x3`、`x5`、`x10` 这类倍率文案
- 「满 ¥500 后变为 5x」这类下一档提示
- 「VIP 套餐 ¥399 / ¥699 / ¥999」对应资产数量
- 「自购种子资产」和「推荐种子资产」的套餐规则卡片
- 「资产说明」区块
- 「规则待开放」「规则待定」这类规则入口或占位文案

App 可以展示已经形成的结果：

- 数字资产总额
- 种子资产余额
- 消费资产余额
- 累计消费金额
- 最近资产流水的标题、时间、变动值、余额

流水标题可保留业务来源，例如「推荐 VIP 种子资产」「自购 VIP 种子资产」「历史消费转入」「消费累计」。这些是结果记录，不暴露具体计算公式。

## 视觉方向

采用用户确认的 C v2「农业科技感」：

- 主色：深海蓝绿 `#15364B`
- 生长绿：`#116150`
- 麦金：`#C2A03E`
- 页面底色：浅雾绿 `#EEF6F1`
- 卡片白：`rgba(255,255,255,0.90)`
- 正文墨色：`#16241F`

页面的唯一强视觉记忆点是顶部资产卡的田垄/资产线条。其他区域保持克制，不再堆装饰。

## 页面结构

VIP 用户：

```text
数字资产

[顶部资产卡]
  数字资产总额
  6,332
  累计消费金额 ¥443.95

  种子资产 5,000
  消费资产 1,332

[最近资产流水]
  推荐 VIP 种子资产      +2,000   余额 5,000
  自购 VIP 种子资产      +1,000   余额 1,000
  历史消费转入           +1,332   余额 1,332
  消费累计               +¥399.00 累计 ¥443.95
```

普通用户：

```text
数字资产

[顶部累计消费卡]
  累计消费金额
  ¥443.95
  开通 VIP 激活数字资产

[最近资产流水]
  消费累计               +¥399.00
  消费累计               +¥44.95
```

普通用户不展示「种子资产」「消费资产」余额，因为普通用户没有数字资产；但可以继续展示累计消费金额和消费记录。

## 最近流水颜色语义

最近资产流水按 `subjectType` / `sourceType` 固定配色：

| 类型 | 颜色 | 适用 |
| --- | --- | --- |
| 种子资产 | 青绿 `#1F8A5F` | `SEED_ASSET`、`SELF_VIP_PURCHASE`、`REFERRAL_VIP_PURCHASE` |
| 消费资产 | 湖蓝 `#267B93` | `CREDIT_ASSET`、`HISTORICAL_CONSUMPTION_GRANT`、普通消费产生的消费资产 |
| 累计消费 | 麦金 `#A87918` | `CUMULATIVE_SPEND`、`CONSUMPTION_CONFIRMED` |
| 扣回 / 退款 | 柔红 `#B65347` | 负向流水、`DEBIT`、`REFUND_REVERSAL` |
| 后台调整 | 石灰灰 `#6E7B72` | `ADMIN_ADJUSTMENT` |

颜色只用于帮助识别流水类型，不解释内部规则。

## 组件与数据边界

主要修改 `app/me/digital-assets.tsx`：

1. 删除消费资产规则区块。
2. 删除 VIP 种子资产规则区块。
3. 删除资产说明区块。
4. 保留并升级顶部 hero 卡。
5. 将「最近消费记录」改为「最近资产流水」。
6. 最近流水根据类型渲染不同图标底色、文字颜色和金额颜色。

可以继续使用现有接口：

- `DigitalAssetRepo.getSummary()`
- `summary.recentRecords`
- `summary.seedAssetBalance`
- `summary.creditAssetBalance`
- `summary.cumulativeSpendAmount`

前端可以保留类型字段 `currentCreditTier`、`nextCreditTier`、`vipSeedRules`，因为它们仍可能被消费记录页或未来后台配置使用；但 `/me/digital-assets` 不读取它们来展示规则。

## 文案

页面不再显示获得方式说明。允许出现的引导文案：

- 普通用户 CTA：「开通 VIP 激活数字资产」
- 空状态：「暂无资产流水」
- 查看入口：「查看全部」

不使用以下文案：

- 「按规则转化」
- 「当前套餐规则」
- 「暂无档位规则」
- 「规则待开放」
- 「规则待配置」
- 「满多少后变为多少」

## 响应式与可访问性

1. 保持现有 `Screen`、`AppHeader`、`useResponsiveLayout`、`useBottomInset` 模式。
2. 大数字使用现有 `priceTextProps` / `fitTextProps` 防止字体放大后溢出。
3. 顶部卡片必须适配小屏宽度，资产分项在极窄屏可维持两列但文字不得重叠。
4. 流水行金额和余额需右对齐，长标题可换行，不挤压金额。
5. 颜色区分不能是唯一信息，图标文案仍需显示「种」「消」「单」等类型提示。

## 测试要求

新增或扩展 `scripts/__tests__/digital-assets-ui.test.mjs`，锁定：

1. `/me/digital-assets` 不出现「长期模块」「未来权益模块」。
2. `/me/digital-assets` 不出现「消费资产规则」。
3. `/me/digital-assets` 不出现「VIP 种子资产规则」。
4. `/me/digital-assets` 不出现「当前档位」。
5. `/me/digital-assets` 不出现「规则待开放」「规则待配置」「暂无档位规则」。
6. `/me/digital-assets` 不出现 `currentCreditTier.multiplier` 的展示模板。
7. 页面仍出现「数字资产总额」「种子资产」「消费资产」「累计消费金额」「最近资产流水」。

发布前验证：

```bash
node --test scripts/__tests__/digital-assets-ui.test.mjs
npm run test:legal
npx tsc -b --noEmit --pretty false
EXPO_PUBLIC_ENV=production EXPO_PUBLIC_USE_MOCK=false EXPO_PUBLIC_API_BASE_URL=https://api.ai-maimai.com/api/v1 EXPO_PUBLIC_ALIPAY_SANDBOX=false EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true NODE_ENV=production npx expo export --platform android
```

## 发布说明

这是纯 JS/TS 和样式改动，不涉及原生模块。实现后可以通过 runtime `1.0.4` production OTA 发布给 1.0.4 安装包用户；仍在 1.0.3 或更老 runtime 的安装包不会收到该 OTA。
