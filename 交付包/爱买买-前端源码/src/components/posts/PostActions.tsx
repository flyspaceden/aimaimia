import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

type PostActionsProps = {
  liked: boolean;
  likeCount: number;
  commentCount: number;
  shareCount?: number;
  onLike?: () => void;
  onComment?: () => void;
  onShare?: () => void;
};

// 帖子互动条：点赞/评论/转发（公共组件需中文注释）
export const PostActions = ({
  liked,
  likeCount,
  commentCount,
  shareCount,
  onLike,
  onComment,
  onShare,
}: PostActionsProps) => {
  const { colors, typography } = useTheme();

  return (
    <View style={styles.row}>
      <Pressable onPress={onLike} style={styles.item} hitSlop={8}>
        <MaterialCommunityIcons
          name={liked ? 'heart' : 'heart-outline'}
          size={18}
          color={liked ? colors.danger : colors.text.secondary}
        />
        <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 4 }]}>{likeCount}</Text>
      </Pressable>
      <Pressable onPress={onComment} style={styles.item} hitSlop={8}>
        <MaterialCommunityIcons name="comment-processing-outline" size={18} color={colors.text.secondary} />
        <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 4 }]}>{commentCount}</Text>
      </Pressable>
      <Pressable onPress={onShare} style={styles.item} hitSlop={8}>
        <MaterialCommunityIcons name="share-variant" size={18} color={colors.text.secondary} />
        <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 4 }]}>
          {shareCount ?? 0}
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
});
