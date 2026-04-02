export type CategoryItem = {
  id: string;
  name: string;
  icon: string;
};

export const categories: CategoryItem[] = [
  { id: 'fresh', name: '生鲜', icon: 'fish' },
  { id: 'vegetable', name: '蔬菜', icon: 'sprout' },
  { id: 'fruit', name: '水果', icon: 'fruit-watermelon' },
  { id: 'organic', name: '天然有机', icon: 'leaf' },
  { id: 'grain', name: '粮油', icon: 'rice' },
  { id: 'tea', name: '茶饮', icon: 'tea' },
  { id: 'gift', name: '礼盒', icon: 'gift' },
  { id: 'equipment', name: '农资', icon: 'tractor' },
];
