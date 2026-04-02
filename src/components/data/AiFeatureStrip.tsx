import React, { useEffect, useMemo } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

type AiFeature = {
  id: string;
  title: string;
  description: string;
  icon: string;
  tone?: 'green' | 'blue' | 'neutral';
};

type AiFeatureStripProps = {
  items: AiFeature[];
  onPress?: (item: AiFeature) => void;
};

// AI 功能入口：为后续 AI 相关能力预留入口
export const AiFeatureStrip = ({ items, onPress }: AiFeatureStripProps) => {
  const { colors, radius, spacing, typography, shadow } = useTheme();

  const toneStyles = {
    green: {
      bg: colors.brand.primarySoft,
      glow: colors.brand.primarySoft,
      icon: colors.brand.primary,
      title: colors.brand.primary,
    },
    blue: {
      bg: colors.accent.blueSoft,
      glow: colors.accent.blueSoft,
      icon: colors.accent.blue,
      title: colors.accent.blue,
    },
    neutral: {
      bg: colors.surface,
      glow: colors.background,
      icon: colors.text.secondary,
      title: colors.text.primary,
    },
  };

  const animatedValues = useMemo(
    () =>
      items.map(() => ({
        opacity: new Animated.Value(0),
        translateY: new Animated.Value(10),
        scale: new Animated.Value(0.96),
      })),
    [items.length]
  );

  useEffect(() => {
    const animations = animatedValues.map((value) =>
      Animated.parallel([
        Animated.timing(value.opacity, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
        }),
        Animated.timing(value.translateY, {
          toValue: 0,
          duration: 260,
          useNativeDriver: true,
        }),
        Animated.spring(value.scale, {
          toValue: 1,
          friction: 6,
          useNativeDriver: true,
        }),
      ])
    );

    Animated.stagger(90, animations).start();
  }, [animatedValues]);

  return (
    <View style={styles.row}>
      {items.map((item, index) => {
        const tone = toneStyles[item.tone ?? 'neutral'];
        const motion = animatedValues[index];

        return (
          <Animated.View
            key={item.id}
            style={[
              styles.cardWrap,
              {
                marginRight: index === items.length - 1 ? 0 : 12,
                opacity: motion.opacity,
                transform: [{ translateY: motion.translateY }, { scale: motion.scale }],
              },
            ]}
          >
            <Pressable
              onPress={() => onPress?.(item)}
              style={({ pressed }) => [
                styles.card,
                shadow.sm,
                {
                  backgroundColor: tone.bg,
                  borderRadius: radius.lg,
                  padding: spacing.md,
                  borderColor: colors.border,
                  opacity: pressed ? 0.94 : 1,
                },
              ]}
            >
              <View style={[styles.glow, { backgroundColor: tone.glow }]} />
              <View style={[styles.accent, { backgroundColor: tone.icon }]} />
              <View style={[styles.iconWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <MaterialCommunityIcons name={item.icon as any} size={18} color={tone.icon} />
              </View>
              <Text style={[typography.bodyStrong, { color: tone.title, marginTop: spacing.sm }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text
                style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}
                numberOfLines={2}
              >
                {item.description}
              </Text>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  cardWrap: {
    flex: 1,
  },
  card: {
    flex: 1,
    borderWidth: 1,
    overflow: 'hidden',
    minHeight: 120,
  },
  glow: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 80,
    height: 80,
    borderRadius: 40,
    opacity: 0.35,
  },
  accent: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 22,
    height: 4,
    borderRadius: 999,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
