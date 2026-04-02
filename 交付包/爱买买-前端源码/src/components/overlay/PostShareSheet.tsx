import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useToast } from '../feedback';
import { Tag } from '../ui';
import { Post } from '../../types';
import { AppBottomSheet } from './AppBottomSheet';

type PostShareSheetProps = {
  open: boolean;
  post?: Post | null;
  onClose: () => void;
};

const shareActions = [
  { id: 'wechat', label: '微信好友', icon: 'wechat', message: '已生成微信分享卡片（占位）' },
  { id: 'moments', label: '朋友圈', icon: 'wechat', message: '已生成朋友圈卡片（占位）' },
  { id: 'xhs', label: '小红书', icon: 'notebook-outline', message: '已生成小红书分享卡片（占位）' },
  { id: 'douyin', label: '抖音', icon: 'music-note', message: '已生成抖音分享卡片（占位）' },
  { id: 'link', label: '复制链接', icon: 'link-variant', message: '链接已复制（占位）' },
];

// 帖子分享卡片：用于爱买买圈/帖子详情的分享预览（公共组件需中文注释）
export const PostShareSheet = ({ open, post, onClose }: PostShareSheetProps) => {
  const { colors, radius, spacing, typography } = useTheme();
  const { show } = useToast();

  if (!post) {
    return null;
  }

  const cover = post.images?.[0];
  const tags = post.tags?.slice(0, 3) ?? [];

  return (
    <AppBottomSheet open={open} onClose={onClose} mode="auto" title="分享卡片" scrollable>
      <View
        style={[
          styles.card,
          {
            borderColor: colors.border,
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            marginTop: spacing.md,
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.brandRow}>
            <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>爱买买</Text>
            <View style={[styles.brandChip, { backgroundColor: colors.accent.blueSoft }]}>
              <Text style={[typography.caption, { color: colors.accent.blue }]}>AI</Text>
            </View>
          </View>
          <View style={[styles.cardBadge, { backgroundColor: colors.brand.primarySoft }]}>
            <Text style={[typography.caption, { color: colors.brand.primary }]}>爱买买圈分享</Text>
          </View>
        </View>

        {cover ? (
          <Image source={{ uri: cover }} style={[styles.cover, { borderRadius: radius.md }]} contentFit="cover" />
        ) : (
          <View
            style={[
              styles.cover,
              styles.coverPlaceholder,
              { borderRadius: radius.md, backgroundColor: colors.border },
            ]}
          />
        )}

        <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: spacing.sm }]} numberOfLines={2}>
          {post.title}
        </Text>
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]} numberOfLines={2}>
          {post.content}
        </Text>

        {tags.length ? (
          <View style={styles.tagRow}>
            {tags.map((tag, index) => (
              <Tag
                key={`${post.id}-share-${tag}-${index}`}
                label={tag}
                tone="neutral"
                style={{ marginRight: spacing.xs }}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.cardFooter}>
          <View style={styles.authorRow}>
            {post.author.avatar ? (
              <Image source={{ uri: post.author.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.brand.primarySoft }]} />
            )}
            <View>
              <Text style={[typography.caption, { color: colors.text.primary }]}>{post.author.name}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>{post.createdAt}</Text>
            </View>
          </View>
          <View style={[styles.qrBox, { borderColor: colors.border }]}>
            <MaterialCommunityIcons name="qrcode" size={20} color={colors.text.secondary} />
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>扫码查看</Text>
          </View>
        </View>
      </View>

      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
        分享卡片为前端占位，后续可接入微信/系统分享能力
      </Text>

      <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: spacing.md }]}>分享到</Text>
      <View style={[styles.actionGrid, { marginTop: spacing.sm }]}>
        {shareActions.map((action) => (
          <Pressable
            key={action.id}
            onPress={() => show({ message: action.message, type: 'info' })}
            style={styles.actionItem}
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <MaterialCommunityIcons name={action.icon as any} size={18} color={colors.text.secondary} />
            </View>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </AppBottomSheet>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    marginLeft: 6,
  },
  cardBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  cover: {
    width: '100%',
    height: 120,
  },
  coverPlaceholder: {
    borderWidth: 1,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
  },
  qrBox: {
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
  },
  actionItem: {
    alignItems: 'center',
    width: '20%',
    marginBottom: 6,
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
