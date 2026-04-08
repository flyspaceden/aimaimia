import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { CsQuickEntry } from '../../types';

interface CsQuickActionsProps {
  entries: CsQuickEntry[];
  onPress: (entry: CsQuickEntry) => void;
}

// 图标名称映射
const iconMap: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  truck: 'truck-outline',
  refresh: 'swap-horizontal',
  'map-pin': 'map-marker-outline',
  'dollar-sign': 'cash-refund',
};

// 客服快捷操作区：2x2 网格按钮
export function CsQuickActions({ entries, onPress }: CsQuickActionsProps) {
  const { colors, radius, spacing, typography } = useTheme();

  // 仅展示 QUICK_ACTION 类型
  const actions = entries.filter((e) => e.type === 'QUICK_ACTION').slice(0, 4);

  if (actions.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={[typography.caption, { color: colors.text.tertiary, marginBottom: spacing.sm }]}>
        快捷操作
      </Text>
      <View style={styles.grid}>
        {actions.map((entry) => (
          <Pressable
            key={entry.id}
            onPress={() => onPress(entry)}
            style={({ pressed }) => [
              styles.button,
              {
                borderColor: pressed ? colors.brand.primary : colors.border,
                borderRadius: radius.md,
                backgroundColor: pressed ? colors.brand.primarySoft : 'transparent',
              },
            ]}
          >
            <MaterialCommunityIcons
              name={iconMap[entry.icon ?? ''] ?? 'help-circle-outline'}
              size={20}
              color={colors.brand.primary}
              style={{ marginBottom: 4 }}
            />
            <Text
              style={[
                typography.caption,
                { color: colors.text.primary, textAlign: 'center' },
              ]}
            >
              {entry.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  button: {
    width: '47%',
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
