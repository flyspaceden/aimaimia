/**
 * Types 导出入口
 *
 * 约定：
 * - 业务域模型集中在 `src/types/domain/*`，可作为后端字段对齐的第一版“契约”
 * - 接口统一使用 `Result<T>` + `AppError`
 */
export * from './AppError';
export * from './Result';
export * from './Pagination';
export * from './domain';
