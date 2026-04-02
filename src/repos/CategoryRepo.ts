import { categories as staticCategories } from '../constants/categories';
import { Category, Result } from '../types';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

const getCategoryIcon = (categoryName: string, categoryPath?: string): string => {
  const text = `${categoryName} ${categoryPath ?? ''}`;

  if (/水果|鲜果|柑橘|浆果|榴莲/u.test(text)) return 'fruit-watermelon';
  if (/蔬菜|叶菜|根茎|菌菇|有机/u.test(text)) return 'sprout';
  if (/水产|海鲜|鱼|虾|蟹/u.test(text)) return 'fish';
  if (/牛|羊|猪|肉|禽蛋|鸡蛋|蛋/u.test(text)) return 'food-steak';
  if (/粮油|米|面|杂粮/u.test(text)) return 'rice';
  if (/茶/u.test(text)) return 'tea';
  if (/蜂蜜/u.test(text)) return 'bee';
  if (/礼盒/u.test(text)) return 'gift';
  if (/农资/u.test(text)) return 'tractor';

  return 'shape-outline';
};

const decorateCategories = (items: Array<Omit<Category, 'icon'> & { icon?: string }>): Category[] =>
  items.map((item) => ({
    ...item,
    icon: item.icon || getCategoryIcon(item.name, item.path),
  }));

export const CategoryRepo = {
  list: async (): Promise<Result<Category[]>> => {
    if (USE_MOCK) {
      return simulateRequest(
        decorateCategories(
          staticCategories.map((category) => ({
            id: category.id,
            name: category.name,
            parentId: null,
            level: 1,
            path: `/${category.name}`,
            icon: category.icon,
          })),
        ),
        { failRate: 0.08 },
      );
    }

    const result = await ApiClient.get<Array<Omit<Category, 'icon'>>>('/products/categories');
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      data: decorateCategories(result.data),
    };
  },
};
