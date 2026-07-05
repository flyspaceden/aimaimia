import {
  backfillDirectReferralRelationCandidates,
  runBackfillDirectReferralRelations,
} from './backfill-direct-referral-relations';

describe('backfill-direct-referral-relations script', () => {
  it('dry-runs by default while still reporting preview counts', async () => {
    const candidate = {
      id: 'binding-1',
      inviterUserId: 'inviter-1',
      inviteeUserId: 'invitee-1',
      relationStatus: 'ACTIVE',
      effectiveInviterUserId: null,
    };
    const deps = {
      getCandidates: jest.fn().mockResolvedValue([candidate]),
      backfillCandidates: jest.fn().mockResolvedValue({
        scanned: 1,
        memberProfilesCreated: 0,
        memberInvitersBackfilled: 1,
        memberInviterConflicts: 0,
        effectiveInvitersBackfilled: 1,
        skipped: 0,
        conflicts: [],
      }),
    };
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(runBackfillDirectReferralRelations({ execute: false, deps })).resolves.toMatchObject({
        execute: false,
        candidateCount: 1,
      });
    } finally {
      logSpy.mockRestore();
    }

    expect(deps.backfillCandidates).toHaveBeenCalledWith([candidate], expect.objectContaining({ execute: false }));
  });

  it('previews without writes when execute is false', async () => {
    const db = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'invitee-1', inviterUserId: null }),
        create: jest.fn(),
        update: jest.fn(),
      },
      normalShareBinding: {
        update: jest.fn(),
      },
    };

    await expect(
      backfillDirectReferralRelationCandidates(db as any, [
        {
          id: 'binding-1',
          inviterUserId: 'inviter-1',
          inviteeUserId: 'invitee-1',
          relationStatus: 'ACTIVE',
          effectiveInviterUserId: null,
        },
      ], { execute: false }),
    ).resolves.toMatchObject({
      scanned: 1,
      memberInvitersBackfilled: 1,
      effectiveInvitersBackfilled: 1,
      skipped: 0,
    });
    expect(db.memberProfile.update).not.toHaveBeenCalled();
    expect(db.normalShareBinding.update).not.toHaveBeenCalled();
  });

  it('creates missing member profile, backfills empty inviter, and fills active effective inviter when executing', async () => {
    const now = new Date('2026-07-05T00:00:00.000Z');
    const db = {
      memberProfile: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ userId: 'invitee-2', inviterUserId: null }),
        create: jest.fn().mockResolvedValue({ id: 'member-created' }),
        update: jest.fn().mockResolvedValue({ id: 'member-updated' }),
      },
      normalShareBinding: {
        update: jest.fn().mockResolvedValue({ id: 'binding-updated' }),
      },
    };

    await expect(
      backfillDirectReferralRelationCandidates(db as any, [
        {
          id: 'binding-1',
          inviterUserId: 'inviter-1',
          inviteeUserId: 'invitee-1',
          relationStatus: 'ACTIVE',
          effectiveInviterUserId: null,
        },
        {
          id: 'binding-2',
          inviterUserId: 'inviter-2',
          inviteeUserId: 'invitee-2',
          relationStatus: 'ACTIVE',
          effectiveInviterUserId: null,
        },
      ], { execute: true, now }),
    ).resolves.toMatchObject({
      scanned: 2,
      memberProfilesCreated: 1,
      memberInvitersBackfilled: 1,
      effectiveInvitersBackfilled: 2,
      skipped: 0,
    });

    expect(db.memberProfile.create).toHaveBeenCalledWith({
      data: {
        userId: 'invitee-1',
        inviterUserId: 'inviter-1',
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(db.memberProfile.update).toHaveBeenCalledWith({
      where: { userId: 'invitee-2' },
      data: { inviterUserId: 'inviter-2' },
    });
    expect(db.normalShareBinding.update).toHaveBeenCalledTimes(2);
  });

  it('reports conflicting member inviter without overwriting it', async () => {
    const db = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'invitee-1', inviterUserId: 'other-inviter' }),
        create: jest.fn(),
        update: jest.fn(),
      },
      normalShareBinding: {
        update: jest.fn(),
      },
    };

    await expect(
      backfillDirectReferralRelationCandidates(db as any, [
        {
          id: 'binding-1',
          inviterUserId: 'binding-inviter',
          inviteeUserId: 'invitee-1',
          relationStatus: 'ACTIVE',
          effectiveInviterUserId: 'binding-inviter',
        },
      ], { execute: true }),
    ).resolves.toMatchObject({
      scanned: 1,
      memberInviterConflicts: 1,
      conflicts: [
        {
          bindingId: 'binding-1',
          inviteeUserId: 'invitee-1',
          bindingInviterUserId: 'binding-inviter',
          memberInviterUserId: 'other-inviter',
        },
      ],
    });
    expect(db.memberProfile.update).not.toHaveBeenCalled();
    expect(db.normalShareBinding.update).not.toHaveBeenCalled();
  });
});
