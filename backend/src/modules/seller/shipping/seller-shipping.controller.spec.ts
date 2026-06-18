import { SellerShippingController } from './seller-shipping.controller';
import { fetchBinaryWithLimit } from '../../../common/utils/remote-binary-fetch.util';
import { applyWaybillWatermark } from '../../../common/security/waybill-watermark';

jest.mock('../../../common/utils/remote-binary-fetch.util', () => ({
  fetchBinaryWithLimit: jest.fn(),
  RemoteBinaryFetchError: class RemoteBinaryFetchError extends Error {
    constructor(
      message: string,
      readonly statusCode = 502,
    ) {
      super(message);
      this.name = 'RemoteBinaryFetchError';
    }
  },
}));

jest.mock('../../../common/security/waybill-watermark', () => ({
  applyWaybillWatermark: jest.fn(),
}));

const mockedFetchBinaryWithLimit = jest.mocked(fetchBinaryWithLimit);
const mockedApplyWaybillWatermark = jest.mocked(applyWaybillWatermark);

function createMockResponse() {
  const headers = new Map<string, string>();
  return {
    headers,
    res: {
      setHeader: jest.fn((key: string, value: string) => {
        headers.set(key, value);
      }),
      send: jest.fn((body: unknown) => body),
    },
  };
}

describe('SellerShippingController.printWaybill', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('serves a PDF when fetched content-type is application/pdf even if the URL has no .pdf suffix', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.7\nmock waybill');
    mockedFetchBinaryWithLimit.mockResolvedValueOnce({
      buffer: pdfBuffer,
      contentType: 'application/pdf; charset=utf-8',
    });
    mockedApplyWaybillWatermark.mockRejectedValueOnce(
      new Error('watermark should not run for PDFs'),
    );

    const shippingService = {
      verifyPrintSignature: jest.fn().mockReturnValue(true),
      getWaybillPrintData: jest.fn().mockResolvedValue({
        waybillNo: 'SF1234567890',
        waybillUrl: 'https://oss.example.com/waybill?id=abc',
        carrierCode: 'SF',
        carrierName: '顺丰速运',
      }),
      recordWaybillPrintAccess: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new SellerShippingController(shippingService as any);
    const { headers, res } = createMockResponse();

    await controller.printWaybill(
      'order-1',
      'company-1',
      'staff-1',
      String(Date.now() + 60_000),
      'sig',
      { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as any,
      res as any,
    );

    expect(headers.get('Content-Type')).toBe('application/pdf');
    expect(headers.get('Content-Disposition')).toBe('inline; filename="waybill-order-1.pdf"');
    expect(res.send).toHaveBeenCalledWith(pdfBuffer);
    expect(mockedApplyWaybillWatermark).not.toHaveBeenCalled();
    expect(shippingService.recordWaybillPrintAccess).toHaveBeenCalledWith(
      'company-1',
      'staff-1',
      'order-1',
      '127.0.0.1',
      'jest',
    );
  });

  it('serves a PDF when fetched content is a PDF but the content-type is application/octet-stream', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.7\nmock waybill');
    mockedFetchBinaryWithLimit.mockResolvedValueOnce({
      buffer: pdfBuffer,
      contentType: 'application/octet-stream',
    });
    mockedApplyWaybillWatermark.mockRejectedValueOnce(
      new Error('watermark should not run for PDF bytes'),
    );

    const shippingService = {
      verifyPrintSignature: jest.fn().mockReturnValue(true),
      getWaybillPrintData: jest.fn().mockResolvedValue({
        waybillNo: 'SF1234567890',
        waybillUrl: 'https://oss.example.com/private-download?id=abc',
        carrierCode: 'SF',
        carrierName: '顺丰速运',
      }),
      recordWaybillPrintAccess: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new SellerShippingController(shippingService as any);
    const { headers, res } = createMockResponse();

    await controller.printWaybill(
      'order-2',
      'company-1',
      'staff-1',
      String(Date.now() + 60_000),
      'sig',
      { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as any,
      res as any,
    );

    expect(headers.get('Content-Type')).toBe('application/pdf');
    expect(headers.get('Content-Disposition')).toBe('inline; filename="waybill-order-2.pdf"');
    expect(res.send).toHaveBeenCalledWith(pdfBuffer);
    expect(mockedApplyWaybillWatermark).not.toHaveBeenCalled();
  });
});
