import { DeliverySellerManifestsController } from './delivery-seller-manifests.controller';

describe('DeliverySellerManifestsController', () => {
  it('delegates fulfillment and finance manifest generation to seller-scoped service methods', async () => {
    const manifestsService = {
      getSellerFulfillmentManifest: jest.fn().mockResolvedValue({ id: 'manifest_1' }),
      exportSellerFinanceManifest: jest.fn().mockResolvedValue({ id: 'manifest_2' }),
    };
    const controller = new DeliverySellerManifestsController(manifestsService as any);

    await controller.getFulfillmentManifest('merchant_1', 'sub_1');
    await controller.exportFinance('merchant_1');

    expect(manifestsService.getSellerFulfillmentManifest).toHaveBeenCalledWith('merchant_1', 'sub_1');
    expect(manifestsService.exportSellerFinanceManifest).toHaveBeenCalledWith('merchant_1');
  });
});
