// 颜色体系：自然绿主导 + 科技蓝点缀 + AI 青色渐变
// 支持浅色/深色双模式，按 frontend.md Section 2.1 规格定义

// 浅色模式调色板
export const lightColors = {
  brand: {
    primary: '#2E7D32',
    primaryLight: '#4CAF50',
    primarySoft: '#E8F5E9',
    primaryDark: '#1B5E20',
  },
  accent: {
    blue: '#2B6CB0',
    blueSoft: '#E6F0FA',
  },
  ai: {
    start: '#00897B',
    end: '#00BFA5',
    glow: '#00E5CC',
    soft: '#E0F7F4',
  },
  gold: {
    primary: '#D4A017',
    light: '#F5E6B8',
  },
  text: {
    primary: '#1A2E1A',
    secondary: '#5A6B5A',
    tertiary: '#8A9B8A',
    inverse: '#FFFFFF',
    onPrimary: '#FFFFFF',
  },
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  background: '#FAFCFA',
  bgPrimary: '#FAFCFA',
  bgSecondary: '#F0F4F0',
  border: '#E2EAE2',
  divider: '#F0F4F0',
  muted: '#8A9B8A',
  success: '#2E7D32',
  warning: '#E6A817',
  danger: '#D32F2F',
  info: '#0277BD',
  skeleton: '#E7EEE9',
  overlay: 'rgba(16, 32, 22, 0.35)',
};

// 深色模式调色板
export const darkColors: ColorScheme = {
  brand: {
    primary: '#4CAF50',
    primaryLight: '#66BB6A',
    primarySoft: '#1A2E1A',
    primaryDark: '#81C784',
  },
  accent: {
    blue: '#4FC3F7',
    blueSoft: '#0D1A2E',
  },
  ai: {
    start: '#00BFA5',
    end: '#00E5CC',
    glow: '#00FFD0',
    soft: '#0D2622',
  },
  gold: {
    primary: '#FFD54F',
    light: '#2E2510',
  },
  text: {
    primary: '#E8F0E8',
    secondary: '#A0B8A0',
    tertiary: '#6A826A',
    inverse: '#0A120A',
    onPrimary: '#FFFFFF',
  },
  surface: '#141E14',
  surfaceElevated: '#1A2A1A',
  background: '#060E06',
  bgPrimary: '#060E06',
  bgSecondary: '#0D1A0D',
  border: '#2A3A2A',
  divider: '#1E2E1E',
  muted: '#6A826A',
  success: '#4CAF50',
  warning: '#FFB74D',
  danger: '#EF5350',
  info: '#4FC3F7',
  skeleton: '#1A2A1A',
  overlay: 'rgba(0, 0, 0, 0.5)',
};

// AI 渐变组合
export const gradients = {
  aiGradient: ['#2E7D32', '#00897B', '#00BFA5'] as const,
  aiOrbGradient: ['#00BFA5', '#00E5CC', '#00FFD0'] as const,
  aiShimmer: ['transparent', '#00E5CC20', 'transparent'] as const,
  goldGradient: ['#D4A017', '#F5C842'] as const,
  surfaceGradient: {
    light: ['#FAFCFA', '#F0F4F0'] as const,
    dark: ['#0A120A', '#141E14'] as const,
  },
};

// 类型导出
export type ColorScheme = typeof lightColors;

// 向后兼容：默认导出浅色方案，旧代码 import { colors } 不报错
export const colors = lightColors;
