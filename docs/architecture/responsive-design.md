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
| Tab bar 在华为三键键被遮 | `app/(tabs)/_layout.tsx` | `insets.bottom = 0` OEM bug，已用 32dp 兜底（commit ec64e3c）|
| 多页面键盘遮挡 | 11+ 含 TextInput 页面 | `Screen.tsx` 无 KAV，已加 `keyboardAvoiding` prop（commit b9ca8df）|

### 1.2 问题分类

按根因分 4 类：

1. **字体缩放未控制**：React Native `<Text>` 默认跟随系统字体设置放大（华为/小米/OPPO 都有"超大字体"选项 1.5-2x）
2. **写死 px / 模块顶层 Dimensions.get()**：旋转/分屏/字体放大时不更新
3. **底部固定栏未吃 safe area**：手势条/虚拟键覆盖
4. **横向多列硬塞**：`flex: 1` 平分屏宽，窄屏 / 大字体下溢出

---

## 二、6 条核心原则

### 原则 1：横向多列必须按真实窗口宽度计算

❌ 反模式：
```tsx
<View style={{ flexDirection: 'row', gap: 10 }}>
  {items.map(i => <Card style={{ flex: 1 }} />)}  // ← 4 列硬塞
</View>
```

✅ 推荐：
```tsx
const { columns } = useResponsiveLayout();
const cols = columns({ wide: 4, narrow: 2 });   // ← 窄屏自动降 2 列
<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
  {items.map(i => <Card style={{ width: `${100/cols - gapPercent}%` }} />)}
</View>
```

**降级策略**：
- 宽屏（≥ 390dp）：4 列
- 窄屏（< 360dp）：2 列
- 特别窄（< 320dp，少见）：横向 ScrollView

**判断标准**：用 dp（density-independent pixels）即 `useWindowDimensions().width`，不用绝对像素。

### 原则 2：金额/按钮/徽标必须防换行

紧凑数字位（价格、Badge、按钮文字、Tab 数字）必须加：

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

### 原则 3：固定底部栏必须吃 safe area

❌ 反模式：
```tsx
<View style={{ position: 'absolute', bottom: 0, height: 60 }}>
  <Button>提交订单</Button>
</View>
```

✅ 推荐：
```tsx
const insets = useSafeAreaInsets();
<View style={{
  position: 'absolute',
  bottom: 0,
  paddingBottom: insets.bottom + 12,   // ← 吃底部安全区
  paddingTop: 12,
}}>
  <Button>提交订单</Button>
</View>
```

同时**正文 ScrollView 的 contentContainerStyle.paddingBottom** 必须 ≥ 底部栏高度 + insets.bottom，避免最后一项被盖住：

```tsx
<ScrollView contentContainerStyle={{ paddingBottom: 60 + insets.bottom + 12 }}>
  ...
</ScrollView>
```

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
| ✅ 用 `false`（不响应系统字体）| 必须 | 价格、Badge 数字、按钮 CTA、Tab amount、版本号、订单号 |
| ✅ 用 `true`（默认）+ `maxFontSizeMultiplier: 1.2` | 推荐 | 标题、副标题、列表条目 |
| ❌ 禁止全局禁用 | — | 正文段落、订单详情、协议条款、客服聊天、AI 对话 |

**违反第 3 条 = 违反无障碍**（视障 / 老年用户依赖系统字体放大）。

### 原则 6：useResponsiveLayout 替代猜尺寸

不要再写：
```tsx
const ITEM_WIDTH = SCREEN_WIDTH / 4 - 10;  // ← 猜
```

统一改用：
```tsx
const { columns, isNarrow } = useResponsiveLayout();
const cols = columns({ wide: 4, narrow: 2 });
```

---

## 三、工具集（src/theme/responsive.ts）

### 3.1 `useResponsiveLayout()` Hook

```ts
import { useWindowDimensions } from 'react-native';

export const useResponsiveLayout = () => {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    /** 是否窄屏（<360dp，常见小屏 Android）*/
    isNarrow: width < 360,
    /** 是否紧凑屏（<390dp，含 iPhone SE 系列）*/
    isCompact: width < 390,
    /** 是否横屏 */
    isLandscape: width > height,
    /**
     * 按窗口宽度选列数
     * @example columns({ wide: 4, narrow: 2 })  // 窄屏 2 列，否则 4 列
     */
    columns: (config: { wide: number; narrow: number; compact?: number }) => {
      if (width < 360) return config.narrow;
      if (width < 390 && config.compact !== undefined) return config.compact;
      return config.wide;
    },
  };
};
```

### 3.2 `priceTextProps` / `fitTextProps` 预设

```ts
import { TextProps } from 'react-native';

/**
 * 价格 / 徽标 / 按钮 / Tab 数字 — 紧凑数字位专用
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
```

### 3.3 全局兜底（app/_layout.tsx）

```ts
import { Text } from 'react-native';

// 全局：所有 Text 默认最大字体放大不超过 1.2x（无障碍合规 + 防爆）
// 写死 fontSize 的页面即使忘加 fitTextProps，也不会被系统字体超大放大爆掉
(Text as any).defaultProps = (Text as any).defaultProps || {};
(Text as any).defaultProps.maxFontSizeMultiplier = 1.2;
```

