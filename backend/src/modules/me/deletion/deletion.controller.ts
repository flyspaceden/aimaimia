import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ExecuteDeletionDto } from './dto/deletion.dto';
import { DeletionService } from './deletion.service';

@Controller('me/deletion')
@UseGuards(JwtAuthGuard)
export class DeletionController {
  constructor(private readonly deletionService: DeletionService) {}

  @Get('preview')
  preview(@CurrentUser('sub') userId: string) {
    return this.deletionService.preview(userId);
  }

  @Post('sms-code')
  sendCode(@CurrentUser('sub') userId: string) {
    return this.deletionService.sendCode(userId);
  }

  @Post('execute')
  execute(
    @CurrentUser('sub') userId: string,
    @Body() dto: ExecuteDeletionDto,
    @Req() req: Request,
  ) {
    return this.deletionService.execute(
      userId,
      dto,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
  }
}
