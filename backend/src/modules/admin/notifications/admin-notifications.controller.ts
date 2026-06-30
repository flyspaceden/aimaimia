import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { NotificationMessageService } from '../../notification/notification-message.service';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';

type NotificationUser = {
  sub: string;
};

@Public()
@UseGuards(AdminAuthGuard)
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly messages: NotificationMessageService) {}

  @Get()
  list(
    @CurrentUser() user: NotificationUser,
    @Query('category') category?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.messages.list(
      this.recipientKey(user),
      category,
      unreadOnly === 'true',
      this.parsePositiveInt(page, 1),
      this.parsePositiveInt(pageSize, 20),
    );
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: NotificationUser) {
    return this.messages.unreadCount(this.recipientKey(user));
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: NotificationUser, @Param('id') id: string) {
    return this.messages.markRead(this.recipientKey(user), id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: NotificationUser) {
    return this.messages.markAllRead(this.recipientKey(user));
  }

  private recipientKey(user: NotificationUser) {
    return `admin:${user.sub}`;
  }

  private parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
