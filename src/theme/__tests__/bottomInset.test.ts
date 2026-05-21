import { calculateBottomInset } from '../bottomInset';

function expectEqual(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function run() {
  expectEqual(
    calculateBottomInset({
      platform: 'android',
      insetBottom: 24,
      insetTop: 24,
      windowHeight: 2400,
      screenHeight: 2400,
      extra: 4,
    }),
    28,
    'trusts correctly reported Android gesture inset',
  );

  expectEqual(
    calculateBottomInset({
      platform: 'android',
      insetBottom: 0,
      insetTop: 24,
      windowHeight: 2320,
      screenHeight: 2400,
      extra: 4,
    }),
    4,
    'does not add nav fallback when Android already reserves bottom system bar outside the app window',
  );

  expectEqual(
    calculateBottomInset({
      platform: 'android',
      insetBottom: 0,
      insetTop: 24,
      windowHeight: 2376,
      screenHeight: 2400,
      extra: 16,
    }),
    80,
    'adds nav fallback when Android reports zero bottom inset but the app still reaches the screen bottom',
  );

  expectEqual(
    calculateBottomInset({
      platform: 'android',
      insetBottom: 0,
      insetTop: 0,
      windowHeight: 2376,
      screenHeight: 2400,
      extra: 4,
    }),
    68,
    'does not mistake a status-bar-sized window delta for a reserved bottom navigation bar',
  );

  expectEqual(
    calculateBottomInset({
      platform: 'ios',
      insetBottom: 34,
      insetTop: 47,
      windowHeight: 844,
      screenHeight: 844,
      extra: 12,
    }),
    46,
    'keeps iOS on native safe-area inset',
  );
}

run();
