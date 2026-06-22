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
    16,
    'does not infer an Android nav fallback when the window delta is only the top status bar',
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
    4,
    'does not add an Android nav fallback from ambiguous zero-inset metrics',
  );

  expectEqual(
    calculateBottomInset({
      platform: 'android',
      insetBottom: 0,
      extra: 16,
      androidMinimumBottomPadding: 64,
    }),
    64,
    'allows a page-level Android minimum bottom padding for isolated bottom CTA escape hatches',
  );

  expectEqual(
    calculateBottomInset({
      platform: 'android',
      insetBottom: 8,
      extra: 16,
      androidMinimumBottomPadding: 64,
    }),
    64,
    'applies the page-level Android minimum when OEM reports a small non-zero bottom inset',
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

it('calculates stable bottom inset across safe-area cases', () => {
  run();
});
