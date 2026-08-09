export type AppError = {
  code: string;
  message: string;
  displayMessage?: string;
  retryable?: boolean;
};

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };
