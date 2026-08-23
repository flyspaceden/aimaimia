import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('mini program lifecycle integration', () => {
  it('maps app visibility to TanStack Query focus state', () => {
    const app = source('src/app.tsx');

    expect(app).toContain('useDidShow(() => focusManager.setFocused(true))');
    expect(app).toContain('useDidHide(() => focusManager.setFocused(false))');
    expect(app).toContain('<MiniappPrivacyAuthorization />');
  });

  it('pauses customer service sockets and read receipts while the page is hidden', () => {
    const chat = source('src/packages/customer-service/chat/index.tsx');

    expect(chat).toContain('useDidHide(() =>');
    expect(chat).toContain('useDidShow(() =>');
    expect(chat).toContain('useUnload(() =>');
    expect(chat).toContain('socketRef.current?.disconnect()');
    expect(chat).toContain('if (!pageVisible || !accessToken || !sessionId || closed) return;');
    expect(chat).toContain("normalized.senderType !== 'USER' && pageVisibleRef.current");
    expect(chat).toContain('refetchInterval: pageVisible && !socketJoined ? 5_000 : false');
  });
});
