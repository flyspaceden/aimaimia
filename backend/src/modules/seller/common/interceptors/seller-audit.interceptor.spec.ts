import { lastValueFrom, of } from 'rxjs';
import { SellerAuditInterceptor } from './seller-audit.interceptor';
import { SELLER_AUDIT_KEY } from '../decorators/seller-audit.decorator';

describe('SellerAuditInterceptor', () => {
  it('records an order id returned by a credential resolver without reading the credential request body', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const reflector = {
      get: jest.fn().mockReturnValue({
        action: 'PICKUP_CREDENTIAL_RESOLVE',
        module: 'pickup',
        targetType: 'Order',
        targetIdResponseKey: 'orderId',
      }),
    };
    const interceptor = new SellerAuditInterceptor(
      reflector as any,
      { sellerAuditLog: { create } } as any,
    );
    const request = {
      user: { staffId: 'staff-1', companyId: 'company-1' },
      // A real request body contains the credential. The interceptor must not persist it.
      body: { qrPayload: 'AIMMPICKUP.1.sensitive.token.signature' },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest' },
    };
    const context = {
      getHandler: () => 'handler',
      switchToHttp: () => ({ getRequest: () => request }),
    };

    await lastValueFrom(interceptor.intercept(context as any, { handle: () => of({ orderId: 'order-1' }) } as any));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reflector.get).toHaveBeenCalledWith(SELLER_AUDIT_KEY, 'handler');
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        staffId: 'staff-1', companyId: 'company-1', targetType: 'Order', targetId: 'order-1',
      }),
    });
    expect(JSON.stringify(create.mock.calls)).not.toContain(request.body.qrPayload);
  });
});
