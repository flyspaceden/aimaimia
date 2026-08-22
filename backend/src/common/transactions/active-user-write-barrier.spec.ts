import { ConflictException } from '@nestjs/common';
import {
  acquireUserWriteLock,
  assertActiveUserWriteBarrier,
} from './active-user-write-barrier';

describe('active user write barrier', () => {
  it('acquires the shared advisory lock before reading the current user row FOR UPDATE', async () => {
    const calls: string[] = [];
    const tx: any = {
      $executeRaw: jest.fn(async () => {
        calls.push('advisory');
        return 1;
      }),
      $queryRaw: jest.fn(async () => {
        calls.push('user-for-update');
        return [{ status: 'ACTIVE', deletionExecutedAt: null }];
      }),
    };

    await expect(assertActiveUserWriteBarrier(tx, 'user-1')).resolves.toBeUndefined();
    expect(calls).toEqual(['advisory', 'user-for-update']);
    expect(tx.$executeRaw.mock.calls[0][1]).toBe('AD-user-1');
  });

  it('uses the exact same AD namespace as account deletion', async () => {
    const tx: any = { $executeRaw: jest.fn().mockResolvedValue(1) };
    await acquireUserWriteLock(tx, 'user-1');
    await acquireUserWriteLock(tx, 'user-1');
    expect(tx.$executeRaw.mock.calls.map((call: any[]) => call[1])).toEqual([
      'AD-user-1',
      'AD-user-1',
    ]);
  });

  it('fails closed when the locked user row is no longer active', async () => {
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{
        status: 'DELETED',
        deletionExecutedAt: new Date(),
      }]),
    };

    await expect(assertActiveUserWriteBarrier(tx, 'user-1'))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
