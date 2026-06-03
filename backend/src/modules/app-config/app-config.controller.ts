import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AppConfigService } from './app-config.service';

@Public()
@Controller('app/config')
export class AppConfigController {
  constructor(private readonly service: AppConfigService) {}

  @Get()
  getPublicConfig() {
    return this.service.getPublicConfig();
  }
}
