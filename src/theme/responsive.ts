/**
 * 买家 App 响应式适配工具集
 *
 * 权威规范见 docs/architecture/responsive-design.md。
 * 任何修改都要同步更新该文档 §3。
 *
 * 使用前提：
 * - 横向多列容器：用 useResponsiveLayout().columns 替代写死列数
 * - 紧凑数字位（价格/Badge/Tab 数字）：spread priceTextProps
 * - 标题/列表项：spread fitTextProps
 * - 按钮 CTA：spread compactActionTextProps（不要默认关闭系统字体缩放）
 * - 底部固定栏：用 useBottomInset 替代直接读 insets.bottom
 *
 * 全局兜底：app/_layout.tsx 已设置 Text.defaultProps.maxFontSizeMultiplier = 1.2，
 * 所有 Text 默认最大字体放大不超过 1.2x（无障碍合规 + 防爆）。
 */

import { Dimensions, PixelRatio, Platform, TextProps, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ---------------------------------------------------------------------------
// useResponsiveLayout — 屏宽 / 字体缩放感知 Hook
// ---------------------------------------------------------------------------

export interface ColumnsConfig {
  /** 宽屏（≥390dp 且 fontScale<1.15）列数，例如 4 */
  wide: number;
  /** 窄屏（<360dp）列数，例如 2 */
  narrow: number;
  /** 紧凑屏（<390dp 或 fontScale≥1.15）列数，缺省取 narrow */
  compact?: number;
}

/**
 * 响应式布局 Hook，返回当前窗口宽度、字体缩放、屏幕分类、列数计算器。
 *
 * 必须在组件函数体内调用（依赖 useWindowDimensions），不允许在模块顶层使用。
 *
 * @example
 *   const { columns, isNarrow, isLargeText } = useResponsiveLayout();
 *   const cols = columns({ wide: 4, narrow: 2 });
 */
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
    /** 是否窄屏（<360dp，常见小屏 Android） */
    isNarrow,
    /** 是否紧凑屏（<390dp 或字体/显示大小偏大） */
    isCompact,
    /** 是否大字体/大显示模式（fontScale ≥ 1.15） */
    isLargeText,
    /** 是否横屏 */
    isLandscape: width > height,
    /**
     * 按窗口宽度选列数。
     * 窄屏取 narrow，紧凑屏取 compact（缺省 narrow），其余取 wide。
     */
    columns: (config: ColumnsConfig) => {
      if (width < 360) return config.narrow;
      if (isCompact) return config.compact ?? config.narrow;
      return config.wide;
    },
  };
};

// ---------------------------------------------------------------------------
// TextProps 预设
// ---------------------------------------------------------------------------

/**
 * 紧凑数字位专用：价格 / Badge / Tab 数字 / 版本号 / 订单号
 *
 * 不响应系统字体放大（allowFontScaling: false），自动缩字号塞一行。
 * 仅用于"紧凑数字位"——不要给正文段落用，会破坏无障碍。
 */
export const priceTextProps: Partial<TextProps> = {
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.75,
  allowFontScaling: false,
};

/**
 * 一般可缩文本：标题 / 列表项
 *
 * 响应系统字体放大（受 app/_layout.tsx 的 1.2x 全局封顶限制），
 * 装不下时自动缩字号到原 85%。
 */
export const fitTextProps: Partial<TextProps> = {
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.85,
};

/**
 * 按钮 / 筛选 Tab 文字
 *
 * 保留系统字体响应能力但限制最大放大倍率，比 priceTextProps 更友好的
 * 无障碍策略——视障/老年用户仍能看到字体放大效果。
 */
export const compactActionTextProps: Partial<TextProps> = {
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.8,
  maxFontSizeMultiplier: 1.1,
};

// ---------------------------------------------------------------------------
// useBottomInset — 固定底部栏 padding 兜底
// ---------------------------------------------------------------------------

// 2026-05-20: 32 → 56。原因：用户在华为 3 键机上反馈 invoices/request 底部按钮
// 仍被虚拟键挡住，diagnose 后发现 32dp 对部分华为/Honor 3 键导航条（实际高度
// 50-70dp）不够。56dp = 标准 Android nav 48dp + 8dp 安全余量；只影响 edge-to-edge
// 模式下 insets.bottom 错报 0 的少数机型，其余机型继续走真实 insets。
const ANDROID_NAV_FALLBACK = 56;

/**
 * 固定底部栏专用 paddingBottom。
 *
 * Android edge-to-edge 模式（系统栏覆盖 app 窗口）下，部分 OEM / 三键导航
 * 会错把 insets.bottom 报 0，导致底部栏被系统按钮挡住——此时强制 56dp 兜底。
 *
 * 但**只在确认 edge-to-edge 时才补**：粗暴的 Math.max(insets.bottom, 56)
 * 会在非 edge-to-edge 旧机型 / 全屏沉浸 App 上多塞 56dp 空白，所以必须用
 * window.height vs screen.height 判定。逻辑与 app/(tabs)/_layout.tsx:13-34
 * 一致。
 *
 * 判定矩阵：
 * | 机型 / 模式                          | insets | window=screen | 结果 |
 * |--------------------------------------|--------|---------------|------|
 * | 华为三键 OEM bug + edge-to-edge      | 0      | 是            | 56   |
 * | 三键正常返回 inset                   | 48     | 是            | 48   |
 * | 全面屏小白条                         | 24-34  | 是            | 24-34|
 * | 非 edge-to-edge 旧机                 | 0      | 否            | 0    |
 * | 全屏沉浸 App                         | 0      | 否            | 0    |
 * | iOS home indicator                   | 34     | N/A           | 34   |
 *
 * @param extra 额外的视觉 padding（默认 12，用于和系统按钮拉开距离）
 */
export const useBottomInset = (extra: number = 12): number => {
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
