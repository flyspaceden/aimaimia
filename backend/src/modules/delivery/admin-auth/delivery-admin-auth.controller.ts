import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { CaptchaService } from '../../captcha/captcha.service';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import {
  DeliveryAdminBindPhoneSmsCodeDto,
  DeliveryAdminChangePasswordDto,
  DeliveryAdminChangePhoneDto,
  DeliveryAdminLoginByPhoneCodeDto,
  DeliveryAdminLoginDto,
  DeliveryAdminRefreshDto,
  DeliveryAdminSmsCodeDto,
} from './delivery-admin-auth.dto';
import { DeliveryAdminAuthService } from './delivery-admin-auth.service';

@Controller('delivery-admin/auth')
export class DeliveryAdminAuthController {
  constructor(
    private readonly deliveryAdminAuthService: DeliveryAdminAuthService,
    private readonly captchaService: CaptchaService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 20 } })
  @Get('captcha')
  getCaptcha() {
    return this.captchaService.generate();
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('login')
  login(@Body() dto: DeliveryAdminLoginDto, @Req() req: Request) {
    return this.deliveryAdminAuthService.login(
      dto,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 3 } })
  @Post('sms/code')
  sendSmsCode(@Body() dto: DeliveryAdminSmsCodeDto, @Req() req: Request) {
    return this.deliveryAdminAuthService.sendSmsCode(dto, req.ip);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('login-by-phone-code')
  loginByPhoneCode(@Body() dto: DeliveryAdminLoginByPhoneCodeDto, @Req() req: Request) {
    return this.deliveryAdminAuthService.loginByPhoneCode(
      dto,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: DeliveryAdminRefreshDto) {
    return this.deliveryAdminAuthService.refresh(dto);
  }

  @Public()
  @UseGuards(DeliveryAdminAuthGuard)
  @Post('logout')
  logout(@CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string) {
    return this.deliveryAdminAuthService.logout(deliveryAdminUserId);
  }

  @Public()
  @UseGuards(DeliveryAdminAuthGuard)
  @Get('profile')
  getProfile(@CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string) {
    return this.deliveryAdminAuthService.getProfile(deliveryAdminUserId);
  }

  @Public()
  @UseGuards(DeliveryAdminAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('change-password')
  changePassword(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Body() dto: DeliveryAdminChangePasswordDto,
  ) {
    return this.deliveryAdminAuthService.changePassword(deliveryAdminUserId, dto);
  }

  @Public()
  @UseGuards(DeliveryAdminAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 3 } })
  @Post('bind-phone/sms/code')
  sendBindPhoneSmsCode(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Body() dto: DeliveryAdminBindPhoneSmsCodeDto,
  ) {
    return this.deliveryAdminAuthService.sendBindPhoneSmsCode(deliveryAdminUserId, dto);
  }

  @Public()
  @UseGuards(DeliveryAdminAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('change-phone')
  changePhone(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Body() dto: DeliveryAdminChangePhoneDto,
  ) {
    return this.deliveryAdminAuthService.changePhone(deliveryAdminUserId, dto);
  }
}
