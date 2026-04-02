import React, { useEffect, useRef, useState } from 'react';
import { Text, TextStyle } from 'react-native';
import { useTheme } from '../../theme';

interface AiTypingEffectProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
  style?: TextStyle;
}

// AI 打字机文字动画：逐字显示 + 末尾闪烁光标
// 纯 Text 嵌套实现，不使用 View 容器，避免 React Native 移动端布局问题
export function AiTypingEffect({ text, speed = 50, onComplete, style }: AiTypingEffectProps) {
  const { colors, typography } = useTheme();
  const [displayCount, setDisplayCount] = useState(0);
  const [showCursor, setShowCursor] = useState(true);
  const completeCalled = useRef(false);

  // 逐字推进
  useEffect(() => {
    if (displayCount >= text.length) {
      if (!completeCalled.current) {
        completeCalled.current = true;
        onComplete?.();
      }
      return;
    }
    const timer = setTimeout(() => {
      setDisplayCount((prev) => prev + 1);
    }, speed);
    return () => clearTimeout(timer);
  }, [displayCount, text.length, speed, onComplete]);

  // 光标闪烁（纯 state 驱动，不用 Reanimated）
  const isComplete = displayCount >= text.length;
  useEffect(() => {
    if (isComplete) return;
    const timer = setInterval(() => setShowCursor((v) => !v), 500);
    return () => clearInterval(timer);
  }, [isComplete]);

  return (
    <Text style={[typography.body, { color: colors.text.primary }, style]}>
      {text.slice(0, displayCount)}
      {!isComplete && showCursor ? (
        <Text style={{ color: colors.ai.start, fontWeight: '300' }}>{'▏'}</Text>
      ) : null}
    </Text>
  );
}
