import { DeliveryUnitsController } from './delivery-units.controller';

describe('DeliveryUnitsController', () => {
  let service: {
    listUnits: jest.Mock;
    createUnit: jest.Mock;
    updateUnit: jest.Mock;
    selectUnit: jest.Mock;
  };
  let controller: DeliveryUnitsController;

  beforeEach(() => {
    service = {
      listUnits: jest.fn().mockResolvedValue({ items: [] }),
      createUnit: jest.fn().mockResolvedValue({ unit: { id: 'unit_1' } }),
      updateUnit: jest.fn().mockResolvedValue({ unit: { id: 'unit_1' } }),
      selectUnit: jest.fn().mockResolvedValue({ currentUnitId: 'unit_1' }),
    };
    controller = new DeliveryUnitsController(service as any);
  });

  it('delegates unit selection to the service with the current delivery user id', async () => {
    await expect(controller.selectUnit('PSYH0000000000001', 'unit_1')).resolves.toEqual({
      currentUnitId: 'unit_1',
    });
    expect(service.selectUnit).toHaveBeenCalledWith('PSYH0000000000001', 'unit_1');
  });
});
