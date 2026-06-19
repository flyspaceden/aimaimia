import { Module } from '@nestjs/common';
import { DeliveryPrismaModule } from '../../delivery-prisma/delivery-prisma.module';
import { DeliveryAuthModule } from './auth/delivery-auth.module';
import { DeliveryIdService } from './common/delivery-id.service';

@Module({
  imports: [DeliveryPrismaModule, DeliveryAuthModule],
  providers: [DeliveryIdService],
  exports: [DeliveryIdService, DeliveryAuthModule],
})
export class DeliveryModule {}
