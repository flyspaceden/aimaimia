import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

type QuantityStepperProps = {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  style?: StyleProp<ViewStyle>;
};

// 数量步进器：用于购物车数量增减（公共组件需中文注释）
export const QuantityStepper = ({ value, min = 1, max = 99, onChange, style }: QuantityStepperProps) => {
  const { colors, radius, typography } = useTheme();
  const canDecrease = value > min;
  const canIncrease = value < max;

  return (
    <View style={[styles.container, { borderRadius: radius.pill, borderColor: colors.border }, style]}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={!canDecrease}
        style={({ pressed }) => [
          styles.button,
          { opacity: canDecrease ? (pressed ? 0.7 : 1) : 0.4 },
        ]}
      >
        <MaterialCommunityIcons name="minus" size={18} color={colors.text.secondary} />
      </Pressable>
      <View style={styles.valueWrap}>
        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{value}</Text>
      </View>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        disabled={!canIncrease}
        style={({ pressed }) => [
          styles.button,
          { opacity: canIncrease ? (pressed ? 0.7 : 1) : 0.4 },
        ]}
      >
        <MaterialCommunityIcons name="plus" size={18} color={colors.text.secondary} />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  button: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueWrap: {
    minWidth: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
