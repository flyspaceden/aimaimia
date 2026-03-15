import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductService } from './product.service';
import { Public } from '../../common/decorators/public.decorator';
import type { AiRecommendTheme } from '../ai/voice-intent.types';
import type { SemanticSlots } from './semantic-score';

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
    @Query('usageScenario') usageScenario?: string,
    @Query('originPreference') originPreference?: string,
    @Query('dietaryPreference') dietaryPreference?: string,
  ) {
    // 将语义槽位组装为 SemanticSlots（仅当至少有一项非空时传入）
    const hasSemanticSlots = usageScenario || originPreference || dietaryPreference;
    const parsedConstraints = constraints
      ? constraints
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    const slots: SemanticSlots | undefined = hasSemanticSlots
      ? {
          ...(usageScenario && { usageScenario }),
          ...(originPreference && { originPreference }),
          ...(dietaryPreference && { dietaryPreference }),
          ...(parsedConstraints.length > 0 && { constraints: parsedConstraints }),
        }
      : undefined;

    return this.productService.list(
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 8,
      categoryId,
      keyword,
      preferRecommended === '1' || preferRecommended === 'true',
      parsedConstraints,
      maxPrice ? parseFloat(maxPrice) : undefined,
      recommendThemes
        ? recommendThemes
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean) as AiRecommendTheme[]
        : [],
      slots,
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
