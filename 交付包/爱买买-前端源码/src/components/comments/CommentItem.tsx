import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { CommentBase } from '../../types';
import { useTheme } from '../../theme';
import { LikeButton } from '../ui';

type CommentItemProps = {
  comment: CommentBase;
  onReply?: (comment: CommentBase) => void;
  onLike?: (comment: CommentBase) => void;
  isReply?: boolean;
  currentUserId?: string;
};

// 评论条目：用于楼中楼评论展示（公共组件需中文注释）
export const CommentItem = ({ comment, onReply, onLike, isReply, currentUserId }: CommentItemProps) => {
  const { colors, spacing, typography } = useTheme();
  const displayTime = comment.createdAt.includes('T') ? comment.createdAt.split('T')[0] : comment.createdAt;
  const resolvedUserId = currentUserId ?? 'u-001';

  return (
    <View
      style={[
        styles.container,
        isReply ? styles.replyContainer : null,
        { borderColor: colors.border, backgroundColor: isReply ? colors.background : colors.surface },
      ]}
    >
      <View style={styles.row}>
        {comment.author.avatar ? (
          <Image source={{ uri: comment.author.avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: colors.brand.primarySoft }]} />
        )}
        <View style={styles.content}>
          <View style={styles.nameRow}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{comment.author.name}</Text>
            <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: spacing.sm }]}>
              {displayTime}
            </Text>
          </View>
          <Text style={[typography.body, { color: colors.text.primary, marginTop: 4 }]}>
            {comment.replyTo ? (
              <Text style={{ color: colors.accent.blue }}>回复 @{comment.replyTo.name}：</Text>
            ) : null}
            {comment.content}
          </Text>
          <View style={styles.actionRow}>
            {onReply ? (
              <Pressable onPress={() => onReply(comment)} hitSlop={8}>
                <Text style={[typography.caption, { color: colors.accent.blue }]}>回复</Text>
              </Pressable>
            ) : null}
            <LikeButton
              liked={comment.likedBy.includes(resolvedUserId)}
              count={comment.likeCount}
              onPress={() => onLike?.(comment)}
              style={{ marginLeft: onReply ? spacing.md : 0 }}
            />
          </View>
        </View>
      </View>
      {isReply ? null : <View style={[styles.divider, { backgroundColor: colors.border }]} />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    padding: 12,
    borderRadius: 14,
  },
  replyContainer: {
    marginLeft: 36,
    marginTop: 10,
  },
  row: {
    flexDirection: 'row',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
  },
  avatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
  },
  content: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  divider: {
    height: 1,
    marginTop: 12,
  },
});
