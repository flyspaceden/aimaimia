import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getReferralInviterLabel,
  hasBoundReferralInviter,
} from '../../src/utils/referralRelation.ts'

test('referral relation treats inviterUserId as bound even when display fields are empty', () => {
  const member = {
    inviterUserId: 'vip-inviter',
    inviter: {
      userId: 'vip-inviter',
      nickname: null,
      maskedPhone: null,
    },
  }

  assert.equal(hasBoundReferralInviter(member), true)
  assert.equal(getReferralInviterLabel(member), '已绑定用户')
})

test('referral relation prefers nickname then masked phone', () => {
  assert.equal(
    getReferralInviterLabel({
      inviterUserId: 'vip-inviter',
      inviter: { userId: 'vip-inviter', nickname: '张三', maskedPhone: '138****5678' },
    }),
    '张三',
  )
  assert.equal(
    getReferralInviterLabel({
      inviterUserId: 'vip-inviter',
      inviter: { userId: 'vip-inviter', nickname: null, maskedPhone: '138****5678' },
    }),
    '138****5678',
  )
})

test('referral relation is unbound when both inviter object and inviterUserId are absent', () => {
  assert.equal(hasBoundReferralInviter({ inviterUserId: null, inviter: null }), false)
  assert.equal(getReferralInviterLabel({ inviterUserId: null, inviter: null }), null)
})
