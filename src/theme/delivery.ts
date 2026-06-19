import type { ColorScheme } from './colors';

export const deliveryLightColors: ColorScheme = {
  brand: {
    primary: '#F97316',
    primaryLight: '#FB923C',
    primarySoft: '#FFF7ED',
    primaryDark: '#EA580C',
  },
  accent: {
    blue: '#0F766E',
    blueSoft: '#ECFEFF',
  },
  ai: {
    start: '#F97316',
    end: '#FB923C',
    glow: '#FDBA74',
    soft: '#FFF1E6',
  },
  gold: {
    primary: '#D97706',
    light: '#FEF3C7',
  },
  text: {
    primary: '#431407',
    secondary: '#9A3412',
    tertiary: '#C2410C',
    inverse: '#FFFFFF',
    onPrimary: '#FFFFFF',
  },
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  background: '#FFF7ED',
  bgPrimary: '#FFF7ED',
  bgSecondary: '#FFEDD5',
  border: '#FED7AA',
  divider: '#FFEDD5',
  muted: '#C2410C',
  success: '#15803D',
  warning: '#D97706',
  danger: '#DC2626',
  info: '#0F766E',
  skeleton: '#FFE7CC',
  overlay: 'rgba(67, 20, 7, 0.24)',
};

export const deliveryDarkColors: ColorScheme = {
  brand: {
    primary: '#FB923C',
    primaryLight: '#FDBA74',
    primarySoft: '#431407',
    primaryDark: '#F97316',
  },
  accent: {
    blue: '#5EEAD4',
    blueSoft: '#0F172A',
  },
  ai: {
    start: '#F97316',
    end: '#FDBA74',
    glow: '#FED7AA',
    soft: '#7C2D12',
  },
  gold: {
    primary: '#F59E0B',
    light: '#3B2A0F',
  },
  text: {
    primary: '#FFEDD5',
    secondary: '#FDBA74',
    tertiary: '#FB923C',
    inverse: '#1C1917',
    onPrimary: '#FFFFFF',
  },
  surface: '#2A140A',
  surfaceElevated: '#3B1D0F',
  background: '#1C0F08',
  bgPrimary: '#1C0F08',
  bgSecondary: '#2A140A',
  border: '#7C2D12',
  divider: '#3B1D0F',
  muted: '#FDBA74',
  success: '#4ADE80',
  warning: '#FBBF24',
  danger: '#F87171',
  info: '#5EEAD4',
  skeleton: '#3B1D0F',
  overlay: 'rgba(0, 0, 0, 0.45)',
};

export const deliveryGradients = {
  hero: ['#F97316', '#FB923C'] as const,
  highlight: ['#FFF7ED', '#FFEDD5'] as const,
  shimmer: ['transparent', '#FDBA7433', 'transparent'] as const,
};

export const deliveryTheme = {
  lightColors: deliveryLightColors,
  darkColors: deliveryDarkColors,
  gradients: deliveryGradients,
};
