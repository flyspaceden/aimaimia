import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) => fs.readFileSync(
  path.resolve(process.cwd(), relativePath),
  'utf8',
);

describe('mini-program WeChat-first authentication boundary', () => {
  it('starts from one WeChat action and only offers phone verification after an unmatched identity chooses account merge', () => {
    const page = readSource('src/packages/account/account-login/index.tsx');

    expect(page).toContain('微信登录');
    expect(page).toContain('loginWithWechatMiniProgram');
    expect(page).not.toMatch(/一个微信身份|无需填写手机号|account-login-benefit/);
    expect(page).not.toMatch(/验证码登录|密码登录|loginWithPhone|registerWithPhone/);
    expect(page).toContain('requiresAccountChoice');
    expect(page).toContain('合并已有手机号账号');
    expect(page).toContain('pendingTicket');
  });

  it('does not ship phone login or registration, but supports an explicit one-time merge ticket', () => {
    const adapter = readSource('src/platform/auth.ts');

    expect(adapter).not.toContain("ApiClient.post<MiniappSession>('/auth/login'");
    expect(adapter).not.toContain("ApiClient.post<MiniappSession>('/auth/register'");
    expect(adapter).toContain('/auth/oauth/wechat-miniapp/bind-phone');
    expect(adapter).toContain('PendingMiniappAccountChoice');
    expect(adapter).not.toContain('bindRequired');
  });

  it('guards every account-choice action against double submit and late session replacement', () => {
    const page = readSource('src/packages/account/account-login/index.tsx');
    const adapter = readSource('src/platform/auth.ts');

    expect(page).toContain('if (submitting || !pendingTicket) return;');
    expect(page).toContain('if (submitting || countdown > 0 || !pendingTicket) return;');
    expect(page).toContain('disabled={submitting}');
    expect(page).toContain('disabled={submitting || countdown > 0}');
    expect(page).toContain('supersedePendingMiniappAuthAttempts');
    expect(adapter.match(/const attempt = beginAuthAttempt\(\)/g)).toHaveLength(3);
    expect(adapter).toContain('return persistSession(result, attempt)');
  });

  it('does not expose an empty native authorization page as an account setting', () => {
    const settings = readSource('src/packages/settings/index/index.tsx');

    expect(settings).not.toContain('微信授权说明');
    expect(settings).not.toContain('openWechatSettings');
    expect(settings).not.toContain('Taro.openSetting');
  });
});
