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

> 🟡 **R-RS01 代码已落地（2026-05-04），待真机视觉验证**：`src/theme/responsive.ts` 已创建（5 个 helper 全部到位）+ `app/_layout.tsx` 已加 Text.defaultProps 1.2x 全局封顶。新代码可以开始 `import { useResponsiveLayout, priceTextProps, ... } from 'src/theme'`。但视觉回归（首页/VIP 礼包/购物车冷启） **尚未完成**，所以本节状态标 🟡 而非 ✅；视觉验证 OK 后本警示去除。

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
import { Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ANDROID_NAV_FALLBACK = 32;

/**
 * 固定底部栏专用 paddingBottom。
 *
 * Android edge-to-edge 模式（系统栏覆盖 app 窗口）下，部分 OEM / 三键导航
 * 会错把 insets.bottom 报 0，导致底部栏被系统按钮挡住——此时强制 32dp 兜底。
 *
 * 但**只在确认 edge-to-edge 时才补**：粗暴的 `Math.max(insets.bottom, 32)`
 * 会在非 edge-to-edge 旧机型 / 全屏沉浸 App 上多塞 32dp 空白（典型表现：
 * 小米机底部出现莫名空白条），所以必须用 window.height vs screen.height
 * 判定，与 `app/(tabs)/_layout.tsx` 的实现保持一致。
 */
export const useBottomInset = (extra = 12) => {
  const insets = useSafeAreaInsets();
  let safeBottom = insets.bottom;

  if (Platform.OS === 'android' && insets.bottom === 0) {
    const window = Dimensions.get('window');
    const screen = Dimensions.get('screen');
    const isEdgeToEdge = Math.abs(window.height - screen.height) < 2; // 容忍 1px 误差
    if (isEdgeToEdge) {
      safeBottom = ANDROID_NAV_FALLBACK; // OEM bug 兜底
    }
  }

  return safeBottom + extra;
};
```

> **判定逻辑要点**：
> - `window.height === screen.height` → edge-to-edge 已开启，app 画到系统栏后面，必须靠 inset 自适应；inset 报 0 就是 OEM bug，补 32dp
> - `window.height < screen.height` → 系统栏在 app 窗口外，inset 自然为 0 是正确行为，不补
>
> 这里**只允许在函数体内**用 `Dimensions.get`（运行时一次性判定），不算违反原则 4——原则 4 禁止的是"模块顶层 `Dimensions.get`"导致旋转/分屏不更新。

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

> 🟡 **R-RS01 helper 已可用（2026-05-04 落地，待真机验证）**：所有 helper 直接 `import { useResponsiveLayout, priceTextProps, fitTextProps, compactActionTextProps, useBottomInset } from 'src/theme'`。新代码 PR 按下面 Checklist 严格检查；老代码迁移走 R-RS04-07 sprint，迁移期允许暂时延用原生 API（`useWindowDimensions` / 显式 `numberOfLines+adjustsFontSizeToFit`）作为过渡，但同一文件碰一次就建议改完。

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

**结果总览**（2026-05-04 二次复核后修正）：
- 🔴 严重：20 处（涉及 16 个文件）
- 🟡 中等：26+ 处
- ✅ 干净：约 29 个文件（首版误把 `orders/index.tsx` 列入，已移到🟡）

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
| ~~B1~~ | ~~`app/(tabs)/museum.tsx`~~ | ~~L18~~ | ✅ **已用 `useWindowDimensions` 改造完成（2026-05-04 复核）**，从待修清单移除 |
| B2 | `app/ai/recommend.tsx` | L18 | AI 推荐组合卡片 |
| B3 | `app/cart.tsx` | L27 | 推荐区固定 140px |
| B4 | `app/product/[id].tsx` | L32 | 商品详情多处依赖 |
| B5 | `app/search.tsx` | L27 | 搜索结果列宽 |
| B6 | `app/index.tsx` | L16 | 启动 splash |
| B7 | `app/vip/gifts.tsx` | L45-49 | **多处依赖**（CARD/SIDE_PADDING/benefitItem/emptyGifts），spec §1.1 原始复现点 |
| B8 | `src/components/effects/FloatingParticles.tsx` | L18 | **共用组件**——粒子背景宽高写死，分屏/旋转不重算（2026-05-04 复核新增） |

> **豁免清单**（rg 命中但不计违规）：
> - `app/(tabs)/_layout.tsx:28-29` — 在函数体内、仅用于 edge-to-edge 判定（原则 4 只禁模块顶层）
> - `src/services/deferredLink.ts:95` — 设备指纹采集服务，需要 screen 像素信息，与 UI 无关

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
ai/history.tsx / orders/track.tsx
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
| **R-RS01** | 工具集基建：新建 `src/theme/responsive.ts`（159 行，5 helper）+ `app/_layout.tsx` 全局 1.2x 封顶 + `src/theme/index.ts` re-export | 1 新增 + 2 改 | 1（待 commit）| OTA（待视觉验证） | 🟡 代码完成 |
| **R-RS02** | 共用组件改造：StickyCTABar / Toast / Screen safeAreaBottom 文档化 / AiFloatingCompanion | 4 共用组件 | 1（合并） | OTA（待） | 🟡 代码完成 |
| **R-RS03** | 高优单页修复（用户已报告 + spec 复现点）：A2/A5/A6/A7 + B7+C1（gifts 三处一起修）| 5 页 | 1（合并） | OTA（待） | 🟡 代码完成 |
| **R-RS04** | 顶层 Dimensions 批量替换（B2/B3/B4/B5/B6 + 共用组件 B8；B1 已修、B7 在 R-RS03 一起改）| 5 页 + 1 共用组件 | 1（合并） | OTA（待） | 🟡 代码完成 |
| **R-RS05** | 金额字号 spread `priceTextProps`（C2-C6）| 5 页 | 4-5 | OTA | ⬜ |
| **R-RS06** | 中优字号批量修（fontSize≥20 缺保护，5 文件实际改）| 9 页（5 改 4 验证免改）| 2（族 A + 族 B） | OTA（待） | 🟡 代码完成 |
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
| `src/theme/responsive.ts`（新建 159 行）| — | R-RS01 | 🟡 代码完成 待真机验证 | （待 commit）| 2026-05-04 |
| `app/_layout.tsx`（Text.defaultProps 1.2x 封顶）| — | R-RS01 | 🟡 代码完成 待真机验证 | （待 commit）| 2026-05-04 |
| `src/theme/index.ts`（re-export responsive）| — | R-RS01 | 🟡 代码完成 待真机验证 | （待 commit）| 2026-05-04 |
| `src/components/orders/StickyCTABar.tsx` | 🔴 A1 | R-RS02 | 🟡 代码完成 待真机验证 | （见 git log）| 2026-05-04 |
| `src/components/feedback/Toast.tsx` | 🟡 | R-RS02 | 🟡 代码完成 待真机验证 | （见 git log）| 2026-05-04 |
| `src/components/layout/Screen.tsx` | 🟡 | R-RS02 | 🟡 文档化完成（不改默认值） | （见 git log）| 2026-05-04 |
| `src/components/effects/AiFloatingCompanion.tsx` | 🟡 | R-RS02 | 🟡 代码完成 待真机验证 | （见 git log）| 2026-05-04 |
| `src/components/effects/FloatingParticles.tsx` | 🔴 B8 | R-RS04 | 🟡 代码完成 待真机验证 | （见 git log）| 2026-05-04 |
| `app/orders/[id].tsx` | 🔴 A2 | R-RS03 | 🟡 代码完成 待真机验证 | （见 git log）| 2026-05-04 |
| `app/orders/after-sale/[id].tsx` | 🔴 A3 | R-RS03（共用组件 R-RS02 修完即解决）| 🟡 R-RS02 自动修复 | （见 git log fa1cf81）| 2026-05-04 |
| `app/orders/after-sale-detail/[id].tsx` | 🔴 A4 | R-RS03（同上）| 🟡 R-RS02 自动修复 | （见 git log fa1cf81）| 2026-05-04 |
| `app/checkout.tsx` | 🔴 A5 | R-RS03 | 🟡 代码完成 待真机验证（小米空白 bug）| （见 git log）| 2026-05-04 |
| `app/cart.tsx` | 🔴 A6 + 🔴 B3 | R-RS03 + R-RS04 | 🟡 A6 完成；B3 留 R-RS04 | （见 git log）| 2026-05-04 |
| `app/checkout-coupon.tsx` | 🔴 A7 + 🔴 C6 | R-RS03 + R-RS05 | 🟡 A7 完成；C6 留 R-RS05 | （见 git log）| 2026-05-04 |
| `app/vip/gifts.tsx` | 🔴 B7 + 🔴 C1 | R-RS03（一次改 3 类问题）| 🟡 B7 + C1 完成（spec §1.1 复现点修复）| （见 git log）| 2026-05-04 |
| ~~`app/(tabs)/museum.tsx`~~ | ~~🔴 B1~~ | R-RS04 | ✅ 已修复（先于本规范） | — | — |
| `app/ai/recommend.tsx` | 🔴 B2 + 🔴 C5 | R-RS04 + R-RS05 | 🟡 B2 完成；C5 留 R-RS05 | （见 git log）| 2026-05-04 |
| `app/product/[id].tsx` | 🔴 B4 | R-RS04 | 🟡 代码完成 待真机验证 | （见 git log）| 2026-05-04 |
| `app/search.tsx` | 🔴 B5 + 🟡 | R-RS04 + R-RS07 | 🟡 B5 完成；🟡 留 R-RS07 | （见 git log）| 2026-05-04 |
| `app/index.tsx` | 🔴 B6 | R-RS04 | 🟡 代码完成 待真机验证 | （见 git log）| 2026-05-04 |
| `app/me/wallet.tsx` | 🔴 C2 | R-RS05 | ⬜ | — | — |
| `app/me/bonus-queue.tsx` | 🔴 C3 | R-RS05 | ⬜ | — | — |
| `app/me/coupons.tsx` | 🔴 C4 | R-RS05 | ⬜ | — | — |
| `app/(tabs)/home.tsx` | 🟡 | R-RS06 族 A | 🟡 完成（pairedAi 标题/品牌字加 priceTextProps + 问候语 fitTextProps）| （见 git log）| 2026-05-04 |
| `app/(tabs)/me.tsx` | 🟡 | R-RS06 族 A | 🟡 完成（钱包余额/推荐码 priceTextProps + VIP 弹窗标题 fitTextProps）| （见 git log）| 2026-05-04 |
| `app/ai/assistant.tsx` | 🟡 | R-RS06 族 B | 🟡 完成（hero 标题 fitTextProps）| （见 git log）| 2026-05-04 |
| `app/ai/finance.tsx` | 🟡 | R-RS06 族 B | ✅ 验证免改（最大 title3=18 < 20）| — | 2026-05-04 |
| `app/ai/trace.tsx` | 🟡 | R-RS06 族 B | 🟡 完成（评分数字 priceTextProps）| （见 git log）| 2026-05-04 |
| `app/ai/chat.tsx` | 🟡 | R-RS06 族 B | ✅ 验证免改（仅 body/caption < 20）| — | 2026-05-04 |
| `app/me/vip.tsx` | 🟡 | R-RS06 族 A | 🟡 完成（钱包余额×3 + 推荐码 priceTextProps）| （见 git log）| 2026-05-04 |
| `app/settings.tsx` | 🟡 | R-RS06 族 A | ✅ 验证免改（最大 title3=18 < 20）| — | 2026-05-04 |
| `app/notification-settings.tsx` | 🟡 | R-RS06 族 A | ✅ 验证免改（仅 body/caption < 20）| — | 2026-05-04 |
| `app/company/[id].tsx` | 🟡 | R-RS07 | ⬜ | — | — |
| `app/category/[id].tsx` | 🟡 | R-RS07 | ⬜ | — | — |
| `app/group/[id].tsx` | 🟡 | R-RS07 | ⬜ | — | — |
| `app/invoices/[id].tsx` | 🟡 | R-RS07 | ⬜ | — | — |
| `app/cs/index.tsx` | 🟡 | R-RS07 | ⬜ | — | — |
| `app/orders/index.tsx` | 🟡（paddingBottom: spacing['3xl'] 不吃 insets，L153）| R-RS07 | ⬜ | — | — |

> 29 个干净文件不进表（无修复任务，详见 §6.1 末尾✅清单）；后续真机/审计再发现新问题追加到本表。

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

> **配套文件**：
> - `src/theme/responsive.ts`（工具实现，🟡 2026-05-04 R-RS01 落地 159 行 5 helper，待真机视觉验证）
> - `app/(tabs)/_layout.tsx:13-34`（已落地的 edge-to-edge bottom inset 判定，§3.3 `useBottomInset` 必须与之一致）
> - `docs/operations/app-发布与OTA手册.md` 第四章（OTA 前 checklist 引用本文）

---

## 九、关联体验问题（相邻规范，本文仅留指针）

> **范围声明**：§1-§8 处理的是"宽度 / 字体 / 多列降级 / 安全区"这类**几何适配**问题。但用户在中国手机上感受到的"App 不掉链子"远不止这些——下面 13 项是 2026-05-04 整理的相邻体验问题，**不在 6 原则覆盖范围内**，但同等重要。本节只做**问题登记 + 解法指针**，不展开规范；任何一项升级为正式规范时，应单独立档（或扩展 §3 工具集）并在此处补链接。

### 9.1 🔴 用户能立刻感知（建议进 v1.0 上线 checklist）

| # | 问题 | 推荐解法 | 当前状态 / 负责人 |
|---|------|---------|------------------|
| ③ | 顶部状态栏 / 刘海 / 灵动岛 不挡内容 | `useSafeAreaInsets().top` + 自定义 header / Modal 顶部均吃 inset | 需 audit `Screen.tsx` 默认 `safeAreaTop` 是否 true + 全部自定义 header |
| ④ | 多输入框表单 focus 时自动滚到当前 input | `KeyboardAwareScrollView`（依赖已存在 `react-native-keyboard-aware-scroll-view`）替代 `ScrollView`；KAV 只抬根容器，不会定位到 focus | 需 audit 5+ 输入框页：地址 / 注册 / 发票申请 / 实名认证 / 商家入驻 |
| ⑤ | Android 物理返回键 / iOS 全面屏左滑返回 | 多页面流（结账→选地址→选优惠券）规范返回行为；Modal/BottomSheet 优先关 Modal 不退页 | 需单独立档；目前各页散落 `BackHandler`，无规范 |
| ⑥ | TextInput 长按"复制/粘贴"菜单不被键盘遮挡 | KAV `extraScrollHeight` 调整 + 关键 input 加 `selectionColor` 测试 | 真机回归 §4 矩阵需补一项 |
| ⑦ | Modal / BottomSheet 自己吃 Safe Area | 弹层组件内部 `useSafeAreaInsets`，顶部 padding inset.top + 12，底部 padding `useBottomInset(12)` | 共用组件 audit：客服聊天 BottomSheet / 地址选择 / AI 推荐弹层 |
| ⑧ | App 前后台切换状态保持 | Zustand 持久化 + 表单输入用 `useFormPersist`；订单/支付中态切到微信回来不丢 | 跟响应式无关但同一类，建议另立档 |

### 9.2 🟡 不紧急但会拉低质感

| # | 问题 | 推荐解法 | 当前状态 |
|---|------|---------|---------|
| ⑨ | Touch target 最小 44x44pt（iOS）/ 48x48dp（Android）| Theme 加 `minTouchSize` token，`<Pressable hitSlop={...}>` 兜底 | 农业用户群 30-60 岁居多，按钮过小高频误触；需全项目 audit |
| ⑩ | 图片 loading / 失败 fallback | `expo-image` 的 `placeholder` + `onError` 显示占位图 | 商品列表 / 商家头像 audit |
| ⑪ | 状态栏 `barStyle` 跟随页面背景切换 | 浅色背景 `dark-content`，深色背景 `light-content`；用 `expo-status-bar` 的 `Stack.Screen options` 切换 | 现状可能写死一种，audit |
| ⑫ | 横屏锁定 | `app.json` `orientation: "portrait"` 全局锁；商品大图查看页另议 | 已知应锁：登录 / 支付 / AI 语音 / 客服聊天 |
| ⑬ | 弱网 / 断网 toast | `@react-native-community/netinfo` 监听，断网/弱网横幅提醒 | 现状未实现 |
| ⑭ | 文字超长省略 + 数字位防抖 | 商家名/商品名 `numberOfLines={1}` + `ellipsizeMode="tail"`；金额数字位加 `minWidth` 防抖（¥9 vs ¥9999.99 字符宽度差 6 倍）| §6.3 R-RS06 部分覆盖，但"数字位 minWidth"是新增点 |
| ⑮ | App 启动 Splash 适配 | `app.json` splash + iOS LaunchScreen.storyboard 各分辨率 | 跟 RN 层无关，是 native 配置；EAS Build 出包前必须验 |

### 9.3 🟢 v1.0 可不管（Backlog 登记）

⑯ 暗黑模式覆盖完整性（`useTheme` 已支持，但页面 audit 未做）
⑰ 复制粘贴自定义菜单 / iOS InputAccessoryView 完成按钮
⑱ iOS Dynamic Type 极端档位（AX1-AX5）—— §3.4 1.2x 封顶已挡住爆布局，剩下是无障碍体验细节
⑲ Push 通知点击 deep link 跳转准确性
⑳ 屏幕录制 / 截图水印（合规要求）

---

### 9.4 与 §6 Sprint 的关系

§9 列的 ③-⑮ 这 13 项**不进 R-RS01-07 sprint**（那 7 个 sprint 范围严格限定在几何适配）。需要：

- 在 `docs/issues/tofix-app-frontend.md` 追加一节「**响应式之外的体验扩展**」，按 §9.1 / 9.2 / 9.3 优先级顺序登记 13 项 + 提出对应改造任务（暂定编号 R-UX01 ~ R-UX13）
- 每项升级为正式规范时（如 ④ 多输入框表单 focus 滚动 → 完整规范），在本节对应行加文档链接
- §4 PR Checklist 在 R-RS01 完成后扩展时，可以选择性吸收 ③⑦⑨⑪ 这几项进编码阶段勾选项
