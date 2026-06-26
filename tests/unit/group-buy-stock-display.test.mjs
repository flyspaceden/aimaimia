import test from 'node:test'
import assert from 'node:assert/strict'

import { getGroupBuyLowStockText } from '../../src/utils/groupBuyStockDisplay.ts'

test('shows group-buy item stock only below the low-stock threshold', () => {
  assert.equal(getGroupBuyLowStockText(0), '库存 0')
  assert.equal(getGroupBuyLowStockText(7), '库存 7')
  assert.equal(getGroupBuyLowStockText(9), '库存 9')
  assert.equal(getGroupBuyLowStockText(10), null)
  assert.equal(getGroupBuyLowStockText(11), null)
})

test('normalizes invalid stock snapshots before rendering', () => {
  assert.equal(getGroupBuyLowStockText(-3), '库存 0')
  assert.equal(getGroupBuyLowStockText(undefined), null)
  assert.equal(getGroupBuyLowStockText(null), null)
})
