import { Controller, Get, Post, Param } from '@nestjs/common';
import { RecommendationService } from './recommendation.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('recommendations')
export class RecommendationController {
  constructor(private recommendationService: RecommendationService) {}

  @Get('me')
  getForMe(@CurrentUser('sub') userId: string) {
    return this.recommendationService.getForUser(userId);
  }

  @Post(':id/not-interested')
  markNotInterested(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.recommendationService.markNotInterested(userId, id);
  }
}
