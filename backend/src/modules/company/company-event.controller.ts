import { Controller, Get, Param } from '@nestjs/common';
import { CompanyService } from './company.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('company-events')
export class CompanyEventController {
  constructor(private companyService: CompanyService) {}

  @Public()
  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.companyService.getActivityById(id);
  }
}
