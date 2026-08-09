import { ApiClient } from '@/api/client';
import type { Result, UpdateUserProfileInput, UserProfile } from '@/types';

type AvatarUploadResult = { url: string; key: string; size: number; mimeType: string };

function invalidAvatarUpload(): Result<AvatarUploadResult> {
  return {
    ok: false,
    error: {
      code: 'INVALID_AVATAR_UPLOAD_RESPONSE',
      message: 'Invalid avatar upload response',
      displayMessage: '头像上传结果异常，请重试',
      retryable: true,
    },
  };
}

function normalizeAvatarUpload(value: unknown): Result<AvatarUploadResult> {
  if (!value || typeof value !== 'object') return invalidAvatarUpload();
  const item = value as Record<string, unknown>;
  const url = typeof item.url === 'string' ? item.url.trim() : '';
  const key = typeof item.key === 'string' ? item.key.trim() : '';
  const mimeType = typeof item.mimeType === 'string' ? item.mimeType.trim().toLowerCase() : '';
  const size = Number(item.size);
  let parsed: URL;
  try { parsed = new URL(url); } catch { return invalidAvatarUpload(); }
  const safeTransport = parsed.protocol === 'https:'
    || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname));
  if (
    !safeTransport
    || parsed.username
    || parsed.password
    || parsed.hash
    || !/^avatars\/[A-Za-z0-9-]+\.(?:webp|png|jpe?g)$/i.test(key)
    || !mimeType.startsWith('image/')
    || !Number.isFinite(size)
    || size <= 0
    || size > 10 * 1024 * 1024
  ) return invalidAvatarUpload();
  return { ok: true, data: { url, key, size, mimeType } };
}

export const UserRepo = {
  profile: (): Promise<Result<UserProfile>> => ApiClient.get<UserProfile>('/me'),

  updateProfile: (input: UpdateUserProfileInput): Promise<Result<UserProfile>> =>
    ApiClient.put<UserProfile>('/me', {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.location !== undefined && { location: input.location }),
      ...(input.interests !== undefined && { interests: input.interests }),
      ...(input.avatar !== undefined && { avatar: input.avatar }),
      ...(input.avatarFrameId !== undefined && { avatarFrameId: input.avatarFrameId }),
      ...(input.gender !== undefined && { gender: input.gender }),
      ...(input.birthday !== undefined && { birthday: input.birthday }),
    }),

  sendBindPhoneCode: (phone: string): Promise<Result<{ ok: boolean }>> =>
    ApiClient.post<{ ok: boolean }>('/me/bind-phone/sms/code', { phone }),

  bindPhone: (phone: string, code: string): Promise<Result<{ ok: boolean }>> =>
    ApiClient.post<{ ok: boolean }>('/me/bind-phone', { phone, code }),

  async uploadAvatar(filePath: string): Promise<Result<AvatarUploadResult>> {
    const result = await ApiClient.uploadFile<unknown>('/upload', {
      filePath,
      name: 'file',
      params: { folder: 'avatars' },
    });
    if (!result.ok) return result;
    return normalizeAvatarUpload(result.data);
  },
};
