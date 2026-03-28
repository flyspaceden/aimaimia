import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CompanyService } from './company.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('companies')
export class CompanyController {
  constructor(
    private companyService: CompanyService,
    private jwtService: JwtService,
  ) {}

  @Public()
  @Get()
  list() {
    return this.companyService.list();
  }

  /** 公开接口：获取标签类别与标签选项 */
  @Public()
  @Get('tag-categories')
  listTagCategories(@Query('scope') scope?: string) {
    return this.companyService.listTagCategories(scope);
  }

  @Public()
  @Get(':id')
  getById(@Param('id') id: string, @Req() req: any) {
    // 尝试从 token 中提取 userId（可选，不强制认证）
    let userId: string | undefined;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const decoded = this.jwtService.verify(token, { secret: process.env.JWT_SECRET });
        userId = decoded.sub;
      }
    } catch {
      // token 无效或缺失，忽略
    }
    return this.companyService.getById(id, userId);
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
