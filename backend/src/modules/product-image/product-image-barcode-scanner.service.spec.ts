import { ProductImageBarcodeScannerService } from './product-image-barcode-scanner.service';
import { productEan13Fixture } from '../../../test/fixtures/product-ean13';

describe('ProductImageBarcodeScannerService', () => {
  it('detects a real RGB EAN-13 image without mocking the decoder', async () => {
    await expect(new ProductImageBarcodeScannerService().scan(await productEan13Fixture()))
      .resolves.toMatchObject({ status: 'DETECTED', formats: ['EAN_13'] });
  });
  it('keeps a decode miss inconclusive instead of inferring that an image contains no barcode', async () => {
    const scanner = new ProductImageBarcodeScannerService();
    await expect(scanner.scan(Buffer.from('not-an-image'))).resolves.toEqual({
      status: 'INCONCLUSIVE',
      detectedCount: 0,
      formats: [],
    });
  });
});
