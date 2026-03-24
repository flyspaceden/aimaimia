import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CaptchaService } from './captcha.service';

@Controller('captcha')
export class CaptchaController {
  constructor(private captchaService: CaptchaService) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Get()
  async getCaptcha() {
    return this.captchaService.generate();
  }
}
