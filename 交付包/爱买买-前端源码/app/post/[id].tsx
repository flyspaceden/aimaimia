import React, { useState } from 'react';
import {
  ActivityIndicator,
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
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { CommentThread } from '../../src/components/comments';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { PostActions, ProductQuickSheet, ProductTag } from '../../src/components/posts';
import { Tag } from '../../src/components/ui';
import { ContentOpsRepo, FeedRepo, InteractionRepo, PostCommentRepo } from '../../src/repos';
import { mockUserProfile } from '../../src/mocks';
import { useTheme } from '../../src/theme';
import {
  AppError,
  CommentBase,
  ExpertQuestionTicket,
  PostCommentThread,
  ReportReason,
  TipMethod,
  TipOrder,
} from '../../src/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBottomSheet, PostShareSheet } from '../../src/components/overlay';
import { StatusPill } from '../../src/components/ui';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [commentText, setCommentText] = useState('');
  const [inputHeight, setInputHeight] = useState(44);
  const [replyTarget, setReplyTarget] = useState<CommentBase | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expertSheetOpen, setExpertSheetOpen] = useState(false);
  const [tipSheetOpen, setTipSheetOpen] = useState(false);
  const [coopSheetOpen, setCoopSheetOpen] = useState(false);
  const [expertQuestion, setExpertQuestion] = useState('');
  const [expertContact, setExpertContact] = useState('');
  const [tipAmount, setTipAmount] = useState(18);
  const [tipMessage, setTipMessage] = useState('');
  const [tipMethod, setTipMethod] = useState<TipMethod>('wechat');
  const [tipOrder, setTipOrder] = useState<TipOrder | null>(null);
  const [tipStage, setTipStage] = useState<'input' | 'checkout' | 'paying' | 'success'>('input');
  const [tipLoading, setTipLoading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [expertTicket, setExpertTicket] = useState<ExpertQuestionTicket | null>(null);
  const [expertSubmitting, setExpertSubmitting] = useState(false);
  const [expertProgressing, setExpertProgressing] = useState(false);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [coopCompany, setCoopCompany] = useState('');
  const [coopContact, setCoopContact] = useState('');
  const [coopPhone, setCoopPhone] = useState('');
  const [coopMessage, setCoopMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const composerOffset = spacing['3xl'] + 110 + insets.bottom;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['post', id],
    queryFn: () => FeedRepo.getById(String(id)),
    enabled: Boolean(id),
  });

  const { data: commentData, isLoading: commentLoading, refetch: refetchComments } = useQuery({
    queryKey: ['post-comments', id],
    queryFn: () => PostCommentRepo.listByPost(String(id)),
    enabled: Boolean(id),
  });
  const { data: moderationData, refetch: refetchModeration } = useQuery({
    queryKey: ['post-moderation', id],
    queryFn: () => ContentOpsRepo.getModerationSnapshot(String(id)),
    enabled: Boolean(id),
  });

  const commentError = commentData && !commentData.ok ? commentData.error : null;
  const commentThreads = commentData?.ok ? commentData.data : [];
  const moderation = moderationData?.ok ? moderationData.data : null;
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchComments(), refetchModeration()]);
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="帖子详情" />
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          <Skeleton height={220} radius={radius.lg} />
          <Skeleton height={16} radius={radius.md} style={{ marginTop: spacing.md }} />
        </ScrollView>
      </Screen>
    );
  }

  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="帖子详情" />
        <ErrorState
          title="帖子加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  const post = data.data;
  const isCompany = post.author.type === 'company';
  const moderationStatus = moderation?.status ?? post.moderationStatus ?? 'pending';
  const moderationLabel = ContentOpsRepo.getModerationLabel(moderationStatus);
  const moderationTone = {
    approved: 'brand',
    pending: 'neutral',
    flagged: 'accent',
    rejected: 'neutral',
  }[moderationStatus];
  const reportCount = moderation?.reportCount ?? post.reportCount ?? 0;
  const latestReports = moderation?.reports?.slice(0, 2) ?? [];

  const handleLike = async () => {
    const result = await FeedRepo.toggleLike(post.id, mockUserProfile.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '点赞失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['circle'] });
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
      ? await PostCommentRepo.reply({ postId: post.id, parentId: replyTarget.id, content })
      : await PostCommentRepo.create({ postId: post.id, content });
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '评论失败', type: 'error' });
      return;
    }
    setCommentText('');
    setReplyTarget(null);
    await queryClient.invalidateQueries({ queryKey: ['circle'] });
    refetch();
    refetchComments();
  };

  const handleCommentLike = async (comment: CommentBase) => {
    const result = await PostCommentRepo.toggleLike(comment.id, mockUserProfile.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '点赞失败', type: 'error' });
      return;
    }
    refetchComments();
  };

  const tipOptions = [5, 18, 52, 88];
  const tipMethods: Array<{ value: TipMethod; label: string }> = [
    { value: 'wechat', label: '微信' },
    { value: 'alipay', label: '支付宝' },
  ];
  const expertSteps = [
    { key: 'submitted', label: '已提交' },
    { key: 'assigned', label: '分配专家' },
    { key: 'answered', label: '已回复' },
  ];
  const tipSteps = [
    { key: 'created', label: '创建订单' },
    { key: 'paying', label: '支付中' },
    { key: 'paid', label: '完成' },
  ];
  const reportReasons: Array<{ value: ReportReason; label: string }> = [
    { value: 'spam', label: '垃圾营销' },
    { value: 'fraud', label: '虚假宣传' },
    { value: 'misinfo', label: '错误信息' },
    { value: 'abuse', label: '不当内容' },
    { value: 'other', label: '其他' },
  ];
  const reportStatusLabels = {
    reviewing: '审核中',
    resolved: '已处理',
    dismissed: '已忽略',
  };
  // 业务状态映射到步骤索引，便于 UI 呈现进度
  const expertStepIndex = expertTicket
    ? expertSteps.findIndex((step) => step.key === expertTicket.status)
    : -1;
  const tipStepIndex = tipOrder ? tipSteps.findIndex((step) => step.key === tipOrder.status) : -1;

  const refreshExpertTicket = async () => {
    if (!expertTicket) {
      return;
    }
    const result = await InteractionRepo.getExpertTicket(expertTicket.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '刷新失败', type: 'error' });
      return;
    }
    setExpertTicket(result.data);
  };

  const handleExpertSubmit = async () => {
    if (expertSubmitting) {
      return;
    }
    const question = expertQuestion.trim();
    if (question.length < 5) {
      show({ message: '问题至少 5 字', type: 'info' });
      return;
    }
    setExpertSubmitting(true);
    const result = await InteractionRepo.submitExpertQuestion({
      postId: post.id,
      question,
      contact: expertContact.trim() || undefined,
    });
    setExpertSubmitting(false);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '提交失败', type: 'error' });
      return;
    }
    setExpertTicket(result.data);
    setExpertQuestion('');
    setExpertContact('');
    show({ message: '问题已提交', type: 'success' });

    // 模拟后台分配专家与回复
    setExpertProgressing(true);
    const assigned = await InteractionRepo.assignExpert(result.data.id);
    if (assigned.ok) {
      setExpertTicket(assigned.data);
    }
    const replied = await InteractionRepo.replyExpertQuestion(result.data.id);
    if (replied.ok) {
      setExpertTicket(replied.data);
    }
    setExpertProgressing(false);
  };

  const resetTipFlow = () => {
    setTipOrder(null);
    setTipStage('input');
    setTipMessage('');
    setTipMethod('wechat');
    setTipAmount(18);
  };

  const handleCreateTipOrder = async () => {
    if (tipLoading) {
      return;
    }
    setTipLoading(true);
    const result = await InteractionRepo.createTipOrder({
      postId: post.id,
      amount: tipAmount,
      method: tipMethod,
      message: tipMessage.trim() || undefined,
    });
    setTipLoading(false);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '创建订单失败', type: 'error' });
      return;
    }
    setTipOrder(result.data);
    setTipStage('checkout');
  };

  const handleStartTipPayment = async () => {
    if (!tipOrder || tipLoading) {
      return;
    }
    setTipLoading(true);
    const result = await InteractionRepo.startTipPayment(tipOrder.id);
    setTipLoading(false);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '支付拉起失败', type: 'error' });
      return;
    }
    setTipOrder(result.data);
    setTipStage('paying');
  };

  const handleConfirmTipPayment = async () => {
    if (!tipOrder || tipLoading) {
      return;
    }
    setTipLoading(true);
    const result = await InteractionRepo.confirmTipPayment(tipOrder.id);
    setTipLoading(false);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '支付失败', type: 'error' });
      return;
    }
    setTipOrder(result.data);
    setTipStage('success');
    show({ message: '打赏成功（占位）', type: 'success' });
  };

  const handleReportSubmit = async () => {
    if (reportSubmitting) {
      return;
    }
    if (!reportReason) {
      show({ message: '请选择举报原因', type: 'info' });
      return;
    }
    setReportSubmitting(true);
    const result = await ContentOpsRepo.submitReport({
      postId: post.id,
      reason: reportReason,
      note: reportNote.trim() || undefined,
    });
    setReportSubmitting(false);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '提交失败', type: 'error' });
      return;
    }
    setReportSheetOpen(false);
    setReportReason(null);
    setReportNote('');
    refetchModeration();
    refetch();
    show({ message: '举报已提交', type: 'success' });
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="帖子详情"
        rightSlot={
          <Pressable onPress={() => setShareOpen(true)} hitSlop={10}>
            <MaterialCommunityIcons name="share-variant" size={20} color={colors.text.secondary} />
          </Pressable>
        }
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ padding: spacing.xl, paddingBottom: composerOffset }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          >
            <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Pressable
                onPress={() => {
                  if (isCompany && post.author.companyId) {
                    router.push({ pathname: '/company/[id]', params: { id: post.author.companyId } });
                  }
                }}
                style={styles.authorRow}
              >
                {post.author.avatar ? (
                  <Image source={{ uri: post.author.avatar }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: colors.brand.primarySoft }]} />
                )}
                <View>
                  <View style={styles.nameRow}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{post.author.name}</Text>
                    {isCompany && post.author.verified ? (
                      <MaterialCommunityIcons
                        name="check-decagram"
                        size={14}
                        color={colors.accent.blue}
                        style={{ marginLeft: 4 }}
                      />
                    ) : null}
                  </View>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                    {isCompany ? post.author.title ?? '企业认证' : post.author.tags?.[0] ?? '内容创作者'}
                  </Text>
                </View>
              </Pressable>

              <Text style={[typography.title2, { color: colors.text.primary, marginTop: spacing.md }]}>
                {post.title}
              </Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                {post.content}
              </Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }}>
                {post.images.map((uri, index) => (
                  <View key={`${post.id}-img-${index}`} style={{ marginRight: spacing.sm }}>
                    <Image source={{ uri }} style={{ width: 240, height: 200, borderRadius: radius.md }} />
                    {index === 0 && post.productId ? (
                      <ProductTag
                        label={post.productTagLabel ?? '即看即买'}
                        onPress={() => setSheetOpen(true)}
                        style={styles.productTag}
                      />
                    ) : null}
                  </View>
                ))}
              </ScrollView>

              {post.tags?.length ? (
                <View style={styles.tagRow}>
                  {post.tags.map((tag, index) => (
                    <Tag key={`${post.id}-${tag}-${index}`} label={tag} tone="neutral" style={{ marginRight: spacing.xs }} />
                  ))}
                </View>
              ) : null}

              <View style={styles.actionRow}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>{post.createdAt}</Text>
                <PostActions
                  liked={post.likedBy.includes(mockUserProfile.id)}
                  likeCount={post.likeCount}
                  commentCount={post.commentCount}
                  shareCount={post.shareCount}
                  onLike={handleLike}
                  onComment={() => show({ message: '请在下方评论区留言', type: 'info' })}
                  onShare={() => setShareOpen(true)}
                />
              </View>

              <View style={[styles.moderationSection, { borderTopColor: colors.border }]}>
                <View style={styles.moderationHeader}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>内容状态</Text>
                  <Pressable onPress={() => setReportSheetOpen(true)} hitSlop={6}>
                    <Text style={[typography.caption, { color: colors.accent.blue }]}>举报</Text>
                  </Pressable>
                </View>
                <View style={styles.moderationRow}>
                  <StatusPill label={moderationLabel} tone={moderationTone as 'brand' | 'accent' | 'neutral'} />
                  {post.isFeatured ? (
                    <StatusPill label="精华" tone="accent" style={{ marginLeft: spacing.sm }} />
                  ) : null}
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                  举报 {reportCount} 条 · {moderation?.lastReviewedAt ? `最近审核 ${moderation.lastReviewedAt}` : '待复核'}
                </Text>
                {moderation?.reviewNote ? (
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                    审核说明：{moderation.reviewNote}
                  </Text>
                ) : null}
                {latestReports.length ? (
                  <View style={{ marginTop: spacing.xs }}>
                    {latestReports.map((report) => (
                      <Text key={report.id} style={[typography.caption, { color: colors.text.secondary }]}>
                        举报原因：{ContentOpsRepo.getReportReasonLabel(report.reason)} · {reportStatusLabels[report.status]}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>深度互动</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                专家答疑、打赏与合作意向（占位）
              </Text>
              <View style={styles.interactionRow}>
                <Pressable
                  onPress={() => setExpertSheetOpen(true)}
                  style={[styles.interactionCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
                >
                  <View style={[styles.interactionIcon, { backgroundColor: colors.accent.blueSoft }]}>
                    <MaterialCommunityIcons name="comment-question-outline" size={18} color={colors.accent.blue} />
                  </View>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>专家提问</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                    向企业专家提问
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setTipSheetOpen(true)}
                  style={[styles.interactionCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
                >
                  <View style={[styles.interactionIcon, { backgroundColor: colors.brand.primarySoft }]}>
                    <MaterialCommunityIcons name="gift-outline" size={18} color={colors.brand.primary} />
                  </View>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>打赏</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                    支持优质内容
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setCoopSheetOpen(true)}
                  style={[styles.interactionCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
                >
                  <View style={[styles.interactionIcon, { backgroundColor: colors.accent.blueSoft }]}>
                    <MaterialCommunityIcons name="handshake-outline" size={18} color={colors.accent.blue} />
                  </View>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>合作意向</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                    发起合作沟通
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>评论</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                先聊聊你的看法
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
                commentThreads.map((thread: PostCommentThread) => (
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

      <ProductQuickSheet open={sheetOpen} productId={post.productId} onClose={() => setSheetOpen(false)} />

      <AppBottomSheet
        open={expertSheetOpen}
        onClose={() => setExpertSheetOpen(false)}
        mode="half"
        title="专家提问"
        scrollable
      >
        {expertTicket ? (
          <View style={[styles.ticketCard, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <View style={styles.ticketHeader}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>咨询进度</Text>
              <Pressable onPress={refreshExpertTicket} hitSlop={6}>
                <Text style={[typography.caption, { color: colors.accent.blue }]}>刷新</Text>
              </Pressable>
            </View>
            <View style={styles.timelineList}>
              {expertSteps.map((step, index) => {
                const item = expertTicket.timeline.find((timeline) => timeline.status === step.key);
                const active = expertStepIndex >= 0 && expertStepIndex >= index;
                return (
                  <View key={step.key} style={styles.timelineItem}>
                    <View
                      style={[
                        styles.timelineDot,
                        { backgroundColor: active ? colors.brand.primary : colors.border },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[typography.body, { color: colors.text.primary }]}>{step.label}</Text>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                        {item?.time ?? '等待更新'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
            <View style={[styles.ticketMeta, { borderTopColor: colors.border }]}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>问题</Text>
              <Text style={[typography.body, { color: colors.text.primary, marginTop: 4 }]}>
                {expertTicket.question}
              </Text>
              {expertProgressing ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                  专家处理中，请稍候…
                </Text>
              ) : null}
            </View>
            <View style={{ marginTop: 12 }}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>专家回复</Text>
              {expertTicket.replies.length ? (
                expertTicket.replies.map((reply) => (
                  <View key={reply.id} style={[styles.replyCard, { borderColor: colors.border }]}>
                    <View style={styles.replyHeader}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{reply.responder}</Text>
                      <Text style={[typography.caption, { color: colors.text.secondary }]}>{reply.createdAt}</Text>
                    </View>
                    <Text style={[typography.body, { color: colors.text.primary, marginTop: 4 }]}>
                      {reply.content}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                  暂无回复
                </Text>
              )}
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: expertTicket ? 16 : 0 }}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>
            你的问题会同步给企业专家，回复后将站内通知。
          </Text>
          <TextInput
            value={expertQuestion}
            onChangeText={setExpertQuestion}
            placeholder="请输入问题（至少 5 字）"
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.sheetInput, { borderColor: colors.border, color: colors.text.primary }]}
          />
          <TextInput
            value={expertContact}
            onChangeText={setExpertContact}
            placeholder="联系方式（选填）"
            placeholderTextColor={colors.muted}
            style={[styles.sheetInput, { borderColor: colors.border, color: colors.text.primary }]}
          />
          <Pressable
            onPress={handleExpertSubmit}
            disabled={expertSubmitting}
            style={[
              styles.primaryButton,
              { backgroundColor: colors.brand.primary, marginTop: spacing.md, opacity: expertSubmitting ? 0.7 : 1 },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
              {expertSubmitting ? '提交中…' : '提交问题'}
            </Text>
          </Pressable>
        </View>
      </AppBottomSheet>

      <AppBottomSheet
        open={tipSheetOpen}
        onClose={() => setTipSheetOpen(false)}
        mode="half"
        title="打赏支持"
        scrollable
      >
        <View style={styles.flowHeader}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>支付流程</Text>
          <View style={styles.flowRow}>
            {tipSteps.map((step, index) => {
              const active = tipStepIndex >= 0 && tipStepIndex >= index;
              return (
                <View key={step.key} style={styles.flowStep}>
                  <View
                    style={[styles.flowDot, { backgroundColor: active ? colors.brand.primary : colors.border }]}
                  />
                  <Text style={[typography.caption, { color: active ? colors.text.primary : colors.text.secondary }]}>
                    {step.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {tipStage === 'input' ? (
          <View>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>选择金额</Text>
            <View style={styles.tipRow}>
              {tipOptions.map((amount) => {
                const active = tipAmount === amount;
                return (
                  <Pressable
                    key={amount}
                    onPress={() => setTipAmount(amount)}
                    style={[
                      styles.tipChip,
                      {
                        backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                        borderColor: active ? colors.brand.primary : colors.border,
                        borderRadius: radius.pill,
                      },
                    ]}
                  >
                    <Text style={[typography.caption, { color: active ? colors.brand.primary : colors.text.secondary }]}>
                      ¥{amount}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
              备注（选填）
            </Text>
            <TextInput
              value={tipMessage}
              onChangeText={setTipMessage}
              placeholder="给作者一句鼓励"
              placeholderTextColor={colors.muted}
              style={[styles.sheetInput, { borderColor: colors.border, color: colors.text.primary }]}
            />
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
              支付方式（占位）
            </Text>
            <View style={styles.tipRow}>
              {tipMethods.map((method) => {
                const active = tipMethod === method.value;
                return (
                  <Pressable
                    key={method.value}
                    onPress={() => setTipMethod(method.value)}
                    style={[
                      styles.tipChip,
                      {
                        backgroundColor: active ? colors.accent.blueSoft : colors.surface,
                        borderColor: active ? colors.accent.blue : colors.border,
                        borderRadius: radius.pill,
                      },
                    ]}
                  >
                    <Text style={[typography.caption, { color: active ? colors.accent.blue : colors.text.secondary }]}>
                      {method.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={handleCreateTipOrder}
              disabled={tipLoading}
              style={[
                styles.primaryButton,
                { backgroundColor: colors.brand.primary, marginTop: spacing.md, opacity: tipLoading ? 0.7 : 1 },
              ]}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                {tipLoading ? '创建订单中…' : '下一步'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {tipStage === 'checkout' && tipOrder ? (
          <View>
            <View style={[styles.orderCard, { borderColor: colors.border }]}>
              <View style={styles.orderRow}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>订单号</Text>
                <Text style={[typography.caption, { color: colors.text.primary }]}>{tipOrder.id}</Text>
              </View>
              <View style={styles.orderRow}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>金额</Text>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>¥{tipOrder.amount}</Text>
              </View>
              <View style={styles.orderRow}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>方式</Text>
                <Text style={[typography.caption, { color: colors.text.primary }]}>
                  {tipMethods.find((method) => method.value === tipOrder.method)?.label ?? '微信'}
                </Text>
              </View>
              <View style={styles.orderRow}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>创建时间</Text>
                <Text style={[typography.caption, { color: colors.text.primary }]}>{tipOrder.createdAt}</Text>
              </View>
            </View>
            <Pressable
              onPress={handleStartTipPayment}
              disabled={tipLoading}
              style={[
                styles.primaryButton,
                { backgroundColor: colors.brand.primary, marginTop: 12, opacity: tipLoading ? 0.7 : 1 },
              ]}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                {tipLoading ? '拉起支付…' : '去支付'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setTipStage('input');
                setTipOrder(null);
              }}
              style={[styles.secondaryButton, { borderColor: colors.border }]}
            >
              <Text style={[typography.body, { color: colors.text.secondary }]}>返回修改</Text>
            </Pressable>
          </View>
        ) : null}

        {tipStage === 'paying' && tipOrder ? (
          <View style={[styles.payCard, { borderColor: colors.border }]}>
            <ActivityIndicator color={colors.brand.primary} />
            <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: 8 }]}>等待支付完成</Text>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
              完成支付后点击确认
            </Text>
            <Pressable
              onPress={handleConfirmTipPayment}
              disabled={tipLoading}
              style={[
                styles.primaryButton,
                { backgroundColor: colors.brand.primary, marginTop: 12, opacity: tipLoading ? 0.7 : 1 },
              ]}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                {tipLoading ? '确认中…' : '已完成支付'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {tipStage === 'success' && tipOrder ? (
          <View style={[styles.successCard, { borderColor: colors.border }]}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>支付成功</Text>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
              感谢你的支持！
            </Text>
            <View style={{ marginTop: 12 }}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>订单号 {tipOrder.id}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                支付时间 {tipOrder.paidAt ?? tipOrder.createdAt}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setTipSheetOpen(false);
                resetTipFlow();
              }}
              style={[styles.primaryButton, { backgroundColor: colors.brand.primary, marginTop: 12 }]}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>完成</Text>
            </Pressable>
          </View>
        ) : null}
      </AppBottomSheet>

      <AppBottomSheet
        open={coopSheetOpen}
        onClose={() => setCoopSheetOpen(false)}
        mode="half"
        title="合作意向"
        scrollable
      >
        <Text style={[typography.caption, { color: colors.text.secondary }]}>
          提交后企业会与您联系（占位）
        </Text>
        <TextInput
          value={coopCompany}
          onChangeText={setCoopCompany}
          placeholder="公司/机构名称"
          placeholderTextColor={colors.muted}
          style={[styles.sheetInput, { borderColor: colors.border, color: colors.text.primary }]}
        />
        <TextInput
          value={coopContact}
          onChangeText={setCoopContact}
          placeholder="联系人"
          placeholderTextColor={colors.muted}
          style={[styles.sheetInput, { borderColor: colors.border, color: colors.text.primary }]}
        />
        <TextInput
          value={coopPhone}
          onChangeText={setCoopPhone}
          placeholder="联系电话"
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
          style={[styles.sheetInput, { borderColor: colors.border, color: colors.text.primary }]}
        />
        <TextInput
          value={coopMessage}
          onChangeText={setCoopMessage}
          placeholder="合作需求简述"
          placeholderTextColor={colors.muted}
          multiline
          style={[styles.sheetInput, styles.sheetTextarea, { borderColor: colors.border, color: colors.text.primary }]}
        />
        <Pressable
          onPress={async () => {
            if (!coopCompany.trim() || !coopContact.trim() || !coopPhone.trim()) {
              show({ message: '请补全合作信息', type: 'info' });
              return;
            }
            const result = await InteractionRepo.submitCooperationIntent({
              postId: post.id,
              companyName: coopCompany.trim(),
              contactName: coopContact.trim(),
              contactPhone: coopPhone.trim(),
              message: coopMessage.trim() || undefined,
            });
            if (!result.ok) {
              show({ message: result.error.displayMessage ?? '提交失败', type: 'error' });
              return;
            }
            setCoopCompany('');
            setCoopContact('');
            setCoopPhone('');
            setCoopMessage('');
            setCoopSheetOpen(false);
            show({ message: '合作意向已提交', type: 'success' });
          }}
          style={[styles.primaryButton, { backgroundColor: colors.brand.primary, marginTop: spacing.md }]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>提交合作意向</Text>
        </Pressable>
      </AppBottomSheet>

      <AppBottomSheet
        open={reportSheetOpen}
        onClose={() => setReportSheetOpen(false)}
        mode="half"
        title="举报内容"
        scrollable
      >
        <Text style={[typography.caption, { color: colors.text.secondary }]}>请选择举报原因</Text>
        <View style={styles.reportReasonRow}>
          {reportReasons.map((reason) => {
            const active = reportReason === reason.value;
            return (
              <Pressable
                key={reason.value}
                onPress={() => setReportReason(reason.value)}
                style={[
                  styles.reportChip,
                  {
                    borderColor: active ? colors.accent.blue : colors.border,
                    backgroundColor: active ? colors.accent.blueSoft : colors.surface,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[typography.caption, { color: active ? colors.accent.blue : colors.text.secondary }]}>
                  {reason.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
          补充说明（选填）
        </Text>
        <TextInput
          value={reportNote}
          onChangeText={setReportNote}
          placeholder="补充说明有助于更快处理"
          placeholderTextColor={colors.muted}
          multiline
          style={[styles.sheetInput, styles.sheetTextarea, { borderColor: colors.border, color: colors.text.primary }]}
        />
        <Pressable
          onPress={handleReportSubmit}
          disabled={reportSubmitting}
          style={[
            styles.primaryButton,
            { backgroundColor: colors.brand.primary, marginTop: spacing.md, opacity: reportSubmitting ? 0.7 : 1 },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
            {reportSubmitting ? '提交中…' : '提交举报'}
          </Text>
        </Pressable>
      </AppBottomSheet>
      <PostShareSheet open={shareOpen} post={post} onClose={() => setShareOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
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
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  moderationSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  moderationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  moderationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  productTag: {
    position: 'absolute',
    left: 10,
    bottom: 10,
  },
  composerDock: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  composer: {
    padding: 12,
    borderWidth: 0,
  },
  ticketCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timelineList: {
    marginTop: 8,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    marginRight: 8,
  },
  ticketMeta: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  replyCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  replyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  replyHint: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  inputShell: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
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
  interactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  interactionCard: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  interactionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  sheetInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  sheetTextarea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  flowHeader: {
    marginBottom: 12,
  },
  flowRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  flowStep: {
    flex: 1,
    alignItems: 'center',
  },
  flowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 6,
  },
  tipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  tipChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  orderCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  orderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  secondaryButton: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
  },
  payCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  successCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  reportReasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  reportChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  primaryButton: {
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
});
