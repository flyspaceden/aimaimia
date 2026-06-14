import { Module } from '@nestjs/common';
import { DigitalAssetModule } from '../../digital-asset/digital-asset.module';
import { AdminDigitalAssetController } from './admin-digital-asset.controller';
import { AdminDigitalAssetService } from './admin-digital-asset.service';

@Module({
  imports: [DigitalAssetModule],
  controllers: [AdminDigitalAssetController],
  providers: [AdminDigitalAssetService],
})
export class AdminDigitalAssetModule {}
