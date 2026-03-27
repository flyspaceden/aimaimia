import { Module } from '@nestjs/common';
import { DeferredLinkController } from './deferred-link.controller';
import { DeferredLinkService } from './deferred-link.service';

@Module({
  controllers: [DeferredLinkController],
  providers: [DeferredLinkService],
})
export class DeferredLinkModule {}
