import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { SellerAuthService } from './seller-auth.service';
import {
  SellerSmsCodeDto,
  SellerLoginDto,
  SellerPasswordLoginDto,
  SellerSelectCompanyDto,
  SellerRefreshDto,
  SellerChangePasswordDto,
  SellerBindPhoneSmsCodeDto,
  SellerChangePhoneDto,
  SellerChangeNicknameDto,
} from './seller-auth.dto';
import {
  SellerSendForgotPasswordCodeDto,
  SellerListCompaniesForResetDto,
  SellerResetForgotPasswordDto,
} from './dto/seller-forgot-password.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { CurrentSeller } from '../common/decorators/current-seller.decorator';
import { CaptchaService } from '../../captcha/captcha.service';

@Controller('seller/auth')
export class SellerAuthController {
  constructor(
    private authService: SellerAuthService,
    private captchaService: CaptchaService,
  ) {}

  /** 获取图形验证码 */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 20 } })
  @Get('captcha')
  async getCaptcha() {
    return this.captchaService.generate();
  }

  /** 发送验证码 */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 3 } })
  @Post('sms/code')
  sendSmsCode(@Body() dto: SellerSmsCodeDto, @Req() req: Request) {
    return this.authService.sendSmsCode(dto, req.ip);
  }

  /** 手机号 + 验证码登录 */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('login')
  login(@Body() dto: SellerLoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip, req.headers['user-agent']);
  }

  /** 手机号 + 密码登录 */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('login-by-password')
  loginByPassword(@Body() dto: SellerPasswordLoginDto, @Req() req: Request) {
    return this.authService.loginByPassword(dto, req.ip, req.headers['user-agent']);
  }

  // ------------------------------------------------------------------------
  // 忘记密码（方案 β 三步：send-code → list-companies → reset）
  // ------------------------------------------------------------------------

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 3 } })
  @Post('forgot-password/send-code')
  sendForgotPasswordCode(@Body() dto: SellerSendForgotPasswordCodeDto) {
    return this.authService.sendForgotPasswordCode(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 10 } })
  @Post('forgot-password/list-companies')
  listCompaniesForReset(@Body() dto: SellerListCompaniesForResetDto) {
    return this.authService.listCompaniesForReset(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('forgot-password/reset')
  resetForgotPassword(@Body() dto: SellerResetForgotPasswordDto, @Req() req: Request) {
    return this.authService.resetForgotPassword(
      dto,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
  }

  /** 多企业用户选择企业 */
  @Public()
  @Post('select-company')
  selectCompany(@Body() dto: SellerSelectCompanyDto, @Req() req: Request) {
    return this.authService.selectCompany(dto, req.ip, req.headers['user-agent']);
  }

  /** 刷新 Token */
  @Public()
  @Post('refresh')
  refresh(@Body() dto: SellerRefreshDto) {
    return this.authService.refresh(dto);
  }

  /** 登出 */
  @Public()
  @UseGuards(SellerAuthGuard)
  @Post('logout')
  logout(@CurrentSeller('sub') staffId: string) {
    return this.authService.logout(staffId);
  }

  /** 获取当前卖家信息 */
  @Public()
  @UseGuards(SellerAuthGuard)
  @Get('me')
  getMe(@CurrentSeller('sub') staffId: string) {
    return this.authService.getMe(staffId);
  }

  // ===================== C40c7 账号安全 =====================

  /** 修改密码（已登录态，旧密码 + 新密码，仅当前 staff） */
  @Public()
  @UseGuards(SellerAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('change-password')
  changePassword(
    @CurrentSeller('sub') staffId: string,
    @Body() dto: SellerChangePasswordDto,
  ) {
    return this.authService.changePassword(staffId, dto);
  }

  /** 给新手机号发绑定验证码 */
  @Public()
  @UseGuards(SellerAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 3 } })
  @Post('bind-phone/sms/code')
  sendBindPhoneSmsCode(
    @CurrentSeller('userId') userId: string,
    @Body() dto: SellerBindPhoneSmsCodeDto,
  ) {
    return this.authService.sendBindPhoneSmsCode(dto, userId);
  }

  /** 修改手机号（已登录态，双重 SMS 验证，影响 User 名下所有企业 staff） */
  @Public()
  @UseGuards(SellerAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('change-phone')
  changePhone(
    @CurrentSeller('sub') staffId: string,
    @CurrentSeller('userId') userId: string,
    @Body() dto: SellerChangePhoneDto,
  ) {
    return this.authService.changePhone(staffId, userId, dto);
  }

  /** 自助修改昵称（不需要 SMS，直接更新 UserProfile.nickname） */
  @Public()
  @UseGuards(SellerAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('change-nickname')
  changeNickname(
    @CurrentSeller('userId') userId: string,
    @Body() dto: SellerChangeNicknameDto,
  ) {
    return this.authService.changeNickname(userId, dto);
  }
}
