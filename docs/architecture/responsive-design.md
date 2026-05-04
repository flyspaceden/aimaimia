# 买家 App 响应式适配规范

> **生成日期**: 2026-04-30
> **触发**: P5 真机测试发现 VIP 价格档位在华为机（系统字体默认放大 1.15x）换行错位，类似问题在多个页面潜伏
> **适用范围**: `app/` 下所有页面 + `src/components/` 公共组件
> **权威范围**: **本文档为响应式适配的唯一权威来源**。前端写新页面 / Code Review / OTA 发布前必须遵循

---

## 一、背景与现状

### 1.1 触发案例

| 现象 | 截图位置 | 根因 |
|---|---|---|
| VIP 价格档位 ¥399/¥699/¥999/¥1299 在华为机换行 | `app/vip/gifts.tsx:419-446` | `flex: 1` 4 列 + `fontSize: 22` 写死 + 没限制系统字体放大 |
| Tab bar 在华为三键键被遮 | `app/(tabs)/_layout.tsx` | `insets.bottom = 0` OEM bug，固定底部栏必须走统一 bottom inset helper |
| 多页面键盘遮挡 | 11+ 含 TextInput 页面 | `Screen.tsx` 无 KAV，已加 `keyboardAvoiding` prop（commit b9ca8df）|

### 1.2 问题分类

按根因分 4 类：

1. **字体缩放未控制**：React Native `<Text>` 默认跟随系统字体设置放大（华为/小米/OPPO 都有"超大字体"选项 1.5-2x）
2. **写死 px / 模块顶层 Dimensions.get()**：旋转/分屏/字体放大时不更新
3. **底部固定栏未吃 safe area**：手势条/虚拟键覆盖
4. **横向多列硬塞**：`flex: 1` 平分屏宽，窄屏 / 大字体下溢出

---

## 二、6 条核心原则

### 原则 1：横向多列必须按真实窗口宽度 + 字体缩放计算

❌ 反模式：
```tsx
<View style={{ flexDirection: 'row', gap: 10 }}>
  {items.map(i => <Card style={{ flex: 1 }} />)}  // ← 4 列硬塞
</View>
```

✅ 推荐：
```tsx
const { width, columns } = useResponsiveLayout();
const cols = columns({ wide: 4, narrow: 2 });   // ← 窄屏自动降 2 列
const contentWidth = width - paddingHorizontal * 2;
const itemWidth = (contentWidth - gap * (cols - 1)) / cols;
<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
  {items.map(i => <Card style={{ width: itemWidth }} />)}
</View>
```

**降级策略**：
- 宽屏（≥ 390dp 且字体缩放 < 1.15）：4 列
- 宽屏但字体 / 显示大小偏大（fontScale ≥ 1.15）：按紧凑屏处理
- 窄屏（< 360dp）：2 列
- 特别窄（< 320dp，少见）：横向 ScrollView

**判断标准**：用 dp（density-independent pixels）即 `useWindowDimensions().width`，并同时读取 `PixelRatio.getFontScale()`。不要只看机型或物理像素。

**宽度计算标准**：多列 item 宽度必须用数字计算，不用百分比猜 gap：

```tsx
const contentWidth = width - paddingHorizontal * 2;
const itemWidth = (contentWidth - gap * (cols - 1)) / cols;
```

### 原则 2：金额/徽标/紧凑数字必须防换行

紧凑数字位（价格、Badge、Tab 数字、版本号、订单号）必须加：

```tsx
import { priceTextProps } from '../src/theme/responsive';

<Text {...priceTextProps} style={{ fontSize: 22 }}>
  ¥{price}
</Text>
```

`priceTextProps` 的语义：
| 属性 | 值 | 作用 |
|---|---|---|
| `numberOfLines` | `1` | 不允许换行 |
| `adjustsFontSizeToFit` | `true` | 装不下时自动缩字号 |
| `minimumFontScale` | `0.75` | 最多缩到原 75%（再低看不清）|
| `allowFontScaling` | `false` | 不响应系统字体放大（紧凑数字位专用）|

