import { ApiClient } from '@/api/client';
import type {
  AccountDeletionExecuteInput,
  AccountDeletionExecuteResult,
  AccountDeletionPreview,
  Result,
} from '@/types';

export const AccountDeletionRepo = {
  preview: (): Promise<Result<AccountDeletionPreview>> =>
    ApiClient.get<AccountDeletionPreview>('/me/deletion/preview'),
  sendCode: (): Promise<Result<{ ok: boolean }>> =>
    ApiClient.post<{ ok: boolean }>('/me/deletion/sms-code'),
  execute: (input: AccountDeletionExecuteInput): Promise<Result<AccountDeletionExecuteResult>> =>
    ApiClient.post<AccountDeletionExecuteResult>('/me/deletion/execute', input),
};
