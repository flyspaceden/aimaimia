import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { CsQuickEntry } from '../../types';

interface CsHotQuestionsProps {
  entries: CsQuickEntry[];
  onPress: (entry: CsQuickEntry) => void;
}

// 热门问题列表：垂直排列的可点击文本项
export function CsHotQuestions({ entries, onPress }: CsHotQuestionsProps) {
  const { colors, spacing, typography } = useTheme();

  // 仅展示 HOT_QUESTION 类型
  const questions = entries.filter((e) => e.type === 'HOT_QUESTION');

  if (questions.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={[typography.caption, { color: colors.text.tertiary, marginBottom: spacing.sm }]}>
        热门问题
      </Text>
      {questions.map((entry, index) => (
        <Pressable
          key={entry.id}
          onPress={() => onPress(entry)}
          style={({ pressed }) => [
            styles.item,
            {
              borderBottomColor: colors.border,
              borderBottomWidth: index < questions.length - 1 ? StyleSheet.hairlineWidth : 0,
              backgroundColor: pressed ? colors.bgSecondary : 'transparent',
            },
          ]}
        >
          <MaterialCommunityIcons
            name="chat-question-outline"
            size={16}
            color={colors.brand.primary}
            style={{ marginRight: 8 }}
          />
          <Text
            style={[
              typography.body,
              { color: colors.brand.primary, flex: 1 },
            ]}
            numberOfLines={1}
          >
            {entry.label}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={16}
            color={colors.text.tertiary}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
});
