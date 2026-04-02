import { appQueryClient } from '../queryClient';
import { useAuthStore } from '../store/useAuthStore';

export function logoutAndClearClientState() {
  useAuthStore.getState().logout();
  appQueryClient.clear();
}
