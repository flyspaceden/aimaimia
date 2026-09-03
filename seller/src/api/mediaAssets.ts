import client from './client';

export type ProductImageQualityAdvisory = {
  code: 'IMAGE_TOO_SMALL' | 'PORTRAIT_CROP_RISK' | 'TOO_DARK' | 'TOO_BRIGHT' | 'LOW_CONTRAST';
  severity: 'warning';
};

export type SellerProductMediaAsset = {
  id: string;
  status?: 'AVAILABLE' | 'CANDIDATE' | 'ADOPTED' | 'RETIRED';
  objectKey: string;
  width: number;
  height: number;
  diagnosis?: { advisories?: ProductImageQualityAdvisory[] } | null;
};

export type UploadedProductImageAsset = {
  asset: SellerProductMediaAsset;
  displayUrl: string;
  expiresAt: string | null;
};

export async function uploadProductImageAsset(
  file: File,
  onUploadPercent?: (percent: number) => void,
): Promise<UploadedProductImageAsset> {
  const form = new FormData();
  form.append('file', file);
  return client.post('/seller/media-assets/product-images', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // 商品证据图需要完成无损规范化、二维码扫描和 OSS 写入，不能沿用
    // 普通 JSON 请求的 15 秒超时。
    timeout: 120_000,
    onUploadProgress: (event) => {
      const progress = typeof event.progress === 'number'
        ? event.progress
        : event.total ? event.loaded / event.total : 0;
      onUploadPercent?.(Math.max(0, Math.min(100, Math.round(progress * 100))));
    },
  });
}
