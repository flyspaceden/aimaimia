import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Post,
  Param,
  Query,
} from '@nestjs/common';
import { InboxService } from './inbox.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('inbox')
export class InboxController {
  constructor(private inboxService: InboxService) {}

  /** 消息列表（筛选） */
  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @Query('category') category?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.inboxService.list(
      userId,
      category,
      unreadOnly === 'true',
      this.parsePositiveInt(page, 1),
      this.parsePositiveInt(pageSize, 20),
    );
  }

  /** 未读数 */
  @Get('unread-count')
  getUnreadCount(@CurrentUser('sub') userId: string) {
    return this.inboxService.getUnreadCount(userId);
  }

  /** 队列红包铃声专用稳定游标：按 createdAt + id 正序追赶，不受列表插入漂移影响。 */
  @Get('queue-reward-events')
  listQueueRewardEvents(
    @CurrentUser('sub') userId: string,
    @Query('afterCreatedAt') afterCreatedAt?: string,
    @Query('afterId') afterId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = new Date(afterCreatedAt ?? '');
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('afterCreatedAt 必须是有效时间');
    }
    return this.inboxService.listQueueRewardEventsAfter(
      userId,
      parsed,
      afterId ?? '',
      this.parsePositiveInt(limit, 100),
    );
  }

  /** 新设备首次启用铃声时使用服务端消息基线，避免客户端时钟偏差漏报。 */
  @Get('queue-reward-events/baseline')
  getQueueRewardEventBaseline(
    @CurrentUser('sub') userId: string,
  ) {
    return this.inboxService.getQueueRewardEventBaseline(userId);
  }

  /** 单条消息详情（仅当前买家可读） */
  @Get(':id')
  getOne(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.inboxService.getOne(id, userId);
  }

  /** 标记单条已读 */
  @Post(':id/read')
  markRead(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.inboxService.markRead(id, userId);
  }

  /** 全部已读 */
  @Post('read-all')
  markAllRead(@CurrentUser('sub') userId: string) {
    return this.inboxService.markAllRead(userId);
  }

  /** 删除全部已读消息（软删除，仅影响当前买家） */
  @Delete('read')
  deleteRead(@CurrentUser('sub') userId: string) {
    return this.inboxService.deleteRead(userId);
  }

  /** 删除全部消息（软删除，仅影响当前买家） */
  @Delete('all')
  deleteAll(@CurrentUser('sub') userId: string) {
    return this.inboxService.deleteAll(userId);
  }

  /** 恢复刚删除的单条消息 */
  @Post(':id/restore')
  restoreOne(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.inboxService.restoreOne(id, userId);
  }

  /** 删除单条消息（软删除，仅影响当前买家） */
  @Delete(':id')
  deleteOne(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.inboxService.deleteOne(id, userId);
  }

  private parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
