import { UnitFieldConfigController } from './unit-field-config.controller';

describe('UnitFieldConfigController', () => {
  it('delegates batch patch to the service', async () => {
    const service = {
      getConfigs: jest.fn().mockResolvedValue([]),
      updateConfigs: jest.fn().mockResolvedValue([{ fieldKey: 'name' }]),
    };
    const controller = new UnitFieldConfigController(service as any);

    await expect(
      controller.update({
        items: [{ fieldKey: 'name', label: '单位名称' }],
      } as any),
    ).resolves.toEqual([{ fieldKey: 'name' }]);
    expect(service.updateConfigs).toHaveBeenCalledWith([{ fieldKey: 'name', label: '单位名称' }]);
  });
});
