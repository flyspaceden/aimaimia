import { Module } from '@nestjs/common';
import { DeliveryPrismaModule } from '../../delivery-prisma/delivery-prisma.module';

@Module({
  imports: [DeliveryPrismaModule],
})
export class DeliveryModule {}
