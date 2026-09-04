import { VisualTaskExecutionService } from './visual-task-execution.service';

const claim = { id: 'task-1', quoteId: 'quote-1', leaseToken: 'owner-a', leaseGeneration: 1, attemptCount: 1 };
function setup() {
  const row: any = { ...claim, state: 'PENDING', leaseExpiresAt: new Date(Date.now() + 120_000) };
  const prisma: any = {
    visualCreditQuote: { findUnique: jest.fn().mockResolvedValue({ id: 'quote-1', status: 'RESERVED' }), findMany: jest.fn().mockResolvedValue([]) },
    visualTaskExecution: {
      upsert: jest.fn(),
      updateMany: jest.fn(async ({ where, data }) => {
        const matches = row.id === where.id && row.state === where.state && row.leaseToken === where.leaseToken
          && row.leaseGeneration === where.leaseGeneration && row.leaseExpiresAt > where.leaseExpiresAt.gt;
        if (matches) Object.assign(row, data);
        return { count: matches ? 1 : 0 };
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([claim]),
  };
  return { prisma, row, service: new VisualTaskExecutionService(prisma) };
}

describe('VisualTaskExecutionService durable orchestration', () => {
  it('closes a cancelled quote without dispatching its handler', async () => {
    const { service, prisma, row } = setup();
    prisma.visualCreditQuote.findUnique.mockResolvedValue({ id: 'quote-1', status: 'CANCELLED' });
    const advance = jest.fn();
    service.registerHandler('PUBLIC', { accepts: () => true, advance });
    await service.runClaim(claim);
    expect(advance).not.toHaveBeenCalled();
    expect(row.state).toBe('DONE');
    expect(row.leaseToken).toBeNull();
  });
  it('advances a claimed task without browser polling and marks it complete', async () => {
    const { service, row } = setup();
    const advance = jest.fn().mockResolvedValue({ done: true });
    service.registerHandler('PUBLIC', { accepts: () => true, advance });
    await service.runClaim(claim);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(row.state).toBe('DONE');
    expect(row.leaseToken).toBeNull();
  });

  it('cannot advance or complete after another worker takes over its lease', async () => {
    const { service, row } = setup();
    row.leaseToken = 'owner-b'; row.leaseGeneration = 2;
    const advance = jest.fn();
    service.registerHandler('PUBLIC', { accepts: () => true, advance });
    await service.runClaim(claim);
    expect(advance).not.toHaveBeenCalled();
    expect((await service.finish(claim, { done: true })).count).toBe(0);
    expect(row.state).toBe('PENDING');
    expect(row.leaseToken).toBe('owner-b');
  });

  it('does not resurrect expired ownership with a heartbeat', async () => {
    const { service, row } = setup();
    row.leaseExpiresAt = new Date(Date.now() - 1);
    expect(await service.heartbeat(claim)).toBe(false);
    expect((await service.finish(claim, { done: true })).count).toBe(0);
  });

  it('retains work after an I/O failure, without resubmitting within this attempt', async () => {
    const { service, row } = setup();
    const advance = jest.fn().mockRejectedValue(new Error('provider unavailable'));
    service.registerHandler('PUBLIC', { accepts: () => true, advance });
    await service.runClaim(claim);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(row.state).toBe('PENDING');
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.lastErrorCode).toBe('TASK_ADVANCE_RETRY');
  });

  it('refuses ambiguous routing rather than running two handlers', async () => {
    const { service, row } = setup();
    const advance = jest.fn();
    service.registerHandler('A', { accepts: () => true, advance });
    service.registerHandler('B', { accepts: () => true, advance });
    await service.runClaim(claim);
    expect(advance).not.toHaveBeenCalled();
    expect(row.lastErrorCode).toBe('TASK_HANDLER_UNAVAILABLE');
  });

  it('discovers historical confirmed quotes idempotently, including incomplete settlement recovery', async () => {
    const { service, prisma } = setup();
    prisma.visualCreditQuote.findMany.mockResolvedValue([{ id: 'legacy-1' }]);
    await service.discoverLegacy(); await service.discoverLegacy();
    expect(prisma.visualTaskExecution.upsert).toHaveBeenCalledWith({ where: { quoteId: 'legacy-1' }, create: { quoteId: 'legacy-1' }, update: {} });
    expect(prisma.visualCreditQuote.findMany.mock.calls[0][0].where).toMatchObject({ confirmedAt: { not: null }, taskExecution: null });
  });

  it('does not drive concurrent process-local cron ticks', async () => {
    const { service, prisma } = setup();
    service.registerHandler('PUBLIC', { accepts: () => true, advance: async () => ({ done: true }) });
    let release!: () => void;
    prisma.visualCreditQuote.findMany.mockImplementation(() => new Promise<any[]>((resolve) => { release = () => resolve([]); }));
    const first = service.tick();
    await service.tick();
    expect(prisma.visualCreditQuote.findMany).toHaveBeenCalledTimes(1);
    release();
    prisma.$queryRaw.mockResolvedValue([]);
    await first;
  });
});
