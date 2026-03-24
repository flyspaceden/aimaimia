import { Controller, Get, Param, Query } from '@nestjs/common';
import { CompanyService } from './company.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('companies')
export class CompanyController {
  constructor(private companyService: CompanyService) {}

  @Public()
  @Get()
  list() {
    return this.companyService.list();
  }

  @Public()
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.companyService.getById(id);
  }

  @Public()
  @Get(':id/products')
  listProducts(
    @Param('id') companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('category') category?: string,
  ) {
    return this.companyService.listCompanyProducts(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      category: category || undefined,
    });
  }

  @Public()
  @Get(':id/events')
  listEvents(@Param('id') companyId: string) {
    return this.companyService.listActivities(companyId);
  }
}
