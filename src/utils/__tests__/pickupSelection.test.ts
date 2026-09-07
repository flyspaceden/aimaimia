import { buildPickupFulfillment, isPickupRecipientValid, pickupPointsAvailable, pickupSelectionsComplete, reconcilePickupSelections } from '../pickupSelection';
import type { PickupPointGroup } from '../../types/domain/Fulfillment';
const groups = [
  { companyId: 'a', companyName: 'A', points: [{ id: 'hub' }, { id: 'a-point' }] },
  { companyId: 'b', companyName: 'B', points: [{ id: 'hub' }] },
] as PickupPointGroup[];
test('requires every merchant, and accepts a shared authorized hub without merging selections', () => {
  expect(pickupPointsAvailable(groups, ['a', 'b'])).toBe(true);
  expect(pickupSelectionsComplete(groups, { a: 'hub' }, ['a', 'b'])).toBe(false);
  expect(buildPickupFulfillment(' 张三 ', '13812345678', { a: 'hub', b: 'hub' }, ['a', 'b'])).toEqual({ mode: 'PICKUP', recipientName: '张三', recipientPhone: '13812345678', selections: [{ companyId: 'a', pickupPointId: 'hub' }, { companyId: 'b', pickupPointId: 'hub' }] });
});
test('removed merchants and revoked authorization never fall back to a different point', () => {
  expect(reconcilePickupSelections(groups, { a: 'revoked', b: 'hub', c: 'old' }, ['a'])).toEqual({});
  expect(pickupSelectionsComplete(groups, { a: 'revoked' }, ['a'])).toBe(false);
  expect(pickupPointsAvailable(groups, ['a', 'missing'])).toBe(false);
  expect(pickupPointsAvailable(groups, [])).toBe(false);
});
test('validates recipient using miniapp mainland-mobile rules', () => {
  expect(isPickupRecipientValid(' 张三 ', '13812345678')).toBe(true);
  expect(isPickupRecipientValid('张', '13812345678')).toBe(false);
  expect(isPickupRecipientValid('张三', '12812345678')).toBe(false);
});
