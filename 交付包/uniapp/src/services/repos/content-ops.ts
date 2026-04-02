// 内容运营/风控仓库：精华/榜单/审核占位
import type { Result } from '../types';
import type { Post } from './feed';

export type ModerationStatus = 'pending' | 'approved' | 'flagged' | 'rejected';
export type ReportReason = 'spam' | 'fraud' | 'misinfo' | 'abuse' | 'other';
export type ReportStatus = 'reviewing' | 'resolved' | 'dismissed';

export type ReportRecord = {
  id: string;
  reason: ReportReason;
  status: ReportStatus;
  note?: string;
  reportedAt: string;
};

export type ContentModerationSnapshot = {
  postId: string;
  status: ModerationStatus;
  reportCount: number;
  lastReviewedAt?: string;
  reviewNote?: string;
  reports: ReportRecord[];
};

export type ModerationQueueItem = {
  postId: string;
  title: string;
  authorName: string;
  status: ModerationStatus;
  reportCount: number;
  lastReviewedAt?: string;
};

export type ContributionRankItem = {
  id: string;
  name: string;
  avatar?: string;
  role: 'user' | 'company';
  badge?: string;
  score: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const formatTime = () => new Date().toLocaleString();
const reportStore = new Map<string, ContentModerationSnapshot>();

const featuredPosts: Post[] = [
  {
    id: 'p1',
    author: '江晴',
    authorId: 'u_mock',
    authorName: '江晴',
    authorType: 'user',
    city: '杭州',
    tag: '阳台种植爱好者',
    title: '高山小番茄的 7 天养护日记',
    content: '记录清晨雾气与温度对口感的影响，欢迎交流。',
    likes: 128,
    comments: 32,
    shares: 12,
    followed: true,
    createdAt: '2024-12-05 09:30',
    tags: ['种植日志', '育苗期'],
    image: 'https://placehold.co/900x900/png',
    images: ['https://placehold.co/900x900/png'],
    productId: 'p1',
    productTagLabel: '即看即买',
    intimacyLevel: 28,
  },
  {
    id: 'p2',
    author: '青禾农场',
    authorId: 'c1',
    authorName: '青禾农场',
    authorType: 'company',
    companyId: 'c1',
    city: '昆明',
    tag: '有机蔬菜供应商',
    title: '雨季育苗期注意事项',
    content: '雨季重点关注通风与排水，避免烂根。',
    likes: 92,
    comments: 18,
    shares: 6,
    followed: true,
    createdAt: '2024-12-04 10:20',
    tags: ['育苗期', '雨季管理'],
    image: 'https://placehold.co/900x900/png',
    images: ['https://placehold.co/900x900/png'],
    intimacyLevel: 62,
  },
];

const moderationQueue: ModerationQueueItem[] = [
  {
    postId: 'p3',
    title: '今年的蓝莓甜度报告',
    authorName: '山谷果园',
    status: 'flagged',
    reportCount: 3,
    lastReviewedAt: '2024-12-04 16:10',
  },
  {
    postId: 'p1',
    title: '高山小番茄的 7 天养护日记',
    authorName: '江晴',
    status: 'approved',
    reportCount: 1,
    lastReviewedAt: '2024-12-05 10:30',
  },
];

const contributionRankings: ContributionRankItem[] = [
  { id: 'r1', name: '江晴', role: 'user', badge: '创意之星', score: 680 },
  { id: 'r2', name: '青禾农场', role: 'company', badge: '优质企业', score: 640 },
  { id: 'r3', name: '小麦', role: 'user', badge: '助愿使者', score: 520 },
  { id: 'r4', name: '山谷果园', role: 'company', badge: '人气企业', score: 460 },
];

const moderationLabels: Record<ModerationStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  flagged: '需复核',
  rejected: '已驳回',
};

const reasonLabels: Record<ReportReason, string> = {
  spam: '垃圾营销',
  fraud: '虚假宣传',
  misinfo: '错误信息',
  abuse: '不当内容',
  other: '其他',
};

const shouldFlag = (reportCount: number) => reportCount >= 3;

const ensureSnapshot = (postId: string): ContentModerationSnapshot => {
  if (!reportStore.has(postId)) {
    const queueItem = moderationQueue.find((item) => item.postId === postId);
    const status = queueItem?.status ?? 'approved';
    const reportCount = queueItem?.reportCount ?? 0;
    const snapshot: ContentModerationSnapshot = {
      postId,
      status,
      reportCount,
      lastReviewedAt: queueItem?.lastReviewedAt ?? (status === 'approved' ? formatTime() : undefined),
      reviewNote: status === 'rejected' ? '未通过内容规范要求' : undefined,
      reports: [],
    };
    reportStore.set(postId, snapshot);
  }
  return reportStore.get(postId)!;
};

export const ContentOpsRepo = {
  listFeaturedPosts: async (): Promise<Result<Post[]>> => {
    await sleep(220);
    return { ok: true, data: featuredPosts };
  },
  listModerationQueue: async (): Promise<Result<ModerationQueueItem[]>> => {
    await sleep(220);
    return { ok: true, data: moderationQueue };
  },
  listContributionRankings: async (): Promise<Result<ContributionRankItem[]>> => {
    await sleep(220);
    return { ok: true, data: contributionRankings };
  },
  /** 审核快照：`GET /api/v1/ops/moderation/{postId}` */
  getModerationSnapshot: async (postId: string): Promise<Result<ContentModerationSnapshot>> => {
    await sleep(200);
    return { ok: true, data: ensureSnapshot(postId) };
  },
  /**
   * 提交举报
   * - 后端建议：`POST /api/v1/ops/reports`
   * - body：`{ postId, reason, note? }`
   */
  submitReport: async (payload: { postId: string; reason: ReportReason; note?: string }): Promise<Result<ContentModerationSnapshot>> => {
    // 举报提交：累积举报数并更新审核状态（复杂业务逻辑需中文注释）
    const snapshot = ensureSnapshot(payload.postId);
    const nextReportCount = snapshot.reportCount + 1;
    const nextStatus = shouldFlag(nextReportCount) ? 'flagged' : snapshot.status;
    const record: ReportRecord = {
      id: `report-${Date.now()}`,
      reason: payload.reason,
      note: payload.note,
      status: 'reviewing',
      reportedAt: formatTime(),
    };
    const updated: ContentModerationSnapshot = {
      ...snapshot,
      status: nextStatus,
      reportCount: nextReportCount,
      reports: [record, ...snapshot.reports].slice(0, 6),
    };
    reportStore.set(payload.postId, updated);
    const queueIndex = moderationQueue.findIndex((item) => item.postId === payload.postId);
    if (queueIndex !== -1) {
      moderationQueue[queueIndex] = {
        ...moderationQueue[queueIndex],
        status: updated.status,
        reportCount: updated.reportCount,
        lastReviewedAt: updated.lastReviewedAt ?? moderationQueue[queueIndex].lastReviewedAt,
      };
    }
    await sleep(240);
    return { ok: true, data: updated };
  },
  getReportReasonLabel: (reason: ReportReason) => reasonLabels[reason],
  getModerationLabel: (status: ModerationStatus) => moderationLabels[status],
};
