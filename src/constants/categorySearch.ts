export const CATEGORY_KEYWORDS_BY_ID: Record<string, string[]> = {
  fresh: ['生鲜', '鲜', '鸡蛋', '番茄', '生菜', '蓝莓'],
  vegetable: ['蔬菜', '生菜', '番茄', '菜'],
  fruit: ['水果', '蓝莓', '草莓', '苹果', '梨', '果'],
  organic: ['有机', '绿色', '天然'],
  grain: ['粮油', '粮', '米', '胚芽', '谷', '杂粮'],
  tea: ['茶饮', '茶', '绿茶', '红茶'],
  gift: ['礼盒', '礼品', '送礼'],
  equipment: ['农资', '设备', '工具'],
};

export const CATEGORY_SEARCH_ALIASES: Record<string, string[]> = {
  生鲜: CATEGORY_KEYWORDS_BY_ID.fresh,
  蔬菜: CATEGORY_KEYWORDS_BY_ID.vegetable,
  青菜: CATEGORY_KEYWORDS_BY_ID.vegetable,
  时蔬: CATEGORY_KEYWORDS_BY_ID.vegetable,
  水果: CATEGORY_KEYWORDS_BY_ID.fruit,
  鲜果: CATEGORY_KEYWORDS_BY_ID.fruit,
  果品: CATEGORY_KEYWORDS_BY_ID.fruit,
  果子: CATEGORY_KEYWORDS_BY_ID.fruit,
  有机: CATEGORY_KEYWORDS_BY_ID.organic,
  粮油: CATEGORY_KEYWORDS_BY_ID.grain,
  杂粮: CATEGORY_KEYWORDS_BY_ID.grain,
  茶饮: CATEGORY_KEYWORDS_BY_ID.tea,
  茶叶: CATEGORY_KEYWORDS_BY_ID.tea,
  礼盒: CATEGORY_KEYWORDS_BY_ID.gift,
  农资: CATEGORY_KEYWORDS_BY_ID.equipment,
};
