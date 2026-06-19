import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryIdService, formatDeliveryId } from './delivery-id.service';

describe('formatDeliveryId', () => {
  it('formats readable delivery ids', () => {
    expect(formatDeliveryId('PSYH', 1)).toBe('PSYH0000000000001');
    expect(formatDeliveryId('PSSJ', 1)).toBe('PSSJ0000000000001');
    expect(formatDeliveryId('PSSP', 1)).toBe('PSSP0000000000001');
    expect(formatDeliveryId('PSDD', 1)).toBe('PSDD0000000000001');
    expect(formatDeliveryId('PSZDD', 1)).toBe('PSZDD000000000001');
    expect(formatDeliveryId('PSZF', 1)).toBe('PSZF0000000000001');
    expect(formatDeliveryId('PSQD', 1)).toBe('PSQD0000000000001');
  });
});

describe('DeliveryIdService.next', () => {
  let tx: any;
  let prisma: { $transaction: jest.Mock };
  let service: DeliveryIdService;

  beforeEach(() => {
    tx = {
      deliverySequence: {
        upsert: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    service = new DeliveryIdService(prisma as unknown as DeliveryPrismaService);
  });

  it('increments the sequence in a Serializable transaction and formats the result', async () => {
    tx.deliverySequence.upsert.mockResolvedValue({
      currentValue: 42n,
    });

    await expect(service.next('PSYH')).resolves.toBe('PSYH0000000000042');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.deliverySequence.upsert).toHaveBeenCalledWith({
      where: { prefix: 'PSYH' },
      create: {
        id: 'PSYH',
        prefix: 'PSYH',
        currentValue: 1n,
      },
      update: {
        currentValue: {
          increment: 1n,
        },
      },
      select: {
        currentValue: true,
      },
    });
  });

  it('retries once when the Serializable transaction conflicts', async () => {
    tx.deliverySequence.upsert.mockResolvedValue({
      currentValue: 2n,
    });
    (prisma.$transaction as jest.Mock)
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      );

    await expect(service.next('PSZF')).resolves.toBe('PSZF0000000000002');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
