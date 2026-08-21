export const colors = {
  brand: {
    primary: '#2E7D32',
    light: '#4CAF50',
    soft: '#E8F5E9',
    dark: '#1B5E20',
  },
  ai: {
    start: '#00897B',
    end: '#00BFA5',
    glow: '#00E5CC',
    soft: '#E0F7F4',
  },
  accent: { blue: '#2B6CB0', blueSoft: '#E6F0FA' },
  gold: { primary: '#D4A017', light: '#F5E6B8' },
  text: { primary: '#1A2E1A', secondary: '#5A6B5A', tertiary: '#8A9B8A', inverse: '#FFFFFF' },
  background: '#FAFCFA',
  surface: '#FFFFFF',
  border: '#E2EAE2',
  divider: '#F0F4F0',
  danger: '#D32F2F',
  warning: '#E6A817',
  success: '#2E7D32',
} as const;

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, full: 9999 } as const;
export const typography = {
  display: { size: 32, lineHeight: 40, weight: 700 },
  heading: { size: 20, lineHeight: 28, weight: 600 },
  body: { size: 15, lineHeight: 22, weight: 400 },
  caption: { size: 12, lineHeight: 18, weight: 400 },
} as const;
