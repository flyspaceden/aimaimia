import {
  drainQueueRewardBellEvents,
} from '../queueRewardBellDrain';

describe('drainQueueRewardBellEvents', () => {
  const firstCursor = {
    createdAt: '2026-07-28T00:00:00.000Z',
    id: '',
  };
  const messages = [
    {
      id: 'message-1',
      type: 'queueReward.available',
      category: 'wallet',
      title: '到账1',
      content: '到账1',
      createdAt: '2026-07-28T00:00:01.000Z',
      unread: true,
      metadata: { ring: true },
    },
    {
      id: 'message-2',
      type: 'queueReward.available',
      category: 'wallet',
      title: '到账2',
      content: '到账2',
      createdAt: '2026-07-28T00:00:02.000Z',
      unread: true,
      metadata: { ring: true },
    },
  ] as any[];

  it('persists each cursor only after that bell succeeds', async () => {
    const saved: any[] = [];
    const playOne = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('audio down'));

    await expect(
      drainQueueRewardBellEvents({
        cursor: firstCursor,
        fetchPage: jest.fn().mockResolvedValue({
          items: messages,
          nextCursor: {
            createdAt: messages[1].createdAt,
            id: messages[1].id,
          },
          hasMore: false,
        }),
        playOne,
        saveCursor: async (cursor) => {
          saved.push(cursor);
        },
        shouldStop: () => false,
      }),
    ).rejects.toThrow('audio down');

    expect(saved).toEqual([
      {
        createdAt: messages[0].createdAt,
        id: messages[0].id,
      },
    ]);
  });

  it('continues through cursor pages without an arbitrary page ceiling', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({
        items: [messages[0]],
        nextCursor: {
          createdAt: messages[0].createdAt,
          id: messages[0].id,
        },
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [messages[1]],
        nextCursor: {
          createdAt: messages[1].createdAt,
          id: messages[1].id,
        },
        hasMore: false,
      });

    await expect(
      drainQueueRewardBellEvents({
        cursor: firstCursor,
        fetchPage,
        playOne: jest.fn().mockResolvedValue(undefined),
        saveCursor: jest.fn().mockResolvedValue(undefined),
        shouldStop: () => false,
      }),
    ).resolves.toEqual({
      createdAt: messages[1].createdAt,
      id: messages[1].id,
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
