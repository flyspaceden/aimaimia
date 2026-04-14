import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { LegalBlock, LegalDocument, LegalSection } from '../../content/legal/types';

type Props = {
  document: LegalDocument;
};

// 渲染法律文本文档（隐私政策 / 用户协议）
export const LegalDocumentView = ({ document }: Props) => {
  const { colors, radius, shadow, spacing, typography } = useTheme();

  const renderBlock = (block: LegalBlock, index: number) => {
    switch (block.type) {
      case 'p':
        return (
          <Text
            key={index}
            style={[
              typography.body,
              { color: colors.text.secondary, marginTop: index === 0 ? 0 : 8, lineHeight: 22 },
            ]}
          >
            {block.text}
          </Text>
        );
      case 'strong':
        return (
          <View
            key={index}
            style={[
              styles.strongBox,
              {
                backgroundColor: `${colors.brand.primary}10`,
                borderLeftColor: colors.brand.primary,
                borderRadius: radius.sm,
                marginTop: index === 0 ? 0 : 10,
              },
            ]}
          >
            <Text
              style={[
                typography.body,
                { color: colors.text.primary, fontWeight: '600', lineHeight: 22 },
              ]}
            >
              {block.text}
            </Text>
          </View>
        );
      case 'bullet':
        return (
          <View key={index} style={[styles.bulletRow, { marginTop: 6 }]}>
            <Text style={[typography.body, { color: colors.brand.primary }]}>•</Text>
            <Text
              style={[
                typography.body,
                { color: colors.text.secondary, marginLeft: 8, flex: 1, lineHeight: 22 },
              ]}
            >
              {block.text}
            </Text>
          </View>
        );
      case 'note':
        return (
          <Text
            key={index}
            style={[
              typography.bodyStrong,
              { color: colors.text.primary, marginTop: 12 },
            ]}
          >
            {block.text}
          </Text>
        );
    }
  };

  const renderSection = (section: LegalSection, index: number) => (
    <Animated.View
      key={section.id}
      entering={FadeInDown.duration(220).delay(index * 20)}
      style={{ marginTop: spacing.lg }}
    >
      <Text style={[typography.title3, { color: colors.text.primary }]}>{section.title}</Text>
      <View
        style={[
          styles.card,
          shadow.md,
          { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.sm },
        ]}
      >
        {section.blocks.map(renderBlock)}
      </View>
    </Animated.View>
  );

  return (
    <View>
      {/* 标题与版本 */}
      <View
        style={[
          styles.headerCard,
          shadow.md,
          { backgroundColor: colors.surface, borderRadius: radius.lg },
        ]}
      >
        <Text style={[typography.title2, { color: colors.text.primary }]}>{document.title}</Text>
        <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}>
          版本 {document.version} · 发布日期 {document.publishedAt} · 生效日期 {document.effectiveAt}
        </Text>
      </View>

      {/* 摘要 / 引言 */}
      <View
        style={[
          styles.card,
          shadow.md,
          {
            backgroundColor: `${colors.brand.primary}08`,
            borderRadius: radius.lg,
            marginTop: spacing.md,
            borderWidth: 1,
            borderColor: `${colors.brand.primary}20`,
          },
        ]}
      >
        {document.summary.map((para, idx) => (
          <Text
            key={idx}
            style={[
              typography.body,
              {
                color: colors.text.primary,
                marginTop: idx === 0 ? 0 : 8,
                lineHeight: 22,
              },
            ]}
          >
            {para}
          </Text>
        ))}
      </View>

      {/* 正文 */}
      {document.sections.map(renderSection)}
    </View>
  );
};

const styles = StyleSheet.create({
  headerCard: {
    padding: 16,
  },
  card: {
    padding: 14,
  },
  strongBox: {
    padding: 10,
    borderLeftWidth: 3,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
});
