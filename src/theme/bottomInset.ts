export type BottomInsetPlatform = 'android' | 'ios' | 'web' | 'windows' | 'macos';

export interface BottomInsetMetrics {
  platform: BottomInsetPlatform | string;
  insetBottom: number;
  insetTop?: number;
  windowHeight?: number;
  screenHeight?: number;
  extra?: number;
  androidFallback?: number;
}

export const ANDROID_NAV_FALLBACK = 64;
const LOW_BOTTOM_INSET_THRESHOLD = 16;
const RESERVED_BOTTOM_THRESHOLD = 32;

/**
 * Computes the visual bottom padding for fixed bottom bars.
 *
 * Android has two valid zero-inset cases:
 * 1. The app is edge-to-edge and the OEM incorrectly reports bottom inset as 0:
 *    add a fallback so the fixed bar clears virtual navigation.
 * 2. The system already reserved the navigation bar outside the app window:
 *    do not add fallback, or a visible blank strip appears below the bar.
 */
export function calculateBottomInset({
  platform,
  insetBottom,
  insetTop = 0,
  windowHeight,
  screenHeight,
  extra = 12,
  androidFallback = ANDROID_NAV_FALLBACK,
}: BottomInsetMetrics): number {
  if (platform !== 'android') {
    return insetBottom + extra;
  }

  if (insetBottom > LOW_BOTTOM_INSET_THRESHOLD) {
    return insetBottom + extra;
  }

  if (typeof windowHeight === 'number' && typeof screenHeight === 'number') {
    const reservedOutsideWindow = Math.max(0, screenHeight - windowHeight);
    const reservedBottomOutsideWindow = Math.max(0, reservedOutsideWindow - insetTop);

    if (reservedBottomOutsideWindow > RESERVED_BOTTOM_THRESHOLD) {
      return insetBottom + extra;
    }
  }

  return androidFallback + extra;
}
