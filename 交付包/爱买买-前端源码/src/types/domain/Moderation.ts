/**
 * 域模型：内容风控/审核（Moderation）
 *
 * 用途：
 * - 举报原因、审核状态、审核快照（运营/风控 v2 占位）
 */
export type ContentModerationStatus = 'pending' | 'approved' | 'flagged' | 'rejected';

export type ReportReason = 'spam' | 'fraud' | 'misinfo' | 'abuse' | 'other';

export type ReportStatus = 'reviewing' | 'resolved' | 'dismissed';

export type ReportRecord = {
  id: string;
  reason: ReportReason;
  note?: string;
  status: ReportStatus;
  reportedAt: string;
};

export type ContentModerationSnapshot = {
  postId: string;
  status: ContentModerationStatus;
  reportCount: number;
  lastReviewedAt?: string;
  reviewNote?: string;
  reports: ReportRecord[];
};

export type ModerationQueueItem = {
  postId: string;
  title: string;
  authorName: string;
  status: ContentModerationStatus;
  reportCount: number;
  lastReviewedAt?: string;
};
