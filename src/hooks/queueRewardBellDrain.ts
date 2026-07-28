import type {
  QueueRewardBellCursor,
  QueueRewardBellPage,
} from '../repos/InboxRepo';

export async function drainQueueRewardBellEvents(input: {
  cursor: QueueRewardBellCursor;
  fetchPage: (
    cursor: QueueRewardBellCursor,
  ) => Promise<QueueRewardBellPage>;
  playOne: () => Promise<void>;
  saveCursor: (
    cursor: QueueRewardBellCursor,
  ) => Promise<void>;
  shouldStop: () => boolean;
}): Promise<QueueRewardBellCursor> {
  let cursor = input.cursor;
  while (!input.shouldStop()) {
    const page = await input.fetchPage(cursor);
    if (page.items.length === 0) return cursor;

    for (const message of page.items) {
      if (input.shouldStop()) return cursor;
      if (
        message.metadata?.ring !== true ||
        message.type !== 'queueReward.available'
      ) {
        cursor = {
          createdAt: message.createdAt,
          id: message.id,
        };
        await input.saveCursor(cursor);
        continue;
      }
      // 只有铃声实际启动并完成短播放间隔后才确认该条消息。
      // 播放失败时 cursor 不前移，App 下次启动会补响而不会永久漏掉。
      await input.playOne();
      cursor = {
        createdAt: message.createdAt,
        id: message.id,
      };
      await input.saveCursor(cursor);
    }

    if (!page.hasMore) return cursor;
  }
  return cursor;
}
