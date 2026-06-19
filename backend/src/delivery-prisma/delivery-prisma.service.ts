import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/delivery-client';

@Injectable()
export class DeliveryPrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
