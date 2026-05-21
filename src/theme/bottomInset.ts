export type BottomInsetPlatform = 'android' | 'ios' | 'web' | 'windows' | 'macos';

export interface BottomInsetMetrics {
  platform: BottomInsetPlatform | string;
  insetBottom: number;
  insetTop?: number;
  windowHeight?: number;
  screenHeight?: number;
  extra?: number;
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
  insetBottom,
  extra = 12,
}: BottomInsetMetrics): number {
  return insetBottom + extra;
}
