import { DeliveryManifestsController } from './delivery-manifests.controller';

describe('DeliveryManifestsController', () => {
  it('delegates buyer manifest listing and order manifest generation', async () => {
    const manifestsService = {
      listBuyerManifests: jest.fn().mockResolvedValue([]),
      getOrderManifest: jest.fn().mockResolvedValue({ id: 'manifest_1' }),
    };
    const controller = new DeliveryManifestsController(manifestsService as any);

    await controller.listManifests('delivery_user_1');
    await controller.getOrderManifest('delivery_user_1', 'PSDD0000000000001');

    expect(manifestsService.listBuyerManifests).toHaveBeenCalledWith('delivery_user_1');
    expect(manifestsService.getOrderManifest).toHaveBeenCalledWith({
      orderId: 'PSDD0000000000001',
      viewer: { kind: 'buyer', deliveryUserId: 'delivery_user_1' },
    });
  });
});
