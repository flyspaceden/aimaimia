import { Global, Module } from '@nestjs/common';
import { DeliveryPrismaService } from './delivery-prisma.service';

@Global()
@Module({
  providers: [DeliveryPrismaService],
  exports: [DeliveryPrismaService],
})
export class DeliveryPrismaModule {}
