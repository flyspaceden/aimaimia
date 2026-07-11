import { Module } from '@nestjs/common';
import { DigitalAssetModule } from '../../digital-asset/digital-asset.module';
import { ProfitModule } from '../../profit/profit.module';
import { AdminDigitalAssetController } from './admin-digital-asset.controller';
import { AdminDigitalAssetService } from './admin-digital-asset.service';

@Module({
  imports: [DigitalAssetModule, ProfitModule],
  controllers: [AdminDigitalAssetController],
  providers: [AdminDigitalAssetService],
})
export class AdminDigitalAssetModule {}
