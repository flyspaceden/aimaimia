import test from 'node:test'
import assert from 'node:assert/strict'

import {
  REFERRAL_LANDING_TARGET,
  getReferralLandingNotice,
} from '../../src/services/referralLanding.ts'

test('referral landing routes back to buyer home', () => {
  assert.equal(REFERRAL_LANDING_TARGET, '/(tabs)/home')
})

test('logged-in referral landing shows bound notice for 2 seconds', () => {
  assert.deepEqual(getReferralLandingNotice(true), {
    message: '推荐码已绑定',
    type: 'success',
    duration: 2000,
  })
})

test('logged-out referral landing shows recorded notice for 2 seconds', () => {
  assert.deepEqual(getReferralLandingNotice(false), {
    message: '推荐码已记录',
    type: 'success',
    duration: 2000,
  })
})
