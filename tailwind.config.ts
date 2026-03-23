import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#2E7D32',
          light: '#4CAF50',
          dark: '#1B5E20',
          soft: '#E8F5E9',
        },
        ai: {
          start: '#00897B',
          end: '#00BFA5',
          glow: '#00E5CC',
          soft: '#E0F7F4',
        },
        gold: {
          DEFAULT: '#D4A017',
          light: '#F5C842',
        },
        dark: {
          bg: '#060E06',
          surface: '#0D1A0D',
          elevated: '#1A2A1A',
        },
        light: {
          bg: '#FAFCFA',
          surface: '#F0F4F0',
          soft: '#E8F5E9',
        },
        text: {
          primary: '#1A2E1A',
          secondary: '#5A6B5A',
          tertiary: '#8A9B8A',
          'on-dark': '#FFFFFF',
          'on-dark-secondary': '#B0C4B0',
          'on-dark-tertiary': '#8A9B8A',
        },
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"Noto Sans SC"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"SF Mono"', '"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        'display': ['64px', { lineHeight: '1.1', fontWeight: '700' }],
        'display-mobile': ['36px', { lineHeight: '1.2', fontWeight: '700' }],
        'h1': ['48px', { lineHeight: '1.15', fontWeight: '700' }],
        'h1-mobile': ['28px', { lineHeight: '1.2', fontWeight: '700' }],
        'h2': ['36px', { lineHeight: '1.2', fontWeight: '600' }],
        'h2-mobile': ['24px', { lineHeight: '1.3', fontWeight: '600' }],
        'h3': ['24px', { lineHeight: '1.3', fontWeight: '600' }],
        'h3-mobile': ['20px', { lineHeight: '1.4', fontWeight: '600' }],
      },
      borderRadius: {
        'card': '16px',
        'card-lg': '24px',
        'pill': '999px',
      },
      boxShadow: {
        'card': '0 4px 20px rgba(10,43,22,0.08)',
        'card-hover': '0 8px 40px rgba(10,43,22,0.12)',
        'ai-glow': '0 0 60px rgba(0,191,165,0.25)',
        'ai-glow-lg': '0 0 120px rgba(0,191,165,0.15)',
      },
      maxWidth: {
        'page': '1200px',
      },
    },
  },
  plugins: [],
} satisfies Config
