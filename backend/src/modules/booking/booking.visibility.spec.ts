import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BookingService } from './booking.service';

const booking = {
  id: 'booking-1',
  userId: 'buyer-1',
  companyId: 'company-1',
  activityId: 'event-1',
  groupId: null,
  date: '2026-08-03',
  headcount: 1,
  identity: 'consumer',
  note: null,
  contactName: '张三',
  contactPhone: '13800138000',
  status: 'PENDING',
  reviewedAt: null,
  auditNote: null,
  createdAt: new Date('2026-08-02T00:00:00.000Z'),
};

function createHarness(options: {
  activity?: { id: string } | null;
  bookingRow?: any;
  group?: any;
} = {}) {
  const bookingRow = options.bookingRow ?? booking;
  const tx = {
    companyActivity: { findFirst: jest.fn().mockResolvedValue(options.activity === undefined ? { id: 'event-1' } : options.activity) },
    company: { findFirst: jest.fn().mockResolvedValue({ id: 'company-1' }) },
    group: {
      findFirst: jest.fn().mockResolvedValue(options.group === undefined ? {
        id: 'group-1',
        companyId: 'company-1',
        status: 'FORMING',
        deadline: '2099-08-31',
        memberCount: 0,
        targetSize: 2,
      } : options.group),
    },
    booking: {
      findFirst: jest.fn()
        .mockResolvedValueOnce(bookingRow)
        .mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(bookingRow),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    booking: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(bookingRow),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const groupService = {
    joinWithBooking: jest.fn(),
    assertGroupAcceptsJoining: jest.fn(),
  };
  return {
    tx,
    prisma,
    groupService,
    service: new BookingService(prisma as any, groupService as any),
  };
}

describe('BookingService buyer visibility and ownership', () => {
  it('validates event ownership and company visibility inside a Serializable create transaction', async () => {
    const { tx, prisma, service } = createHarness();

    await service.create('buyer-1', {
      companyId: 'company-1',
      eventId: 'event-1',
      date: '2026-08-03',
      headcount: 1,
      identity: 'consumer',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(tx.companyActivity.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'event-1',
        companyId: 'company-1',
        company: { status: 'ACTIVE', isPlatform: false },
      },
      select: { id: true },
    });
    expect(tx.booking.create).toHaveBeenCalledTimes(1);
  });

  it('does not create a booking for a hidden or mismatched event', async () => {
    const { tx, service } = createHarness({ activity: null });

    await expect(service.create('buyer-1', {
      companyId: 'company-1',
      eventId: 'event-hidden',
      date: '2026-08-03',
      headcount: 1,
      identity: 'consumer',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it('delegates group booking and memberCount changes to the shared atomic join', async () => {
    const { groupService, service } = createHarness();
    groupService.joinWithBooking.mockResolvedValue({
      booking: { ...booking, activityId: null, groupId: 'group-1', status: 'JOINED' },
      group: {},
      joined: true,
    });

    await expect(service.joinGroup('buyer-1', {
      companyId: 'company-1',
      groupId: 'group-1',
      headcount: 99,
      identity: 'consumer',
      contactName: '张三',
    })).resolves.toMatchObject({ id: 'booking-1', groupId: 'group-1', status: 'joined' });
    expect(groupService.joinWithBooking).toHaveBeenCalledWith('group-1', 'buyer-1', {
      expectedCompanyId: 'company-1',
      identity: 'consumer',
      contactName: '张三',
    });
  });

  it('filters company booking lists by buyer-visible company', async () => {
    const { prisma, service } = createHarness();

    await service.listByCompany('buyer-1', 'company-1');

    expect(prisma.booking.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'buyer-1',
        companyId: 'company-1',
        company: { status: 'ACTIVE', isPlatform: false },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('invites only an approved booking into a visible forming group owned by the same company', async () => {
    const approved = { ...booking, status: 'APPROVED', activityId: null };
    const { tx, prisma, groupService, service } = createHarness({ bookingRow: approved });

    await expect(service.inviteToGroup('booking-1', { groupId: 'group-1' }, 'company-1'))
      .resolves.toMatchObject({ id: 'booking-1', groupId: 'group-1', status: 'invited' });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(tx.group.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'group-1',
        companyId: 'company-1',
        company: { status: 'ACTIVE', isPlatform: false },
      },
    });
    expect(groupService.assertGroupAcceptsJoining).toHaveBeenCalled();
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'booking-1',
        companyId: 'company-1',
        status: 'APPROVED',
        groupId: null,
      },
      data: { status: 'INVITED', groupId: 'group-1' },
    });
  });

  it('does not invite a booking into a hidden or cross-company group', async () => {
    const approved = { ...booking, status: 'APPROVED' };
    const { tx, service } = createHarness({ bookingRow: approved, group: null });

    await expect(service.inviteToGroup('booking-1', { groupId: 'group-other' }, 'company-1'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it('does not create a second invitation for the same user and group', async () => {
    const approved = { ...booking, status: 'APPROVED' };
    const { tx, service } = createHarness({ bookingRow: approved });
    tx.booking.findFirst
      .mockReset()
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce({ id: 'booking-existing' });

    await expect(service.inviteToGroup('booking-1', { groupId: 'group-1' }, 'company-1'))
      .rejects.toThrow('已有本考察团的预约');
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it('confirms an invited booking through the shared atomic join using the exact booking id', async () => {
    const invited = { ...booking, activityId: null, groupId: 'group-1', status: 'INVITED' };
    const { groupService, service } = createHarness({ bookingRow: invited });
    groupService.joinWithBooking.mockResolvedValue({
      booking: { ...invited, status: 'JOINED' },
      group: {},
      joined: true,
    });

    await expect(service.confirmJoin('booking-1', 'buyer-1')).resolves.toMatchObject({ status: 'joined' });
    expect(groupService.joinWithBooking).toHaveBeenCalledWith('group-1', 'buyer-1', {
      expectedCompanyId: 'company-1',
      existingBookingId: 'booking-1',
    });
  });

  it('fails closed when a buyer attempts to mark a booking paid', async () => {
    const { prisma, service } = createHarness();

    await expect(service.markPaid('booking-1', 'buyer-1')).rejects.toThrow('支付尚未开放');
    expect(prisma.booking.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a missing buyer identity before a company booking query can broaden', async () => {
    const { prisma, service } = createHarness();

    await expect(service.listByCompany('', 'company-1')).rejects.toBeInstanceOf(Error);
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });
});
