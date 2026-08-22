import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GroupService } from './group.service';

const group = (overrides: Record<string, unknown> = {}) => ({
  id: 'group-1',
  companyId: 'company-1',
  title: '产地考察团',
  destination: '云南',
  targetSize: 2,
  memberCount: 0,
  deadline: '2099-08-31',
  status: 'FORMING',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  ...overrides,
});

const booking = (overrides: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  userId: 'buyer-1',
  companyId: 'company-1',
  groupId: 'group-1',
  date: '2026-08-02',
  headcount: 1,
  identity: 'consumer',
  contactName: null,
  contactPhone: null,
  note: null,
  status: 'JOINED',
  reviewedAt: null,
  auditNote: null,
  createdAt: new Date('2026-08-02T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  ...overrides,
});

function createHarness(options: {
  group?: any;
  existingBooking?: any;
  updateCounts?: number[];
} = {}) {
  const tx = {
    group: {
      findFirst: jest.fn().mockResolvedValue(options.group === undefined ? group() : options.group),
      updateMany: jest.fn(),
    },
    booking: {
      findFirst: jest.fn().mockResolvedValue(options.existingBooking ?? null),
      create: jest.fn().mockResolvedValue(booking()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  for (const count of options.updateCounts ?? [1]) {
    tx.group.updateMany.mockResolvedValueOnce({ count });
  }
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { tx, prisma, service: new GroupService(prisma as any) };
}

describe('GroupService atomic buyer join', () => {
  it('creates the booking and claims the visible forming group in one Serializable transaction', async () => {
    const { tx, prisma, service } = createHarness();

    const result = await service.joinWithBooking('group-1', 'buyer-1', {
      expectedCompanyId: 'company-1',
      identity: 'buyer',
      contactName: '张三',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(tx.group.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'group-1',
        company: { status: 'ACTIVE', isPlatform: false },
      },
    });
    expect(tx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'buyer-1',
        companyId: 'company-1',
        groupId: 'group-1',
        headcount: 1,
        identity: 'buyer',
        contactName: '张三',
        status: 'JOINED',
      }),
    });
    expect(tx.group.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'group-1',
        status: 'FORMING',
        memberCount: 0,
        targetSize: 2,
        deadline: '2099-08-31',
        company: { status: 'ACTIVE', isPlatform: false },
      },
      data: { memberCount: 1, status: 'FORMING' },
    });
    expect(result).toMatchObject({ joined: true, group: { memberCount: 1 } });
  });

  it('rejects a client companyId that does not belong to the group', async () => {
    const { tx, service } = createHarness();

    await expect(service.joinWithBooking('group-1', 'buyer-1', {
      expectedCompanyId: 'company-other',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(tx.group.updateMany).not.toHaveBeenCalled();
  });

  it('hides groups whose company is no longer buyer-visible', async () => {
    const { tx, service } = createHarness({ group: null });

    await expect(service.join('group-hidden', 'buyer-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it('makes the legacy second join call idempotent without incrementing twice', async () => {
    const existing = booking();
    const { tx, service } = createHarness({
      group: group({ memberCount: 2, status: 'INVITING' }),
      existingBooking: existing,
    });

    await expect(service.join('group-1', 'buyer-1')).resolves.toMatchObject({
      memberCount: 2,
      status: 'inviting',
    });
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(tx.group.updateMany).not.toHaveBeenCalled();
  });

  it('upgrades the exact invited booking in place and increments memberCount once', async () => {
    const invited = booking({ status: 'INVITED' });
    const { tx, service } = createHarness({ existingBooking: invited });

    await expect(service.joinWithBooking('group-1', 'buyer-1', {
      existingBookingId: 'booking-1',
      expectedCompanyId: 'company-1',
    })).resolves.toMatchObject({
      joined: true,
      booking: { id: 'booking-1', status: 'JOINED' },
      group: { memberCount: 1 },
    });
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'booking-1',
        userId: 'buyer-1',
        companyId: 'company-1',
        groupId: 'group-1',
        status: 'INVITED',
      },
      data: { status: 'JOINED' },
    });
    expect(tx.group.updateMany).toHaveBeenCalledTimes(1);
  });

  it('fails closed instead of creating around an existing non-reusable booking', async () => {
    const canceled = booking({ status: 'CANCELED' });
    const { tx, service } = createHarness({ existingBooking: canceled });

    await expect(service.join('group-1', 'buyer-1')).rejects.toThrow('不可复用预约记录');
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(tx.group.updateMany).not.toHaveBeenCalled();
  });

  it('retries a database unique conflict so the committed booking can be reread', async () => {
    const existing = booking();
    const { tx, prisma, service } = createHarness({ existingBooking: existing });
    prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error('unique race'), { code: 'P2002' }));

    await expect(service.join('group-1', 'buyer-1')).resolves.toMatchObject({ memberCount: 0 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it('fails closed for invalid, expired, or full groups', async () => {
    for (const invalidGroup of [
      group({ deadline: 'not-a-date' }),
      group({ deadline: '2099-02-30' }),
      group({ deadline: '2020-01-01' }),
      group({ memberCount: 2 }),
    ]) {
      const { tx, service } = createHarness({ group: invalidGroup });
      await expect(service.join('group-1', 'buyer-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.booking.create).not.toHaveBeenCalled();
      expect(tx.group.updateMany).not.toHaveBeenCalled();
    }
  });

  it('retries a failed memberCount CAS before succeeding', async () => {
    const { tx, prisma, service } = createHarness({ updateCounts: [0, 1] });

    await expect(service.join('group-1', 'buyer-1')).resolves.toMatchObject({ memberCount: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.group.updateMany).toHaveBeenCalledTimes(2);
  });
});
