import { ServiceUnavailableException } from '@nestjs/common';
import { SellerMediaAssetsController } from './seller-media-assets.controller';

describe('SellerMediaAssetsController', () => {
  it('keeps the deterministic renderer unavailable until controlled candidate adoption exists', () => {
    const controller = new SellerMediaAssetsController({} as any);
    expect(() => controller.composeWhite()).toThrow(ServiceUnavailableException);
  });
});
