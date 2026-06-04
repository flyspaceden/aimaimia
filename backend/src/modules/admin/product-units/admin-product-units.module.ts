import { Module } from '@nestjs/common';
import { AdminProductUnitsController } from './admin-product-units.controller';
import { AdminProductUnitsService } from './admin-product-units.service';

@Module({
  controllers: [AdminProductUnitsController],
  providers: [AdminProductUnitsService],
})
export class AdminProductUnitsModule {}
