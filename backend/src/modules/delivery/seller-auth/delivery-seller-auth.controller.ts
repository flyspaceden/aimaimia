import { BadRequestException, Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { CaptchaService } from '../../captcha/captcha.service';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import {
  DeliverySellerBindPhoneSmsCodeDto,
  DeliverySellerChangeNicknameDto,
  DeliverySellerChangePasswordDto,
  DeliverySellerChangePhoneDto,
  DeliverySellerLoginDto,
  DeliverySellerPasswordLoginDto,
  DeliverySellerRefreshDto,
  DeliverySellerSelectCompanyDto,
  DeliverySellerSmsCodeDto,
} from './delivery-seller-auth.dto';
import {
  DeliverySellerListCompaniesForResetDto,
  DeliverySellerResetForgotPasswordDto,
  DeliverySellerSendForgotPasswordCodeDto,
} from './dto/delivery-seller-forgot-password.dto';
import { DeliverySellerAuthService } from './delivery-seller-auth.service';

@Controller('delivery-seller/auth')
export class DeliverySellerAuthController {
  constructor(
    private readonly deliverySellerAuthService: DeliverySellerAuthService,
    private readonly captchaService: CaptchaService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 20 } })
  @Get('captcha')
  getCaptcha() {
    return this.captchaService.generate();
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 3 } })
  @Post('sms/code')
  sendSmsCode(@Body() dto: DeliverySellerSmsCodeDto, @Req() req: Request) {
    return this.deliverySellerAuthService.sendSmsCode(dto, req.ip);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('login')
  login(@Body() dto: DeliverySellerLoginDto, @Req() req: Request) {
    return this.deliverySellerAuthService.login(
      dto,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('login-by-password')
  async loginByPassword(@Body() dto: DeliverySellerPasswordLoginDto, @Req() req: Request) {
    const captchaOk = await this.captchaService.verify(dto.captchaId, dto.captchaCode);
    if (!captchaOk) {
      throw new UnauthorizedException({
        code: 'CAPTCHA_INVALID',
        message: '图形验证码错误或已过期',
      });
    }
    return this.deliverySellerAuthService.loginByPassword(
      dto,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
  }

  @Public()
  @Post('select-company')
  selectCompany(@Body() dto: DeliverySellerSelectCompanyDto, @Req() req: Request) {
    return this.deliverySellerAuthService.selectCompany(
      dto,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: DeliverySellerRefreshDto) {
    return this.deliverySellerAuthService.refresh(dto);
  }

  @UseGuards(DeliverySellerAuthGuard)
  @Post('logout')
  logout(@CurrentUser('sessionId') sessionId: string) {
    return this.deliverySellerAuthService.logout(sessionId);
  }

  @UseGuards(DeliverySellerAuthGuard)
  @Get('me')
  getMe(@CurrentUser('sub') staffId: string) {
    return this.deliverySellerAuthService.getMe(staffId);
  }

  @UseGuards(DeliverySellerAuthGuard)
  @Post('change-password')
  changePassword(
    @CurrentUser('sub') staffId: string,
    @Body() dto: DeliverySellerChangePasswordDto,
  ) {
    return this.deliverySellerAuthService.changePassword(staffId, dto);
  }

  @UseGuards(DeliverySellerAuthGuard)
  @Post('bind-phone/sms/code')
  sendBindPhoneSmsCode(
    @CurrentUser('sub') staffId: string,
    @Body() dto: DeliverySellerBindPhoneSmsCodeDto,
  ) {
    return this.deliverySellerAuthService.sendBindPhoneSmsCode(staffId, dto);
  }

  @UseGuards(DeliverySellerAuthGuard)
  @Post('change-phone')
  changePhone(
    @CurrentUser('sub') staffId: string,
    @Body() dto: DeliverySellerChangePhoneDto,
  ) {
    return this.deliverySellerAuthService.changePhone(staffId, dto);
  }

  @UseGuards(DeliverySellerAuthGuard)
  @Post('change-nickname')
  changeNickname(
    @CurrentUser('sub') staffId: string,
    @Body() dto: DeliverySellerChangeNicknameDto,
  ) {
    return this.deliverySellerAuthService.changeNickname(staffId, dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 3 } })
  @Post('forgot-password/send-code')
  async sendForgotPasswordCode(@Body() dto: DeliverySellerSendForgotPasswordCodeDto) {
    const captchaOk = await this.captchaService.verify(dto.captchaId, dto.captchaCode);
    if (!captchaOk) {
      throw new BadRequestException({
        code: 'CAPTCHA_INVALID',
        message: '图形验证码错误或已过期',
      });
    }
    return this.deliverySellerAuthService.sendForgotPasswordCode(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 10 } })
  @Post('forgot-password/list-companies')
  listCompaniesForReset(@Body() dto: DeliverySellerListCompaniesForResetDto) {
    return this.deliverySellerAuthService.listCompaniesForReset(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('forgot-password/reset')
  resetForgotPassword(@Body() dto: DeliverySellerResetForgotPasswordDto) {
    return this.deliverySellerAuthService.resetForgotPassword(dto);
  }
}
