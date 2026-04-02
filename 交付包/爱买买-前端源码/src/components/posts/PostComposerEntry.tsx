import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

type PostComposerEntryProps = {
  onCreate?: () => void;
  onTemplate?: () => void;
  onAiAssist?: () => void;
};

// 发布入口：模板/AI 辅助入口占位（公共组件需中文注释）
export const PostComposerEntry = ({ onCreate, onTemplate, onAiAssist }: PostComposerEntryProps) => {
  const { colors, radius, shadow, spacing, typography } = useTheme();

  return (
    <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
      <View style={styles.headerRow}>
        <View>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>想分享今天的农场动态？</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
            支持模板发布与 AI 文案助手
          </Text>
        </View>
        <Pressable
          onPress={onCreate}
          style={[styles.primaryButton, { backgroundColor: colors.brand.primary }]}
        >
          <Text style={[typography.caption, { color: colors.text.inverse }]}>去发布</Text>
        </Pressable>
      </View>
      <View style={styles.actionRow}>
        <Pressable onPress={onTemplate} style={[styles.actionChip, { borderColor: colors.border }]}>
          <MaterialCommunityIcons name="file-document-outline" size={16} color={colors.text.secondary} />
          <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: spacing.xs }]}>
            模板发布
          </Text>
        </Pressable>
        <Pressable onPress={onAiAssist} style={[styles.actionChip, { borderColor: colors.border }]}>
          <MaterialCommunityIcons name="auto-fix" size={16} color={colors.accent.blue} />
          <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: spacing.xs }]}>
            AI 文案助手
          </Text>
        </Pressable>
        <View style={[styles.tagChip, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.pill }]}>
          <Text style={[typography.caption, { color: colors.brand.primary }]}>#育苗期#</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  primaryButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    flexWrap: 'wrap',
  },
  actionChip: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    marginBottom: 8,
  },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
});
