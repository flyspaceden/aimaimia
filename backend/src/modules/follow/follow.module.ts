import { Module } from '@nestjs/common';
import { FollowController, AuthorController } from './follow.controller';
import { FollowService } from './follow.service';

@Module({
  controllers: [FollowController, AuthorController],
  providers: [FollowService],
})
export class FollowModule {}
