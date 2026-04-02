import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { lightColors, darkColors, gradients, type ColorScheme } from './colors';
import { radius } from './radius';
import { shadow } from './shadow';
import { spacing } from './spacing';
import { typography } from './typography';
import { animation } from './animation';

// 主题对象类型
export type Theme = {
  colors: ColorScheme;
  gradients: typeof gradients;
  radius: typeof radius;
  shadow: typeof shadow;
  spacing: typeof spacing;
  typography: typeof typography;
  animation: typeof animation;
  isDark: boolean;
};

// 浅色主题
const lightTheme: Theme = {
  colors: lightColors,
  gradients,
  radius,
  shadow,
  spacing,
  typography,
  animation,
  isDark: false,
};

// 深色主题
const darkTheme: Theme = {
  colors: darkColors,
  gradients,
  radius,
  shadow,
  spacing,
  typography,
  animation,
  isDark: true,
};

// 向后兼容：导出静态 theme 对象供非 React 上下文使用
export const theme = lightTheme;

const ThemeContext = createContext<Theme>(lightTheme);

// 主题提供者：根据系统主题自动切换浅色/深色
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const colorScheme = useColorScheme();
  const value = useMemo(
    () => (colorScheme === 'dark' ? darkTheme : lightTheme),
    [colorScheme]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// 组件内读取主题的统一入口
export const useTheme = () => useContext(ThemeContext);