按钮 CTA 不默认使用 `allowFontScaling: false`。按钮文字优先使用 `numberOfLines: 1` + `adjustsFontSizeToFit` + `maxFontSizeMultiplier: 1.1`，只有极窄工具按钮 / 底部固定按钮在 Code Review 确认后才允许关闭字体缩放。

### 原则 3：固定底部栏必须吃 safe area

❌ 反模式：
```tsx
<View style={{ position: 'absolute', bottom: 0, height: 60 }}>
  <Button>提交订单</Button>
</View>
```

✅ 推荐：
```tsx
const bottomPadding = useBottomInset(12);
<View style={{
  position: 'absolute',
  bottom: 0,
  paddingBottom: bottomPadding,   // ← 吃底部安全区 + Android OEM 兜底
  paddingTop: 12,
}}>
  <Button>提交订单</Button>
</View>
```

同时**正文 ScrollView 的 contentContainerStyle.paddingBottom** 必须 ≥ 底部栏高度 + bottomPadding，避免最后一项被盖住：

```tsx
const bottomPadding = useBottomInset(12);

<ScrollView contentContainerStyle={{ paddingBottom: 60 + bottomPadding }}>
  ...
</ScrollView>
```

不要在页面里直接写 `insets.bottom + 12`。Android 部分 OEM / 三键导航会返回 `insets.bottom = 0`，必须通过项目统一 helper 做兜底。

### 原则 4：避免模块顶层 Dimensions.get()

❌ 反模式：
```tsx
import { Dimensions } from 'react-native';
const { width: SCREEN_WIDTH } = Dimensions.get('window');  // ← 模块加载时一次性，旋转/分屏不更新

export default function MyScreen() {
  return <View style={{ width: SCREEN_WIDTH / 4 }} />;
}
```

✅ 推荐：
```tsx
import { useWindowDimensions } from 'react-native';

export default function MyScreen() {
  const { width } = useWindowDimensions();   // ← Hook，分屏/旋转/系统显示大小变化时自动重新渲染
  return <View style={{ width: width / 4 }} />;
}
```

**完全禁止**：模块顶层 `Dimensions.get('window')` / `Dimensions.get('screen')`。
**允许**：模块顶层定义常量比例（`const COL_RATIO = 0.25`）+ 组件内乘以 `useWindowDimensions().width`。

### 原则 5：allowFontScaling 红线

| 类别 | allowFontScaling | 例子 |
|---|---|---|
| ✅ 用 `false`（不响应系统字体）| 必须 | 价格、Badge 数字、Tab amount、版本号、订单号 |
| ⚠️ 尽量不用 `false`，改用最大倍率限制 | 推荐 | 按钮 CTA、筛选 tab、紧凑操作入口 |
| ✅ 用 `true`（默认）+ `maxFontSizeMultiplier: 1.2` | 推荐 | 标题、副标题、列表条目 |
| ❌ 禁止全局禁用 | — | 正文段落、订单详情、协议条款、客服聊天、AI 对话 |

**违反第 3 条 = 违反无障碍**（视障 / 老年用户依赖系统字体放大）。

### 原则 6：useResponsiveLayout 替代猜尺寸

不要再写：
```tsx
const ITEM_WIDTH = SCREEN_WIDTH / 4 - 10;  // ← 猜
```

统一改用，并让 Hook 同时暴露字体缩放状态：
```tsx
const { columns, isNarrow, isLargeText } = useResponsiveLayout();
const cols = columns({ wide: 4, narrow: 2 });
```

---

## 三、工具集（src/theme/responsive.ts）

### 3.1 `useResponsiveLayout()` Hook

```ts
import { PixelRatio, useWindowDimensions } from 'react-native';

export const useResponsiveLayout = () => {
  const { width, height } = useWindowDimensions();
  const fontScale = PixelRatio.getFontScale();
  const isLargeText = fontScale >= 1.15;
  const isNarrow = width < 360;
  const isCompact = width < 390 || isLargeText;

  return {
    width,
    height,
    fontScale,
    /** 是否窄屏（<360dp，常见小屏 Android）*/
    isNarrow,
    /** 是否紧凑屏（<390dp 或字体/显示大小偏大）*/
    isCompact,
    /** 是否大字体/大显示模式 */
    isLargeText,
    /** 是否横屏 */
    isLandscape: width > height,
    /**
     * 按窗口宽度选列数
     * @example columns({ wide: 4, narrow: 2 })  // 窄屏 2 列，否则 4 列
     */
    columns: (config: { wide: number; narrow: number; compact?: number }) => {
      if (width < 360) return config.narrow;
      if (isCompact) return config.compact ?? config.narrow;
      return config.wide;
    },
  };
};
```

