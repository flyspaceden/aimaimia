import { Global, Module } from '@nestjs/common';
import { RedisCoordinatorService } from './redis-coordinator.service';

@Global()
@Module({
  providers: [RedisCoordinatorService],
  exports: [RedisCoordinatorService],
})
export class InfraModule {}

