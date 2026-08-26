import { Injectable } from '@nestjs/common';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
const sharp = require('sharp') as typeof import('sharp').default;

export type BarcodeScanResult = {
  status: 'NONE' | 'DETECTED' | 'INCONCLUSIVE';
  detectedCount: number;
  formats: string[];
};

const MAX_SCAN_EDGE = 2048;

/**
 * Local 1D barcode decoder. A decode miss is never proof of absence: damaged,
 * tiny, low-contrast and unsupported barcodes must remain INCONCLUSIVE so a
 * later FREE_TUNE cannot accidentally alter protected facts.
 */
@Injectable()
export class ProductImageBarcodeScannerService {
  async scan(buffer: Buffer): Promise<BarcodeScanResult> {
    try {
      const { data, info } = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
        .resize({ width: MAX_SCAN_EDGE, height: MAX_SCAN_EDGE, fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (!info.width || !info.height || info.channels !== 3) {
        return { status: 'INCONCLUSIVE', detectedCount: 0, formats: [] };
      }
      const bitmap = new BinaryBitmap(
        new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)),
      );
      const hints = new Map<DecodeHintType, unknown>([
        [DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
          BarcodeFormat.CODABAR, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
          BarcodeFormat.ITF, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
        ]],
        [DecodeHintType.TRY_HARDER, true],
      ]);
      const reader = new MultiFormatReader();
      try {
        const result = reader.decode(bitmap, hints);
        return {
          status: 'DETECTED',
          detectedCount: 1,
          formats: [BarcodeFormat[result.getBarcodeFormat()] ?? String(result.getBarcodeFormat())],
        };
      } catch {
        return { status: 'INCONCLUSIVE', detectedCount: 0, formats: [] };
      }
    } catch {
      return { status: 'INCONCLUSIVE', detectedCount: 0, formats: [] };
    }
  }
}