### 3.2 `priceTextProps` / `fitTextProps` 预设

```ts
import { TextProps } from 'react-native';

/**
 * 价格 / 徽标 / Tab 数字 — 紧凑数字位专用
 * 不响应系统字体放大，自动缩字号塞一行
 */
export const priceTextProps: Partial<TextProps> = {
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.75,
  allowFontScaling: false,
};

/**
 * 一般可缩文本 — 标题 / 列表项
 * 响应系统字体放大但不超过 1.2x（在 _layout 全局已设）
 * 装不下时自动缩字号
 */
export const fitTextProps: Partial<TextProps> = {
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.85,
};

/**
 * 按钮 / 筛选 Tab 文字 — 保留系统字体能力，但限制最大放大
 */
export const compactActionTextProps: Partial<TextProps> = {
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.8,
  maxFontSizeMultiplier: 1.1,
};
```

### 3.3 `useBottomInset()` 固定底部栏安全区 helper

```ts
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ANDROID_NAV_FALLBACK = 32;

/**
 * 固定底部栏专用 paddingBottom。
 * Android 部分 OEM / 三键导航会返回 insets.bottom = 0，需要兜底。
 */
export const useBottomInset = (extra = 12) => {
  const insets = useSafeAreaInsets();
  const safeBottom =
    Platform.OS === 'android'
      ? Math.max(insets.bottom, ANDROID_NAV_FALLBACK)
      : insets.bottom;

  return safeBottom + extra;
};
```

### 3.4 全局兜底（app/_layout.tsx）

```ts
import { Text } from 'react-native';

// 全局：所有 Text 默认最大字体放大不超过 1.2x（无障碍合规 + 防爆）
// 写死 fontSize 的页面即使忘加 fitTextProps，也不会被系统字体超大放大爆掉
(Text as any).defaultProps = (Text as any).defaultProps || {};
(Text as any).defaultProps.maxFontSizeMultiplier = 1.2;
```

全局 `defaultProps` 只作为迁移期兜底，不作为长期唯一方案。新代码仍应显式使用 `priceTextProps` / `fitTextProps` / `compactActionTextProps`，后续如果项目统一封装 `AppText`，应迁移到组件层控制。

---

## 四、新页面开发 Checklist（PR / Code Review 必跑）

### 编码阶段

- [ ] 没用模块顶层 `Dimensions.get('window' | 'screen')`，全用 `useWindowDimensions()`
- [ ] 横向多列容器（4 列以上）使用 `useResponsiveLayout().columns({ wide, narrow })`，且大字体 / 大显示模式会降级
- [ ] 价格 / Badge / Tab 数字 等紧凑文本 spread `priceTextProps`
- [ ] 按钮 CTA 优先使用 `compactActionTextProps`，不要默认关闭系统字体缩放
- [ ] 标题 / 列表项等可缩文本 spread `fitTextProps`
- [ ] 正文段落保持默认（响应系统字体放大，无障碍兼容）
- [ ] 底部固定栏（`position: absolute` + `bottom: 0`）使用 `useBottomInset()`，不直接用 `insets.bottom`
- [ ] 包含底部固定栏的 ScrollView，contentContainerStyle.paddingBottom ≥ 栏高 + `useBottomInset()`

### 真机测试矩阵（PR 必须跑过的 8 个场景）

