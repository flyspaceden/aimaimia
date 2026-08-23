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
    const prisma: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{
        status: 'ACTIVE',
        deletionExecutedAt: null,
      }]),
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
      $transaction: jest.fn(async (operation: any) => (
        typeof operation === 'function' ? operation(prisma) : Promise.all(operation)
      )),
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
    prisma.address.findFirst.mockResolvedValue(makeAddress({ id: 'addr-default', isDefault: true }));
    prisma.address.create.mockResolvedValue(makeAddress({ id: 'addr-new' }));

    await service.create('user-1', {
      recipientName: '李四',
      phone: '13900000000',
      regionCode: '440304',
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
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
  });

  it('repairs a historical address book with no active default when creating another address', async () => {
    const { service, prisma } = createMocks();
    prisma.address.count.mockResolvedValue(2);
    prisma.address.findFirst.mockResolvedValue(null);
    prisma.address.updateMany.mockResolvedValue({ count: 0 });
    prisma.address.create.mockResolvedValue(makeAddress({ id: 'addr-new', isDefault: true }));

    const result = await service.create('user-1', {
      recipientName: '李四',
      phone: '13900000000',
      regionCode: '440304',
      regionText: '广东省 深圳市 福田区',
      detail: '中心区 2 号',
      isDefault: false,
    });

    expect(result.isDefault).toBe(true);
    expect(prisma.address.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isDefault: true, deletedAt: null },
      data: { isDefault: false },
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

  it('clears the current default before promoting its replacement', async () => {
    const { service, prisma } = createMocks();
    const current = makeAddress({ id: 'addr-current', isDefault: true });
    const replacement = makeAddress({ id: 'addr-next', isDefault: false });
    prisma.address.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(replacement);
    prisma.address.update
      .mockResolvedValueOnce({ ...current, isDefault: false })
      .mockResolvedValueOnce({ ...replacement, isDefault: true });

    const result = await service.update('user-1', 'addr-current', { isDefault: false });

    expect(result.isDefault).toBe(false);
    expect(prisma.address.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'addr-current', userId: 'user-1', deletedAt: null },
      data: { isDefault: false },
    });
    expect(prisma.address.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'addr-next', userId: 'user-1', deletedAt: null },
      data: { isDefault: true },
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

  it('sets a default address in one Serializable transaction', async () => {
    const { service, prisma } = createMocks();
    const address = makeAddress({ id: 'addr-target', isDefault: false });
    prisma.address.findFirst.mockResolvedValue(address);
    prisma.address.updateMany.mockResolvedValue({ count: 1 });
    prisma.address.update.mockResolvedValue({ ...address, isDefault: true });

    const result = await service.setDefault('user-1', 'addr-target');

    expect(result.isDefault).toBe(true);
    expect(prisma.address.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isDefault: true, deletedAt: null },
      data: { isDefault: false },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
  });

  it('retries a serialization conflict before creating the first default address', async () => {
    const { service, prisma } = createMocks();
    const conflict = new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)(
      'serialization conflict',
      { code: 'P2034', clientVersion: 'test' },
    );
    prisma.$transaction
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (operation: any) => operation(prisma));
    prisma.address.count.mockResolvedValue(0);
    prisma.address.updateMany.mockResolvedValue({ count: 0 });
    prisma.address.create.mockResolvedValue(makeAddress({ id: 'addr-first', isDefault: true }));

    const pending = service.create('user-1', {
      recipientName: '王五',
      phone: '13700000000',
      regionCode: '110108',
      regionText: '北京市 北京市 海淀区',
      detail: '中关村 1 号',
    });
    await jest.advanceTimersByTimeAsync(20);
    const result = await pending;

    expect(result.isDefault).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('returns a retryable conflict instead of leaking a database error after retries are exhausted', async () => {
    const { service, prisma } = createMocks();
    const conflict = new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)(
      'serialization conflict',
      { code: 'P2034', clientVersion: 'test' },
    );
    prisma.$transaction.mockRejectedValue(conflict);

    const pending = service.create('user-1', {
      recipientName: '王五',
      phone: '13700000000',
      regionCode: '110108',
      regionText: '北京市 北京市 海淀区',
      detail: '中关村 1 号',
    });
    const assertion = expect(pending).rejects.toThrow('地址状态已变化，请重试');
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('rejects a forged region code whose province disagrees with the delivery text', async () => {
    const { service, prisma } = createMocks();

    await expect(service.create('user-1', {
      recipientName: '李四',
      phone: '13900000000',
      regionCode: '110101',
      regionText: '新疆维吾尔自治区/乌鲁木齐市/天山区',
      detail: '人民路 1 号',
    })).rejects.toThrow('行政区划代码与地址省份不一致');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.address.create).not.toHaveBeenCalled();
  });

  it('rejects unknown or non-six-digit province codes on new writes', async () => {
    const { service } = createMocks();

    await expect(service.create('user-1', {
      recipientName: '李四',
      phone: '13900000000',
      regionCode: 'CN-BJ-CY',
      regionText: '北京市/北京市/朝阳区',
      detail: '建国路 1 号',
    })).rejects.toThrow('请选择标准省/市/区');

    await expect(service.create('user-1', {
      recipientName: '李四',
      phone: '13900000000',
      regionCode: '990101',
      regionText: '北京市/北京市/朝阳区',
      detail: '建国路 1 号',
    })).rejects.toThrow('行政区划代码所属省份无效');
  });

  it('requires a legacy address to repair its region before any modification', async () => {
    const { service, prisma } = createMocks();
    prisma.address.findFirst.mockResolvedValue(makeAddress({ regionCode: '' }));

    await expect(service.update('user-1', 'addr-1', { detail: '新地址' }))
      .rejects.toThrow('请选择标准省/市/区');

    expect(prisma.address.update).not.toHaveBeenCalled();
  });
});
