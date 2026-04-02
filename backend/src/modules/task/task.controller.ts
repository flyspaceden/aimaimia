import { Controller, Get, Post, Param } from '@nestjs/common';
import { TaskService } from './task.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('tasks')
export class TaskController {
  constructor(private taskService: TaskService) {}

  /** 任务列表（含当前用户完成状态） */
  @Get()
  list(@CurrentUser('sub') userId: string) {
    return this.taskService.list(userId);
  }

  /** 完成任务（颁发积分/成长值） */
  @Post(':id/complete')
  complete(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.taskService.complete(id, userId);
  }
}
