import { Module } from '@nestjs/common';
import { NormalShareController } from './normal-share.controller';
import { NormalShareDeferredService } from './normal-share-deferred.service';
import { NormalShareService } from './normal-share.service';

@Module({
  controllers: [NormalShareController],
  providers: [NormalShareService, NormalShareDeferredService],
  exports: [NormalShareService, NormalShareDeferredService],
})
export class NormalShareModule {}
