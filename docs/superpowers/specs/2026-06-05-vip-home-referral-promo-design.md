# VIP 首页礼包推荐展示设计方案（方案 B · 轻改版）

> 2026-06-05 | 状态：已选型（方案 B），待实施
> 视觉对比稿：`docs/superpowers/specs/2026-06-05-vip-home-referral-mockup.html`（三方案手机框架 mockup，用户选定方案 B）

## 1. 背景与问题

首页 VIP 礼包跑马灯（`VipHomePromoCarousel`）当前仅对未登录 / 普通用户显示（`app/(tabs)/home.tsx` 中 `shouldShowVipPromo = !isLoggedIn || member?.tier === 'NORMAL'`）。已是 VIP 的用户首页只剩一条金色横幅「推荐好友开通 VIP，有高额奖励」。

后果：VIP 向朋友面对面推荐时，**手上没有可展示的"弹药"**——打不开任何页面给朋友看礼包里有什么、VIP 有什么权益（`/vip/gifts` 对 VIP 硬拦截，只显示"您已是 VIP 会员"提示页）。

## 2. 目标 / 非目标

**目标**
- VIP 用户首页恢复礼包跑马灯展示，作为推荐弹药
- VIP 可进入 `/vip/gifts` 浏览完整礼包内容与权益（浏览模式）
- 全程不产生"已是 VIP 还要再买一次"的误解

**非目标**
- 不改未登录 / 普通用户的任何行为
- 不改现有金色横幅（保留原样）
- 不加收益数字展示（方案 C 内容，本期不做）
- 不动后端（`GET /bonus/vip/gift-options` 本就是公开接口）

## 3. 设计

### 3.1 首页（`app/(tabs)/home.tsx`）

| 项 | 现状 | 改后 |
|---|---|---|
| 跑马灯显示条件 | `!isLoggedIn \|\| tier === 'NORMAL'` | **所有用户**（含 VIP） |
| `vip-gift-options` 查询 `enabled` | 同上 | 恒为 true（接口公开，无副作用） |
| 跑马灯标题 | 「VIP 开通礼包」 | 非 VIP 不变；**VIP 显示「好友开通可得礼包」** |
| 金色横幅 | VIP 显示，跳 `/me/referral` | **原样保留**，位置不变（跑马灯下方） |
| 点卡片 | 跳 `/vip/gifts`（带 packageId/giftOptionId） | 路由不变；VIP 进入的是浏览模式（见 3.3） |

### 3.2 跑马灯组件（`src/components/data/VipHomePromoCarousel.tsx`）

新增 prop `mode: 'purchase' | 'referral'`（默认 `'purchase'`，所有现有调用零破坏）：

- `referral` 模式仅替换两处文案：
  - 标题「VIP 开通礼包」→「好友开通可得礼包」
  - 卡片 `accessibilityLabel` 末尾「点击查看赠品详情」→「点击查看礼包详情，可分享给好友」
- 卡片视觉、跑马灯动画、长按暂停逻辑**零改动**

`home.tsx` 按 `member?.tier === 'VIP' ? 'referral' : 'purchase'` 传入。

### 3.3 礼包页浏览模式（`app/vip/gifts.tsx`）

移除「您已是 VIP 会员」硬拦截页（现 388-417 行），VIP 进入浏览模式，三处防混淆：

1. **顶部金色提示条**：`👑 您已是 VIP 会员 · 以下为礼包内容，可展示给好友`——进页第一眼明确"这不是让你买"
2. **底部 CTA 替换**：价格展示保留（朋友需要知道价格）；按钮「立即开通」→「**分享给好友开通**」，点击跳 `/me/referral`（有二维码，面对面让朋友扫码最顺）
3. **购买链路物理隔离**：VIP 状态下不写 `useCheckoutStore.vipPackageSelection`，档位/赠品仍可点选切换浏览，但任何路径都到不了结算

### 3.4 文案防混淆原则（三端一致）

- VIP 视角下所有「开通」动词主语必须是「好友」：「**好友**开通可得礼包」「分享给**好友**开通」
- 标题语境是「推荐好友开通 VIP」而非「开通 VIP」
- 价格、赠品明细照常展示——这正是朋友要看的内容

## 4. 边界情况

| 场景 | 行为 |
|---|---|
| 未登录 / NORMAL 用户 | 全部现状不变（标题仍「VIP 开通礼包」，礼包页可正常购买） |
| VIP 无推荐码（理论不存在） | 横幅本就不显示（`buildVipReferralHomePrompt` 已处理）；跑马灯照常显示；礼包页「分享给好友开通」仍跳 `/me/referral`（该页非 VIP 分支有兜底 UI） |
| 礼包全售罄 / packages 为空 | 跑马灯现有逻辑返回 null，整块隐藏（VIP 同样适用） |
| 礼包页 URL 直达（深链/历史栈） | VIP 一律进浏览模式，与从首页进入一致 |

## 5. 影响面

- 纯前端（买家 App）3 个文件：`app/(tabs)/home.tsx`、`src/components/data/VipHomePromoCarousel.tsx`、`app/vip/gifts.tsx`
- 后端零改动；无 Schema / 接口变更
- 可走 OTA 发布（无原生层改动）

## 6. 验收清单

- [ ] VIP 登录后首页可见跑马灯，标题为「好友开通可得礼包」，金色横幅仍在其下方
- [ ] 非 VIP（未登录 / NORMAL）首页与改动前逐像素一致
- [ ] VIP 点卡片进 `/vip/gifts`：可浏览所有档位与赠品，顶部有"您已是 VIP"提示条，底部按钮为「分享给好友开通」且跳 `/me/referral`
- [ ] VIP 在礼包页任何操作都无法进入结算（`vipPackageSelection` 不被写入）
- [ ] 非 VIP 在礼包页购买流程不受影响
- [ ] `tsc -b` 通过（CI 等效模式）
