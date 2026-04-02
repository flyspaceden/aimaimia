export const UPLOAD_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'application/pdf',
] as const;

export const UPLOAD_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// 最多 3 层目录，每段仅允许字母/数字/_/-
export const UPLOAD_FOLDER_PATTERN = /^(?:[A-Za-z0-9_-]+)(?:\/[A-Za-z0-9_-]+){0,2}$/;
