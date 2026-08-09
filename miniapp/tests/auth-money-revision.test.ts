import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('money pages follow the authenticated account generation', () => {
  it('recovers VIP checkout from the server and rejects stale account results', () => {
    const vip = source('src/packages/benefits/vip-gifts/index.tsx');

    expect(vip).toContain('CheckoutRepo.getPendingVip()');
    expect(vip).toContain("created.error.code === 'PENDING_CHECKOUT_EXISTS'");
    expect(vip).toContain('current.revision === revisionAtStart');
    expect(vip).toContain('current.userId === userIdAtStart');
    expect(vip).toContain("setPendingSession(undefined)");
    expect(vip).toContain("checkoutKey.current = ''");
  });

  it('clears withdrawal state and scopes queries to auth revision and user', () => {
    const withdraw = source('src/packages/member/wechat-withdraw/index.tsx');

    expect(withdraw).toContain("['member', 'wallet', authRevision, userId]");
    expect(withdraw).toContain("['member', 'withdraw-history', authRevision, userId]");
    expect(withdraw).toContain("setAmount('')");
    expect(withdraw).toContain('setTrackedWithdrawId(undefined)');
    expect(withdraw).toContain('retainedKey.current = undefined');
    expect(withdraw).toContain('announcedTerminal.current = undefined');
    expect(withdraw).toContain('current.revision !== authRevision');
    expect(withdraw).toContain('current.userId !== userId');
  });
});
