import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { SellerAuthService } from './seller-auth.service';
import {
  SellerSmsCodeDto,
  SellerLoginDto,
  SellerSelectCompanyDto,
  SellerRefreshDto,
} from './seller-auth.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { CurrentSeller } from '../common/decorators/current-seller.decorator';

@Controller('seller/auth')
export class SellerAuthController {
  constructor(private authService: SellerAuthService) {}

  /** 发送验证码 */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('sms/code')
  sendSmsCode(@Body() dto: SellerSmsCodeDto) {
    return this.authService.sendSmsCode(dto.phone);
  }

  /** 手机号 + 验证码登录 */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login')
  login(@Body() dto: SellerLoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip, req.headers['user-agent']);
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