| 场景 | 设备 / 设置 | 关注点 |
|---|---|---|
| 1 | Android 360dp（窄屏，如华为某些低端机）| 横向多列是否降级 / 文本是否换行 |
| 2 | iOS 390dp（iPhone 12/13/14）| 标准基准 |
| 3 | 系统字体放大 1.2x（设置 → 显示 → 字体大小 +2）| 价格/按钮是否爆 |
| 4 | 系统字体放大 1.3x（更激进）| 全局 maxFontSizeMultiplier 是否兜住 |
| 5 | Android 三键虚拟键 | Tab bar / 底部栏不被覆盖 |
| 6 | 全面屏手势条 + 键盘弹出 | 底部固定栏 + 键盘适配 |
| 7 | Android 显示大小偏大（字体默认）| 宽度足够但布局被系统显示缩放挤爆 |
| 8 | Android 字体 1.15x + 显示大小偏大 | 华为 / 小米真实高风险组合 |

### OTA / Build 发布前

- [ ] 上面 8 个场景全部跑过
- [ ] rg 审计黑名单（见五）输出 0 命中 OR 已知豁免
- [ ] 文档若有更新，本文 commit message 引用

---

## 五、rg 审计黑名单（项目级巡检）

定期跑这些 rg 命令，发现新违反需立即修：

```bash
# 1. Dimensions.get 巡检（模块顶层绝对禁止；组件内也优先改 useWindowDimensions）
rg -n "Dimensions\\.get\\(['\"](?:window|screen)['\"]\\)" app src

# 2. 写死大宽度（>200px 一般可疑，需确认是否需要响应式）
rg -n "width: [2-9][0-9]{2,}" app src

# 3. 大字号 + 没 numberOfLines 限制（容易换行爆）
rg -n -B2 -A2 "fontSize: [2-9][0-9]" app src

# 4. 底部固定栏可能没吃 safe area
rg -n -B1 -A8 "position: 'absolute'" app src | rg -B3 -A8 "bottom: 0"

# 5. flex:1 row 包多个 Text（窄屏/大字体爆）
rg -n -B3 -A10 "flexDirection: 'row'" app src | rg -B3 -A10 "flex: 1"
```

每次发现新违反点：
1. 加进当前批次修
2. 实在没空 → 加进 `docs/issues/tofix-app-frontend.md` backlog
3. 不允许新代码引入新违反

---

## 六、实施路线图 + 修复进度

### 6.1 全项目审计（2026-05-04 完成）

**触发**：
- 2026-04-30 spec 立项时仅 VIP 礼包页 1 个截图复现点
- 2026-05-04 用户随手测试发现 `checkout.tsx`（小米机底部空白）+ `orders/[id].tsx`（底部被手势条挡住）—— 决定全项目扫一遍，不再依赖随机发现

**方法**：4 组并行 subagent 审查 60 个页面 + 16 个共用组件，对照 6 原则 + §5 rg 黑名单

**结果总览**：
- 🔴 严重：15+ 处（涉及 9 个文件）
- 🟡 中等：26+ 处
- ✅ 干净：约 30 个文件

#### 🔴 高优问题清单（按修复 ROI 排序）

**A. 底部 safe area 系统性缺陷（影响最大，对应用户报告的 bug）**

| # | 文件 | 问题 | 影响范围 |
|---|------|------|---------|
| A1 | `src/components/orders/StickyCTABar.tsx` | 完全没用 `useSafeAreaInsets`，`padding: 10` 直接贴系统栏 | **共用组件**——影响订单详情/售后/售后详情 3 页 |
| A2 | `app/orders/[id].tsx` | ScrollView paddingBottom=80 写死 + StickyCTABar 没保护 | 用户已报告 |
| A3 | `app/orders/after-sale/[id].tsx` | 同 A2，走同共用组件 | — |
| A4 | `app/orders/after-sale-detail/[id].tsx` | 同 A2 | — |
| A5 | `app/checkout.tsx` | bottomBar `paddingBottom: insets.bottom + 8` 无 OEM 兜底 + ScrollView paddingBottom 不对称 | 用户已报告（小米空白）|
| A6 | `app/cart.tsx` | 同样 bottomBar OEM bug | 购物车确认栏 |
| A7 | `app/checkout-coupon.tsx` | 同样 bottomBar OEM bug + 优惠券价格未防缩放 | 优惠券选择栏 |

**B. 模块顶层 `Dimensions.get` 锁死宽度（违反原则 4）**

