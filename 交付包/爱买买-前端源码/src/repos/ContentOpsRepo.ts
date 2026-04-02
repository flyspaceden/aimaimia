/**
 * 内容运营/风控仓储（Repo）（当前为占位）
 *
 * 作用：
 * - 精华专区/榜单（内容运营）
 * - 举报/审核状态（风控）
 *
 * 后端接入说明：
 * - 建议接口：
 *   - `GET /api/v1/ops/featured-posts`
 *   - `GET /api/v1/ops/contribution-rankings`
 *   - `GET /api/v1/ops/moderation/queue`
 *   - `GET /api/v1/ops/moderation/{postId}`
 *   - `POST /api/v1/ops/reports`（提交举报）
 *
 * 详细接口清单：`说明文档/后端接口清单.md#46-运营风控与精华占位`
 */
import { mockContributionRanks, mockPosts } from '../mocks';
import {
  ContentModerationSnapshot,
  ContributionRankItem,
  ModerationQueueItem,
  Post,
  ReportReason,
  ReportRecord,
  Result,
} from '../types';
import { simulateRequest } from './helpers';

const formatTime = () => new Date().toLocaleString();
const reportStore = new Map<string, ContentModerationSnapshot>();

const moderationLabels: Record<ContentModerationSnapshot['status'], string> = {
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

const ensureSnapshot = (postId: string): ContentModerationSnapshot => {
  if (!reportStore.has(postId)) {
    const post = mockPosts.find((item) => item.id === postId);
    const status = post?.moderationStatus ?? 'approved';
    const reportCount = post?.reportCount ?? 0;
    const snapshot: ContentModerationSnapshot = {
      postId,
      status,
      reportCount,
      lastReviewedAt: status === 'approved' ? formatTime() : undefined,
      reviewNote: status === 'rejected' ? '未通过内容规范要求' : undefined,
      reports: [],
    };
    reportStore.set(postId, snapshot);
  }
  return reportStore.get(postId)!;
};

const shouldFlag = (reportCount: number) => reportCount >= 3;

// 内容运营仓储：精华/榜单/举报审核（占位）
export const ContentOpsRepo = {
  /** 精华内容：`GET /api/v1/ops/featured-posts` */
  listFeaturedPosts: async (): Promise<Result<Post[]>> => {
    const list = mockPosts.filter((post) => post.isFeatured).sort((a, b) => (b.contributionScore ?? 0) - (a.contributionScore ?? 0));
    return simulateRequest(list, { delay: 260 });
  },
  /** 贡献值榜单：`GET /api/v1/ops/contribution-rankings` */
  listContributionRankings: async (): Promise<Result<ContributionRankItem[]>> => {
    return simulateRequest(mockContributionRanks, { delay: 260 });
  },
  /** 审核队列：`GET /api/v1/ops/moderation/queue` */
  listModerationQueue: async (): Promise<Result<ModerationQueueItem[]>> => {
    const items = mockPosts
      .filter((post) => (post.reportCount ?? 0) > 0 || post.moderationStatus !== 'approved')
      .map((post) => {
        const snapshot = ensureSnapshot(post.id);
        return {
          postId: post.id,
          title: post.title,
          authorName: post.author.name,
          status: snapshot.status,
          reportCount: snapshot.reportCount,
          lastReviewedAt: snapshot.lastReviewedAt,
        };
      });
    return simulateRequest(items, { delay: 240 });
  },
  /** 审核快照：`GET /api/v1/ops/moderation/{postId}` */
  getModerationSnapshot: async (postId: string): Promise<Result<ContentModerationSnapshot>> => {
    const snapshot = ensureSnapshot(postId);
    return simulateRequest(snapshot, { delay: 200 });
  },
  /**
   * 提交举报
   * - 用途：帖子“举报/不感兴趣”入口（当前前端做占位）
   * - 后端建议：`POST /api/v1/ops/reports`
   * - body：`{ postId, reason, note? }`
   */
  submitReport: async (payload: {
    postId: string;
    reason: ReportReason;
    note?: string;
  }): Promise<Result<ContentModerationSnapshot>> => {
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
    const postIndex = mockPosts.findIndex((item) => item.id === payload.postId);
    if (postIndex !== -1) {
      mockPosts[postIndex] = {
        ...mockPosts[postIndex],
        moderationStatus: updated.status,
        reportCount: updated.reportCount,
      };
    }
    return simulateRequest(updated, { delay: 260 });
  },
  getReportReasonLabel: (reason: ReportReason) => reasonLabels[reason],
  getModerationLabel: (status: ContentModerationSnapshot['status']) => moderationLabels[status],
};
