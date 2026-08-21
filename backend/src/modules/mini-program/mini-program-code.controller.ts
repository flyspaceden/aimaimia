import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CreateMiniProgramCodeDto } from './dto/mini-program-code.dto';
import { MiniProgramCodeService } from './mini-program-code.service';

@Controller('mini-program')
export class MiniProgramCodeController {
  constructor(private readonly codes: MiniProgramCodeService) {}

  @Post('codes')
  createCode(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateMiniProgramCodeDto,
  ) {
    return this.codes.createCode(userId, dto.kind);
  }

  @Public()
  @Get('scenes/:token')
  resolveScene(@Param('token') token: string) {
    return this.codes.resolveScene(token);
  }
}
