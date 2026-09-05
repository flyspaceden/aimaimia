import { AdminVisualAgentClientController } from './admin-visual-agent-client.controller';

describe('AdminVisualAgentClientController', () => {
  it('provisions a client without issuing a raw key as a side effect', async () => {
    const clientKeys = { provisionClient: jest.fn().mockResolvedValue({ id: 'restaurant-client' }) };
    const controller = new AdminVisualAgentClientController(clientKeys as any);
    const dto = {
      tenantId: 'restaurant-tenant', tenantName: '华海餐厅', clientId: 'restaurant-client', clientName: '菜单图片',
      adapterNamespace: 'restaurant-menu', allowedAdapterTypes: ['restaurant-menu-v1'],
    };

    await expect(controller.provision(dto)).resolves.toEqual({ id: 'restaurant-client' });
    expect(clientKeys.provisionClient).toHaveBeenCalledWith(dto);
  });

  it('forwards a one-time key issue with no-store-compatible date conversion', async () => {
    const clientKeys = { issueKey: jest.fn().mockResolvedValue({ key: 'vag_live_redacted', record: { id: 'key-1' } }) };
    const controller = new AdminVisualAgentClientController(clientKeys as any);

    await expect(controller.issueKey('restaurant-client', { environment: 'live', expiresAt: '2026-09-01T00:00:00.000Z' }, 'admin-1'))
      .resolves.toEqual({ key: 'vag_live_redacted', record: { id: 'key-1' } });
    expect(clientKeys.issueKey).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'restaurant-client', environment: 'live', issuedByOperatorId: 'admin-1', expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    }));
  });

  it('scopes a revoke to the admin-selected client and returns no secret material', async () => {
    const clientKeys = { revokeKey: jest.fn().mockResolvedValue(undefined) };
    const controller = new AdminVisualAgentClientController(clientKeys as any);

    await expect(controller.revokeKey('restaurant-client', 'key-1')).resolves.toEqual({ revoked: true });
    expect(clientKeys.revokeKey).toHaveBeenCalledWith('restaurant-client', 'key-1');
  });
});
