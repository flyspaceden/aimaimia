// 通用类型：Result/AppError（后端接口对接的统一结构）
export type AppError = {
  code: string;
  message: string;
  detail?: string;
};

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export type PagedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};
