import { Module } from '@nestjs/common';
import { GrowthModule } from '../growth/growth.module';
import { NormalShareController } from './normal-share.controller';
import { NormalShareDeferredService } from './normal-share-deferred.service';
import { NormalShareService } from './normal-share.service';

@Module({
  imports: [GrowthModule],
  controllers: [NormalShareController],
  providers: [NormalShareService, NormalShareDeferredService],
  exports: [NormalShareService, NormalShareDeferredService],
})
export class NormalShareModule {}
