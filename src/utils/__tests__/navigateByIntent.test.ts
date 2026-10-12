import { resolveIntent } from '../navigateByIntent';
import { OrderRepo } from '../../repos/OrderRepo';
import type { AiVoiceIntent } from '../../types/domain/Ai';

jest.mock('../../repos/OrderRepo', () => ({ OrderRepo: { list: jest.fn(), getPendingCheckout: jest.fn(), getLatestIssue: jest.fn() } }));
jest.mock('../../repos/CompanyRepo', () => ({ CompanyRepo: { list: jest.fn() } }));
const pending: AiVoiceIntent = { type: 'transaction', transcript: '查待发货订单', feedback: '查看待发货订单',
  transaction: { action: 'view-order', status: 'pendingShip' }, resolved: { transactionAction: 'view-order', transactionStatus: 'pendingShip' } };
const loggedIn = { isLoggedIn: true, cartCount: 0, selectedCartCount: 0 };

beforeEach(() => jest.clearAllMocks());
describe('App voice transaction compatibility', () => {
  it('uses the existing PAID filter for pending-shipment voice intents', async () => {
    expect(await resolveIntent(pending, loggedIn)).toMatchObject({ action: 'navigate', route: '/orders', params: { status: 'PAID' } });
    expect(OrderRepo.list).not.toHaveBeenCalled();
  });

  it('still requires login before showing pending-shipment orders', async () => {
    expect(await resolveIntent(pending, { ...loggedIn, isLoggedIn: false })).toMatchObject({ action: 'feedback', needsAuth: true });
    expect(OrderRepo.list).not.toHaveBeenCalled();
  });

  it('preserves the actual logistics route for shipped orders', async () => {
    (OrderRepo.list as jest.Mock).mockResolvedValue({ ok: true, data: { items: [{ id: 'shipped', status: 'SHIPPED' }] } });
    expect(await resolveIntent({ ...pending, transaction: { action: 'track-order', status: 'shipping' },
      resolved: { transactionAction: 'track-order', transactionStatus: 'shipping' } }, loggedIn))
      .toMatchObject({ action: 'navigate', route: '/orders/track', params: { orderId: 'shipped' } });
  });
});
