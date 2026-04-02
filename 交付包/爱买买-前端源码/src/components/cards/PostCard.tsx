import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Post } from '../../types';
import { useTheme } from '../../theme';
import { Tag } from '../ui';
import { PostActions, ProductTag } from '../posts';

type PostCardProps = {
  post: Post;
  liked?: boolean;
  currentUserId?: string;
  onPress?: (post: Post) => void;
  onAuthorPress?: (post: Post) => void;
  onMore?: (post: Post) => void;
  onProductPress?: (post: Post) => void;
  onLike?: (post: Post) => void;
  onComment?: (post: Post) => void;
  onShare?: (post: Post) => void;
  onFollowToggle?: (post: Post) => void;
};

// 帖子卡片：爱买买圈信息流主卡（公共组件需中文注释）
export const PostCard = ({
  post,
  liked,
  currentUserId,
  onPress,
  onAuthorPress,
  onMore,
  onProductPress,
  onLike,
  onComment,
  onShare,
  onFollowToggle,
}: PostCardProps) => {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const isCompany = post.author.type === 'company';
  const images = post.images ?? [];
  const isSelf = currentUserId ? post.author.id === currentUserId : false;
  const isFollowed = Boolean(post.author.isFollowed);
  const intimacyLevel = Math.min(100, Math.max(0, post.author.intimacyLevel ?? 0));
  const canFollow = !isSelf && typeof onFollowToggle === 'function';

  return (
    <Pressable
      onPress={() => onPress?.(post)}
      style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
    >
      <View style={styles.headerRow}>
        <Pressable onPress={() => onAuthorPress?.(post)} style={styles.authorRow} hitSlop={8}>
          {post.author.avatar ? (
            <Image source={{ uri: post.author.avatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.brand.primarySoft }]} />
          )}
          <View>
            <View style={styles.nameRow}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{post.author.name}</Text>
              {isCompany && post.author.verified ? (
                <MaterialCommunityIcons name="check-decagram" size={14} color={colors.accent.blue} style={{ marginLeft: 4 }} />
              ) : null}
            </View>
            {isCompany && post.author.title ? (
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                {post.author.title}
              </Text>
            ) : post.author.tags?.length ? (
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                {post.author.tags[0]}
              </Text>
            ) : null}
            {isFollowed ? (
              <View style={styles.intimacyRow}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>亲密度 {intimacyLevel}%</Text>
                <View style={[styles.intimacyTrack, { backgroundColor: colors.border }]}>
                  <View
                    style={[styles.intimacyFill, { backgroundColor: colors.brand.primary, width: `${intimacyLevel}%` }]}
                  />
                </View>
              </View>
            ) : null}
          </View>
        </Pressable>
        <View style={styles.headerActions}>
          {canFollow ? (
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                onFollowToggle?.(post);
              }}
              style={[
                styles.followButton,
                {
                  backgroundColor: isFollowed ? colors.surface : colors.brand.primary,
                  borderColor: isFollowed ? colors.border : colors.brand.primary,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <Text style={[typography.caption, { color: isFollowed ? colors.text.secondary : colors.text.inverse }]}>
                {isFollowed ? '已关注' : '关注'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => onMore?.(post)} hitSlop={10} style={styles.moreButton}>
            <MaterialCommunityIcons name="dots-horizontal" size={18} color={colors.text.secondary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.imageWrap}>
        {images[0] ? (
          <Image source={{ uri: images[0] }} style={[styles.cover, { borderRadius: radius.md }]} />
        ) : null}
        {images.length > 1 ? (
          <View style={[styles.imageCount, { backgroundColor: colors.overlay, borderRadius: radius.pill }]}>
            <Text style={[typography.caption, { color: colors.text.inverse }]}>+{images.length - 1}</Text>
          </View>
        ) : null}
        {post.productId ? (
          <ProductTag
            label={post.productTagLabel ?? '即看即买'}
            onPress={() => onProductPress?.(post)}
            style={styles.productTag}
          />
        ) : null}
      </View>

      <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: spacing.sm }]} numberOfLines={2}>
        {post.title}
      </Text>
      <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.xs }]} numberOfLines={3}>
        {post.content}
      </Text>

      {post.tags?.length ? (
        <View style={styles.tagRow}>
          {post.tags.map((tag, index) => (
            <Tag key={`${post.id}-${tag}-${index}`} label={tag} tone="neutral" style={{ marginRight: spacing.xs }} />
          ))}
        </View>
      ) : null}

      <View style={styles.footerRow}>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>{post.createdAt}</Text>
        <PostActions
          liked={liked ?? false}
          likeCount={post.likeCount}
          commentCount={post.commentCount}
          shareCount={post.shareCount}
          onLike={() => onLike?.(post)}
          onComment={() => onComment?.(post)}
          onShare={() => onShare?.(post)}
        />
      </View>
    </Pressable>
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
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  intimacyRow: {
    marginTop: 6,
  },
  intimacyTrack: {
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 4,
    width: 140,
  },
  intimacyFill: {
    height: '100%',
    borderRadius: 999,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  moreButton: {
    padding: 4,
  },
  followButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    marginRight: 6,
  },
  imageWrap: {
    marginTop: 12,
  },
  cover: {
    width: '100%',
    height: 190,
  },
  imageCount: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  productTag: {
    position: 'absolute',
    left: 10,
    bottom: 10,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
});
