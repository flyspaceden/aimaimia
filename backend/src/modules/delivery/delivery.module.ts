import { Module } from '@nestjs/common';
import { DeliveryPrismaModule } from '../../delivery-prisma/delivery-prisma.module';
import { DeliveryIdService } from './common/delivery-id.service';

@Module({
  imports: [DeliveryPrismaModule],
  providers: [DeliveryIdService],
  exports: [DeliveryIdService],
})
export class DeliveryModule {}
