import React, { useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppHeader, Screen } from '../../src/components/layout';
import { CommentThread } from '../../src/components/comments';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { LikeButton, StatusPill, Tag } from '../../src/components/ui';
import { wishCrowdfundingPresets, wishPowerLevels, wishStatusLabels } from '../../src/constants';
import { mockUserProfile } from '../../src/mocks';
import { CommentRepo, UserRepo, WishRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AppError, CommentBase, CommentThread as CommentThreadType, WishStatus } from '../../src/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function WishDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [commentText, setCommentText] = useState('');
  const [inputHeight, setInputHeight] = useState(44);
  const [replyTarget, setReplyTarget] = useState<CommentBase | null>(null);
  const [commentSort, setCommentSort] = useState<'relevant' | 'latest' | 'earliest' | 'top'>('latest');
  const [refreshing, setRefreshing] = useState(false);
  const composerOffset = spacing['3xl'] + 110 + insets.bottom;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['wish', id],
    queryFn: () => WishRepo.getById(String(id)),
    enabled: Boolean(id),
  });
  const { data: profileResult } = useQuery({
    queryKey: ['userProfile'],
    queryFn: () => UserRepo.profile(),
  });

  const { data: commentData, isLoading: commentLoading, refetch: refetchComments } = useQuery({
    queryKey: ['wish-comments', id],
    queryFn: () => CommentRepo.listByWish(String(id)),
    enabled: Boolean(id),
  });

  const commentError = commentData && !commentData.ok ? commentData.error : null;
  const commentThreads = commentData?.ok ? commentData.data : [];
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchComments()]);
    setRefreshing(false);
  };
  const sortedThreads = useMemo(() => {
    const list = [...commentThreads];
    const toTime = (value: string) => new Date(value).getTime();
    const score = (thread: CommentThreadType) => thread.likeCount * 2 + (thread.replies?.length ?? 0);

    switch (commentSort) {
      case 'latest':
        return list.sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
      case 'earliest':
        return list.sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt));
      case 'top':
        return list.sort((a, b) => b.likeCount - a.likeCount);
      case 'relevant':
      default:
        return list.sort((a, b) => score(b) - score(a));
    }
  }, [commentSort, commentThreads]);

  const statusOptions = useMemo(
    () => [
      { value: 'planning' as WishStatus, label: wishStatusLabels.planning },
      { value: 'adopted' as WishStatus, label: wishStatusLabels.adopted },
      { value: 'done' as WishStatus, label: wishStatusLabels.done },
    ],
    []
  );

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="心愿详情" />
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          <Skeleton height={220} radius={radius.lg} />
          <Skeleton height={16} radius={radius.md} style={{ marginTop: spacing.md }} />
          <Skeleton height={16} radius={radius.md} style={{ marginTop: spacing.sm }} />
        </ScrollView>
      </Screen>
    );
  }

  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="心愿详情" />
        <ErrorState
          title="心愿加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  const wish = data.data;
  const isOwner = wish.author.id === mockUserProfile.id;
  const progress =
    wish.progress ?? (wish.status === 'done' ? 100 : wish.status === 'adopted' ? 60 : 30);
  const rawPowerIndex = wishPowerLevels.findIndex((level) => level.id === wish.wishPower.level);
  const powerLevelIndex = rawPowerIndex < 0 ? 0 : rawPowerIndex;
  const powerLevel = wishPowerLevels[powerLevelIndex] ?? wishPowerLevels[0];
  const nextLevel = wishPowerLevels[powerLevelIndex + 1];
  const powerProgress = nextLevel
    ? Math.min(
        1,
        (wish.wishPower.score - powerLevel.min) / Math.max(1, nextLevel.min - powerLevel.min)
      )
    : 1;
  const profile = profileResult?.ok ? profileResult.data : null;
  const fulfillmentLabelMap = {
    open: '待企业接单',
    accepted: '企业已接单',
    producing: '生产推进中',
    delivered: '交付完成',
  };
  const crowdfunding = wish.crowdfunding;
  const exchange = wish.exchange;

  const handleLike = async () => {
    const result = await WishRepo.toggleLike(wish.id, mockUserProfile.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '点赞失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['wishes'] });
    refetch();
  };

  const handleStatusUpdate = async (status: WishStatus) => {
    const result = await WishRepo.updateStatus(wish.id, status, mockUserProfile.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '更新失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['wishes'] });
    refetch();
  };

  const handleCommentSubmit = async () => {
    const content = commentText.trim();
    if (!content) {
      show({ message: '请输入评论内容', type: 'info' });
      return;
    }
    Keyboard.dismiss();
    const result = replyTarget
      ? await CommentRepo.reply({ wishId: wish.id, parentId: replyTarget.id, content })
      : await CommentRepo.create({ wishId: wish.id, content });
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '评论失败', type: 'error' });
      return;
    }
    setCommentText('');
    setReplyTarget(null);
    await queryClient.invalidateQueries({ queryKey: ['wishes'] });
    refetch();
    refetchComments();
  };

  const handleCompanyAccept = async () => {
    const result = await WishRepo.acceptByCompany(wish.id, wish.companyId);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '接单失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['wishes'] });
    refetch();
    show({ message: '企业接单已提交', type: 'success' });
  };

  const handleCrowdfunding = async (amount: number) => {
    const result = await WishRepo.pledgeCrowdfunding(wish.id, amount);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '众筹支持失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['wishes'] });
    refetch();
    show({ message: `已支持 ¥${amount}`, type: 'success' });
  };

  const handleRedeem = async () => {
    if (!exchange) {
      show({ message: '当前心愿未开放兑换', type: 'info' });
      return;
    }
    if (exchange.redeemed) {
      show({ message: '已完成兑换', type: 'info' });
      return;
    }
    if (profile && profile.points < exchange.pointsRequired) {
      show({ message: '积分不足，先去完成任务吧', type: 'info' });
      return;
    }
    const redeemResult = await WishRepo.redeemWithPoints(wish.id);
    if (!redeemResult.ok) {
      show({ message: redeemResult.error.displayMessage ?? '兑换失败', type: 'error' });
      return;
    }
    await UserRepo.applyRewards({ points: -(exchange.pointsRequired ?? 0) });
    await queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    await queryClient.invalidateQueries({ queryKey: ['wishes'] });
    refetch();
    show({ message: '兑换成功，已扣除积分', type: 'success' });
  };

  const handleCommentLike = async (comment: CommentBase) => {
    const result = await CommentRepo.toggleLike(comment.id, mockUserProfile.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '点赞失败', type: 'error' });
      return;
    }
    refetchComments();
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="心愿详情" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ padding: spacing.xl, paddingBottom: composerOffset }}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          >
            <View
              style={[
                styles.card,
                shadow.sm,
                { backgroundColor: colors.surface, borderRadius: radius.lg, borderColor: colors.border },
              ]}
            >
              <View style={styles.authorRow}>
                {wish.author.avatar ? (
                  <Image source={{ uri: wish.author.avatar }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatarFallback, { backgroundColor: colors.brand.primarySoft }]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{wish.author.name}</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>{wish.createdAt}</Text>
                </View>
                <StatusPill
                  label={wishStatusLabels[wish.status]}
                  tone={wish.status === 'adopted' ? 'accent' : wish.status === 'planning' ? 'brand' : 'neutral'}
                />
              </View>

              <Text style={[typography.title2, { color: colors.text.primary, marginTop: spacing.md }]}>
                {wish.title}
              </Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                {wish.description}
              </Text>

              <View style={styles.tagRow}>
                <Tag
                  label={wish.type === 'platform' ? '给平台' : wish.type === 'company' ? '给企业' : '公开心愿'}
                  tone="accent"
                  style={{ marginRight: spacing.xs }}
                />
                {wish.tags.map((tag, index) => (
                  <Tag key={`${wish.id}-${tag}-${index}`} label={tag} style={{ marginRight: spacing.xs }} />
                ))}
                {wish.mentions?.map((mention) => (
                  <Tag key={`mention-${mention.id}`} label={`@${mention.name}`} tone="accent" />
                ))}
              </View>

              <View style={{ marginTop: spacing.md }}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>进度 {progress}%</Text>
                <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.progressFill,
                      { backgroundColor: colors.brand.primary, width: `${Math.min(100, progress)}%` },
                    ]}
                  />
                </View>
              </View>

              <View style={styles.metaRow}>
                <View style={styles.countRow}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>评论</Text>
                  <Text style={[typography.caption, { color: colors.text.primary, marginLeft: 4 }]}>
                    {wish.commentCount}
                  </Text>
                </View>
                <LikeButton
                  liked={wish.likedBy.includes(mockUserProfile.id)}
                  count={wish.likeCount}
                  onPress={handleLike}
                />
              </View>
            </View>

            <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={styles.powerHeader}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>心愿力</Text>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  {powerLevel.label} · {wish.wishPower.score}
                </Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    { backgroundColor: colors.brand.primary, width: `${Math.round(powerProgress * 100)}%` },
                  ]}
                />
              </View>
              <View style={styles.powerMeta}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  {nextLevel ? `距离下一等级还差 ${Math.max(0, nextLevel.min - wish.wishPower.score)}` : '已达到最高等级'}
                </Text>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  当前徽章 {wish.badges.length} 枚
                </Text>
              </View>
              {wish.badges.length ? (
                <View style={styles.badgeRow}>
                  {wish.badges.map((badge) => (
                    <Tag key={`${wish.id}-${badge.id}`} label={badge.label} tone={badge.tone} style={{ marginRight: 6 }} />
                  ))}
                </View>
              ) : (
                <Text style={[typography.caption, { color: colors.muted, marginTop: 8 }]}>
                  继续互动即可解锁徽章
                </Text>
              )}
            </View>

            <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={styles.sectionHeader}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>企业接单</Text>
                <StatusPill label={fulfillmentLabelMap[wish.fulfillment?.status ?? 'open']} tone="neutral" />
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                {wish.fulfillment?.companyName
                  ? `当前接单企业：${wish.fulfillment.companyName}`
                  : '企业可接单并进入生产排期'}
              </Text>
              {wish.fulfillment?.status === 'open' ? (
                <Pressable
                  onPress={handleCompanyAccept}
                  style={[
                    styles.actionButton,
                    { borderRadius: radius.pill, borderColor: colors.brand.primary },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.brand.primary }]}>申请企业接单</Text>
                </Pressable>
              ) : null}
            </View>

            {crowdfunding ? (
              <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
                <View style={styles.sectionHeader}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>心愿众筹</Text>
                  <StatusPill
                    label={crowdfunding.status === 'success' ? '已达成' : '进行中'}
                    tone={crowdfunding.status === 'success' ? 'brand' : 'accent'}
                  />
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                  已筹 ¥{crowdfunding.pledgedAmount} / 目标 ¥{crowdfunding.targetAmount} · {crowdfunding.supporters} 人支持
                </Text>
                <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: colors.accent.blue,
                        width: `${Math.min(100, (crowdfunding.pledgedAmount / crowdfunding.targetAmount) * 100)}%`,
                      },
                    ]}
                  />
                </View>
                {crowdfunding.status === 'open' ? (
                  <View style={styles.crowdRow}>
                    {wishCrowdfundingPresets.map((amount) => (
                      <Pressable
                        key={amount}
                        onPress={() => handleCrowdfunding(amount)}
                        style={[
                          styles.crowdChip,
                          { borderRadius: radius.pill, borderColor: colors.border },
                        ]}
                      >
                        <Text style={[typography.caption, { color: colors.text.secondary }]}>支持 ¥{amount}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {exchange ? (
              <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
                <View style={styles.sectionHeader}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>积分兑换</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>
                    当前积分 {profile?.points ?? 0}
                  </Text>
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                  兑换所需 {exchange.pointsRequired} 积分 · 库存 {exchange.stock}
                </Text>
                {exchange.stock <= 0 ? (
                  <Text style={[typography.caption, { color: colors.danger, marginTop: 6 }]}>库存不足</Text>
                ) : null}
                <Pressable
                  onPress={handleRedeem}
                  disabled={exchange.redeemed || exchange.stock <= 0}
                  style={[
                    styles.actionButton,
                    { borderRadius: radius.pill, borderColor: colors.brand.primary },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.brand.primary }]}>
                    {exchange.redeemed ? '已兑换' : '立即兑换'}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {isOwner ? (
              <View style={[styles.card, { borderRadius: radius.lg, borderColor: colors.border }]}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>更新心愿状态</Text>
                <View style={styles.statusRow}>
                  {statusOptions.map((option) => {
                    const active = wish.status === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => handleStatusUpdate(option.value)}
                        style={[
                          styles.statusChip,
                          {
                            backgroundColor: active ? colors.brand.primary : colors.surface,
                            borderColor: active ? colors.brand.primary : colors.border,
                            borderRadius: radius.pill,
                          },
                        ]}
                      >
                        <Text
                          style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {wish.responses?.length ? (
              <View style={[styles.card, { borderRadius: radius.lg, borderColor: colors.border }]}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>官方/企业回复</Text>
                {wish.responses.map((response) => (
                  <View key={response.id} style={styles.responseItem}>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>
                      {response.type === 'platform' ? '平台回复' : '企业回复'} · {response.createdAt}
                    </Text>
                    <Text style={[typography.body, { color: colors.text.primary, marginTop: 4 }]}>
                      {response.content}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={{ marginTop: spacing.lg }}>
              <View style={styles.commentHeader}>
                <Text style={[typography.title3, { color: colors.text.primary }]}>评论</Text>
                <View style={styles.sortRow}>
                  {[
                    { id: 'earliest', label: '最早' },
                    { id: 'latest', label: '最晚' },
                    { id: 'relevant', label: '最相关' },
                    { id: 'top', label: '最多赞' },
                  ].map((item) => {
                    const active = commentSort === item.id;
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => setCommentSort(item.id as typeof commentSort)}
                        style={[
                          styles.sortChip,
                          {
                            backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                            borderColor: active ? colors.brand.primary : colors.border,
                            borderRadius: radius.pill,
                          },
                        ]}
                      >
                        <Text style={[typography.caption, { color: active ? colors.brand.primary : colors.text.secondary }]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                像小红书一样聊一聊
              </Text>
            </View>

            <View style={{ marginTop: spacing.md }}>
              {commentLoading ? (
                <View>
                  <Skeleton height={90} radius={radius.lg} />
                  <View style={{ height: spacing.sm }} />
                  <Skeleton height={90} radius={radius.lg} />
                </View>
              ) : (commentError as AppError | null) ? (
                <ErrorState
                  title="评论加载失败"
                  description={commentError?.displayMessage ?? '请稍后重试'}
                  onAction={refetchComments}
                />
            ) : commentThreads.length === 0 ? (
              <EmptyState title="暂无评论" description="成为第一个发声的人" />
            ) : (
              sortedThreads.map((thread: CommentThreadType) => (
                <CommentThread
                  key={thread.id}
                  thread={thread}
                  onReply={(comment) => setReplyTarget(comment)}
                    onLike={handleCommentLike}
                    currentUserId={mockUserProfile.id}
                  />
                ))
              )}
            </View>
          </ScrollView>

          <View
            style={[
              styles.composerDock,
              {
                backgroundColor: colors.background,
                borderTopColor: colors.border,
                paddingBottom: 0,
              },
            ]}
          >
            <View
              style={[
                styles.composer,
                { backgroundColor: colors.surface, borderRadius: radius.lg, borderColor: colors.border },
              ]}
            >
              {replyTarget ? (
                <View style={styles.replyHint}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>
                    回复 @{replyTarget.author.name}
                  </Text>
                  <Pressable onPress={() => setReplyTarget(null)} hitSlop={8}>
                    <Text style={[typography.caption, { color: colors.accent.blue }]}>取消</Text>
                  </Pressable>
                </View>
              ) : null}
              <View style={[styles.inputShell, { borderColor: colors.border, borderRadius: radius.md }]}>
                <TextInput
                  value={commentText}
                  onChangeText={setCommentText}
                  placeholder="写下你的评论..."
                  placeholderTextColor={colors.muted}
                  multiline
                  onContentSizeChange={(event) => {
                    const nextHeight = Math.min(120, Math.max(44, event.nativeEvent.contentSize.height));
                    setInputHeight(nextHeight);
                  }}
                  style={[
                    styles.input,
                    {
                      color: colors.text.primary,
                      height: inputHeight,
                    },
                  ]}
                />
                <Pressable
                  onPress={handleCommentSubmit}
                  disabled={!commentText.trim()}
                  style={({ pressed }) => [
                    styles.sendButton,
                    {
                      opacity: commentText.trim() ? (pressed ? 0.7 : 1) : 0.4,
                      backgroundColor: colors.brand.primarySoft,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="send"
                    size={18}
                    color={commentText.trim() ? colors.brand.primary : colors.muted}
                  />
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  powerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  powerMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
  },
  crowdRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  crowdChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
  },
  responseItem: {
    marginTop: 12,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    marginLeft: 6,
    marginBottom: 4,
  },
  composer: {
    padding: 12,
    borderWidth: 0,
  },
  composerDock: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  inputShell: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  replyHint: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  input: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    textAlignVertical: 'top',
  },
  sendButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
});
