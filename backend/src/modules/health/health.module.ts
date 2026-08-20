import { Module } from '@nestjs/common';
import { InfraModule } from '../../common/infra/infra.module';
import { DeliveryPrismaModule } from '../../delivery-prisma/delivery-prisma.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [PrismaModule, DeliveryPrismaModule, InfraModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
