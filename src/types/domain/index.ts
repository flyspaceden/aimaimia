/**
 * 业务域模型（Domain Types）
 *
 * 说明：
 * - 这些类型在前端用于渲染与状态管理，也用于指导后端接口字段设计
 * - 后端对接时，建议以这些字段为第一版契约（后续可在不破坏前端的前提下扩展字段）
 */
export * from './Author';
export * from './Product';
export * from './Company';
export * from './Order';
export * from './UserProfile';
export * from './Booking';
export * from './Group';
export * from './CompanyEvent';
export * from './Payment';
export * from './Comment';
export * from './Ai';
export * from './AiFeature';
export * from './Follow';
export * from './Me';
export * from './Inbox';
export * from './Auth';
export * from './Address';
export * from './ServerCart';
export * from './Trace';
export * from './Bonus';
export * from './Coupon';
export * from './Category';
export * from './Invoice';
export * from './CustomerService';
