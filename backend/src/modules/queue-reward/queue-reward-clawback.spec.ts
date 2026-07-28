import { pendingQueueClawbackCents } from './queue-reward-clawback';

describe('pendingQueueClawbackCents', () => {
  it('sums only the remaining global queue clawback debt in integer cents', () => {
    expect(
      pendingQueueClawbackCents([
        {
          amount: -10,
          meta: {
            scheme: 'GLOBAL_QUEUE_VOID',
            clawbackAmount: 6.23,
          },
        },
        {
          amount: -1.77,
          meta: { scheme: 'GLOBAL_QUEUE_VOID' },
        },
        {
          amount: -99,
          meta: { scheme: 'AFTER_SALE_REWARD_REVERSAL' },
        },
      ]),
    ).toBe(800);
  });

  it('rejects a sum outside the JavaScript safe integer range', () => {
    expect(() =>
      pendingQueueClawbackCents([
        {
          amount: 0,
          meta: {
            scheme: 'GLOBAL_QUEUE_VOID',
            clawbackAmount: Number.MAX_SAFE_INTEGER / 100,
          },
        },
        {
          amount: 0,
          meta: {
            scheme: 'GLOBAL_QUEUE_VOID',
            clawbackAmount: 1,
          },
        },
      ]),
    ).toThrow('safe cent range');
  });
});
