import { DeliveryPrismaService } from './delivery-prisma.service';

describe('DeliveryPrismaService', () => {
  it('is instantiable from generated delivery client', () => {
    const service = new DeliveryPrismaService();

    expect(service).toBeDefined();
    expect(typeof service.$connect).toBe('function');
    expect(typeof service.$disconnect).toBe('function');
  });
});
