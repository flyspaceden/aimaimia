/**
 * Repo 导出入口
 *
 * 约定：
 * - 页面/组件只应从这里 import Repo，不应直接 import `mocks` 或自行请求网络
 * - 后端接入时，优先替换各 Repo 的实现（Mock -> HTTP），页面层尽量保持不动
 *
 * 后端接口清单：`说明文档/后端接口清单.md`
 */
export * from './ProductRepo';
export * from './CompanyRepo';
export * from './WishRepo';
export * from './WishAiRepo';
export * from './FeedRepo';
export * from './DraftRepo';
export * from './AiRepo';
export * from './AiAssistantRepo';
export * from './AiFeatureRepo';
export * from './InteractionRepo';
export * from './OrderRepo';
export * from './UserRepo';
export * from './BookingRepo';
export * from './GroupRepo';
export * from './CompanyEventRepo';
export * from './CommentRepo';
export * from './PostCommentRepo';
export * from './AnalyticsRepo';
export * from './ContentOpsRepo';
export * from './TaskRepo';
export * from './CheckInRepo';
export * from './RecommendRepo';
export * from './InboxRepo';
export * from './FollowRepo';
export * from './AuthRepo';
