import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';

type ToastType = 'info' | 'success' | 'error' | 'warning';

type ToastOptions = {
  message: string;
  type?: ToastType;
  duration?: number;
};

type ToastState = ToastOptions & { id: number };

type ToastContextValue = {
  show: (options: ToastOptions) => void;
  hide: () => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// 命令式 toast（供 Zustand Store 等非 React 环境调用）
let _imperativeShow: ((options: ToastOptions) => void) | null = null;
export const showToast = (options: ToastOptions) => _imperativeShow?.(options);

// 全局 Toast：统一轻提示入口
export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    setToast(null);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const show = useCallback((options: ToastOptions) => {
    const nextToast: ToastState = {
      id: Date.now(),
      type: 'info',
      duration: 2200,
      ...options,
    };

    setToast(nextToast);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setToast(null);
    }, nextToast.duration);
  }, []);

  // 注册命令式入口，供 Zustand Store 调用
  useEffect(() => {
    _imperativeShow = show;
    return () => { _imperativeShow = null; };
  }, [show]);

  return (
    <ToastContext.Provider value={{ show, hide }}>
      {children}
      <ToastViewport toast={toast} />
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast 必须在 ToastProvider 内部使用');
  }
  return context;
};

type ToastViewportProps = {
  toast: ToastState | null;
};

const ToastViewport = ({ toast }: ToastViewportProps) => {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    if (!toast) {
      return;
    }

    opacity.setValue(0);
    translateY.setValue(16);

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [toast, opacity, translateY]);

  if (!toast) {
    return null;
  }

  const toneMap: Record<ToastType, string> = {
    info: colors.brand.primary,
    success: colors.success,
    error: colors.danger,
    warning: colors.warning,
  };

  return (
    <View pointerEvents="none" style={[styles.container, { bottom: insets.bottom + spacing.lg }]}>
      <Animated.View
        style={[
          styles.toast,
          shadow.sm,
          {
            opacity,
            transform: [{ translateY }],
            borderRadius: radius.lg,
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: toneMap[toast.type ?? 'info'] }]} />
        <Text style={[typography.body, { color: colors.text.primary }]}>{toast.message}</Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginRight: 8,
  },
});
