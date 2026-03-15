import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductService } from './product.service';
import { Public } from '../../common/decorators/public.decorator';
import type { AiRecommendTheme } from '../ai/voice-intent.types';

@Controller('products')
export class ProductController {
  constructor(private productService: ProductService) {}

  @Public()
  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('categoryId') categoryId?: string,
    @Query('keyword') keyword?: string,
    @Query('preferRecommended') preferRecommended?: string,
    @Query('constraints') constraints?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('recommendThemes') recommendThemes?: string,
  ) {
    return this.productService.list(
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 8,
      categoryId,
      keyword,
      preferRecommended === '1' || preferRecommended === 'true',
      constraints
        ? constraints
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
      maxPrice ? parseFloat(maxPrice) : undefined,
      recommendThemes
        ? recommendThemes
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean) as AiRecommendTheme[]
        : [],
    );
  }

  /** 分类树 */
  @Public()
  @Get('categories')
  getCategories() {
    return this.productService.getCategories();
  }

  @Public()
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.productService.getById(id);
  }
}
