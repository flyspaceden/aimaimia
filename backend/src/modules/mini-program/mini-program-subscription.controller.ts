import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RecordMiniProgramSubscriptionConsentsDto } from './dto/mini-program-subscription.dto';
import { MiniProgramSubscriptionService } from './mini-program-subscription.service';

@Controller('mini-program/subscriptions')
export class MiniProgramSubscriptionController {
  constructor(private readonly subscriptions: MiniProgramSubscriptionService) {}

  @Get('templates')
  getTemplates() {
    return this.subscriptions.getTemplatesForClient();
  }

  @Post('consents')
  recordConsents(
    @CurrentUser('sub') userId: string,
    @CurrentUser('sessionId') sessionId: string | undefined,
    @CurrentUser('authIdentityId') authIdentityId: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RecordMiniProgramSubscriptionConsentsDto,
  ) {
    if (!idempotencyKey || idempotencyKey.trim() !== dto.clientRequestId) {
      throw new BadRequestException('订阅授权请求标识不一致');
    }
    return this.subscriptions.recordConsents(userId, {
      sessionId,
      authIdentityId,
    }, dto);
  }
}
