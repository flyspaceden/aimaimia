import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { CsRepo } from '../../repos';
import { useToast } from '../feedback';

interface CsRatingSheetProps {
  visible: boolean;
  sessionId: string;
  onClose: () => void;
}

// 预设评价标签
const PRESET_TAGS = ['回复快速', '解决了问题', '态度友好', '专业解答'];

// 客服评价弹窗：星级评分 + 标签选择 + 文字输入
export function CsRatingSheet({ visible, sessionId, onClose }: CsRatingSheetProps) {
  const { colors, radius, spacing, typography, shadow } = useTheme();
  const { show } = useToast();

  const [score, setScore] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 切换标签选中状态
  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  // 提交评价
  const handleSubmit = async () => {
    if (score === 0) {
      show({ message: '请选择评分', type: 'warning' });
      return;
    }
    setSubmitting(true);
    const result = await CsRepo.submitRating(sessionId, {
      score,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      comment: comment.trim() || undefined,
    });
    setSubmitting(false);

    if (result.ok) {
      show({ message: '感谢您的评价！', type: 'success' });
      onClose();
    } else {
      show({ message: result.error.displayMessage ?? '提交失败，请重试', type: 'error' });
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            shadow.lg,
            {
              backgroundColor: colors.bgPrimary,
              borderRadius: radius.xl,
            },
          ]}
        >
          {/* 成功图标 + 标题 */}
          <View style={styles.header}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: '#E8F5E9' },
              ]}
            >
              <MaterialCommunityIcons name="check-circle" size={36} color="#2E7D32" />
            </View>
            <Text
              style={[
                typography.headingMd,
                { color: colors.text.primary, marginTop: spacing.md },
              ]}
            >
              服务已结束
            </Text>
            <Text
              style={[
                typography.body,
                { color: colors.text.secondary, marginTop: spacing.xs },
              ]}
            >
              请对本次服务进行评价
            </Text>
          </View>

          {/* 星级评分 */}
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Pressable key={star} onPress={() => setScore(star)} hitSlop={8}>
                <MaterialCommunityIcons
                  name={star <= score ? 'star' : 'star-outline'}
                  size={36}
                  color={star <= score ? '#FFC107' : colors.text.tertiary}
                />
              </Pressable>
            ))}
          </View>

          {/* 标签选择 */}
          <View style={styles.tagsRow}>
            {PRESET_TAGS.map((tag) => {
              const selected = selectedTags.includes(tag);
              return (
                <Pressable
                  key={tag}
                  onPress={() => toggleTag(tag)}
                  style={[
                    styles.tagChip,
                    {
                      borderRadius: radius.pill,
                      borderColor: selected ? colors.brand.primary : colors.border,
                      backgroundColor: selected ? colors.brand.primarySoft : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      typography.caption,
                      {
                        color: selected ? colors.brand.primary : colors.text.secondary,
                      },
                    ]}
                  >
                    {tag}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* 文字输入 */}
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="其他建议（选填）"
            placeholderTextColor={colors.text.tertiary}
            multiline
            numberOfLines={3}
            style={[
              styles.textInput,
              typography.body,
              {
                color: colors.text.primary,
                backgroundColor: colors.bgSecondary,
                borderRadius: radius.md,
                borderColor: colors.border,
              },
            ]}
          />

          {/* 操作按钮 */}
          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              style={[
                styles.actionButton,
                {
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[typography.body, { color: colors.text.secondary }]}>
                跳过
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              style={[
                styles.actionButton,
                {
                  borderRadius: radius.md,
                  backgroundColor: submitting ? colors.text.tertiary : '#2E7D32',
                },
              ]}
            >
              <Text style={[typography.body, { color: '#FFFFFF', fontWeight: '600' }]}>
                {submitting ? '提交中...' : '提交评价'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  tagChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
  },
  textInput: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    minHeight: 72,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
