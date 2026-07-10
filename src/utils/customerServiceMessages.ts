import type { CsMessage } from '../types';

type LocalCsMessage = CsMessage & { _status?: 'sending' | 'sent' | 'failed' };

export function sortCustomerServiceMessages(messages: CsMessage[]): CsMessage[] {
  return [...messages].sort((a, b) => {
    const timeDifference = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return timeDifference !== 0 ? timeDifference : a.id.localeCompare(b.id);
  });
}

function hasPersistedCounterpart(local: LocalCsMessage, serverMessages: CsMessage[]): boolean {
  if (local._status !== 'sending' && local._status !== 'failed') return false;
  return serverMessages.some((serverMessage) => (
    serverMessage.senderType === 'USER'
    && serverMessage.content === local.content
    && Math.abs(
      new Date(serverMessage.createdAt).getTime() - new Date(local.createdAt).getTime(),
    ) < 15_000
  ));
}

/** Merge an HTTP snapshot without letting an older response remove newer Socket/local messages. */
export function mergeCustomerServiceMessages(
  previousMessages: CsMessage[],
  serverMessages: CsMessage[],
): CsMessage[] {
  const merged = new Map<string, CsMessage>();
  for (const message of serverMessages) merged.set(message.id, message);

  for (const previousMessage of previousMessages as LocalCsMessage[]) {
    if (merged.has(previousMessage.id)) continue;
    if (hasPersistedCounterpart(previousMessage, serverMessages)) continue;
    merged.set(previousMessage.id, previousMessage);
  }

  return sortCustomerServiceMessages(Array.from(merged.values()));
}
