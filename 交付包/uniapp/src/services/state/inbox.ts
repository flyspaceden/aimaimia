// 消息未读数本地占位（前端）+ 后端对接接口说明
//
// 目标：
// - “我的”页右上角铃铛展示未读角标
// - 消息中心支持“全部已读/单条已读”（后端未接入前先本地模拟）
//
// 后端对接建议：
// - GET /inbox?type=&unreadOnly=&page=&pageSize=
// - POST /inbox/read { id }
// - POST /inbox/read-all
// - （可选）GET /inbox/unread-count
import { APP_EVENTS } from './events';
import { emitAppEvent } from './uniEvents';
import { InboxRepo } from '../repos';

const UNREAD_KEY = 'nm_inbox_unread_v1';

const readCount = () => Number(uni.getStorageSync(UNREAD_KEY) || 0) || 0;
const writeCount = (count: number) => {
  const next = Math.max(0, Math.floor(count));
  uni.setStorageSync(UNREAD_KEY, next);
  emitAppEvent(APP_EVENTS.INBOX_CHANGED, { unreadCount: next });
};

export const InboxState = {
  getUnreadCount: readCount,

  setUnreadCount: writeCount,

  // 从消息列表计算未读数（占位实现）
  async refreshUnreadCount() {
    // TODO(后端)：后端可提供 /inbox/unread-count，避免拉全量列表
    const res = await InboxRepo.list({ page: 1, pageSize: 50 });
    if (res.ok) {
      const count = res.data.items.filter((x) => x.unread).length;
      writeCount(count);
    }
  },
};

