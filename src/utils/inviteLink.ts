const INVITE_H5_BASE_URL = 'https://app.ai-maimai.com/invite';

type InviteBindResultLike = {
  ok?: boolean;
  error?: {
    retryable?: boolean;
    displayMessage?: string;
    message?: string;
  };
};

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

export function buildInviteH5Url(code: string): string {
  return `${INVITE_H5_BASE_URL}/${normalizeInviteCode(code)}`;
}

export function extractUnifiedInviteCodeFromURL(url: string): string | null {
  const match = url.match(/app\.(ai-maimai|xn--ckqa175y)\.com\/invite\/([A-Za-z0-9]{8})/);
  return match ? match[2].toUpperCase() : null;
}

function bindErrorMessage(result: InviteBindResultLike): string {
  return `${result.error?.displayMessage ?? ''}${result.error?.message ?? ''}`;
}

export function shouldTryVipReferralAfterNormalResult(result: InviteBindResultLike): boolean {
  if (result.ok || result.error?.retryable) return false;
  return bindErrorMessage(result).includes('普通分享码无效');
}

export function shouldTryNormalShareAfterVipResult(result: InviteBindResultLike): boolean {
  if (result.ok || result.error?.retryable) return false;
  return bindErrorMessage(result).includes('推荐码无效');
}
