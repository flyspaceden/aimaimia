import type { CaptainApplicationStatus, ScanTarget } from './types';

const INVITE_CODE = /^[A-Z0-9]{8}$/;
const GROUP_BUY_CODE = /^[A-Z2-9]{10}$/;
const CAPTAIN_CODE = /^[A-Z0-9]{3,40}$/;
const ALLOWED_HOSTS = new Set(['app.ai-maimai.com', 'app.爱买买.com', 'app.xn--ckqa175y.com']);
const MINI_PROGRAM_SCENE_PATH = /^\/?packages\/community\/scene\/index\?scene=([A-Za-z0-9_-]{16,32})$/;

export function formatMoney(value?: number | null): string {
  return Number.isFinite(Number(value)) ? Number(value || 0).toFixed(2) : '0.00';
}

export function formatDate(value?: string): string {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '时间待确认';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function captainApplicationStatus(status?: CaptainApplicationStatus): { label: string; tone: string } {
  if (status === 'PENDING') return { label: '审核中', tone: 'pending' };
  if (status === 'APPROVED') return { label: '已通过', tone: 'success' };
  if (status === 'REJECTED') return { label: '未通过', tone: 'danger' };
  if (status === 'WITHDRAWN') return { label: '已撤回', tone: 'muted' };
  return { label: '未申请', tone: 'muted' };
}

function referralTarget(code: string, inviteKind?: 'normal' | 'vip'): ScanTarget {
  const kind = inviteKind || (code.startsWith('S') ? 'normal' : 'vip');
  return {
    kind: 'referral',
    code,
    inviteKind: kind,
    url: `/packages/referral/landing/index?code=${encodeURIComponent(code)}&kind=${kind}`,
  };
}

function groupBuyTarget(code: string): ScanTarget {
  return { kind: 'group-buy', code, url: `/packages/group-buy/activity-detail/index?shareCode=${encodeURIComponent(code)}` };
}

function captainTarget(code: string): ScanTarget {
  return { kind: 'captain', code, url: `/packages/community/captain-landing/index?code=${encodeURIComponent(code)}` };
}

export function parseScanTarget(raw?: string): ScanTarget | null {
  let input = raw?.trim() || '';
  if (!input || input.length > 512) return null;
  try {
    input = decodeURIComponent(input);
  } catch {
    return null;
  }

  const normalized = input.toUpperCase();
  if (INVITE_CODE.test(normalized)) return referralTarget(normalized);
  if (/^SEA[A-Z0-9]{0,37}$/.test(normalized) && CAPTAIN_CODE.test(normalized)) return captainTarget(normalized);
  if (GROUP_BUY_CODE.test(normalized)) return groupBuyTarget(normalized);

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => {
    try { return decodeURIComponent(segment); } catch { return ''; }
  });
  if (segments.length !== 2) return null;
  const route = segments[0].toLowerCase();
  const code = segments[1].trim().toUpperCase();
  if ((route === 'invite' || route === 'r' || route === 's') && INVITE_CODE.test(code)) {
    return referralTarget(code, route === 'r' ? 'vip' : route === 's' ? 'normal' : undefined);
  }
  if (route === 'gb' && GROUP_BUY_CODE.test(code)) return groupBuyTarget(code);
  if (route === 'c' && CAPTAIN_CODE.test(code)) return captainTarget(code);
  return null;
}

/**
 * 微信扫到当前小程序码时，业务入口位于 `result.path`。这里只允许平台签发的
 * scene 中转页，禁止把扫码结果当成任意内部路由直接打开。
 */
export function normalizeMiniProgramScanPath(raw?: string): string | null {
  const value = raw?.trim() || '';
  if (!value || value.length > 256 || /[\r\n]/.test(value)) return null;
  const match = MINI_PROGRAM_SCENE_PATH.exec(value);
  return match ? `/packages/community/scene/index?scene=${encodeURIComponent(match[1])}` : null;
}

export function authorSearchText(author: { name: string; title?: string; city?: string; tags?: string[]; interestTags?: string[] }): string {
  return [author.name, author.title, author.city, ...(author.tags || []), ...(author.interestTags || [])].filter(Boolean).join(' ').toLowerCase();
}
