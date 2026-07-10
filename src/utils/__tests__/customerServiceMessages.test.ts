import { mergeCustomerServiceMessages } from '../customerServiceMessages';
import type { CsMessage } from '../../types';

function message(id: string, content: string, createdAt: string, status?: 'sending' | 'failed') {
  return {
    id,
    sessionId: 'session-1',
    senderType: 'USER',
    contentType: 'TEXT',
    content,
    createdAt,
    ...(status ? { _status: status } : {}),
  } as CsMessage;
}

describe('mergeCustomerServiceMessages', () => {
  it('较旧的轮询响应不会删除刚通过 Socket 收到的持久化消息', () => {
    const previous = [
      message('m1', '第一条', '2026-07-10T10:00:00.000Z'),
      message('m2', 'Socket 新消息', '2026-07-10T10:00:02.000Z'),
    ];
    const staleServer = [message('m1', '第一条', '2026-07-10T10:00:00.000Z')];

    expect(mergeCustomerServiceMessages(previous, staleServer).map((item) => item.id))
      .toEqual(['m1', 'm2']);
  });

  it('服务器出现内容和时间相近的对应消息后移除 sending 占位', () => {
    const previous = [message('local-1', '你好', '2026-07-10T10:00:00.000Z', 'sending')];
    const server = [message('server-1', '你好', '2026-07-10T10:00:03.000Z')];

    expect(mergeCustomerServiceMessages(previous, server).map((item) => item.id))
      .toEqual(['server-1']);
  });

  it('保留失败消息供用户重发', () => {
    const failed = message('local-failed', '请重试', '2026-07-10T10:00:00.000Z', 'failed');

    expect(mergeCustomerServiceMessages([failed], [])).toEqual([failed]);
  });

  it('发送已落库但 HTTP 响应丢失时，用服务器消息替换 failed 占位', () => {
    const failed = message('local-failed', '已收到吗', '2026-07-10T10:00:00.000Z', 'failed');
    const persisted = message('server-1', '已收到吗', '2026-07-10T10:00:04.000Z');

    expect(mergeCustomerServiceMessages([failed], [persisted]).map((item) => item.id))
      .toEqual(['server-1']);
  });
});
