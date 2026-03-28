import { Module } from '@nestjs/common';
import { AdminTagCategoriesController, AdminTagsController } from './admin-tags.controller';
import { AdminTagsService } from './admin-tags.service';

@Module({
  controllers: [AdminTagCategoriesController, AdminTagsController],
  providers: [AdminTagsService],
})
export class AdminTagsModule {}
