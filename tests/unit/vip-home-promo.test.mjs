import test from 'node:test'
import assert from 'node:assert/strict'

import { buildVipHomePromoCards, buildVipReferralHomePrompt } from '../../src/utils/vipHomePromo.ts'

const teaGift = {
  id: 'gift-tea',
  title: '有机茶叶礼盒',
  subtitle: '精选高山绿茶，适合日常自饮和送礼',
  badge: '热门',
  coverMode: 'AUTO_GRID',
  coverUrl: null,
  totalPrice: 128,
  available: true,
  items: [
    { skuId: 'sku-tea-1', productTitle: '高山绿茶', productImage: null, skuTitle: '250g装', price: 68, quantity: 1 },
    { skuId: 'sku-tea-2', productTitle: '铁观音', productImage: null, skuTitle: '200g装', price: 60, quantity: 1 },
  ],
}

test('builds VIP home promo cards from package gift combinations', () => {
  const cards = buildVipHomePromoCards([
    {
      id: 'pkg-399',
      price: 399,
      sortOrder: 0,
      giftOptions: [teaGift],
    },
  ])

  assert.deepEqual(cards, [
    {
      packageId: 'pkg-399',
      giftOptionId: 'gift-tea',
      price: 399,
      title: '有机茶叶礼盒',
      subtitle: '精选高山绿茶，适合日常自饮和送礼',
      badge: '热门',
      totalPrice: 128,
      giftCount: 1,
      available: true,
      itemLines: ['高山绿茶 250g装 ×1', '铁观音 200g装 ×1'],
      hasMoreItems: false,
    },
  ])
})

test('uses the first available gift option and excludes packages without available gifts', () => {
  const cards = buildVipHomePromoCards([
    {
      id: 'pkg-empty',
      price: 199,
      sortOrder: 0,
      giftOptions: [],
    },
    {
      id: 'pkg-unavailable',
      price: 399,
      sortOrder: 0,
      giftOptions: [
        { ...teaGift, id: 'gift-unavailable', available: false, title: '缺货礼盒' },
      ],
    },
    {
      id: 'pkg-699',
      price: 699,
      sortOrder: 1,
      giftOptions: [
        { ...teaGift, id: 'gift-sold-out', available: false, title: '售罄礼盒' },
        {
          ...teaGift,
          id: 'gift-honey',
          available: true,
          title: '农家蜂蜜套装',
          subtitle: null,
          badge: null,
          totalPrice: 198,
          items: [
            { skuId: 'sku-honey-1', productTitle: '百花蜜', productImage: null, skuTitle: '500g', price: 49.5, quantity: 2 },
            { skuId: 'sku-honey-2', productTitle: '蜂巢蜜试吃装', productImage: null, skuTitle: '', price: 99, quantity: 1 },
            { skuId: 'sku-box', productTitle: '礼盒包装', productImage: null, skuTitle: '', price: 0, quantity: 1 },
          ],
        },
      ],
    },
  ], { maxItemLines: 2 })

  assert.equal(cards.length, 1)
  assert.equal(cards[0].giftOptionId, 'gift-honey')
  assert.equal(cards[0].subtitle, '百花蜜 500g ×2 + 蜂巢蜜试吃装 ×1等')
  assert.deepEqual(cards[0].itemLines, ['百花蜜 500g ×2', '蜂巢蜜试吃装 ×1'])
  assert.equal(cards[0].hasMoreItems, true)
  assert.equal(cards[0].giftCount, 2)
})

test('builds VIP referral home prompt only for VIP users with referral code', () => {
  assert.deepEqual(
    buildVipReferralHomePrompt({ tier: 'VIP', referralCode: 'LQHE2025' }),
    {
      title: '推荐好友开通 VIP，有高额奖励',
      actionLabel: '去分享',
      targetPath: '/me/referral',
    },
  )

  assert.equal(buildVipReferralHomePrompt({ tier: 'NORMAL', referralCode: 'NORMAL01' }), null)
  assert.equal(buildVipReferralHomePrompt({ tier: 'VIP', referralCode: '' }), null)
  assert.equal(buildVipReferralHomePrompt(null), null)
})
