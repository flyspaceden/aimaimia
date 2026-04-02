import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../src/components/layout';
import { useTheme } from '../src/theme';

export default function Index() {
  const router = useRouter();
  const { colors, typography } = useTheme();
  const brandOpacity = useRef(new Animated.Value(0)).current;
  const brandScale = useRef(new Animated.Value(0.84)).current;
  const brandTranslate = useRef(new Animated.Value(10)).current;
  const lineScale = useRef(new Animated.Value(0)).current;
  const dotOpacity = useRef(new Animated.Value(0)).current;
  const dotScale = useRef(new Animated.Value(0)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const subtitleTranslate = useRef(new Animated.Value(12)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ])
    );

    const brandAnim = Animated.parallel([
      Animated.timing(brandOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(brandScale, {
        toValue: 1,
        friction: 5,
        useNativeDriver: true,
      }),
      Animated.timing(brandTranslate, {
        toValue: 0,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    const lineAnim = Animated.parallel([
      Animated.timing(lineScale, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(dotOpacity, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.spring(dotScale, {
          toValue: 1,
          friction: 5,
          useNativeDriver: true,
        }),
      ]),
    ]);

    const subtitleAnim = Animated.parallel([
      Animated.timing(subtitleOpacity, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(subtitleTranslate, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    pulseLoop.start();
    Animated.sequence([brandAnim, Animated.delay(120), lineAnim, Animated.delay(120), subtitleAnim]).start();

    const timer = setTimeout(() => {
      router.replace('/(tabs)/home');
    }, 1600);

    return () => {
      pulseLoop.stop();
      clearTimeout(timer);
    };
  }, [
    brandOpacity,
    brandScale,
    brandTranslate,
    dotOpacity,
    dotScale,
    lineScale,
    pulse,
    router,
    subtitleOpacity,
    subtitleTranslate,
  ]);

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.75, 1.25],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 0],
  });

  return (
    <Screen style={{ backgroundColor: colors.brand.primaryDark }} contentStyle={styles.container} statusBarStyle="light">
      <View style={styles.atmosphere} pointerEvents="none">
        <Animated.View
          style={[
            styles.pulseRing,
            { borderColor: colors.accent.blue, opacity: pulseOpacity, transform: [{ scale: pulseScale }] },
          ]}
        />
        <View style={[styles.glowOrb, { backgroundColor: colors.accent.blueSoft }]} />
        <View style={[styles.glowOrbSecondary, { backgroundColor: colors.brand.primarySoft }]} />
      </View>
      <Pressable style={styles.skip} onPress={() => router.replace('/(tabs)/home')}>
        <Text style={[typography.caption, { color: colors.text.inverse }]}>跳过</Text>
      </Pressable>
      <Animated.Text
        style={[
          styles.brand,
          {
            color: colors.text.inverse,
            opacity: brandOpacity,
            transform: [{ scale: brandScale }, { translateY: brandTranslate }],
          },
        ]}
      >
        爱买买
      </Animated.Text>
      <Animated.View style={[styles.underlineWrap, { transform: [{ scaleX: lineScale }] }]}>
        <View style={[styles.underline, { backgroundColor: colors.accent.blue }]} />
      </Animated.View>
      <Animated.View
        style={[
          styles.seedDot,
          {
            backgroundColor: colors.accent.blueSoft,
            opacity: dotOpacity,
            transform: [{ scale: dotScale }],
          },
        ]}
      />
      <Animated.View style={{ opacity: subtitleOpacity, transform: [{ translateY: subtitleTranslate }] }}>
        <Text style={[typography.body, styles.subtitle, { color: colors.text.inverse }]}>
          AI赋能农业，夯实健康之路
        </Text>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 8,
  },
  underlineWrap: {
    width: 160,
    alignItems: 'center',
    marginTop: 12,
  },
  underline: {
    height: 3,
    width: '100%',
    borderRadius: 999,
  },
  seedDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 10,
  },
  subtitle: {
    marginTop: 12,
    letterSpacing: 1,
  },
  skip: {
    position: 'absolute',
    top: 12,
    right: 16,
  },
  atmosphere: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1.5,
  },
  glowOrb: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 999,
    opacity: 0.18,
    top: '22%',
    right: '12%',
  },
  glowOrbSecondary: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 999,
    opacity: 0.16,
    bottom: '18%',
    left: '10%',
  },
});
