import { Module } from '@nestjs/common';
import { ProductUnitController } from './product-unit.controller';
import { ProductUnitService } from './product-unit.service';

@Module({
  controllers: [ProductUnitController],
  providers: [ProductUnitService],
})
export class ProductUnitModule {}
