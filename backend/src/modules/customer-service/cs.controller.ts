import { Controller, Post, Get, Param, Body, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CsService } from './cs.service';
import { CreateCsSessionDto } from './dto/cs-create-session.dto';
import { SubmitCsRatingDto } from './dto/cs-submit-rating.dto';

@Controller('cs')
export class CsController {
  constructor(private csService: CsService) {}

  @Post('sessions')
  createSession(@CurrentUser('sub') userId: string, @Body() dto: CreateCsSessionDto) {
    return this.csService.createSession(userId, dto.source, dto.sourceId);
  }

  @Get('sessions/active')
  getActiveSession(
    @CurrentUser('sub') userId: string,
    @Query('source') source: string,
    @Query('sourceId') sourceId?: string,
  ) {
    return this.csService.getActiveSession(userId, source, sourceId);
  }

  @Get('sessions/:id/messages')
  getMessages(@CurrentUser('sub') userId: string, @Param('id') sessionId: string) {
    return this.csService.getSessionMessages(sessionId, userId);
  }

  @Post('sessions/:id/rating')
  submitRating(
    @CurrentUser('sub') userId: string,
    @Param('id') sessionId: string,
    @Body() dto: SubmitCsRatingDto,
  ) {
    return this.csService.submitRating(sessionId, userId, dto.score, dto.tags ?? [], dto.comment);
  }

  @Get('quick-entries')
  getQuickEntries() {
    return this.csService.getQuickEntries();
  }
}
