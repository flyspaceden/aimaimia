import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('WeChat privacy authorization component contract', () => {
  it('resolves agreement only from the official privacy button event', () => {
    const source = readFileSync(
      new URL('../src/components/privacy-authorization/index.tsx', import.meta.url),
      'utf8',
    );
    const agreeButton = source.match(/<Button[\s\S]*?id=\{MINIAPP_PRIVACY_AGREE_BUTTON_ID\}[\s\S]*?>同意并继续<\/Button>/)?.[0];

    expect(agreeButton).toContain("openType='agreePrivacyAuthorization'");
    expect(agreeButton).toContain("onAgreePrivacyAuthorization={() => decide('agree')}");
    expect(agreeButton).not.toContain("onClick={() => decide('agree')}");
  });
});
