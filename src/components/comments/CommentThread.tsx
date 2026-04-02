import React from 'react';
import { StyleSheet, View } from 'react-native';
import { CommentBase, CommentThreadBase } from '../../types';
import { CommentItem } from './CommentItem';

type CommentThreadProps = {
  thread: CommentThreadBase;
  onReply?: (comment: CommentBase) => void;
  onLike?: (comment: CommentBase) => void;
  currentUserId?: string;
};

// 评论楼中楼：父评论 + 多条回复（公共组件需中文注释）
export const CommentThread = ({ thread, onReply, onLike, currentUserId }: CommentThreadProps) => (
  <View style={styles.thread}>
    <CommentItem comment={thread} onReply={onReply} onLike={onLike} currentUserId={currentUserId} />
    {thread.replies.map((reply) => (
      <CommentItem key={reply.id} comment={reply} isReply onLike={onLike} currentUserId={currentUserId} />
    ))}
  </View>
);

const styles = StyleSheet.create({
  thread: {
    marginBottom: 12,
  },
});
