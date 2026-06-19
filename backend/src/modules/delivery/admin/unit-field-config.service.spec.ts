import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryUnitFieldConfigService } from './unit-field-config.service';

describe('DeliveryUnitFieldConfigService', () => {
  let deliveryPrisma: {
    deliveryUnitFieldConfig: {
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
  };
  let service: DeliveryUnitFieldConfigService;

  beforeEach(() => {
    deliveryPrisma = {
      deliveryUnitFieldConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockImplementation(({ create, update }: any) => ({
          ...(create ?? {}),
          ...(update ?? {}),
        })),
      },
    };
    service = new DeliveryUnitFieldConfigService(
      deliveryPrisma as unknown as DeliveryPrismaService,
    );
  });

  it('supports label, sort, visibility, required flag, and PDF/Excel inclusion while protecting fixed fulfillment fields', async () => {
    await expect(
      service.updateConfigs([
        {
          fieldKey: 'name',
          label: '单位名称',
          sortOrder: 1,
          isVisible: false,
          isRequired: false,
          showInApp: false,
          showInAdmin: false,
          includeInPdf: false,
          includeInExcel: false,
        },
        {
          fieldKey: 'gateCode',
          label: '门禁码',
          sortOrder: 9,
          isVisible: true,
          isRequired: false,
          showInApp: true,
          showInAdmin: true,
          includeInPdf: true,
          includeInExcel: true,
        },
      ]),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldKey: 'name',
          isVisible: true,
          isRequired: true,
          showInApp: true,
          showInAdmin: true,
          includeInPdf: true,
          includeInExcel: true,
        }),
        expect.objectContaining({
          fieldKey: 'gateCode',
          label: '门禁码',
          sortOrder: 9,
          includeInPdf: true,
          includeInExcel: true,
        }),
      ]),
    );
  });
});