| # | 文件 | 位置 | 影响 |
|---|------|------|------|
| B1 | `app/(tabs)/museum.tsx` | L18 | 瀑布流卡宽不响应分屏/旋转 |
| B2 | `app/ai/recommend.tsx` | L18 | AI 推荐组合卡片 |
| B3 | `app/cart.tsx` | L27 | 推荐区固定 140px |
| B4 | `app/product/[id].tsx` | L32 | 商品详情多处依赖 |
| B5 | `app/search.tsx` | L27 | 搜索结果列宽 |
| B6 | `app/index.tsx` | L16 | 启动 splash |
| B7 | `app/vip/gifts.tsx` | L45-49 | **多处依赖**（CARD/SIDE_PADDING/benefitItem/emptyGifts），spec §1.1 原始复现点 |

**C. 大字号 / 价格未防字体放大（违反原则 2/5）**

| # | 文件 | 位置 | 问题 |
|---|------|------|------|
| C1 | `app/vip/gifts.tsx` | L860-866 | 价格档位 ¥399/¥699/¥999/¥1299 在华为字体 1.15x 时换行（**spec §1.1 原始复现点**）|
| C2 | `app/me/wallet.tsx` | L499 | 余额 `fontSize: 40` 长数字爆布局 |
| C3 | `app/me/bonus-queue.tsx` | L184 | 排位 `fontSize: 56` 无保护 |
| C4 | `app/me/coupons.tsx` | L99/L483 | 优惠面额 `fontSize: 26` 无防缩放 |
| C5 | `app/ai/recommend.tsx` | L632 | 组合价格无 priceTextProps |
| C6 | `app/checkout-coupon.tsx` | L98-102 | 金额区 fontSize:28/22 |

#### 🟡 中等问题清单（局部 / 大字体下才出问题）

| 类别 | 文件清单 | 数量 |
|------|---------|------|
| `fontSize ≥ 20` 缺 `numberOfLines` / `fitTextProps` | home / me / assistant / finance / trace / settings / notification / vip / chat / about | ~15 处 |
| ScrollView `paddingBottom` 写死 `spacing['3xl']` 不吃 insets | company/[id] / category/[id] / group/[id] / search / orders/index / 大部分列表页 | ~10 处 |
| 共用组件 safe area 隐患 | `Toast.tsx`（用 `insets.bottom` 但无 OEM 兜底）/ `Screen.tsx`（`safeAreaBottom` 默认 `false` 容易被忘）/ `AiFloatingCompanion.tsx` | 3 处 |

#### ✅ 干净文件（无明显问题，约 30 个）

```
about.tsx / privacy.tsx / terms.tsx / payment-success.tsx / account-security.tsx
referral.tsx / lottery.tsx / coupon-center.tsx / inbox/index.tsx
checkout-address.tsx / checkout-pending.tsx / company/search.tsx
ai/history.tsx / orders/index.tsx / orders/track.tsx
invoices/index.tsx / invoices/request.tsx / invoices/profiles.tsx / invoices/profiles/edit.tsx
me/addresses.tsx / me/appearance.tsx / me/following.tsx / me/profile.tsx
me/recommend.tsx / me/referral.tsx / me/scanner.tsx / me/tasks.tsx
user/[id].tsx
src/components/overlay/PrivacyConsentModal.tsx / MapView.tsx / VoiceOverlay.tsx
```

---

### 6.2 Sprint 拆解

