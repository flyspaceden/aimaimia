import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { DeliveryUserAuthGuard } from '../auth/guards/delivery-user-auth.guard';
import { PhoneLoginDto } from './dto/phone-login.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';
import { DeliveryBuyerAuthService } from './delivery-buyer-auth.service';

@Public()
@Controller('delivery')
export class DeliveryBuyerAuthController {
  constructor(private readonly deliveryBuyerAuthService: DeliveryBuyerAuthService) {}

  @Post('auth/phone-login')
  phoneLogin(@Body() dto: PhoneLoginDto, @Req() req: Request) {
    return this.deliveryBuyerAuthService.phoneLogin(
      dto,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
  }

  @Post('auth/wechat-login')
  wechatLogin(@Body() dto: WechatLoginDto, @Req() req: Request) {
    return this.deliveryBuyerAuthService.wechatLogin(
      dto,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
  }

  @UseGuards(DeliveryUserAuthGuard)
  @Get('me')
  getMe(@CurrentUser('deliveryUserId') deliveryUserId: string) {
    return this.deliveryBuyerAuthService.getMe(deliveryUserId);
  }
}
