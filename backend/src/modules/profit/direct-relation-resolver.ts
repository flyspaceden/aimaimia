import { Prisma } from '@prisma/client';

export type DirectRelationSource = 'MEMBER_PROFILE' | 'NORMAL_SHARE_BINDING' | 'NONE';
export type DirectRelationSourceCodeType = 'NORMAL_SHARE_CODE' | 'MEMBER_REFERRAL_CODE';

export interface DirectRelationResolution {
  inviterUserId: string | null;
  sourceRelation: DirectRelationSource;
  normalShareBindingId?: string;
  relationStatus?: string;
  sourceCode?: string | null;
  sourceCodeType?: DirectRelationSourceCodeType | null;
  platformReason?: string;
}

export async function resolveDirectRelation(
  tx: Prisma.TransactionClient,
  inviteeUserId: string,
  memberProfileInviterUserId: string | null,
  memberProfileMissing = false,
): Promise<DirectRelationResolution> {
  if (memberProfileMissing) {
    return {
      inviterUserId: null,
      sourceRelation: 'NONE',
      platformReason: 'NO_MEMBER_PROFILE',
    };
  }

  const binding = await tx.normalShareBinding.findUnique({
    where: { inviteeUserId },
    select: {
      id: true,
      code: true,
      inviterUserId: true,
      relationStatus: true,
      effectiveInviterUserId: true,
    },
  });

  if (memberProfileInviterUserId) {
    if (
      binding
      && binding.inviterUserId === memberProfileInviterUserId
      && binding.relationStatus !== 'ACTIVE'
      && binding.relationStatus !== 'SUPERSEDED_BY_VIP_TREE'
    ) {
      return {
        inviterUserId: null,
        sourceRelation: 'NORMAL_SHARE_BINDING',
        normalShareBindingId: binding.id,
        relationStatus: binding.relationStatus,
        sourceCode: binding.code,
        sourceCodeType: 'NORMAL_SHARE_CODE',
        platformReason: 'DIRECT_RELATION_NOT_ACTIVE',
      };
    }

    return {
      inviterUserId: memberProfileInviterUserId,
      sourceRelation: 'MEMBER_PROFILE',
      normalShareBindingId: binding?.id,
      relationStatus: binding?.relationStatus,
      sourceCode: binding?.code ?? null,
      sourceCodeType: binding?.code ? 'NORMAL_SHARE_CODE' : null,
    };
  }

  if (!binding) {
    return {
      inviterUserId: null,
      sourceRelation: 'NONE',
      platformReason: 'NO_DIRECT_INVITER',
    };
  }

  if (binding.relationStatus !== 'ACTIVE') {
    return {
      inviterUserId: null,
      sourceRelation: 'NORMAL_SHARE_BINDING',
      normalShareBindingId: binding.id,
      relationStatus: binding.relationStatus,
      sourceCode: binding.code,
      sourceCodeType: 'NORMAL_SHARE_CODE',
      platformReason: 'DIRECT_RELATION_NOT_ACTIVE',
    };
  }

  if (!binding.effectiveInviterUserId) {
    return {
      inviterUserId: null,
      sourceRelation: 'NORMAL_SHARE_BINDING',
      normalShareBindingId: binding.id,
      relationStatus: binding.relationStatus,
      sourceCode: binding.code,
      sourceCodeType: 'NORMAL_SHARE_CODE',
      platformReason: 'DIRECT_RELATION_NO_EFFECTIVE_INVITER',
    };
  }

  return {
    inviterUserId: binding.effectiveInviterUserId,
    sourceRelation: 'NORMAL_SHARE_BINDING',
    normalShareBindingId: binding.id,
    relationStatus: binding.relationStatus,
    sourceCode: binding.code,
    sourceCodeType: 'NORMAL_SHARE_CODE',
  };
}
