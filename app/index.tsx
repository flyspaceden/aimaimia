import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SW, height: SH } = Dimensions.get('window');

// ────────────────────────────────────────────
// 种子粒子：散布在屏幕各处，象征 AI 数据流 + 种子萌发
// ────────────────────────────────────────────
const SEEDS = [
  { left: SW * 0.12, top: SH * 0.14, r: 3, delay: 0 },
  { left: SW * 0.85, top: SH * 0.22, r: 2.5, delay: 300 },
  { left: SW * 0.22, top: SH * 0.73, r: 3.5, delay: 150 },
  { left: SW * 0.78, top: SH * 0.68, r: 2, delay: 450 },
  { left: SW * 0.55, top: SH * 0.10, r: 2.5, delay: 200 },
  { left: SW * 0.06, top: SH * 0.48, r: 2, delay: 350 },
  { left: SW * 0.90, top: SH * 0.83, r: 3, delay: 100 },
  { left: SW * 0.38, top: SH * 0.90, r: 2.5, delay: 250 },
];

function Seed({ left, top, r, delay }: (typeof SEEDS)[number]) {
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
        {SEEDS.map((s, i) => (
          <Seed key={i} {...s} />
        ))}

        {/* 大背景光斑 — 右上方 */}
        <View style={styles.bgOrbTopRight} />

        {/* 大背景光斑 — 左下方 */}
        <View style={styles.bgOrbBottomLeft} />

        {/* 脉冲环 */}
        <Animated.View
          style={[
            styles.ring,
            { opacity: pulseOp, transform: [{ scale: pulseScale }] },
          ]}
        />

        {/* 中心 AI 光晕 */}
        <Animated.View
          style={[
            styles.glow,
            { opacity: glowOp, transform: [{ scale: glowSc }] },
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
          农 脉
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
    letterSpacing: 14,
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
  glow: {
    position: 'absolute',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
    backgroundColor: 'rgba(0,191,165,0.10)',
    top: (SH - GLOW_SIZE) / 2,
    left: (SW - GLOW_SIZE) / 2,
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
    top: (SH - RING_SIZE) / 2,
    left: (SW - RING_SIZE) / 2,
  },
  bgOrbTopRight: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(0,230,204,0.06)',
    top: SH * 0.08,
    right: -40,
  },
  bgOrbBottomLeft: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(76,175,80,0.06)',
    bottom: SH * 0.05,
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
