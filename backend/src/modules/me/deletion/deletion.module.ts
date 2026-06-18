import { Module } from '@nestjs/common';
import { DigitalAssetModule } from '../../digital-asset/digital-asset.module';
import { DeletionController } from './deletion.controller';
import { DeletionService } from './deletion.service';

@Module({
  imports: [DigitalAssetModule],
  controllers: [DeletionController],
  providers: [DeletionService],
  exports: [DeletionService],
})
export class DeletionModule {}
