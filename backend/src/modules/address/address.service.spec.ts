import { AddressService } from './address.service';

describe('AddressService soft delete behavior', () => {
  const now = new Date('2026-06-04T12:00:00.000Z');

  function makeAddress(overrides: Record<string, any> = {}) {
    return {
      id: 'addr-1',
      userId: 'user-1',
      recipientName: '张三',
      phone: '13800000000',
      regionCode: '440305',
      regionText: '广东省 深圳市 南山区',
      detail: '科技园 1 号',
      location: null,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...overrides,
    };
  }

  function createMocks() {
    const prisma = {
      address: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(async (operations: Promise<any>[]) => Promise.all(operations)),
    };

    return {
      prisma,
      service: new AddressService(prisma as any),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('list excludes soft-deleted addresses', async () => {
    const { service, prisma } = createMocks();
    prisma.address.findMany.mockResolvedValue([makeAddress()]);

    const addresses = await service.list('user-1');

    expect(addresses).toHaveLength(1);
    expect(prisma.address.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  });

  it('create counts only non-deleted addresses when deciding first default address', async () => {
    const { service, prisma } = createMocks();
    prisma.address.count.mockResolvedValue(1);
    prisma.address.create.mockResolvedValue(makeAddress({ id: 'addr-new' }));

    await service.create('user-1', {
      recipientName: '李四',
      phone: '13900000000',
      regionText: '广东省 深圳市 福田区',
      detail: '中心区 2 号',
    });

    expect(prisma.address.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null },
    });
    expect(prisma.address.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        isDefault: false,
      }),
    });
  });

  it('update only operates on non-deleted owned addresses', async () => {
    const { service, prisma } = createMocks();
    prisma.address.findFirst.mockResolvedValue(makeAddress());
    prisma.address.update.mockResolvedValue(makeAddress({ detail: '新地址' }));

    await service.update('user-1', 'addr-1', { detail: '新地址' });

    expect(prisma.address.findFirst).toHaveBeenCalledWith({
      where: { id: 'addr-1', userId: 'user-1', deletedAt: null },
    });
    expect(prisma.address.update).toHaveBeenCalledWith({
      where: { id: 'addr-1', userId: 'user-1', deletedAt: null },
      data: expect.objectContaining({ detail: '新地址' }),
    });
  });

  it('remove soft-deletes the address instead of hard-deleting it', async () => {
    const { service, prisma } = createMocks();
    prisma.address.findFirst.mockResolvedValue(makeAddress({ isDefault: false }));
    prisma.address.update.mockResolvedValue(makeAddress({ deletedAt: now, isDefault: false }));

    await service.remove('user-1', 'addr-1');

    expect(prisma.address.update).toHaveBeenCalledWith({
      where: { id: 'addr-1', userId: 'user-1', deletedAt: null },
      data: { deletedAt: now, isDefault: false },
    });
    expect(prisma.address.delete).not.toHaveBeenCalled();
  });

  it('default reassignment ignores soft-deleted addresses', async () => {
    const { service, prisma } = createMocks();
    const removedDefault = makeAddress({ id: 'addr-default', isDefault: true });
    const nextDefault = makeAddress({ id: 'addr-next', isDefault: false });
    prisma.address.findFirst
      .mockResolvedValueOnce(removedDefault)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(nextDefault);
    prisma.address.update.mockResolvedValue({});

    await service.remove('user-1', 'addr-default');

    expect(prisma.address.findFirst).toHaveBeenNthCalledWith(2, {
      where: { userId: 'user-1', isDefault: true, deletedAt: null },
    });
    expect(prisma.address.findFirst).toHaveBeenNthCalledWith(3, {
      where: { userId: 'user-1', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.address.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'addr-next', userId: 'user-1', deletedAt: null },
      data: { isDefault: true },
    });
  });

  it('recovers a missing active default after removing a non-default address', async () => {
    const { service, prisma } = createMocks();
    const removedAddress = makeAddress({ id: 'addr-removed', isDefault: false });
    const nextDefault = makeAddress({ id: 'addr-next', isDefault: false });
    prisma.address.findFirst
      .mockResolvedValueOnce(removedAddress)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(nextDefault);
    prisma.address.update.mockResolvedValue({});

    await service.remove('user-1', 'addr-removed');

    expect(prisma.address.findFirst).toHaveBeenNthCalledWith(2, {
      where: { userId: 'user-1', isDefault: true, deletedAt: null },
    });
    expect(prisma.address.findFirst).toHaveBeenNthCalledWith(3, {
      where: { userId: 'user-1', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.address.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'addr-next', userId: 'user-1', deletedAt: null },
      data: { isDefault: true },
    });
  });
});