| Sprint | 任务 | 涉及文件 | 预计 commit | 部署 | 状态 |
|--------|------|---------|------------|------|------|
| **R-RS01** | 工具集基建：新建 `src/theme/responsive.ts` + `app/_layout.tsx` 全局兜底 | 1 新增 + 1 改 | 1 | OTA | ⬜ |
| **R-RS02** | 共用组件改造：StickyCTABar / Toast / Screen `safeAreaBottom` 默认值评估 / AiFloatingCompanion | 4 共用组件 | 3-4 | OTA | ⬜ |
| **R-RS03** | 高优单页修复（用户已报告 + spec 复现点）：A2/A5/A6/A7 + B7+C1（gifts 三处一起修）| 5 页 | 5 | OTA | ⬜ |
| **R-RS04** | 顶层 Dimensions 批量替换（B1-B6） | 6 页 | 6 | OTA | ⬜ |
| **R-RS05** | 金额字号 spread `priceTextProps`（C2-C6）| 5 页 | 4-5 | OTA | ⬜ |
| **R-RS06** | 中优字号批量修（fontSize≥20 缺保护，~15 处）| ~15 页 | 5-8 | OTA | ⬜ |
| **R-RS07** | 中优 ScrollView paddingBottom 批量改吃 insets（~10 处）| ~10 页 | 3-5 | OTA | ⬜ |
| **R-RS-LT01** | PR 模板加适配 Checklist 提示 | — | 1 | — | ⬜ |
| **R-RS-LT02** | OTA 发布前必跑 rg 审计（加进 `app-发布与OTA手册.md`）| — | 1 | — | ⬜ |
| **R-RS-LT03**（可选）| 封装 `AppText` 组件包 `Text`，从 defaultProps 升级到组件层显式控制 | 全项目 | — | OTA | ⬜ |

**执行原则**：
- R-RS01 必须最先做（其余 sprint 都依赖工具集）
- R-RS02 第二（共用组件改一次修多页）
- R-RS03 第三（用户已报告的 bug 优先于其他）
- R-RS04~07 顺序无强依赖，可按可用时间穿插
- 每个 sprint 完成 → 跑 §4 真机测试矩阵 8 场景 → OTA

---

### 6.3 修复进度表（每文件一行，commit 落实后回填）

| 文件 | 严重度 | Sprint | 状态 | commit | 完成日期 |
|------|--------|--------|------|--------|---------|
| `src/theme/responsive.ts`（新建）| — | R-RS01 | ⬜ | — | — |
| `app/_layout.tsx`（全局兜底）| — | R-RS01 | ⬜ | — | — |
| `src/components/orders/StickyCTABar.tsx` | 🔴 A1 | R-RS02 | ⬜ | — | — |
| `src/components/feedback/Toast.tsx` | 🟡 | R-RS02 | ⬜ | — | — |
| `src/components/layout/Screen.tsx` | 🟡 | R-RS02 | ⬜ | — | — |
| `src/components/effects/AiFloatingCompanion.tsx` | 🟡 | R-RS02 | ⬜ | — | — |
| `app/orders/[id].tsx` | 🔴 A2 | R-RS03 | ⬜ | — | — |
| `app/orders/after-sale/[id].tsx` | 🔴 A3 | R-RS03（共用组件 R-RS02 修完即解决）| ⬜ | — | — |
| `app/orders/after-sale-detail/[id].tsx` | 🔴 A4 | R-RS03（同上）| ⬜ | — | — |
| `app/checkout.tsx` | 🔴 A5 | R-RS03 | ⬜ | — | — |
| `app/cart.tsx` | 🔴 A6 + 🟡 B3 | R-RS03 + R-RS04 | ⬜ | — | — |
| `app/checkout-coupon.tsx` | 🔴 A7 + 🔴 C6 | R-RS03 + R-RS05 | ⬜ | — | — |
| `app/vip/gifts.tsx` | 🔴 B7 + 🔴 C1 | R-RS03（一次改 3 类问题）| ⬜ | — | — |
| `app/(tabs)/museum.tsx` | 🔴 B1 | R-RS04 | ⬜ | — | — |
| `app/ai/recommend.tsx` | 🔴 B2 + 🔴 C5 | R-RS04 + R-RS05 | ⬜ | — | — |
| `app/product/[id].tsx` | 🔴 B4 | R-RS04 | ⬜ | — | — |
| `app/search.tsx` | 🔴 B5 + 🟡 | R-RS04 + R-RS07 | ⬜ | — | — |
| `app/index.tsx` | 🔴 B6 | R-RS04 | ⬜ | — | — |
| `app/me/wallet.tsx` | 🔴 C2 | R-RS05 | ⬜ | — | — |
| `app/me/bonus-queue.tsx` | 🔴 C3 | R-RS05 | ⬜ | — | — |
| `app/me/coupons.tsx` | 🔴 C4 | R-RS05 | ⬜ | — | — |
| `app/(tabs)/home.tsx` | 🟡 | R-RS06 | ⬜ | — | — |
| `app/(tabs)/me.tsx` | 🟡 | R-RS06 | ⬜ | — | — |
| `app/ai/assistant.tsx` | 🟡 | R-RS06 | ⬜ | — | — |
| `app/ai/finance.tsx` | 🟡 | R-RS06 | ⬜ | — | — |
| `app/ai/trace.tsx` | 🟡 | R-RS06 | ⬜ | — | — |
| `app/ai/chat.tsx` | 🟡 | R-RS06 | ⬜ | — | — |
| `app/me/vip.tsx` | 🟡 | R-RS06 | ⬜ | — | — |
| `app/settings.tsx` | 🟡 | R-RS06 | ⬜ | — | — |
| `app/notification-settings.tsx` | 🟡 | R-RS06 | ⬜ | — | — |
| `app/company/[id].tsx` | 🟡 | R-RS07 | ⬜ | — | — |
| `app/category/[id].tsx` | 🟡 | R-RS07 | ⬜ | — | — |
| `app/group/[id].tsx` | 🟡 | R-RS07 | ⬜ | — | — |
| `app/invoices/[id].tsx` | 🟡 | R-RS07 | ⬜ | — | — |
| `app/cs/index.tsx` | 🟡 | R-RS07 | ⬜ | — | — |

