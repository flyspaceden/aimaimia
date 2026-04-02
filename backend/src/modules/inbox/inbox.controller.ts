import { Controller, Get, Post, Param, Query } from '@nestjs/common';
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
  ) {
    return this.inboxService.list(userId, category, unreadOnly === 'true');
  }

  /** 未读数 */
  @Get('unread-count')
  getUnreadCount(@CurrentUser('sub') userId: string) {
    return this.inboxService.getUnreadCount(userId);
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
}
