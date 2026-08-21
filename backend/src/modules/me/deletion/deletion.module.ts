import { Module } from '@nestjs/common';
import { DigitalAssetModule } from '../../digital-asset/digital-asset.module';
import { QueueRewardModule } from '../../queue-reward/queue-reward.module';
import { AuthModule } from '../../auth/auth.module';
import { DeletionController } from './deletion.controller';
import { DeletionService } from './deletion.service';

@Module({
  imports: [DigitalAssetModule, QueueRewardModule, AuthModule],
  controllers: [DeletionController],
  providers: [DeletionService],
  exports: [DeletionService],
})
export class DeletionModule {}
