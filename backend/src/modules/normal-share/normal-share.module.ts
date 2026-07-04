import { Module } from '@nestjs/common';
import { NormalShareController } from './normal-share.controller';
import { NormalShareService } from './normal-share.service';

@Module({
  controllers: [NormalShareController],
  providers: [NormalShareService],
  exports: [NormalShareService],
})
export class NormalShareModule {}
