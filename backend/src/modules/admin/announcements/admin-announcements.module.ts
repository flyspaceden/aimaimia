import { Module } from '@nestjs/common';
import { AdminAnnouncementsController } from './admin-announcements.controller';
import { AdminAnnouncementsService } from './admin-announcements.service';

@Module({
  controllers: [AdminAnnouncementsController],
  providers: [AdminAnnouncementsService],
})
export class AdminAnnouncementsModule {}
