import { DeliveryAdminManifestsController } from './delivery-admin-manifests.controller';

describe('DeliveryAdminManifestsController', () => {
  it('delegates template listing and regeneration with admin scope', async () => {
    const manifestsService = {
      listAdminTemplates: jest.fn().mockResolvedValue([]),
      regenerateTemplate: jest.fn().mockResolvedValue({ versionNo: 2 }),
    };
    const controller = new DeliveryAdminManifestsController(manifestsService as any);

    await controller.listTemplates();
    await controller.regenerate('admin_1', 'tmpl_1', {
      columns: [{ key: 'orderId', label: 'Order ID', sortOrder: 10, visible: true }],
    } as any);

    expect(manifestsService.listAdminTemplates).toHaveBeenCalled();
    expect(manifestsService.regenerateTemplate).toHaveBeenCalledWith('admin_1', 'tmpl_1', {
      columns: [{ key: 'orderId', label: 'Order ID', sortOrder: 10, visible: true }],
    });
  });
});
