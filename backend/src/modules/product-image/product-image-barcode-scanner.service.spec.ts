import { ProductImageBarcodeScannerService } from './product-image-barcode-scanner.service';

describe('ProductImageBarcodeScannerService', () => {
  it('keeps a decode miss inconclusive instead of inferring that an image contains no barcode', async () => {
    const scanner = new ProductImageBarcodeScannerService();
    await expect(scanner.scan(Buffer.from('not-an-image'))).resolves.toEqual({
      status: 'INCONCLUSIVE',
      detectedCount: 0,
      formats: [],
    });
  });
});
