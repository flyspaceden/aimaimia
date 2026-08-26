import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { VisualAgentClientKeyService } from './visual-agent-client-key.service';

const rawKey = `vag_live_abcdef123456_${'a'.repeat(43)}`;
const keyHash = createHash('sha256').update(rawKey).digest('hex');

function clientRecord() {
  return {
    id: 'restaurant-client', tenantId: 'restaurant-tenant', name: '餐厅菜单', adapterNamespace: 'restaurant-menu',
    allowedAdapterTypes: ['restaurant-menu-v1'], status: 'ACTIVE',
    tenant: { status: 'ACTIVE' },
  };
}

function build() {
  const tx = {
    visualAgentTenant: { upsert: jest.fn() },
    visualAgentClient: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(clientRecord()),
    },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    visualAgentClient: { findUnique: jest.fn().mockResolvedValue(clientRecord()) },
    visualAgentClientKey: {
      create: jest.fn().mockResolvedValue({
        id: 'key-1', clientId: 'restaurant-client', keyPrefix: 'vag_live_abcdef123456', status: 'ACTIVE',
        expiresAt: null, lastUsedAt: null, revokedAt: null, createdAt: new Date(),
      }),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { service: new VisualAgentClientKeyService(prisma as any), prisma, tx };
}

describe('VisualAgentClientKeyService', () => {
  it('provisions an isolated client with a tenant-scoped Adapter namespace', async () => {
    const { service, tx } = build();

    await expect(service.provisionClient({
      tenantId: 'restaurant-tenant', tenantName: '华海餐厅', clientId: 'restaurant-client', clientName: '菜单图片',
      adapterNamespace: 'restaurant-menu', allowedAdapterTypes: ['restaurant-menu-v1'],
    })).resolves.toMatchObject({ id: 'restaurant-client', tenantId: 'restaurant-tenant', adapterNamespace: 'restaurant-menu' });

    expect(tx.visualAgentTenant.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'restaurant-tenant' } }));
    expect(tx.visualAgentClient.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ allowedAdapterTypes: ['restaurant-menu-v1'] }),
    }));
  });

  it('returns a raw key exactly once while persisting only its verifier and prefix', async () => {
    const { service, prisma } = build();

    const issued = await service.issueKey({ clientId: 'restaurant-client', environment: 'live' });

    expect(issued.key).toMatch(/^vag_live_[a-f0-9]{12}_[A-Za-z0-9_-]{32,128}$/);
    expect(issued.record).not.toHaveProperty('keyHash');
    expect(prisma.visualAgentClientKey.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ keyPrefix: expect.stringMatching(/^vag_live_[a-f0-9]{12}$/), keyHash: expect.not.stringMatching(/^vag_live_/) }),
    }));
  });

  it('authenticates only an active, unexpired key and returns its immutable scope', async () => {
    const { service, prisma } = build();
    prisma.visualAgentClientKey.findFirst.mockResolvedValue({
      id: 'key-1', keyHash, client: clientRecord(),
    });

    await expect(service.authenticate(rawKey)).resolves.toEqual({
      tenantId: 'restaurant-tenant', clientId: 'restaurant-client', adapterNamespace: 'restaurant-menu',
      allowedAdapterTypes: ['restaurant-menu-v1'], keyId: 'key-1',
    });
    expect(prisma.visualAgentClientKey.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'key-1', status: 'ACTIVE' }, data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
    }));
  });

  it('rejects malformed, revoked/expired, or verifier-mismatched key material without leaking why', async () => {
    const { service, prisma } = build();
    await expect(service.authenticate('not-a-key')).rejects.toBeInstanceOf(UnauthorizedException);

    prisma.visualAgentClientKey.findFirst.mockResolvedValue(null);
    await expect(service.authenticate(rawKey)).rejects.toBeInstanceOf(UnauthorizedException);

    prisma.visualAgentClientKey.findFirst.mockResolvedValue({ id: 'key-1', keyHash: 'b'.repeat(64), client: clientRecord() });
    await expect(service.authenticate(rawKey)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('permits only the Adapter types allowlisted for the authenticated client', () => {
    const { service } = build();
    const principal = {
      tenantId: 'restaurant-tenant', clientId: 'restaurant-client', adapterNamespace: 'restaurant-menu',
      allowedAdapterTypes: ['restaurant-menu-v1'], keyId: 'key-1',
    };

    expect(() => service.assertAdapterAccess(principal, 'restaurant-menu-v1')).not.toThrow();
    expect(() => service.assertAdapterAccess(principal, 'aimai-product-v1')).toThrow(ForbiddenException);
  });

  it('revokes only an active key under the intended client scope', async () => {
    const { service, prisma } = build();
    await expect(service.revokeKey('restaurant-client', 'key-1')).resolves.toBeUndefined();
    expect(prisma.visualAgentClientKey.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'key-1', clientId: 'restaurant-client', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'REVOKED', revokedAt: expect.any(Date) }),
    }));
  });
});
