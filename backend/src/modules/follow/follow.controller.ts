import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { FollowService } from './follow.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('follows')
export class FollowController {
  constructor(private followService: FollowService) {}

  /** 我的关注列表 */
  @Get()
  listFollowing(
    @CurrentUser('sub') userId: string,
    @Query('role') role?: string,
    @Query('sort') sort?: string,
  ) {
    return this.followService.listFollowing(userId, role, sort);
  }

  /** 关注/取关切换 */
  @Post(':authorId/toggle')
  toggle(
    @CurrentUser('sub') userId: string,
    @Param('authorId') authorId: string,
  ) {
    return this.followService.toggleFollow(userId, authorId);
  }
}

@Controller('authors')
export class AuthorController {
  constructor(private followService: FollowService) {}

  /** 作者公开资料（含 isFollowed 状态） */
  @Get(':id')
  getProfile(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.followService.getAuthorProfile(id, userId);
  }
}
