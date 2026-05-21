export type BottomInsetPlatform = 'android' | 'ios' | 'web' | 'windows' | 'macos';

export interface BottomInsetMetrics {
  platform: BottomInsetPlatform | string;
  insetBottom: number;
  insetTop?: number;
  windowHeight?: number;
  screenHeight?: number;
  extra?: number;
  /**
   * Page-level escape hatch for isolated Android screens whose bottom CTA is
   * still obscured when the OEM reports bottom inset as 0 or a tiny non-zero
   * value.
   *
   * Do not use globally. The default path intentionally avoids inferring a
   * nav-bar fallback because that caused app-wide bottom gaps on gesture-nav
   * devices.
   */
  androidMinimumBottomPadding?: number;
}

/**
 * Computes the visual bottom padding for fixed bottom bars.
 *
 * Important: Android OEMs report inconsistent combinations of safe-area
 * insets and window/screen dimensions. A JS-only helper cannot reliably
 * distinguish "zero inset is correct" from "zero inset is an OEM bug".
 * Therefore this helper deliberately does not infer a virtual navigation
 * fallback from Dimensions. It only applies the safe-area value reported by
 * react-native-safe-area-context plus the caller's visual spacing.
 */
export function calculateBottomInset({
  platform,
  insetBottom,
  extra = 12,
  androidMinimumBottomPadding,
}: BottomInsetMetrics): number {
  const base = insetBottom + extra;

  if (
    platform === 'android' &&
    typeof androidMinimumBottomPadding === 'number'
  ) {
    return Math.max(base, androidMinimumBottomPadding);
  }

  return base;
}