> 30 个干净文件不进表（无修复任务）；后续真机/审计再发现新问题追加到本表。

---

## 七、常见反模式 + 修法速查

### 反模式 1：写死 SCREEN_WIDTH 算单元宽度
```tsx
// ❌
const ITEM_WIDTH = SCREEN_WIDTH / 4 - 10;

// ✅
const { width, columns } = useResponsiveLayout();
const cols = columns({ wide: 4, narrow: 2 });
const itemWidth = (width - GAP * (cols - 1) - PADDING * 2) / cols;
```

### 反模式 2：价格用普通 Text
```tsx
// ❌
<Text style={{ fontSize: 22, fontWeight: '700' }}>¥{price}</Text>

// ✅
<Text {...priceTextProps} style={{ fontSize: 22, fontWeight: '700' }}>¥{price}</Text>
```

### 反模式 3：底部按钮硬定位
```tsx
// ❌
<View style={{ position: 'absolute', bottom: 0, padding: 16 }}>...</View>

// ✅
const bottomPadding = useBottomInset(12);
<View style={{ position: 'absolute', bottom: 0, paddingTop: 16, paddingBottom: bottomPadding }}>...</View>
```

### 反模式 4：横向多 Text 平分宽度
```tsx
// ❌
<View style={{ flexDirection: 'row' }}>
  <Text style={{ flex: 1 }}>商品名</Text>
  <Text style={{ flex: 1 }}>¥{price}</Text>
  <Text style={{ flex: 1 }}>x{qty}</Text>
</View>

// ✅
<View style={{ flexDirection: 'row', alignItems: 'center' }}>
  <Text style={{ flex: 1 }} numberOfLines={1} ellipsizeMode="tail">商品名</Text>
  <Text {...priceTextProps} style={{ marginHorizontal: 8, fontWeight: '700' }}>¥{price}</Text>
  <Text style={{ minWidth: 30 }}>x{qty}</Text>
</View>
```

### 反模式 5：单行长文本会爆
```tsx
// ❌
<Text style={{ fontSize: 16 }}>{order.merchantOrderNo}</Text>   // 订单号 30 字符可能爆

// ✅
<Text style={{ fontSize: 16 }} numberOfLines={1} ellipsizeMode="middle">
  {order.merchantOrderNo}   // 中间省略：CS-1777...-th9j7o
</Text>
```

---

## 八、何时更新本文档

任何下列情况发生：

- 发现新的设备适配 bug → 加入"触发案例"表
- 新工具 / Hook 加入 `responsive.ts` → 同步本文 §3
- 检查清单 / rg 黑名单 增删 → 同步 §4 / §5
- 真机测试矩阵增加 → §4
- 反模式新发现 → §7

> **配套文件**：`src/theme/responsive.ts`（工具实现），`docs/operations/app-发布与OTA手册.md` 第四章（OTA 前 checklist 引用本文）。
