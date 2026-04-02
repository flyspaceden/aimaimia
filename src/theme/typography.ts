import { Platform } from 'react-native';

// 字体族定义（iOS/Android 分别指定）
const fontFamily = Platform.select({
  ios: 'PingFang SC',
  android: 'Noto Sans SC',
  default: 'System',
});

// 等宽字体族（金额、编号等等宽场景）
export const monoFamily = Platform.select({
  ios: 'SF Mono',
  android: 'Roboto Mono',
  default: 'monospace',
});

// 字体排版规范
export const typography = {
  // --- Display / Heading 层级 ---
  displayLg: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700' as const,
    fontFamily,
  },
  displaySm: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700' as const,
    fontFamily,
  },
  headingLg: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '600' as const,
    fontFamily,
  },
  headingMd: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600' as const,
    fontFamily,
  },
  headingSm: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600' as const,
    fontFamily,
  },
  bodyLg: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
    fontFamily,
  },
  bodyMd: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400' as const,
    fontFamily,
  },
  bodySm: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
    fontFamily,
  },
  captionSm: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500' as const,
    fontFamily,
  },
  // --- 保留旧 Token（其他页面在用） ---
  title1: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700' as const,
    fontFamily,
  },
  title2: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700' as const,
    fontFamily,
  },
  title3: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600' as const,
    fontFamily,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
    fontFamily,
  },
  bodyStrong: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600' as const,
    fontFamily,
  },
  caption: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400' as const,
    fontFamily,
  },
};
