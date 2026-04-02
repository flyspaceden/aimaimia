import React, { createContext, useContext, useMemo } from 'react';
import { colors } from './colors';
import { radius } from './radius';
import { shadow } from './shadow';
import { spacing } from './spacing';
import { typography } from './typography';

// 统一主题对象，便于组件层集中取用
export const theme = {
  colors,
  radius,
  shadow,
  spacing,
  typography,
};

type Theme = typeof theme;

const ThemeContext = createContext<Theme>(theme);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const value = useMemo(() => theme, []);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// 组件内读取主题的统一入口
export const useTheme = () => useContext(ThemeContext);