---

## 四、新页面开发 Checklist（PR / Code Review 必跑）

### 编码阶段

- [ ] 没用模块顶层 `Dimensions.get('window' | 'screen')`，全用 `useWindowDimensions()`
- [ ] 横向多列容器（4 列以上）使用 `useResponsiveLayout().columns({ wide, narrow })`
- [ ] 价格 / Badge / 按钮 / Tab 数字 等紧凑文本 spread `priceTextProps`
- [ ] 标题 / 列表项等可缩文本 spread `fitTextProps`
- [ ] 正文段落保持默认（响应系统字体放大，无障碍兼容）
- [ ] 底部固定栏（`position: absolute` + `bottom: 0`）使用 `paddingBottom: insets.bottom + 12`
- [ ] 包含底部固定栏的 ScrollView，contentContainerStyle.paddingBottom ≥ 栏高 + insets.bottom + 12

### 真机测试矩阵（PR 必须跑过的 6 个场景）

| 场景 | 设备 / 设置 | 关注点 |
|---|---|---|
| 1 | Android 360dp（窄屏，如华为某些低端机）| 横向多列是否降级 / 文本是否换行 |
| 2 | iOS 390dp（iPhone 12/13/14）| 标准基准 |
| 3 | 系统字体放大 1.2x（设置 → 显示 → 字体大小 +2）| 价格/按钮是否爆 |
| 4 | 系统字体放大 1.3x（更激进）| 全局 maxFontSizeMultiplier 是否兜住 |
| 5 | Android 三键虚拟键 | Tab bar / 底部栏不被覆盖 |
| 6 | 全面屏手势条 + 键盘弹出 | 底部固定栏 + 键盘适配 |

### OTA / Build 发布前

- [ ] 上面 6 个场景全部跑过
- [ ] grep 审计黑名单（见五）输出 0 命中 OR 已知豁免
- [ ] 文档若有更新，本文 commit message 引用

---

## 五、grep 审计黑名单（项目级巡检）

定期跑这些 grep，发现新违反需立即修：

```bash
# 1. 模块顶层 Dimensions.get （绝对禁止）
grep -rnE "^const.*Dimensions\.get|^const SCREEN_WIDTH|^const SCREEN_HEIGHT" app/ src/ --include="*.tsx" --include="*.ts"

# 2. 写死大宽度（>200px 一般可疑，需确认是否需要响应式）
grep -rnE "width: [2-9][0-9]{2,}," app/ src/ --include="*.tsx"

# 3. 大字号 + 没 numberOfLines 限制（容易换行爆）
grep -rnB2 -A2 "fontSize: [2-9][0-9]" app/ src/ --include="*.tsx" | grep -B2 -A2 "fontSize" | grep -v "numberOfLines"

# 4. 底部固定栏可能没吃 safe area
grep -rnB1 -A5 "position: 'absolute'" app/ src/ --include="*.tsx" | grep -B3 "bottom: 0" | grep -v "insets.bottom"

# 5. flex:1 row 包多个 Text（窄屏/大字体爆）
grep -rnB3 -A10 "flexDirection: 'row'" app/ src/ --include="*.tsx" | grep -B3 -A10 "flex: 1" | grep -c "<Text"
```

每次发现新违反点：
1. 加进当前批次修
2. 实在没空 → 加进 `docs/issues/tofix-app-frontend.md` backlog
3. 不允许新代码引入新违反

---

## 六、实施路线图

### Sprint 1（本批次，3 commit）

| # | 内容 | 文件 |
|---|---|---|
| 1 | 工具基建 + 全局兜底 | 新建 `src/theme/responsive.ts`（useResponsiveLayout + priceTextProps + fitTextProps） + `app/_layout.tsx` 设全局 maxFontSizeMultiplier=1.2 |
| 2 | 修 VIP 礼包页（截图复现点）| `app/vip/gifts.tsx` 改 useWindowDimensions + 价格 tab 窄屏 2 列 + 价格 spread priceTextProps + 底部栏吃 safe area |
| 3 | 项目级 grep 审计报告 + 修高优 5 处 | grep 黑名单跑全项目，按页面访问频率排序，先修 checkout / 商品详情 / 订单卡片 / 加购栏 / 首页 |

### Sprint 2（下一批，按 grep 报告）

剩余非高优页面分批修，每个 commit 修 3-5 个页面。预计 2-3 个 sprint 清完。

### 长期：每个新页面强制走 Checklist

- PR 模板加适配 checklist
- 每个新页面 reviewer 必查响应式 6 原则
- OTA 发布前 6 场景测试矩阵

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
const insets = useSafeAreaInsets();
<View style={{ position: 'absolute', bottom: 0, paddingTop: 16, paddingBottom: insets.bottom + 12 }}>...</View>
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
- 检查清单 / grep 黑名单 增删 → 同步 §4 / §5
- 真机测试矩阵增加 → §4
- 反模式新发现 → §7

> **配套文件**：`src/theme/responsive.ts`（工具实现），`docs/operations/app-发布与OTA手册.md` 第四章（OTA 前 checklist 引用本文）。
