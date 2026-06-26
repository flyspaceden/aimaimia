import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync('app/group-buy/[activityId].tsx', 'utf8');

test('group-buy detail removes purchasable-count copy from the price card', () => {
  assert.equal(source.includes('可购 {availableStock} 份'), false);
  assert.match(source, /下单前请确认收货地址/);
});

test('group-buy detail renders item stock only through low-stock display helper', () => {
  assert.equal(source.includes('{item.skuTitle} · 库存 {item.stock}'), false);
  assert.equal(source.includes('默认规格'), false);
  assert.match(source, /getGroupBuyLowStockText\(item\.stock\)/);
});
