import { Module } from '@nestjs/common';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { GrowthModule } from '../growth/growth.module';

@Module({
  imports: [GrowthModule],
  controllers: [TaskController],
  providers: [TaskService],
})
export class TaskModule {}
