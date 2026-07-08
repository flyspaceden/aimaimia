const INVITE_H5_BASE_URL = 'https://app.ai-maimai.com/invite';

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
