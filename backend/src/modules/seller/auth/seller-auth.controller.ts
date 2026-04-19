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
} from './seller-auth.dto';
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
}
