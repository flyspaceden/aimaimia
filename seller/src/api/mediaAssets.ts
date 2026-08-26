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

export async function uploadProductImageAsset(file: File): Promise<UploadedProductImageAsset> {
  const form = new FormData();
  form.append('file', file);
  return client.post('/seller/media-assets/product-images', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}
