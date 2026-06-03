import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMeReferralToolEntry,
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

test('my page referral entry uses VIP code label only for VIP users with referral code', () => {
  assert.deepEqual(buildMeReferralToolEntry({ tier: 'VIP', referralCode: 'VIPCODE1' }), {
    label: '我的推荐码',
    icon: 'qrcode',
    route: '/me/referral',
  })

  assert.deepEqual(buildMeReferralToolEntry({ tier: 'VIP', referralCode: null }), {
    label: '推荐关系',
    icon: 'account-heart-outline',
    route: '/me/referral',
  })

  assert.deepEqual(buildMeReferralToolEntry({ tier: 'NORMAL', referralCode: null }), {
    label: '推荐关系',
    icon: 'account-heart-outline',
    route: '/me/referral',
  })
})
