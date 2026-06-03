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

import { PixelRatio, Platform, TextProps, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { calculateBottomInset } from './bottomInset';

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

export interface BottomInsetOptions {
  /**
   * Isolated page-level escape hatch for Android screens whose bottom CTA is
   * still obscured when the OEM reports bottom inset as 0 or a tiny non-zero
   * value.
   *
   * This must not be used as a global default; global Android zero-inset
   * fallback caused app-wide bottom gaps on gesture-nav devices.
   */
  androidMinimumBottomPadding?: number;
}

// ---------------------------------------------------------------------------
// useBottomInset — 固定底部栏 safe-area padding
// ---------------------------------------------------------------------------

/**
 * 固定底部栏专用 paddingBottom。
 *
 * 这里不再根据 Android `Dimensions` 推断虚拟导航栏高度：
 * 不同 OEM 在手势条 / 三键导航 / edge-to-edge 下返回的
 * `insets.bottom`、`window.height`、`screen.height` 组合不稳定，
 * JS 侧强行兜底会把正常页面顶出统一 gap。
 *
 * 统一规则：只使用系统 safe-area 返回值 + 调用方额外视觉间距。
 *
 * 判定矩阵：
 * | 机型 / 模式                          | bottom inset | 结果 |
 * |--------------------------------------|--------------|------|
 * | Android 手势条且系统返回 0           | 0            | extra |
 * | Android 手势条且系统返回 24-34       | 24-34        | inset + extra |
 * | Android 三键且系统返回 48-64         | 48-64        | inset + extra |
 * | iOS home indicator                   | 34           | 34 + extra |
 *
 * @param extra 额外的视觉 padding（默认 12，用于和系统按钮拉开距离）
 * @param options 页面级例外配置。默认不要传。
 */
export const useBottomInset = (extra: number = 12, options: BottomInsetOptions = {}): number => {
  const insets = useSafeAreaInsets();

  return calculateBottomInset({
    platform: Platform.OS,
    insetBottom: insets.bottom,
    extra,
    androidMinimumBottomPadding: options.androidMinimumBottomPadding,
  });
};
