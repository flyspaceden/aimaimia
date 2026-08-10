import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) => fs.readFileSync(
  path.resolve(process.cwd(), relativePath),
  'utf8',
);

describe('mini-program WeChat-only authentication boundary', () => {
  it('keeps the login page to one WeChat action without phone login or registration forms', () => {
    const page = readSource('src/packages/account/account-login/index.tsx');

    expect(page).toContain('微信一键登录');
    expect(page).toContain('loginWithWechatMiniProgram');
    expect(page).not.toMatch(/验证码登录|密码登录|请输入手机号|绑定你的手机号|loginWithPhone|registerWithPhone/);
    expect(page).not.toMatch(/import\s*\{[^}]*\bInput\b[^}]*\}\s*from '@tarojs\/components'/);
    expect(page).not.toContain('<Input');
  });

  it('does not ship phone login, phone registration, or forced bind-ticket handling in the miniapp auth adapter', () => {
    const adapter = readSource('src/platform/auth.ts');

    expect(adapter).not.toContain("ApiClient.post<MiniappSession>('/auth/login'");
    expect(adapter).not.toContain("ApiClient.post<MiniappSession>('/auth/register'");
    expect(adapter).not.toContain('/auth/oauth/wechat-miniapp/bind-phone');
    expect(adapter).not.toContain('bindRequired');
  });
});
