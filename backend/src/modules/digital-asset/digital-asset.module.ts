import { Module } from '@nestjs/common';
import { DigitalAssetController } from './digital-asset.controller';
import { DigitalAssetService } from './digital-asset.service';

@Module({
  controllers: [DigitalAssetController],
  providers: [DigitalAssetService],
  exports: [DigitalAssetService],
})
export class DigitalAssetModule {}
