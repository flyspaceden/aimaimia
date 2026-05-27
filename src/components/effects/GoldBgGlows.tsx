import React from 'react';
import { StyleSheet, View } from 'react-native';

// VIP 页背景金箔光斑：三个柔焦金色圆斑（右上 / 左中 / 右下），用纯色 + 高 opacity + 大 borderRadius 实现
// RN 没有 CSS filter:blur，柔焦效果靠 opacity 渐变和大半径让边缘看起来软；不需要 expo-blur
// pointerEvents none 不拦截交互
export function GoldBgGlows() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.glow, styles.topRight]} />
      <View style={[styles.glow, styles.midLeft]} />
      <View style={[styles.glow, styles.bottomRight]} />
    </View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    borderRadius: 9999,
  },
  topRight: {
    top: -120,
    right: -80,
    width: 280,
    height: 280,
    backgroundColor: '#FFD700',
    opacity: 0.18,
  },
  midLeft: {
    top: 360,
    left: -100,
    width: 240,
    height: 240,
    backgroundColor: '#FFE680',
    opacity: 0.15,
  },
  bottomRight: {
    bottom: -100,
    right: -60,
    width: 260,
    height: 260,
    backgroundColor: '#B8860B',
    opacity: 0.12,
  },
});
