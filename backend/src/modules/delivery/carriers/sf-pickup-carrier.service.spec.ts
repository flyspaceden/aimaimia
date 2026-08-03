import { BadRequestException } from '@nestjs/common';
import { SfExpressService } from '../../shipment/sf-express.service';
import { UploadService } from '../../upload/upload.service';
import { SfPickupCarrierService } from './sf-pickup-carrier.service';

jest.mock('../../../common/utils/remote-binary-fetch.util', () => ({
  fetchBinaryWithLimit: jest.fn().mockResolvedValue({
    buffer: Buffer.from('pdf'),
    contentType: 'application/pdf',
    size: 3,
    finalUrl: 'https://sf.example/waybill.pdf',
  }),
}));

describe('SfPickupCarrierService', () => {
  let sfExpress: any;
  let uploadService: any;
  let service: SfPickupCarrierService;

  beforeEach(() => {
    sfExpress = {
      isConfigured: jest.fn().mockReturnValue(true),
      createOrder: jest.fn(),
      printWaybill: jest.fn().mockResolvedValue({ pdfUrl: 'https://sf.example/waybill.pdf' }),
      queryRoutes: jest.fn(),
      cancelOrder: jest.fn(),
    };
    uploadService = {
      uploadBuffer: jest.fn().mockResolvedValue({ url: 'https://oss.example/waybill.pdf' }),
    };
    service = new SfPickupCarrierService(
      sfExpress as SfExpressService,
      uploadService as UploadService,
    );
  });

  it('creates one SF carrier order and preserves every returned waybill', async () => {
    sfExpress.createOrder.mockResolvedValue({
      waybillNo: 'SF001',
      waybillNos: ['SF001', 'SF002'],
      sfOrderId: 'sf_order_1',
    });

    await expect(
      service.createShipment({
        outsideOrderId: 'AIMM-DELIVERY-BATCH-1',
        sender: party('发件人'),
        receiver: party('收件人'),
        cargo: { name: '大米', quantity: 20, weightKg: 100 },
        expressTypeId: 1,
        expressTypeName: '顺丰标快',
        packageCount: 2,
        totalWeightKg: 100,
      }),
    ).resolves.toMatchObject({
      provider: 'SF',
      primaryWaybillNo: 'SF001',
      waybillNos: ['SF001', 'SF002'],
      waybillUrl: 'https://oss.example/waybill.pdf',
      status: 'WAITING_DRIVER',
    });
    expect(sfExpress.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ packageCount: 2, totalWeight: 100, expressTypeId: 1, isDocall: 1 }),
    );
    expect(sfExpress.printWaybill).toHaveBeenCalledWith(['SF001', 'SF002']);
  });

  it('aggregates multi-waybill tracking only after every waybill is delivered', async () => {
    sfExpress.queryRoutes
      .mockResolvedValueOnce({ status: 'DELIVERED', events: [{ message: '已签收' }] })
      .mockResolvedValueOnce({ status: 'IN_TRANSIT', events: [{ message: '运输中' }] });

    await expect(service.syncWaybills(['SF001', 'SF002'])).resolves.toMatchObject({
      status: 'DELIVERING',
      waybills: [
        { trackingNo: 'SF001', mappedStatus: 'COMPLETED' },
        { trackingNo: 'SF002', mappedStatus: 'DELIVERING' },
      ],
    });
  });

  it('rejects unavailable or invalid SF shipment parameters before remote calls', async () => {
    sfExpress.isConfigured.mockReturnValue(false);
    await expect(
      service.createShipment({
        outsideOrderId: 'order_1',
        sender: party('发件人'),
        receiver: party('收件人'),
        cargo: { name: '大米', quantity: 1, weightKg: 1 },
        expressTypeId: 1,
        expressTypeName: '顺丰标快',
        packageCount: 1,
        totalWeightKg: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sfExpress.createOrder).not.toHaveBeenCalled();
  });
});

function party(name: string) {
  return {
    name,
    phone: '13800000000',
    province: '广东省',
    city: '广州市',
    district: '天河区',
    detail: '体育东路 1 号',
  };
}
