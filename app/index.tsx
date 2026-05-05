import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ────────────────────────────────────────────
// 种子粒子：散布在屏幕各处，象征 AI 数据流 + 种子萌发
// 使用屏幕比例（leftRatio/topRatio）配置，运行时乘以响应式 SW/SH
// ────────────────────────────────────────────
const SEED_RATIOS = [
  { leftRatio: 0.12, topRatio: 0.14, r: 3, delay: 0 },
  { leftRatio: 0.85, topRatio: 0.22, r: 2.5, delay: 300 },
  { leftRatio: 0.22, topRatio: 0.73, r: 3.5, delay: 150 },
  { leftRatio: 0.78, topRatio: 0.68, r: 2, delay: 450 },
  { leftRatio: 0.55, topRatio: 0.10, r: 2.5, delay: 200 },
  { leftRatio: 0.06, topRatio: 0.48, r: 2, delay: 350 },
  { leftRatio: 0.90, topRatio: 0.83, r: 3, delay: 100 },
  { leftRatio: 0.38, topRatio: 0.90, r: 2.5, delay: 250 },
];

function Seed({ left, top, r, delay }: { left: number; top: number; r: number; delay: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const fadeIn = Animated.timing(opacity, {
      toValue: 0.45,
      duration: 800,
      delay: delay + 500,
      useNativeDriver: true,
    });
    const float = Animated.loop(
      Animated.sequence([
        Animated.timing(ty, {
          toValue: -6,
          duration: 1800 + delay,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ty, {
          toValue: 6,
          duration: 1800 + delay,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    fadeIn.start(() => float.start());
    return () => {
      fadeIn.stop();
      float.stop();
    };
  }, [delay, opacity, ty]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left,
        top,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        backgroundColor: 'rgba(255,255,255,0.7)',
        opacity,
        transform: [{ translateY: ty }],
      }}
    />
  );
}

// ────────────────────────────────────────────
// 启动页主体
// ────────────────────────────────────────────
export default function Index() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // 响应式屏幕尺寸（分屏/旋转/字体放大时实时更新，禁止在模块顶层使用 Dimensions.get）
  const { width: SW, height: SH } = useWindowDimensions();
  // 种子粒子坐标随屏幕尺寸动态计算
  const seeds = useMemo(
    () =>
      SEED_RATIOS.map((s) => ({
        left: SW * s.leftRatio,
        top: SH * s.topRatio,
        r: s.r,
        delay: s.delay,
      })),
    [SW, SH],
  );

  // 动画值
  const glowOp = useRef(new Animated.Value(0)).current;
  const glowSc = useRef(new Animated.Value(0.6)).current;
  const brandOp = useRef(new Animated.Value(0)).current;
  const brandSc = useRef(new Animated.Value(0.85)).current;
  const lineX = useRef(new Animated.Value(0)).current;
  const subOp = useRef(new Animated.Value(0)).current;
  const subTy = useRef(new Animated.Value(14)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 持续脉冲环
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    // 入场动画序列
    Animated.sequence([
      // 1. 中心光晕浮现
      Animated.parallel([
        Animated.timing(glowOp, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.spring(glowSc, {
          toValue: 1,
          friction: 8,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(120),
      // 2. 品牌名弹入
      Animated.parallel([
        Animated.timing(brandOp, {
          toValue: 1,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(brandSc, {
          toValue: 1,
          friction: 5,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(100),
      // 3. 金色线条延展
      Animated.timing(lineX, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(100),
      // 4. 副标题上移淡入
      Animated.parallel([
        Animated.timing(subOp, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(subTy, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // 自动跳转首页
    const timer = setTimeout(() => router.replace('/(tabs)/home'), 2400);
    return () => {
      loop.stop();
      clearTimeout(timer);
    };
  }, [brandOp, brandSc, glowOp, glowSc, lineX, pulse, router, subOp, subTy]);

  // 脉冲环插值
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1.4],
  });
  const pulseOp = pulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.22, 0.06, 0.22],
  });

  return (
    <LinearGradient
      colors={['#1B5E20', '#256B2E', '#1A6B5A', '#00897B']}
      locations={[0, 0.3, 0.65, 1]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.root}
    >
      <StatusBar style="light" />

      {/* ── 装饰层 ── */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* 种子粒子 */}
        {seeds.map((s, i) => (
          <Seed key={i} {...s} />
        ))}

        {/* 大背景光斑 — 右上方（top 依赖响应式 SH，内联 style 注入） */}
        <View style={[styles.bgOrbTopRight, { top: SH * 0.08 }]} />

        {/* 大背景光斑 — 左下方（bottom 依赖响应式 SH，内联 style 注入） */}
        <View style={[styles.bgOrbBottomLeft, { bottom: SH * 0.05 }]} />

        {/* 脉冲环（top/left 依赖响应式 SW/SH，内联 style 注入） */}
        <Animated.View
          style={[
            styles.ring,
            {
              top: (SH - RING_SIZE) / 2,
              left: (SW - RING_SIZE) / 2,
              opacity: pulseOp,
              transform: [{ scale: pulseScale }],
            },
          ]}
        />

        {/* 中心 AI 光晕（top/left 依赖响应式 SW/SH，内联 style 注入） */}
        <Animated.View
          style={[
            styles.glow,
            {
              top: (SH - GLOW_SIZE) / 2,
              left: (SW - GLOW_SIZE) / 2,
              opacity: glowOp,
              transform: [{ scale: glowSc }],
            },
          ]}
        />
      </View>

      {/* ── 主内容 ── */}
      <View style={styles.content}>
        <Animated.Text
          style={[
            styles.brand,
            {
              opacity: brandOp,
              transform: [{ scale: brandSc }],
            },
          ]}
        >
          爱买买
        </Animated.Text>

        <Animated.View style={[styles.lineWrap, { transform: [{ scaleX: lineX }] }]}>
          <LinearGradient
            colors={['transparent', '#D4A017', '#F5C842', '#D4A017', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.goldLine}
          />
        </Animated.View>

        <Animated.Text
          style={[
            styles.subtitle,
            {
              opacity: subOp,
              transform: [{ translateY: subTy }],
            },
          ]}
        >
          AI赋能农业 · 夯实健康之路
        </Animated.Text>
      </View>

      {/* ── 跳过按钮 ── */}
      <Pressable
        style={[styles.skip, { top: insets.top + 12 }]}
        onPress={() => router.replace('/(tabs)/home')}
        hitSlop={12}
      >
        <View style={styles.skipPill}>
          <Text style={styles.skipText}>跳过</Text>
        </View>
      </Pressable>
    </LinearGradient>
  );
}

// ────────────────────────────────────────────
const GLOW_SIZE = 260;
const RING_SIZE = 300;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  // ── 主内容居中 ──
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    fontSize: 48,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 6,
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  lineWrap: {
    width: 140,
    marginTop: 18,
    alignItems: 'center',
  },
  goldLine: {
    width: '100%',
    height: 2.5,
    borderRadius: 999,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.78)',
    letterSpacing: 2.5,
    marginTop: 20,
  },

  // ── 装饰元素 ──
  // 注意：依赖响应式 SW/SH 的 top/left/bottom 通过内联 style 注入，不能放在 StyleSheet 中
  glow: {
    position: 'absolute',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
    backgroundColor: 'rgba(0,191,165,0.10)',
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  bgOrbTopRight: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(0,230,204,0.06)',
    right: -40,
  },
  bgOrbBottomLeft: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(76,175,80,0.06)',
    left: -60,
  },

  // ── 跳过按钮 ──
  skip: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
  },
  skipPill: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  skipText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '500',
  },
});
