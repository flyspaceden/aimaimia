import { Module } from '@nestjs/common';
import { DigitalAssetController } from './digital-asset.controller';
import { DigitalAssetService } from './digital-asset.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [DigitalAssetController],
  providers: [DigitalAssetService],
  exports: [DigitalAssetService],
})
export class DigitalAssetModule {}
