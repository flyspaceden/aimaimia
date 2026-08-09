import { queryClient } from '@/query/client';
import { type AuthSession, type AuthSessionGuard, useAuthStore } from '@/store/auth';

type PrivateStateReset = () => void;

const privateStateResets = new Set<PrivateStateReset>();

/** Phase 1 后的购物车、地址草稿等私有 Store 必须在此注册退出清理。 */
export function registerPrivateStateReset(reset: PrivateStateReset): () => void {
  privateStateResets.add(reset);
  return () => privateStateResets.delete(reset);
}

function clearPrivateClientState(): void {
  queryClient.clear();
  privateStateResets.forEach((reset) => {
    try {
      reset();
    } catch (error) {
      // 一个 Store 清理失败不能阻止其余账号私有状态被清除。
      console.error('private state reset failed', error);
    }
  });
}

/** 只接受服务端签发的可信会话；跨账号时先清空旧账号的全部客户端私有状态。 */
export function replaceTrustedSession(session: AuthSession): void {
  const currentUserId = useAuthStore.getState().userId;
  if (currentUserId && currentUserId !== session.userId) clearPrivateClientState();
  useAuthStore.getState().setSession(session);
}

export function logoutAndClearClientState(): void {
  useAuthStore.getState().clearSession();
  clearPrivateClientState();
}

export function logoutAndClearClientStateIfCurrent(guard: AuthSessionGuard): boolean {
  const cleared = useAuthStore.getState().clearSessionIfCurrent(guard);
  if (cleared) clearPrivateClientState();
  return cleared;
}
