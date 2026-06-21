import { DeliveryAdminManifestsController } from './delivery-admin-manifests.controller';

describe('DeliveryAdminManifestsController', () => {
  it('delegates template listing and regeneration with admin scope', async () => {
    const manifestsService = {
      listAdminTemplates: jest.fn().mockResolvedValue([]),
      regenerateTemplate: jest.fn().mockResolvedValue({ versionNo: 2 }),
      getTargetCustomization: jest.fn().mockResolvedValue({ entries: [] }),
      upsertTargetCustomization: jest.fn().mockResolvedValue({ ok: true }),
    };
    const controller = new DeliveryAdminManifestsController(manifestsService as any);

    await controller.listTemplates();
    await controller.regenerate('admin_1', 'tmpl_1', {
      columns: [{ key: 'orderId', label: '配送订单号', sortOrder: 10, visible: true }],
    } as any);
    await controller.getCustomization('BUYER_FULL', 'PSDD0000000000001');
    await controller.upsertCustomization('admin_1', {
      manifestType: 'BUYER_FULL',
      targetId: 'PSDD0000000000001',
      entries: [{ key: 'pickupCode', label: '取货码', value: 'A-17', visible: true }],
    } as any);

    expect(manifestsService.listAdminTemplates).toHaveBeenCalled();
    expect(manifestsService.regenerateTemplate).toHaveBeenCalledWith('admin_1', 'tmpl_1', {
      columns: [{ key: 'orderId', label: '配送订单号', sortOrder: 10, visible: true }],
    });
    expect(manifestsService.getTargetCustomization).toHaveBeenCalledWith(
      'BUYER_FULL',
      'PSDD0000000000001',
    );
    expect(manifestsService.upsertTargetCustomization).toHaveBeenCalledWith('admin_1', {
      manifestType: 'BUYER_FULL',
      targetId: 'PSDD0000000000001',
      entries: [{ key: 'pickupCode', label: '取货码', value: 'A-17', visible: true }],
    });
  });
});
