import { DeliverySellerApplicationController } from './delivery-seller-application.controller';

describe('DeliverySellerApplicationController', () => {
  it('delegates create without requiring seller login context', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ application: { id: 'apply_1' } }),
    };
    const controller = new DeliverySellerApplicationController(service as any);

    await expect(
      controller.create({
        companyName: '青禾配送中心',
        contactName: '张三',
        contactPhone: '13800000000',
      } as any),
    ).resolves.toEqual({
      application: { id: 'apply_1' },
    });
    expect(service.create).toHaveBeenCalled();
  });
});
