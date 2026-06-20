import { DeliveryPrismaService } from './delivery-prisma.service';

describe('DeliveryPrismaService', () => {
  it('is instantiable from generated delivery client', () => {
    const service = new DeliveryPrismaService();

    expect(service).toBeDefined();
    expect(typeof service.$connect).toBe('function');
    expect(typeof service.$disconnect).toBe('function');
    expect('onModuleInit' in service).toBe(false);
    expect((service as { onModuleInit?: unknown }).onModuleInit).toBeUndefined();
  });
});
