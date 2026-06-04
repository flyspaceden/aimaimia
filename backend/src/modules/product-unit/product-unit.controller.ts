import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { ProductUnitService } from './product-unit.service';

@Controller('product-units')
export class ProductUnitController {
  constructor(private readonly service: ProductUnitService) {}

  /**
   * 计量单位下拉数据（仅启用项）。
   * @Public() 跳过全局买家 Guard，使卖家端（seller JWT）与管理端均可直接读取。
   */
  @Public()
  @Get()
  listActive() {
    return this.service.listActive();
  }
}
