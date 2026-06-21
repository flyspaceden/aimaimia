import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryUnitFieldConfigService } from './unit-field-config.service';

describe('DeliveryUnitFieldConfigService', () => {
  let deliveryPrisma: {
    deliveryUnitFieldConfig: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    deliveryAuditLog: {
      create: jest.Mock;
    };
  };
  let service: DeliveryUnitFieldConfigService;

  beforeEach(() => {
    deliveryPrisma = {
      deliveryUnitFieldConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create, update }: any) => ({
          ...(create ?? {}),
          ...(update ?? {}),
        })),
      },
      deliveryAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit_1' }),
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

  it('rejects malformed field options and invalid sort order in service normalization', async () => {
    await expect(
      service.updateConfigs([
        {
          fieldKey: 'note',
          fieldType: 'TEXT' as any,
          options: ['A'],
        },
      ]),
    ).rejects.toThrow();

    await expect(
      service.updateConfigs([
        {
          fieldKey: 'gateCode',
          fieldType: 'SELECT' as any,
          sortOrder: -1,
          options: [{ label: 'A 区' }],
        },
      ]),
    ).rejects.toThrow();
  });

  it('writes audit logs when an admin updates delivery unit fields', async () => {
    await service.updateConfigs([
      {
        fieldKey: 'gateCode',
        label: '门禁码',
        sortOrder: 9,
        isVisible: true,
      },
    ], 'admin_1');

    expect((deliveryPrisma as any).deliveryAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorType: 'ADMIN',
        actorId: 'admin_1',
        module: 'unit-field-config',
        action: 'CREATE_UNIT_FIELD',
        targetType: 'DeliveryUnitFieldConfig',
        targetId: 'gateCode',
        after: expect.objectContaining({ label: '门禁码' }),
      }),
    }));
  });
});
