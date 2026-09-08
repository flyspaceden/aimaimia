/// <reference types="jest" />
jest.mock('../http/config', () => ({ USE_MOCK: false }));
jest.mock('../../mocks', () => ({ mockOrders: [] }));
jest.mock('../CartRepo', () => ({ CartRepo: {} }));
jest.mock('../InvoiceRepo', () => ({ getMockInvoiceForOrder: jest.fn() }));
jest.mock('../http/ApiClient', () => ({ ApiClient: { get: jest.fn(), post: jest.fn() } }));
import { OrderRepo } from '../OrderRepo';
import { ApiClient } from '../http/ApiClient';
import { reconcilePickupSelections } from '../../utils/pickupSelection';
import type { FulfillmentInput } from '../../types';
const fulfillment: FulfillmentInput = { mode: 'PICKUP', recipientName: '张三', recipientPhone: '13812345678', selections: [{ companyId: 'company', pickupPointId: 'hub' }] };
beforeEach(() => jest.clearAllMocks());
it('forwards pickup to the ordinary preview without requiring a delivery address', async () => {
  await OrderRepo.previewOrder({ items: [{ id: 'cart', productId: 'product', skuId: 'sku', title: '苹果', image: '', price: 2, quantity: 1 }], fulfillment });
  expect(ApiClient.post).toHaveBeenCalledWith('/orders/preview', expect.objectContaining({ fulfillment, addressId: undefined, items: [{ skuId: 'sku', quantity: 1, cartItemId: 'cart' }] }));
});
it.each(['alipay','wechat'])('ordinary and VIP creation preserve App payment channel %s with pickup', async (paymentChannel) => {
  await OrderRepo.createCheckoutSession({ items: [{ skuId: 'sku', quantity: 1 }], fulfillment, paymentChannel, idempotencyKey: 'ordinary' });
  await OrderRepo.createVipCheckoutSession({ packageId: 'package', giftOptionId: 'gift', fulfillment, paymentChannel, idempotencyKey: 'vip' });
  expect(ApiClient.post).toHaveBeenNthCalledWith(1, '/orders/checkout', expect.objectContaining({ fulfillment, paymentChannel, idempotencyKey: 'ordinary' }));
  expect(ApiClient.post).toHaveBeenNthCalledWith(2, '/orders/vip-checkout', expect.objectContaining({ fulfillment, paymentChannel, idempotencyKey: 'vip' }));
});
it('uses uncached pass and App VIP pending endpoints, never mini-program payment endpoints', async () => {
  await OrderRepo.getPickupPass('order/1');
  await OrderRepo.getPendingVipCheckout();
  expect(ApiClient.get).toHaveBeenNthCalledWith(1, '/orders/order%2F1/pickup-pass', undefined, { noCache: true });
  expect(ApiClient.get).toHaveBeenNthCalledWith(2, '/orders/vip-checkout/me/pending', undefined, { noCache: true });
});
it('keeps legacy delivery request intact', async () => {
  const payload = { items: [{ skuId: 'sku', quantity: 1 }], addressId: 'address', paymentChannel: 'alipay' };
  await OrderRepo.createCheckoutSession(payload);
  expect(ApiClient.post).toHaveBeenCalledWith('/orders/checkout', payload);
});

it('unwraps the real backend pickup items envelope before checkout reconciliation', async () => {
  const groups = [{ companyId: 'company', companyName: '商家', points: [{ id: 'hub', companyId: 'platform-company', name: '中心仓', regionText: '市区', detail: '门店', contactName: '店员', contactPhoneMasked: '138****0001', businessHours: {}, pickupNotice: null, kind: 'PLATFORM_HUB' }] }];
  (ApiClient.get as jest.Mock).mockResolvedValue({ ok: true, data: { items: groups } });
  const result = await OrderRepo.getPickupPoints(['company', 'company']);
  expect(result).toEqual({ ok: true, data: groups });
  expect(ApiClient.get).toHaveBeenCalledWith('/orders/pickup-points', { companyIds: 'company' }, { noCache: true });
  if (result.ok) expect(reconcilePickupSelections(result.data, { company: 'hub' }, ['company'])).toEqual({ company: 'hub' });
});
it.each([null, {}, [], { items: null }, { items: [null] }, { items: [{ companyId: 'c', companyName: '店', points: {} }] }, { items: [{ companyId: 'c', companyName: '店', points: [null] }] }])('returns a displayable error for malformed pickup response %j', async (data) => {
  (ApiClient.get as jest.Mock).mockResolvedValue({ ok: true, data });
  expect(await OrderRepo.getPickupPoints(['company'])).toEqual({ ok: false, error: expect.objectContaining({ code: 'INVALID', displayMessage: expect.any(String) }) });
});
it('preserves pickup API failure for retry UI', async () => {
  const failure = { ok: false, error: { code: 'NETWORK', message: 'offline', retryable: true } };
  (ApiClient.get as jest.Mock).mockResolvedValue(failure);
  expect(await OrderRepo.getPickupPoints(['company'])).toBe(failure);
});
