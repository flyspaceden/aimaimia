import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  liveness() {
    return this.healthService.liveness();
  }

  @Get('ready')
  readiness() {
    return this.healthService.readiness();
  }
}
