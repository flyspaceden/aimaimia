# 电商展示商城 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 website/ 官网内嵌入一套 6 页响应式电商展示商城，供 App Store 审核员验证平台电商属性，纯前端 mock，不连后端。

**Architecture:** 商城路由 `/shop/*` 使用独立 ShopLayout（含专属 ShopNavbar/ShopFooter），App.tsx 检测路由前缀对 `/shop/*` 隐藏官网 Navbar/Footer；购物车用 ShopCart 内 useState 本地管理；所有商品数据来自 shopMockData.ts。

**Tech Stack:** React 19 + TypeScript + React Router v7（Outlet 嵌套路由）+ Tailwind CSS 3（website/ 现有技术栈）

---

## File Map

**新建：**
- `website/src/data/shopMockData.ts` — Product/Category 类型 + 28 条 mock 数据
- `website/src/components/shop/ShopNavbar.tsx` — 响应式商城顶导
- `website/src/components/shop/ShopFooter.tsx` — 商城底部备案信息
- `website/src/components/shop/ShopLayout.tsx` — ShopNavbar + Outlet + ShopFooter
- `website/src/components/shop/ProductCard.tsx` — 商品卡片（点击跳详情）
- `website/src/pages/shop/ShopHome.tsx` — 首页（Banner + 秒杀条 + 3个商品分区）
- `website/src/pages/shop/ShopCategory.tsx` — 分类列表（子分类筛选 + 排序 + 网格）
- `website/src/pages/shop/ShopProduct.tsx` — 商品详情（SKU + 数量 + 加购/购买）
- `website/src/pages/shop/ShopCart.tsx` — 购物车（列表 + 结算摘要）
- `website/src/pages/shop/ShopCheckout.tsx` — 结账页（地址 + 配送 + 支付 + 成功弹窗）
- `website/src/pages/shop/ShopUser.tsx` — 个人中心（用户信息 + 订单状态 + 菜单）

**修改：**
- `website/src/App.tsx` — 新增 /shop/* 嵌套路由；对 /shop/* 隐藏主 Navbar/Footer
- `website/src/components/layout/Navbar.tsx` — 新增"进入商城"Link 按钮（桌面+移动端菜单）
- `website/src/styles/globals.css` — 新增 `.scrollbar-hide` utility

---

## Task 1: Mock 数据

**Files:**
- Create: `website/src/data/shopMockData.ts`

- [ ] **Step 1: 创建 shopMockData.ts**

```typescript
// website/src/data/shopMockData.ts

export interface ProductSpec {
  label: string
  value: string
}

export interface ProductSku {
  label: string
  price: number
}

export interface Product {
  id: string
  name: string
  subtitle: string
  price: number
  originalPrice: number
  emoji: string
  bgGradient: string
  categoryId: string
  origin: string
  specs: ProductSpec[]
  tags: string[]
  stock: number
  description: string
  skus: ProductSku[]
  badge?: string
}

export interface Category {
  id: string
  label: string
  emoji: string
  subCategories: string[]
}

export const SHOP_CATEGORIES: Category[] = [
  { id: 'all',       label: '全部',     emoji: '🛒', subCategories: [] },
  { id: 'seafood',   label: '海鲜水产', emoji: '🦐', subCategories: ['螃蟹', '虾类', '贝类', '其他'] },
  { id: 'fish',      label: '鱼类',     emoji: '🐟', subCategories: ['淡水鱼', '海水鱼', '冻鱼'] },
  { id: 'fruit',     label: '新鲜水果', emoji: '🍊', subCategories: ['荔枝龙眼', '热带水果', '柑橘类'] },
  { id: 'vegetable', label: '时令蔬菜', emoji: '🥬', subCategories: ['叶菜类', '根茎类', '瓜类'] },
  { id: 'meat',      label: '肉禽蛋',   emoji: '🥩', subCategories: ['猪肉', '家禽', '鸡蛋'] },
  { id: 'specialty', label: '农家特产', emoji: '🌾', subCategories: ['腌制品', '干货', '调味料'] },
  { id: 'frozen',    label: '冷冻食品', emoji: '🧊', subCategories: ['速冻海鲜', '速冻蔬菜', '预制菜'] },
]

export const SHOP_PRODUCTS: Product[] = [
  // ── 海鲜水产 ──
  {
    id: 'p001',
    name: '阳江肉蟹',
    subtitle: '野生活蟹 · 肉质饱满',
    price: 68,
    originalPrice: 88,
    emoji: '🦀',
    bgGradient: 'linear-gradient(135deg, #e0f7fa, #b2dfdb)',
    categoryId: 'seafood',
    origin: '广东阳江',
    specs: [
      { label: '规格', value: '500g/只（±30g）' },
      { label: '品种', value: '远海青蟹（肉蟹）' },
      { label: '捕捞方式', value: '野生捕捞，当日发货' },
      { label: '储存方式', value: '冷链保鲜 0-4°C' },
      { label: '保质期', value: '收到后建议当日食用' },
    ],
    tags: ['🚚 顺丰冷链', '✅ 产地直发', '🌊 活蟹保鲜'],
    stock: 128,
    description: '阳江肉蟹产自广东省阳江市沿海，肉质饱满，膏黄丰厚，鲜甜可口。采用顺丰冷链专线运输，从捕捞到送达全程不超过24小时，确保生猛新鲜。',
    skus: [{ label: '500g/只', price: 68 }, { label: '750g/只', price: 95 }, { label: '1000g/只(±50g)', price: 120 }],
    badge: '热销',
  },
  {
    id: 'p002',
    name: '湛江大对虾',
    subtitle: '活冻直发 · 虾肉饱满',
    price: 45,
    originalPrice: 60,
    emoji: '🦐',
    bgGradient: 'linear-gradient(135deg, #fff3e0, #ffe0b2)',
    categoryId: 'seafood',
    origin: '广东湛江',
    specs: [
      { label: '规格', value: '500g/袋，约10-12只' },
      { label: '品种', value: '南美白对虾' },
      { label: '处理方式', value: '活冻锁鲜' },
      { label: '储存方式', value: '-18°C 冷冻保存' },
      { label: '保质期', value: '冷冻保存12个月' },
    ],
    tags: ['❄️ 活冻锁鲜', '✅ 产地直发', '🔥 爆款'],
    stock: 256,
    description: '湛江对虾养殖于广东湛江优质海域，水质清澈，虾肉弹嫩鲜甜。采用活冻工艺，在虾活着时迅速冷冻，最大程度保留鲜味。',
    skus: [{ label: '500g/袋', price: 45 }, { label: '1kg/袋', price: 85 }, { label: '2kg/箱', price: 158 }],
    badge: '产地直发',
  },
  {
    id: 'p003',
    name: '湛江龙虾',
    subtitle: '活鲜空运 · 肉质鲜嫩',
    price: 128,
    originalPrice: 168,
    emoji: '🦞',
    bgGradient: 'linear-gradient(135deg, #fbe9e7, #ffccbc)',
    categoryId: 'seafood',
    origin: '广东湛江',
    specs: [
      { label: '规格', value: '600g/只（±50g）' },
      { label: '品种', value: '波纹龙虾' },
      { label: '运输方式', value: '活鲜充氧空运' },
      { label: '储存方式', value: '收到后冷藏，当日烹饪' },
    ],
    tags: ['✈️ 活鲜空运', '🌊 产地捕捞', '🍽️ 宴席首选'],
    stock: 42,
    description: '产自湛江近海的天然龙虾，生长于水质优良的深海，肉质鲜美细嫩。采用充氧保鲜盒空运，确保到手时仍是活蹦乱跳的鲜活状态。',
    skus: [{ label: '600g/只', price: 128 }, { label: '800g/只', price: 168 }, { label: '1kg/只', price: 210 }],
    badge: '活鲜',
  },
  {
    id: 'p004',
    name: '湛江生蚝',
    subtitle: '肉质肥美 · 12只装',
    price: 58,
    originalPrice: 75,
    emoji: '🦪',
    bgGradient: 'linear-gradient(135deg, #fce4ec, #f8bbd0)',
    categoryId: 'seafood',
    origin: '广东湛江',
    specs: [
      { label: '规格', value: '12只/箱，单只约80-120g' },
      { label: '品种', value: '太平洋牡蛎' },
      { label: '养殖方式', value: '深海吊养，18个月以上' },
      { label: '储存方式', value: '冷藏0-4°C，建议3日内食用' },
    ],
    tags: ['🌊 深海吊养', '✅ 检疫合格', '🍋 配料包赠送'],
    stock: 180,
    description: '湛江生蚝产自广东湛江雷州半岛，这里的海水盐度适中、浮游生物丰富，是生蚝生长的黄金海域。肉质肥厚饱满，汁水丰盈，鲜味浓郁。',
    skus: [{ label: '12只/箱', price: 58 }, { label: '24只/箱', price: 108 }, { label: '36只/箱', price: 155 }],
    badge: '新鲜',
  },
  {
    id: 'p005',
    name: '阳江膏蟹',
    subtitle: '蟹黄丰厚 · 秋季限定',
    price: 89,
    originalPrice: 118,
    emoji: '🦀',
    bgGradient: 'linear-gradient(135deg, #e8f5e9, #c8e6c9)',
    categoryId: 'seafood',
    origin: '广东阳江',
    specs: [
      { label: '规格', value: '500g/只' },
      { label: '品种', value: '远海青蟹（膏蟹）' },
      { label: '特点', value: '蟹黄饱满，秋季最肥' },
      { label: '储存方式', value: '冷藏，建议当日食用' },
    ],
    tags: ['🟡 蟹黄饱满', '🍂 秋季限定', '✅ 活蟹保鲜'],
    stock: 65,
    description: '膏蟹是青蟹中品质最高的一类，蟹黄饱满金黄，口感绵密香浓。阳江产膏蟹受益于南海优质水域，是粤菜中的珍贵食材。',
    skus: [{ label: '500g/只', price: 89 }, { label: '750g/只', price: 128 }],
  },
  {
    id: 'p006',
    name: '潮汕血蚶',
    subtitle: '鲜活现捞 · 汆水即食',
    price: 28,
    originalPrice: 38,
    emoji: '🐚',
    bgGradient: 'linear-gradient(135deg, #f3e5f5, #e1bee7)',
    categoryId: 'seafood',
    origin: '广东汕头',
    specs: [
      { label: '规格', value: '500g' },
      { label: '品种', value: '泥蚶（血蚶）' },
      { label: '食用方式', value: '沸水烫10秒，即开即食' },
      { label: '储存方式', value: '冷藏，24小时内食用' },
    ],
    tags: ['🌊 现捞新鲜', '🍽️ 潮汕名产', '⚡ 快手美食'],
    stock: 320,
    description: '血蚶是潮汕美食的代表之一，也是广东人喜爱的海鲜小食。汕头出产的血蚶肉质饱满，汁水鲜甜，用沸水烫开即可蘸酱食用。',
    skus: [{ label: '500g', price: 28 }, { label: '1kg', price: 52 }],
  },
  {
    id: 'p007',
    name: '雷州章鱼',
    subtitle: '鲜活捕捞 · 肉质Q弹',
    price: 35,
    originalPrice: 48,
    emoji: '🐙',
    bgGradient: 'linear-gradient(135deg, #e8eaf6, #c5cae9)',
    categoryId: 'seafood',
    origin: '广东湛江雷州',
    specs: [
      { label: '规格', value: '500g（约1-2只）' },
      { label: '品种', value: '短蛸章鱼' },
      { label: '处理方式', value: '新鲜冷藏' },
      { label: '储存方式', value: '冷藏0-4°C，3日内食用' },
    ],
    tags: ['🌊 近海捕捞', '🍳 百搭食材', '✅ 无添加'],
    stock: 88,
    description: '雷州半岛近海捕捞的野生章鱼，生长于干净海域，肉质Q弹爽滑，鲜味十足。可炒、可煮、可凉拌，是粤菜家常食材。',
    skus: [{ label: '500g', price: 35 }, { label: '1kg', price: 65 }],
  },
  {
    id: 'p008',
    name: '珠海带鱼',
    subtitle: '银光闪亮 · 肉嫩少刺',
    price: 22,
    originalPrice: 32,
    emoji: '🐟',
    bgGradient: 'linear-gradient(135deg, #e3f2fd, #bbdefb)',
    categoryId: 'seafood',
    origin: '广东珠海',
    specs: [
      { label: '规格', value: '500g，约2-3段' },
      { label: '品种', value: '东海带鱼' },
      { label: '处理方式', value: '速冻锁鲜' },
      { label: '储存方式', value: '-18°C 冷冻，6个月内食用' },
    ],
    tags: ['❄️ 速冻锁鲜', '🍳 老少皆宜', '✅ 无鱼刺处理'],
    stock: 215,
    description: '珠海出产的带鱼银光闪亮，表皮完整，肉质细嫩鲜美，刺少易食。红烧、清蒸、煎炸皆宜，是广东家庭餐桌上的常见美食。',
    skus: [{ label: '500g', price: 22 }, { label: '1kg', price: 40 }, { label: '2kg', price: 75 }],
    badge: '特惠',
  },
  // ── 鱼类 ──
  {
    id: 'p009',
    name: '顺德鲩鱼',
    subtitle: '淡水河鲜 · 顺德名产',
    price: 32,
    originalPrice: 45,
    emoji: '🐠',
    bgGradient: 'linear-gradient(135deg, #e8f5e9, #c8e6c9)',
    categoryId: 'fish',
    origin: '广东佛山顺德',
    specs: [
      { label: '规格', value: '约1.5kg/条' },
      { label: '品种', value: '草鱼（鲩鱼）' },
      { label: '养殖方式', value: '顺德基塘鱼塘' },
      { label: '储存方式', value: '活鱼配送，冷藏当日食用' },
    ],
    tags: ['🌿 基塘养殖', '🍜 顺德名产', '✅ 活鱼直发'],
    stock: 96,
    description: '顺德是广东淡水鱼养殖的核心产区，基塘鱼塘养殖的鲩鱼肉质细嫩，无土腥味，是做鱼生、清蒸、水煮鱼的上乘食材。',
    skus: [{ label: '约1.5kg/条', price: 32 }, { label: '约2kg/条', price: 42 }],
  },
  {
    id: 'p010',
    name: '南海石斑鱼',
    subtitle: '深海野生 · 高档食材',
    price: 88,
    originalPrice: 120,
    emoji: '🐡',
    bgGradient: 'linear-gradient(135deg, #fff8e1, #ffecb3)',
    categoryId: 'fish',
    origin: '广东湛江',
    specs: [
      { label: '规格', value: '约400g/条' },
      { label: '品种', value: '点带石斑鱼' },
      { label: '捕捞方式', value: '南海野生捕捞' },
      { label: '储存方式', value: '活鱼氧气袋，冷藏当日食用' },
    ],
    tags: ['🌊 深海野生', '🍽️ 高档宴席', '✅ 活鱼发货'],
    stock: 38,
    description: '南海野生石斑鱼，生长于深海礁石区，肉质雪白细嫩，富含优质蛋白，是粤式清蒸鱼的最佳食材，也是宴席待客的高档菜肴。',
    skus: [{ label: '约400g/条', price: 88 }, { label: '约600g/条', price: 128 }],
    badge: '野生',
  },
  {
    id: 'p011',
    name: '顺德鳗鱼',
    subtitle: '香滑软糯 · 补气养血',
    price: 76,
    originalPrice: 98,
    emoji: '🐍',
    bgGradient: 'linear-gradient(135deg, #fafafa, #f5f5f5)',
    categoryId: 'fish',
    origin: '广东佛山顺德',
    specs: [
      { label: '规格', value: '约800g/条' },
      { label: '品种', value: '日本鳗鲡' },
      { label: '养殖方式', value: '顺德生态养殖' },
      { label: '储存方式', value: '冷链配送，冷藏3日内食用' },
    ],
    tags: ['🌿 生态养殖', '💪 补气养血', '🍳 红烧最佳'],
    stock: 54,
    description: '顺德出产的鳗鱼肉质香滑软糯，营养丰富，含有大量不饱和脂肪酸和优质蛋白。红烧鳗鱼是广东传统滋补名菜。',
    skus: [{ label: '约800g/条', price: 76 }, { label: '约1kg/条', price: 95 }],
  },
  // ── 新鲜水果 ──
  {
    id: 'p012',
    name: '增城荔枝',
    subtitle: '桂味荔枝 · 果肉晶莹',
    price: 28,
    originalPrice: 38,
    emoji: '🍈',
    bgGradient: 'linear-gradient(135deg, #fffde7, #fff9c4)',
    categoryId: 'fruit',
    origin: '广东广州增城',
    specs: [
      { label: '规格', value: '500g' },
      { label: '品种', value: '桂味荔枝' },
      { label: '采摘', value: '人工现采，当日发货' },
      { label: '储存方式', value: '冷藏2-4°C，5日内食用' },
    ],
    tags: ['🌳 树上熟透', '❄️ 冷链配送', '🏆 增城特产'],
    stock: 480,
    description: '增城桂味荔枝是广东最著名的荔枝品种之一，果皮薄，果肉晶莹剔透，核小肉厚，清甜带有桂花香气，是荔枝中的极品。',
    skus: [{ label: '500g', price: 28 }, { label: '1kg', price: 52 }, { label: '3kg礼盒', price: 148 }],
    badge: '当季',
  },
  {
    id: 'p013',
    name: '徐闻菠萝',
    subtitle: '金钻菠萝 · 香甜多汁',
    price: 12,
    originalPrice: 18,
    emoji: '🍍',
    bgGradient: 'linear-gradient(135deg, #fff9c4, #fff176)',
    categoryId: 'fruit',
    origin: '广东湛江徐闻',
    specs: [
      { label: '规格', value: '约1.5kg/个' },
      { label: '品种', value: '金钻凤梨' },
      { label: '产地', value: '徐闻菠萝产区（中国最大菠萝基地）' },
      { label: '储存方式', value: '常温放置，5日内食用' },
    ],
    tags: ['🌞 产地直发', '🍰 无需泡盐水', '✅ 检疫合格'],
    stock: 680,
    description: '徐闻是中国最大的菠萝产区，出产的金钻菠萝酸甜适中，汁水丰富，不需要泡盐水就可以直接食用，口感清甜爽脆。',
    skus: [{ label: '1个约1.5kg', price: 12 }, { label: '3个装', price: 32 }, { label: '5个装', price: 50 }],
  },
  {
    id: 'p014',
    name: '高州龙眼',
    subtitle: '石硖龙眼 · 清甜爽口',
    price: 22,
    originalPrice: 30,
    emoji: '🍇',
    bgGradient: 'linear-gradient(135deg, #fce4ec, #f8bbd0)',
    categoryId: 'fruit',
    origin: '广东茂名高州',
    specs: [
      { label: '规格', value: '500g' },
      { label: '品种', value: '石硖龙眼' },
      { label: '采摘', value: '人工采摘，新鲜发货' },
      { label: '储存方式', value: '冷藏3-5°C，7日内食用' },
    ],
    tags: ['🌿 无公害种植', '🏆 高州名产', '❄️ 冷链保鲜'],
    stock: 350,
    description: '高州石硖龙眼是广东著名特产，果实饱满，核小肉厚，清甜爽口，香气浓郁。高州得天独厚的气候条件造就了上等龙眼的品质。',
    skus: [{ label: '500g', price: 22 }, { label: '1kg', price: 40 }, { label: '2kg礼盒', price: 75 }],
    badge: '当季',
  },
  {
    id: 'p015',
    name: '潮州柚子',
    subtitle: '蜜柚清香 · 果肉饱满',
    price: 15,
    originalPrice: 22,
    emoji: '🍋',
    bgGradient: 'linear-gradient(135deg, #f9fbe7, #f0f4c3)',
    categoryId: 'fruit',
    origin: '广东潮州',
    specs: [
      { label: '规格', value: '约1kg/个' },
      { label: '品种', value: '沙田柚' },
      { label: '采摘', value: '树上熟透再采' },
      { label: '储存方式', value: '常温放置，30日内食用' },
    ],
    tags: ['🌳 树上熟透', '🏮 中秋佳品', '✅ 有机种植'],
    stock: 285,
    description: '潮州沙田柚皮厚肉嫩，果汁丰富，甜而不腻，是中秋节的传统节令水果，也是广东人最喜爱的水果之一。',
    skus: [{ label: '约1个1kg', price: 15 }, { label: '2个装', price: 28 }, { label: '礼盒4个', price: 55 }],
  },
  // ── 时令蔬菜 ──
  {
    id: 'p016',
    name: '广州菜心',
    subtitle: '嫩绿爽脆 · 当日采摘',
    price: 5,
    originalPrice: 8,
    emoji: '🥬',
    bgGradient: 'linear-gradient(135deg, #e8f5e9, #c8e6c9)',
    categoryId: 'vegetable',
    origin: '广东广州',
    specs: [
      { label: '规格', value: '500g/扎' },
      { label: '品种', value: '广州菜心' },
      { label: '采摘', value: '清晨采摘，当日配送' },
      { label: '储存方式', value: '冷藏，3日内食用' },
    ],
    tags: ['🌿 当日采摘', '❌ 无农药残留', '✅ 基地直发'],
    stock: 800,
    description: '广州菜心是粤菜中最常见的绿叶蔬菜，叶嫩茎脆，清甜爽口。清晨采摘后冷链配送，保证蔬菜的新鲜度和营养价值。',
    skus: [{ label: '500g', price: 5 }, { label: '1kg', price: 9 }, { label: '2kg', price: 16 }],
  },
  {
    id: 'p017',
    name: '潮汕芥菜',
    subtitle: '清脆爽口 · 腌制两用',
    price: 8,
    originalPrice: 12,
    emoji: '🥦',
    bgGradient: 'linear-gradient(135deg, #f1f8e9, #dcedc8)',
    categoryId: 'vegetable',
    origin: '广东汕头',
    specs: [
      { label: '规格', value: '500g' },
      { label: '品种', value: '潮汕大芥菜' },
      { label: '采摘', value: '当季新鲜' },
      { label: '储存方式', value: '冷藏，5日内食用' },
    ],
    tags: ['🌿 时令鲜蔬', '🏺 腌制两用', '✅ 无污染种植'],
    stock: 420,
    description: '潮汕大芥菜是广东潮汕地区的特色蔬菜，可新鲜炒食，也可腌制成著名的潮汕咸菜。味道清脆，营养丰富。',
    skus: [{ label: '500g', price: 8 }, { label: '1kg', price: 14 }],
  },
  {
    id: 'p018',
    name: '佛山节瓜',
    subtitle: '粤式家常 · 清甜软糯',
    price: 6,
    originalPrice: 10,
    emoji: '🥒',
    bgGradient: 'linear-gradient(135deg, #e8f5e9, #a5d6a7)',
    categoryId: 'vegetable',
    origin: '广东佛山',
    specs: [
      { label: '规格', value: '约500g/个' },
      { label: '品种', value: '节瓜（毛瓜）' },
      { label: '采摘', value: '当季新鲜采摘' },
      { label: '储存方式', value: '阴凉处放置，7日内食用' },
    ],
    tags: ['🌿 时令鲜蔬', '🍲 煲汤首选', '✅ 生态种植'],
    stock: 560,
    description: '节瓜又称毛瓜，是粤菜常用食材，肉质细嫩清甜，含水量高。煲汤、炒食、酿肉都是经典做法，是广东夏秋季节的代表性蔬菜。',
    skus: [{ label: '约500g/个', price: 6 }, { label: '约1kg', price: 10 }],
  },
  // ── 肉禽蛋 ──
  {
    id: 'p019',
    name: '清远鸡',
    subtitle: '散养土鸡 · 肉质鲜嫩',
    price: 58,
    originalPrice: 78,
    emoji: '🍗',
    bgGradient: 'linear-gradient(135deg, #fff8e1, #ffe082)',
    categoryId: 'meat',
    origin: '广东清远',
    specs: [
      { label: '规格', value: '约1.2kg/只' },
      { label: '品种', value: '清远麻鸡' },
      { label: '养殖方式', value: '山地散养180天以上' },
      { label: '储存方式', value: '冷藏，3日内食用' },
    ],
    tags: ['🌿 散养土鸡', '🏆 清远特产', '🍲 白切最佳'],
    stock: 120,
    description: '清远麻鸡是广东四大名鸡之一，在山地自由散养180天以上，肉质紧实鲜嫩，皮薄骨细，鸡味浓郁。白切鸡的首选食材。',
    skus: [{ label: '约1.2kg/只', price: 58 }, { label: '约1.5kg/只', price: 72 }],
    badge: '爆款',
  },
  {
    id: 'p020',
    name: '深圳本地猪肉',
    subtitle: '新鲜现宰 · 当日配送',
    price: 35,
    originalPrice: 45,
    emoji: '🥩',
    bgGradient: 'linear-gradient(135deg, #fce4ec, #ef9a9a)',
    categoryId: 'meat',
    origin: '广东深圳',
    specs: [
      { label: '规格', value: '500g，五花肉' },
      { label: '品种', value: '黑毛猪' },
      { label: '处理方式', value: '当日现宰，真空包装' },
      { label: '储存方式', value: '冷藏0-4°C，3日内食用' },
    ],
    tags: ['🐷 当日现宰', '❌ 无激素', '✅ 检疫合格'],
    stock: 200,
    description: '本地新鲜猪肉，当日宰杀，真空保鲜包装配送。选用优质黑毛猪，不添加瘦肉精，肉色红润，脂肪分布均匀，口感鲜美。',
    skus: [{ label: '五花肉500g', price: 35 }, { label: '梅花肉500g', price: 38 }, { label: '里脊肉500g', price: 40 }],
  },
  // ── 农家特产 ──
  {
    id: 'p021',
    name: '潮州凤凰单枞',
    subtitle: '山地茶叶 · 清香高扬',
    price: 88,
    originalPrice: 120,
    emoji: '🍵',
    bgGradient: 'linear-gradient(135deg, #e8f5e9, #a5d6a7)',
    categoryId: 'specialty',
    origin: '广东潮州凤凰山',
    specs: [
      { label: '规格', value: '100g/罐' },
      { label: '品种', value: '凤凰单枞（鸭屎香）' },
      { label: '采摘', value: '春茶，手工采摘' },
      { label: '储存方式', value: '密封避光，常温保存' },
    ],
    tags: ['🌿 高山茶园', '🏆 潮州名产', '🎁 送礼佳品'],
    stock: 95,
    description: '凤凰单枞产于广东潮州凤凰山，鸭屎香是单枞中最受欢迎的品种之一，香气高扬，兰花蜜香，口感醇厚回甘，是中国乌龙茶的代表。',
    skus: [{ label: '100g/罐', price: 88 }, { label: '250g/罐', price: 198 }, { label: '500g礼盒', price: 380 }],
    badge: '特产',
  },
  {
    id: 'p022',
    name: '阳西咸鱼干',
    subtitle: '传统腌制 · 咸香下饭',
    price: 32,
    originalPrice: 45,
    emoji: '🐡',
    bgGradient: 'linear-gradient(135deg, #fff3e0, #ffcc80)',
    categoryId: 'specialty',
    origin: '广东阳江阳西',
    specs: [
      { label: '规格', value: '250g/包' },
      { label: '品种', value: '马交鱼咸鱼干' },
      { label: '腌制工艺', value: '传统海盐腌制，日晒风干' },
      { label: '储存方式', value: '密封阴凉，6个月内食用' },
    ],
    tags: ['🌞 天然晒制', '🎖️ 百年工艺', '🍚 下饭神器'],
    stock: 160,
    description: '阳西咸鱼干是广东沿海传统食品，选用新鲜海鱼，以海盐腌制后天然日晒风干，保留了鱼的原始鲜味，咸香浓郁，是广东人最爱的下饭菜。',
    skus: [{ label: '250g/包', price: 32 }, { label: '500g/包', price: 58 }],
  },
  // ── 冷冻食品 ──
  {
    id: 'p023',
    name: '虾饺皮（广式）',
    subtitle: '港式点心 · 在家复刻',
    price: 18,
    originalPrice: 25,
    emoji: '🥟',
    bgGradient: 'linear-gradient(135deg, #f3e5f5, #ce93d8)',
    categoryId: 'frozen',
    origin: '广东广州',
    specs: [
      { label: '规格', value: '10张/包' },
      { label: '品种', value: '澄粉虾饺皮' },
      { label: '储存方式', value: '-18°C 冷冻，3个月内使用' },
      { label: '使用方式', value: '解冻后包馅蒸制' },
    ],
    tags: ['🏠 在家做早茶', '🍤 配料自备', '✅ 无添加'],
    stock: 380,
    description: '广式虾饺皮采用澄粉制作，晶莹剔透，口感爽滑软韧，是在家复刻港式早茶虾饺的必备材料。10张一包，量足实惠。',
    skus: [{ label: '10张/包', price: 18 }, { label: '30张/包', price: 48 }],
  },
  {
    id: 'p024',
    name: '速冻白灼虾',
    subtitle: '活冻锁鲜 · 即煮即食',
    price: 38,
    originalPrice: 52,
    emoji: '🦐',
    bgGradient: 'linear-gradient(135deg, #fbe9e7, #ffab91)',
    categoryId: 'frozen',
    origin: '广东湛江',
    specs: [
      { label: '规格', value: '500g/袋，约15-20只' },
      { label: '品种', value: '南美白对虾（活冻）' },
      { label: '处理方式', value: '活虾急冻，未调味' },
      { label: '储存方式', value: '-18°C 冷冻，12个月内食用' },
    ],
    tags: ['❄️ 活冻锁鲜', '⚡ 3分钟即食', '✅ 无防腐剂'],
    stock: 420,
    description: '湛江活虾在捕捞后立即急冻，保留原汁原味。白灼、蒜蓉蒸、油焖大虾皆适用，是家庭常备的海鲜速冻食品。',
    skus: [{ label: '500g/袋', price: 38 }, { label: '1kg/袋', price: 72 }, { label: '2kg/箱', price: 135 }],
    badge: '热销',
  },
  {
    id: 'p025',
    name: '广式腊肠',
    subtitle: '甜润香浓 · 传统工艺',
    price: 42,
    originalPrice: 58,
    emoji: '🌭',
    bgGradient: 'linear-gradient(135deg, #ffebee, #ef9a9a)',
    categoryId: 'frozen',
    origin: '广东广州',
    specs: [
      { label: '规格', value: '250g/包，约8-10根' },
      { label: '品种', value: '广式甜腊肠' },
      { label: '工艺', value: '天然猪肠衣灌制，烘干' },
      { label: '储存方式', value: '-18°C 冷冻，6个月内食用' },
    ],
    tags: ['🎖️ 传统工艺', '🍚 煲仔饭必备', '🎁 年货首选'],
    stock: 310,
    description: '广式腊肠采用优质猪肉配以广东玫瑰酒、蔗糖腌制，灌入天然猪肠衣后低温烘干，色泽红亮，甜润香浓，是广东煲仔饭的灵魂配料。',
    skus: [{ label: '250g/包', price: 42 }, { label: '500g/包', price: 78 }, { label: '年货礼盒1kg', price: 148 }],
    badge: '经典',
  },

  // Additional seafood items for variety
  {
    id: 'p026',
    name: '北海花蛤',
    subtitle: '鲜活现捞 · 炒辣最佳',
    price: 18,
    originalPrice: 26,
    emoji: '🐚',
    bgGradient: 'linear-gradient(135deg, #e3f2fd, #90caf9)',
    categoryId: 'seafood',
    origin: '广西北海',
    specs: [
      { label: '规格', value: '500g' },
      { label: '品种', value: '菲律宾蛤仔（花蛤）' },
      { label: '处理方式', value: '净水吐沙，鲜活发货' },
      { label: '储存方式', value: '冷藏，24小时内食用' },
    ],
    tags: ['🌊 鲜活配送', '🌶️ 炒辣一绝', '✅ 吐沙处理'],
    stock: 450,
    description: '北海花蛤产自广西北海优质海域，贝肉饱满，鲜甜爽脆。经净水吐沙处理后发货，辣炒、蒜蓉蒸、葱姜炒，都是下饭神菜。',
    skus: [{ label: '500g', price: 18 }, { label: '1kg', price: 34 }],
  },
  {
    id: 'p027',
    name: '东莞香蕉',
    subtitle: '粉蕉甜糯 · 产地直发',
    price: 8,
    originalPrice: 12,
    emoji: '🍌',
    bgGradient: 'linear-gradient(135deg, #fffde7, #fff176)',
    categoryId: 'fruit',
    origin: '广东东莞',
    specs: [
      { label: '规格', value: '约700g/把，5-6根' },
      { label: '品种', value: '粉蕉' },
      { label: '采摘', value: '七八成熟采摘，到家刚好' },
      { label: '储存方式', value: '常温放置，避免冷藏' },
    ],
    tags: ['🌴 产地直发', '🍯 清甜软糯', '✅ 无催熟剂'],
    stock: 720,
    description: '东莞粉蕉是广东特色香蕉品种，比普通香蕉更小更甜，果肉绵软细腻，香气浓郁。七八成熟采摘快递，到家后刚好成熟食用。',
    skus: [{ label: '约700g/把', price: 8 }, { label: '约1.5kg两把', price: 14 }, { label: '约5kg箱装', price: 42 }],
  },
  {
    id: 'p028',
    name: '惠州竹笋',
    subtitle: '鲜嫩爽脆 · 山野气息',
    price: 10,
    originalPrice: 15,
    emoji: '🌿',
    bgGradient: 'linear-gradient(135deg, #f1f8e9, #aed581)',
    categoryId: 'vegetable',
    origin: '广东惠州',
    specs: [
      { label: '规格', value: '500g，已去壳' },
      { label: '品种', value: '雷竹笋' },
      { label: '采摘', value: '当日现挖，当日发货' },
      { label: '储存方式', value: '冷藏，3日内食用' },
    ],
    tags: ['🌿 当日现挖', '🏔️ 山地种植', '✅ 无农药'],
    stock: 280,
    description: '惠州山地出产的新鲜竹笋，鲜嫩爽脆，带有淡淡的山野清香。现挖现发，保证新鲜度。炒肉、红烧、煮汤，是广东家庭的时令美食。',
    skus: [{ label: '500g去壳', price: 10 }, { label: '1kg去壳', price: 18 }],
  },
]

// 首页推荐商品 ID 分组
export const HOME_SECTIONS = [
  {
    title: '🦀 爆款海鲜',
    categoryId: 'seafood',
    productIds: ['p001', 'p002', 'p003', 'p004', 'p005', 'p006', 'p007', 'p008'],
  },
  {
    title: '🍊 当季水果',
    categoryId: 'fruit',
    productIds: ['p012', 'p013', 'p014', 'p015'],
  },
  {
    title: '🥬 时令蔬菜',
    categoryId: 'vegetable',
    productIds: ['p016', 'p017', 'p018', 'p028'],
  },
]

// 购物车初始 mock 数据（用于 ShopCart 和 ShopCheckout）
export interface CartItem {
  productId: string
  name: string
  spec: string
  price: number
  quantity: number
  emoji: string
  bgGradient: string
  checked: boolean
}

export const MOCK_CART_ITEMS: CartItem[] = [
  {
    productId: 'p001',
    name: '【阳江直发】新鲜肉蟹 生猛活蟹',
    spec: '500g/只',
    price: 68,
    quantity: 1,
    emoji: '🦀',
    bgGradient: 'linear-gradient(135deg, #e0f7fa, #b2dfdb)',
    checked: true,
  },
  {
    productId: 'p002',
    name: '湛江大对虾 活冻鲜虾',
    spec: '500g/袋',
    price: 45,
    quantity: 2,
    emoji: '🦐',
    bgGradient: 'linear-gradient(135deg, #fff3e0, #ffe0b2)',
    checked: true,
  },
  {
    productId: 'p004',
    name: '湛江生蚝 12只装',
    spec: '12只/箱',
    price: 58,
    quantity: 1,
    emoji: '🦪',
    bgGradient: 'linear-gradient(135deg, #fce4ec, #f8bbd0)',
    checked: false,
  },
]
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/website" && npx tsc --noEmit
```

预期：无报错。

- [ ] **Step 3: Commit**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && git add website/src/data/shopMockData.ts && git commit -m "feat(shop): add mock product/category data (28 items, Guangdong seafood & produce)"
```

---

## Task 2: ShopNavbar 组件

**Files:**
- Create: `website/src/components/shop/ShopNavbar.tsx`

- [ ] **Step 1: 创建 ShopNavbar.tsx**

```tsx
// website/src/components/shop/ShopNavbar.tsx
import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { SHOP_CATEGORIES } from '@/data/shopMockData'

interface Props {
  cartCount?: number
}

export default function ShopNavbar({ cartCount = 3 }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  const handleSearch = () => {
    if (searchQuery.trim()) {
      navigate(`/shop/category/all`)
    }
  }

  const activeCatId = location.pathname.startsWith('/shop/category/')
    ? location.pathname.split('/')[3]
    : null

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      {/* Top row */}
      <div className="max-w-page mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
        {/* Logo */}
        <Link to="/shop" className="font-black text-brand text-base sm:text-lg whitespace-nowrap flex items-center gap-1">
          🛒 <span>爱买买生鲜</span>
        </Link>

        {/* Search bar */}
        <div className="flex-1 flex items-center bg-gray-100 rounded-full px-3 sm:px-4 py-2 gap-2 min-w-0">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="搜索广东海鲜、生鲜蔬果..."
            className="bg-transparent flex-1 text-sm text-gray-600 placeholder-gray-400 outline-none min-w-0"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
          />
        </div>

        {/* Desktop: city + my orders */}
        <div className="hidden lg:flex items-center gap-4 text-sm text-gray-500 whitespace-nowrap flex-shrink-0">
          <span className="cursor-pointer hover:text-brand transition-colors">📍 广州 ▾</span>
          <Link to="/shop/user" className="hover:text-brand transition-colors">我的订单</Link>
        </div>

        {/* Cart icon */}
        <Link to="/shop/cart" className="relative text-gray-600 hover:text-brand transition-colors flex-shrink-0">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          {cartCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center font-bold leading-none">
              {cartCount}
            </span>
          )}
        </Link>

        {/* Desktop: user icon */}
        <Link to="/shop/user" className="hidden sm:block text-gray-600 hover:text-brand transition-colors flex-shrink-0">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </Link>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden text-gray-600 flex-shrink-0 p-1"
          onClick={() => setMenuOpen(v => !v)}
          aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {menuOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            }
          </svg>
        </button>
      </div>

      {/* Category tabs – desktop */}
      <div className="hidden sm:flex max-w-page mx-auto px-6 overflow-x-auto scrollbar-hide border-t border-gray-100">
        {SHOP_CATEGORIES.map(cat => (
          <Link
            key={cat.id}
            to={`/shop/category/${cat.id}`}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
              activeCatId === cat.id
                ? 'text-brand border-brand font-semibold'
                : 'text-gray-600 border-transparent hover:text-brand hover:border-brand'
            }`}
          >
            {cat.emoji} {cat.label}
          </Link>
        ))}
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="sm:hidden bg-white border-t border-gray-100 shadow-lg">
          <div className="px-4 py-3 flex flex-col">
            {SHOP_CATEGORIES.map(cat => (
              <Link
                key={cat.id}
                to={`/shop/category/${cat.id}`}
                className="py-3 text-sm text-gray-700 border-b border-gray-50 last:border-0 flex items-center gap-2"
              >
                <span>{cat.emoji}</span>
                <span>{cat.label}</span>
              </Link>
            ))}
            <Link to="/shop/user" className="py-3 text-sm text-brand font-medium flex items-center gap-2">
              <span>👤</span><span>个人中心</span>
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
```

- [ ] **Step 2: 添加 `.scrollbar-hide` 到 globals.css**

在 `website/src/styles/globals.css` 的 `@layer utilities { ... }` 块内追加：

```css
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
```

- [ ] **Step 3: TypeScript 编译验证**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/website" && npx tsc --noEmit
```

预期：无报错。

- [ ] **Step 4: Commit**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && git add website/src/components/shop/ShopNavbar.tsx website/src/styles/globals.css && git commit -m "feat(shop): add ShopNavbar with responsive category tabs and search"
```

---

## Task 3: ShopFooter + ShopLayout

**Files:**
- Create: `website/src/components/shop/ShopFooter.tsx`
- Create: `website/src/components/shop/ShopLayout.tsx`

- [ ] **Step 1: 创建 ShopFooter.tsx**

```tsx
// website/src/components/shop/ShopFooter.tsx
import { Link } from 'react-router-dom'

export default function ShopFooter() {
  return (
    <footer className="bg-brand-dark text-white/70 text-sm mt-auto">
      <div className="max-w-page mx-auto px-6 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
          <div>
            <div className="text-white font-bold text-base mb-3">🛒 爱买买生鲜</div>
            <p className="text-xs leading-relaxed">
              广东本地生鲜直销平台，专注粤港澳优质农产品直供，每日清晨直采，冷链直送到家。
            </p>
          </div>
          <div>
            <div className="text-white/90 font-semibold mb-3">快速入口</div>
            <div className="flex flex-col gap-2 text-xs">
              <Link to="/shop" className="hover:text-white transition-colors">商城首页</Link>
              <Link to="/shop/category/seafood" className="hover:text-white transition-colors">海鲜水产</Link>
              <Link to="/shop/cart" className="hover:text-white transition-colors">我的购物车</Link>
              <Link to="/shop/user" className="hover:text-white transition-colors">个人中心</Link>
            </div>
          </div>
          <div>
            <div className="text-white/90 font-semibold mb-3">客户服务</div>
            <div className="flex flex-col gap-2 text-xs">
              <span>客服热线：400-888-8888</span>
              <span>服务时间：08:00–22:00</span>
              <span>企业邮箱：service@aimaimai.com</span>
              <Link to="/" className="hover:text-white transition-colors mt-1">返回官网 →</Link>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10 pt-4 text-xs text-center space-y-1">
          <p>© 2025 爱买买生鲜平台 版权所有</p>
          <p>粤ICP备2025XXXXXX号 · 食品经营许可证：粤食经营许可证2025XXXXXX · 增值电信业务经营许可证：粤B2-XXXXXX</p>
          <p>本平台所有商品均经严格质检，如有质量问题请联系客服，支持7日无理由退换货</p>
        </div>
      </div>
    </footer>
  )
}
```

- [ ] **Step 2: 创建 ShopLayout.tsx**

```tsx
// website/src/components/shop/ShopLayout.tsx
import { Outlet } from 'react-router-dom'
import ShopNavbar from './ShopNavbar'
import ShopFooter from './ShopFooter'

export default function ShopLayout() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <ShopNavbar cartCount={3} />
      <main className="flex-1">
        <Outlet />
      </main>
      <ShopFooter />
    </div>
  )
}
```

- [ ] **Step 3: TypeScript 编译验证**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/website" && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && git add website/src/components/shop/ShopFooter.tsx website/src/components/shop/ShopLayout.tsx && git commit -m "feat(shop): add ShopFooter and ShopLayout with Outlet"
```

---

## Task 4: 路由接入 + 官网 Navbar 按钮

**Files:**
- Modify: `website/src/App.tsx`
- Modify: `website/src/components/layout/Navbar.tsx`

- [ ] **Step 1: 修改 App.tsx — 新增商城路由并对 /shop/* 隐藏主布局**

将 `website/src/App.tsx` 全文替换为：

```tsx
// website/src/App.tsx
import { lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { PAGE_META } from '@/lib/constants'

const Home = lazy(() => import('@/pages/Home'))
const Products = lazy(() => import('@/pages/Products'))
const AiTech = lazy(() => import('@/pages/AiTech'))
const About = lazy(() => import('@/pages/About'))
const Merchants = lazy(() => import('@/pages/Merchants'))
const MerchantApply = lazy(() => import('@/pages/MerchantApply'))
const Contact = lazy(() => import('@/pages/Contact'))
const NotFound = lazy(() => import('@/pages/NotFound'))
const Download = lazy(() => import('@/pages/Download'))
const Resolve = lazy(() => import('@/pages/Resolve'))

// 商城模块
const ShopLayout = lazy(() => import('@/components/shop/ShopLayout'))
const ShopHome = lazy(() => import('@/pages/shop/ShopHome'))
const ShopCategory = lazy(() => import('@/pages/shop/ShopCategory'))
const ShopProduct = lazy(() => import('@/pages/shop/ShopProduct'))
const ShopCart = lazy(() => import('@/pages/shop/ShopCart'))
const ShopCheckout = lazy(() => import('@/pages/shop/ShopCheckout'))
const ShopUser = lazy(() => import('@/pages/shop/ShopUser'))

function MetaUpdater() {
  const location = useLocation()
  useEffect(() => {
    const meta = PAGE_META[location.pathname]
    if (meta) {
      document.title = meta.title
      const updateMeta = (sel: string, attr: string, val: string) => {
        const el = document.querySelector(sel)
        if (el) el.setAttribute(attr, val)
      }
      updateMeta('meta[name="description"]', 'content', meta.description)
      updateMeta('meta[property="og:title"]', 'content', meta.title)
      updateMeta('meta[property="og:description"]', 'content', meta.description)
      updateMeta('meta[property="og:url"]', 'content', window.location.href)
      updateMeta('meta[name="twitter:title"]', 'content', meta.title)
      updateMeta('meta[name="twitter:description"]', 'content', meta.description)
    }
  }, [location.pathname])
  return null
}

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-bg">
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-ai-start to-ai-glow animate-pulse" />
    </div>
  )
}

export default function App() {
  const location = useLocation()
  const isLandingPage = location.pathname.startsWith('/r/') || location.pathname === '/download' || location.pathname === '/resolve'
  const isShopPage = location.pathname.startsWith('/shop')
  const hideMainLayout = isLandingPage || isShopPage

  return (
    <>
      <MetaUpdater />
      {!hideMainLayout && <Navbar />}
      <main id="main-content">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* 官网路由 */}
            <Route path="/" element={<Home />} />
            <Route path="/products" element={<Products />} />
            <Route path="/ai" element={<AiTech />} />
            <Route path="/about" element={<About />} />
            <Route path="/merchants" element={<Merchants />} />
            <Route path="/merchants/apply" element={<MerchantApply />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/r/:code" element={<Download />} />
            <Route path="/download" element={<Download />} />
            <Route path="/resolve" element={<Resolve />} />

            {/* 商城路由（嵌套在 ShopLayout 下） */}
            <Route path="/shop" element={<ShopLayout />}>
              <Route index element={<ShopHome />} />
              <Route path="category/:id" element={<ShopCategory />} />
              <Route path="product/:id" element={<ShopProduct />} />
              <Route path="cart" element={<ShopCart />} />
              <Route path="checkout" element={<ShopCheckout />} />
              <Route path="user" element={<ShopUser />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      {!hideMainLayout && <Footer />}
    </>
  )
}
```

- [ ] **Step 2: 修改 Navbar.tsx — 新增"进入商城"Link**

在 `website/src/components/layout/Navbar.tsx` 中，在 `import Button` 后新增 Link import（已有则跳过），然后在 CTA 区域加入进入商城按钮：

将 `{/* CTA + 汉堡 */}` 的 div 内部改为：

```tsx
          {/* CTA + 汉堡 */}
          <div className="flex items-center gap-3">
            <Link
              to="/shop"
              className="hidden md:inline-flex items-center px-4 py-1.5 text-sm font-semibold rounded-pill border border-brand-light text-brand-light hover:bg-brand-light hover:text-white transition-colors"
            >
              进入商城
            </Link>
            <Button
              size="sm"
              className="hidden md:inline-flex"
              onClick={() => setDownloadOpen(true)}
            >
              下载 App
            </Button>

            {/* 汉堡菜单按钮 */}
            <button
              className="md:hidden text-white p-2"
              onClick={toggleMenu}
              aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
              aria-expanded={menuOpen}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {menuOpen ? (
                  <path d="M18 6L6 18M6 6l12 12" />
                ) : (
                  <path d="M3 12h18M3 6h18M3 18h18" />
                )}
              </svg>
            </button>
          </div>
```

并在移动端菜单的 nav links 后、Button 前插入：

```tsx
              <Link
                to="/shop"
                className="py-2 text-base text-brand-light font-medium"
              >
                🛒 进入商城
              </Link>
```

- [ ] **Step 3: 创建商城页面占位文件（确保路由不报错）**

先创建 6 个空占位页面：

`website/src/pages/shop/ShopHome.tsx`:
```tsx
export default function ShopHome() { return <div className="p-8 text-center text-gray-500">商城首页（建设中）</div> }
```

`website/src/pages/shop/ShopCategory.tsx`:
```tsx
export default function ShopCategory() { return <div className="p-8 text-center text-gray-500">分类页（建设中）</div> }
```

`website/src/pages/shop/ShopProduct.tsx`:
```tsx
export default function ShopProduct() { return <div className="p-8 text-center text-gray-500">商品详情（建设中）</div> }
```

`website/src/pages/shop/ShopCart.tsx`:
```tsx
export default function ShopCart() { return <div className="p-8 text-center text-gray-500">购物车（建设中）</div> }
```

`website/src/pages/shop/ShopCheckout.tsx`:
```tsx
export default function ShopCheckout() { return <div className="p-8 text-center text-gray-500">结账页（建设中）</div> }
```

`website/src/pages/shop/ShopUser.tsx`:
```tsx
export default function ShopUser() { return <div className="p-8 text-center text-gray-500">个人中心（建设中）</div> }
```

- [ ] **Step 4: TypeScript 编译验证**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/website" && npx tsc --noEmit
```

预期：无报错。

- [ ] **Step 5: 启动开发服务器，验证路由**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/website" && npm run dev
```

在浏览器中验证：
- `http://localhost:5175` — 官网首页正常，Navbar 有"进入商城"按钮
- `http://localhost:5175/shop` — 进入商城，显示 ShopNavbar（绿色）和"商城首页（建设中）"
- 官网 Navbar/Footer 在 /shop 下不显示

- [ ] **Step 6: Commit**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && git add website/src/App.tsx website/src/components/layout/Navbar.tsx website/src/pages/shop/ && git commit -m "feat(shop): wire routing, add '进入商城' button to main Navbar"
```

---

## Task 5: ProductCard 组件

**Files:**
- Create: `website/src/components/shop/ProductCard.tsx`

- [ ] **Step 1: 创建 ProductCard.tsx**

```tsx
// website/src/components/shop/ProductCard.tsx
import { Link } from 'react-router-dom'
import type { Product } from '@/data/shopMockData'

interface Props {
  product: Product
}

export default function ProductCard({ product }: Props) {
  return (
    <Link
      to={`/shop/product/${product.id}`}
      className="block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 group"
    >
      {/* Product image area */}
      <div
        className="flex items-center justify-center text-5xl"
        style={{ background: product.bgGradient, height: '120px' }}
        aria-hidden="true"
      >
        {product.emoji}
      </div>

      {/* Product info */}
      <div className="p-3">
        {product.badge && (
          <span className="inline-block text-xs bg-brand text-white px-1.5 py-0.5 rounded mb-1.5">
            {product.badge}
          </span>
        )}
        <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-brand transition-colors">
          {product.name}
        </p>
        <p className="text-xs text-gray-400 mt-0.5 truncate">{product.subtitle}</p>
        <div className="flex items-baseline gap-1.5 mt-2">
          <span className="text-base font-bold text-red-500">
            <span className="text-xs">¥</span>{product.price}
          </span>
          {product.originalPrice > product.price && (
            <span className="text-xs text-gray-300 line-through">¥{product.originalPrice}</span>
          )}
        </div>
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/website" && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && git add website/src/components/shop/ProductCard.tsx && git commit -m "feat(shop): add ProductCard component with hover animation"
```

---

## Task 6: ShopHome 首页

**Files:**
- Modify: `website/src/pages/shop/ShopHome.tsx`（替换占位内容）

- [ ] **Step 1: 实现 ShopHome.tsx**

```tsx
// website/src/pages/shop/ShopHome.tsx
import { Link } from 'react-router-dom'
import { SHOP_PRODUCTS, HOME_SECTIONS } from '@/data/shopMockData'
import ProductCard from '@/components/shop/ProductCard'

function HeroBanner() {
  return (
    <div
      className="relative overflow-hidden flex items-center px-6 sm:px-12 py-8 sm:py-12"
      style={{ background: 'linear-gradient(135deg, #1B5E20 0%, #2E7D32 55%, #00897B 100%)', minHeight: '160px' }}
    >
      {/* Background decoration */}
      <div className="absolute right-6 sm:right-16 text-8xl sm:text-9xl opacity-20 select-none" aria-hidden="true">
        🌊
      </div>
      <div className="relative z-10 text-white">
        <span className="inline-block text-xs bg-white/20 px-3 py-1 rounded-full mb-3">
          🔥 粤港澳生鲜直供
        </span>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight">
          每日清晨直采 · 产地直发
        </h1>
        <p className="text-white/80 text-sm sm:text-base mt-2">
          湛江海鲜 · 阳江生猛 · 顺德河鲜 · 冷链直送到家
        </p>
        <Link
          to="/shop/category/seafood"
          className="inline-block mt-4 bg-orange-500 hover:bg-orange-600 text-white font-bold px-6 py-2.5 rounded-full text-sm transition-colors"
        >
          立即选购 →
        </Link>
      </div>
    </div>
  )
}

function FlashDealBar() {
  return (
    <div className="bg-orange-50 border-b border-orange-200 px-4 sm:px-6 py-3 flex items-center gap-3">
      <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded flex-shrink-0">
        限时秒杀
      </span>
      <span className="text-sm font-semibold text-orange-700">今日特惠</span>
      <span className="text-xs text-gray-400 ml-auto flex-shrink-0">距结束 02:34:17 ⏱</span>
      <Link to="/shop/category/all" className="text-xs text-brand font-semibold flex-shrink-0 hidden sm:block">
        查看全部 →
      </Link>
    </div>
  )
}

interface ProductSectionProps {
  title: string
  categoryId: string
  productIds: string[]
}

function ProductSection({ title, categoryId, productIds }: ProductSectionProps) {
  const products = productIds
    .map(id => SHOP_PRODUCTS.find(p => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined)

  return (
    <section className="max-w-page mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <Link
          to={`/shop/category/${categoryId}`}
          className="text-sm text-brand hover:text-brand-dark font-medium transition-colors"
        >
          查看全部 →
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {products.map(product => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  )
}

export default function ShopHome() {
  return (
    <div>
      <HeroBanner />
      <FlashDealBar />

      {/* Category icon row */}
      <div className="max-w-page mx-auto px-4 sm:px-6 py-5 sm:hidden">
        <div className="grid grid-cols-4 gap-2">
          {[
            { id: 'seafood', emoji: '🦐', label: '海鲜' },
            { id: 'fish',    emoji: '🐟', label: '鱼类' },
            { id: 'fruit',   emoji: '🍊', label: '水果' },
            { id: 'vegetable', emoji: '🥬', label: '蔬菜' },
          ].map(cat => (
            <Link
              key={cat.id}
              to={`/shop/category/${cat.id}`}
              className="flex flex-col items-center gap-1 bg-white rounded-xl p-3 shadow-sm hover:shadow-card transition-shadow"
            >
              <span className="text-2xl">{cat.emoji}</span>
              <span className="text-xs text-gray-600">{cat.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Product sections */}
      {HOME_SECTIONS.map(section => (
        <ProductSection
          key={section.categoryId}
          title={section.title}
          categoryId={section.categoryId}
          productIds={section.productIds}
        />
      ))}

      {/* Trust banner */}
      <div className="bg-white border-t border-gray-100 py-8 mt-4">
        <div className="max-w-page mx-auto px-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
            {[
              { icon: '🚚', title: '顺丰冷链', desc: '全程0-4°C保鲜' },
              { icon: '🌊', title: '产地直采', desc: '清晨鲜采当日发' },
              { icon: '✅', title: '品质保障', desc: '严格质检，不满意退' },
              { icon: '📞', title: '7×14客服', desc: '400-888-8888' },
            ].map(item => (
              <div key={item.title} className="flex flex-col items-center gap-2">
                <span className="text-3xl">{item.icon}</span>
                <span className="font-semibold text-gray-800 text-sm">{item.title}</span>
                <span className="text-xs text-gray-400">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/website" && npx tsc --noEmit
```

- [ ] **Step 3: 浏览器验证**

访问 `http://localhost:5175/shop`，检查：
- Hero Banner 绿色渐变正常显示
- 3 个商品分区各自显示正确数量的商品卡
- 响应式：手机尺寸显示 2 列，宽屏显示 4 列

- [ ] **Step 4: Commit**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && git add website/src/pages/shop/ShopHome.tsx && git commit -m "feat(shop): implement ShopHome with hero banner, flash deal, product sections"
```

---

## Task 7: ShopCategory 分类列表页

**Files:**
- Modify: `website/src/pages/shop/ShopCategory.tsx`

- [ ] **Step 1: 实现 ShopCategory.tsx**

```tsx
// website/src/pages/shop/ShopCategory.tsx
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { SHOP_PRODUCTS, SHOP_CATEGORIES } from '@/data/shopMockData'
import ProductCard from '@/components/shop/ProductCard'

type SortKey = 'default' | 'sales' | 'price_asc' | 'price_desc'

export default function ShopCategory() {
  const { id } = useParams<{ id: string }>()
  const [sortKey, setSortKey] = useState<SortKey>('default')
  const [activeSubCat, setActiveSubCat] = useState<string>('全部')

  const category = SHOP_CATEGORIES.find(c => c.id === id)
  const subCategories = ['全部', ...(category?.subCategories ?? [])]

  // Filter products
  let products = id === 'all'
    ? SHOP_PRODUCTS
    : SHOP_PRODUCTS.filter(p => p.categoryId === id)

  // Sort
  const sorted = [...products].sort((a, b) => {
    if (sortKey === 'price_asc') return a.price - b.price
    if (sortKey === 'price_desc') return b.price - a.price
    return 0
  })

  const categoryLabel = id === 'all' ? '全部商品' : (category?.label ?? '商品列表')

  return (
    <div className="max-w-page mx-auto px-4 sm:px-6 py-4">
      {/* Breadcrumb */}
      <nav className="text-xs text-gray-400 mb-4 flex items-center gap-1.5">
        <Link to="/shop" className="hover:text-brand transition-colors">首页</Link>
        <span>›</span>
        <span className="text-gray-700">{categoryLabel}</span>
      </nav>

      <div className="flex gap-4">
        {/* Desktop: left sub-category sidebar */}
        {subCategories.length > 1 && (
          <aside className="hidden sm:block w-32 flex-shrink-0">
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden sticky top-32">
              <div className="px-3 py-2.5 bg-brand-soft text-brand text-xs font-semibold">
                {category?.emoji} {category?.label}
              </div>
              {subCategories.map(sub => (
                <button
                  key={sub}
                  onClick={() => setActiveSubCat(sub)}
                  className={`w-full text-left px-3 py-2.5 text-xs border-b border-gray-50 last:border-0 transition-colors ${
                    activeSubCat === sub
                      ? 'bg-brand-soft text-brand font-semibold'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {sub}
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Mobile: horizontal sub-category tabs */}
          {subCategories.length > 1 && (
            <div className="sm:hidden flex gap-2 overflow-x-auto scrollbar-hide mb-3 pb-1">
              {subCategories.map(sub => (
                <button
                  key={sub}
                  onClick={() => setActiveSubCat(sub)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    activeSubCat === sub
                      ? 'bg-brand text-white'
                      : 'bg-white text-gray-600 border border-gray-200'
                  }`}
                >
                  {sub}
                </button>
              ))}
            </div>
          )}

          {/* Sort toolbar */}
          <div className="flex items-center gap-2 mb-4 bg-white rounded-xl border border-gray-100 px-4 py-2.5">
            <span className="text-xs text-gray-400 mr-2">排序：</span>
            {([
              { key: 'default' as SortKey, label: '综合' },
              { key: 'sales' as SortKey, label: '销量' },
              { key: 'price_asc' as SortKey, label: '价格↑' },
              { key: 'price_desc' as SortKey, label: '价格↓' },
            ]).map(opt => (
              <button
                key={opt.key}
                onClick={() => setSortKey(opt.key)}
                className={`px-3 py-1 rounded-full text-xs transition-colors ${
                  sortKey === opt.key
                    ? 'bg-brand text-white font-semibold'
                    : 'text-gray-500 hover:text-brand'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-gray-400">{sorted.length} 件商品</span>
          </div>

          {/* Product grid */}
          {sorted.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {sorted.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">🔍</div>
              <p>该分类暂无商品</p>
              <Link to="/shop" className="text-brand text-sm mt-2 inline-block">返回首页</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/website" && npx tsc --noEmit
```

- [ ] **Step 3: 浏览器验证**

访问 `http://localhost:5175/shop/category/seafood`，检查：
- 面包屑显示"首页 › 海鲜水产"
- 左侧子分类侧栏在宽屏下显示
- 排序按钮切换后列表顺序变化

- [ ] **Step 4: Commit**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && git add website/src/pages/shop/ShopCategory.tsx && git commit -m "feat(shop): implement ShopCategory with sub-category filter and sort"
```

---

## Task 8: ShopProduct 商品详情页

**Files:**
- Modify: `website/src/pages/shop/ShopProduct.tsx`

- [ ] **Step 1: 实现 ShopProduct.tsx**

```tsx
// website/src/pages/shop/ShopProduct.tsx
import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { SHOP_PRODUCTS } from '@/data/shopMockData'
import ProductCard from '@/components/shop/ProductCard'

export default function ShopProduct() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const product = SHOP_PRODUCTS.find(p => p.id === id)

  const [selectedSkuIdx, setSelectedSkuIdx] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const [activeThumb, setActiveThumb] = useState(0)
  const [addedToCart, setAddedToCart] = useState(false)

  if (!product) {
    return (
      <div className="text-center py-20 text-gray-400">
        <div className="text-5xl mb-4">🔍</div>
        <p className="text-lg">商品不存在</p>
        <Link to="/shop" className="text-brand mt-3 inline-block">返回首页</Link>
      </div>
    )
  }

  const category = product.categoryId
  const currentSku = product.skus[selectedSkuIdx]
  const currentPrice = currentSku?.price ?? product.price

  const handleAddToCart = () => {
    setAddedToCart(true)
    setTimeout(() => setAddedToCart(false), 2000)
  }

  const handleBuyNow = () => {
    navigate('/shop/checkout')
  }

  // Recommend products from same category
  const related = SHOP_PRODUCTS
    .filter(p => p.categoryId === category && p.id !== product.id)
    .slice(0, 4)

  // Mock thumbnails (same emoji repeated for demo)
  const thumbs = [product.emoji, '📦', '🚚', '✅']

  return (
    <div className="max-w-page mx-auto px-4 sm:px-6 py-4">
      {/* Breadcrumb */}
      <nav className="text-xs text-gray-400 mb-5 flex items-center gap-1.5">
        <Link to="/shop" className="hover:text-brand transition-colors">首页</Link>
        <span>›</span>
        <Link to={`/shop/category/${product.categoryId}`} className="hover:text-brand transition-colors">
          {product.categoryId === 'seafood' ? '海鲜水产'
            : product.categoryId === 'fish' ? '鱼类'
            : product.categoryId === 'fruit' ? '新鲜水果'
            : product.categoryId === 'vegetable' ? '时令蔬菜'
            : product.categoryId === 'meat' ? '肉禽蛋'
            : product.categoryId === 'specialty' ? '农家特产'
            : '冷冻食品'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 truncate max-w-xs">{product.name}</span>
      </nav>

      {/* Main product section */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-6">
        <div className="flex flex-col lg:flex-row">
          {/* Gallery */}
          <div className="lg:w-80 flex-shrink-0">
            {/* Main image */}
            <div
              className="flex items-center justify-center text-8xl"
              style={{ background: product.bgGradient, height: '280px' }}
              aria-hidden="true"
            >
              {thumbs[activeThumb] === product.emoji ? product.emoji : thumbs[activeThumb]}
            </div>
            {/* Thumbnails */}
            <div className="flex gap-2 p-3">
              {thumbs.map((thumb, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveThumb(idx)}
                  className={`w-14 h-14 rounded-lg flex items-center justify-center text-2xl border-2 transition-colors ${
                    activeThumb === idx
                      ? 'border-brand bg-brand-soft'
                      : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                  }`}
                  style={idx === 0 ? { background: product.bgGradient } : undefined}
                >
                  {thumb}
                </button>
              ))}
            </div>
          </div>

          {/* Product info */}
          <div className="flex-1 p-5 sm:p-6 border-t lg:border-t-0 lg:border-l border-gray-100">
            <h1 className="text-xl font-bold text-gray-900 leading-tight">{product.name}</h1>
            <p className="text-sm text-gray-500 mt-1">{product.subtitle} · 产地：{product.origin}</p>

            {/* Price */}
            <div className="mt-4 bg-red-50 rounded-xl p-4 flex items-baseline gap-3">
              <span className="text-3xl font-black text-red-500">
                <span className="text-lg">¥</span>{currentPrice}
              </span>
              {product.originalPrice > currentPrice && (
                <span className="text-sm text-gray-300 line-through">¥{product.originalPrice}</span>
              )}
              {product.originalPrice > currentPrice && (
                <span className="ml-auto text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">
                  {Math.round(currentPrice / product.originalPrice * 10)}折
                </span>
              )}
            </div>

            {/* Tags */}
            <div className="flex flex-wrap gap-2 mt-4">
              {product.tags.map(tag => (
                <span key={tag} className="text-xs px-2.5 py-1 rounded-full border border-brand text-brand">
                  {tag}
                </span>
              ))}
            </div>

            {/* SKU selection */}
            {product.skus.length > 1 && (
              <div className="mt-5">
                <p className="text-sm font-semibold text-gray-700 mb-2">规格</p>
                <div className="flex flex-wrap gap-2">
                  {product.skus.map((sku, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedSkuIdx(idx)}
                      className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                        selectedSkuIdx === idx
                          ? 'border-brand bg-brand-soft text-brand font-semibold'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {sku.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity */}
            <div className="mt-5">
              <p className="text-sm font-semibold text-gray-700 mb-2">数量</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:border-brand hover:text-brand transition-colors text-lg"
                >
                  −
                </button>
                <span className="text-base font-semibold w-8 text-center">{quantity}</span>
                <button
                  onClick={() => setQuantity(q => Math.min(product.stock, q + 1))}
                  className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:border-brand hover:text-brand transition-colors text-lg"
                >
                  +
                </button>
                <span className="text-xs text-gray-400">库存 {product.stock} 件</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleAddToCart}
                className={`flex-1 py-3 rounded-xl font-semibold text-sm border-2 transition-colors ${
                  addedToCart
                    ? 'border-brand bg-brand text-white'
                    : 'border-brand text-brand hover:bg-brand hover:text-white'
                }`}
              >
                {addedToCart ? '✓ 已加入购物车' : '🛒 加入购物车'}
              </button>
              <button
                onClick={handleBuyNow}
                className="flex-1 py-3 rounded-xl font-semibold text-sm bg-orange-500 hover:bg-orange-600 text-white transition-colors"
              >
                立即购买
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Product details */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 mb-6">
        <h2 className="text-base font-bold text-gray-900 mb-4">商品详情</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {product.specs.map(spec => (
            <div key={spec.label} className="flex gap-3 text-sm">
              <span className="text-gray-400 flex-shrink-0 w-20">{spec.label}</span>
              <span className="text-gray-700">{spec.value}</span>
            </div>
          ))}
        </div>
        <div className="bg-brand-soft rounded-xl p-4 text-sm text-gray-700 leading-relaxed">
          {product.description}
        </div>
      </div>

      {/* Related products */}
      {related.length > 0 && (
        <div>
          <h2 className="text-base font-bold text-gray-900 mb-4">猜你喜欢</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {related.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/website" && npx tsc --noEmit
```

- [ ] **Step 3: 浏览器验证**

访问 `http://localhost:5175/shop/product/p001`，检查：
- 面包屑正常
- 图片区 + 缩略图切换
- SKU 选择更新价格
- 数量 ± 正常
- "加入购物车"点击后变绿显示成功
- "立即购买"跳转 `/shop/checkout`

- [ ] **Step 4: Commit**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && git add website/src/pages/shop/ShopProduct.tsx && git commit -m "feat(shop): implement ShopProduct with SKU selection, quantity control, related products"
```

---

## Task 9: ShopCart 购物车页

**Files:**
- Modify: `website/src/pages/shop/ShopCart.tsx`

- [ ] **Step 1: 实现 ShopCart.tsx**

```tsx
// website/src/pages/shop/ShopCart.tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MOCK_CART_ITEMS, SHOP_PRODUCTS, type CartItem } from '@/data/shopMockData'
import ProductCard from '@/components/shop/ProductCard'

export default function ShopCart() {
  const [items, setItems] = useState<CartItem[]>(MOCK_CART_ITEMS)
  const navigate = useNavigate()

  const checkedItems = items.filter(i => i.checked)
  const subtotal = checkedItems.reduce((sum, i) => sum + i.price * i.quantity, 0)

  const toggleCheck = (productId: string) => {
    setItems(prev => prev.map(i => i.productId === productId ? { ...i, checked: !i.checked } : i))
  }
  const toggleAll = () => {
    const allChecked = items.every(i => i.checked)
    setItems(prev => prev.map(i => ({ ...i, checked: !allChecked })))
  }
  const updateQty = (productId: string, delta: number) => {
    setItems(prev => prev.map(i =>
      i.productId === productId
        ? { ...i, quantity: Math.max(1, i.quantity + delta) }
        : i
    ))
  }
  const removeItem = (productId: string) => {
    setItems(prev => prev.filter(i => i.productId !== productId))
  }

  const allChecked = items.length > 0 && items.every(i => i.checked)

  // Recommended products
  const recommended = SHOP_PRODUCTS.filter(p => !items.find(i => i.productId === p.id)).slice(0, 4)

  return (
    <div className="max-w-page mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-xl font-bold text-gray-900 mb-5">
        🛒 我的购物车
        {items.length > 0 && <span className="text-base font-normal text-gray-400 ml-2">（{items.length}件）</span>}
      </h1>

      {items.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">🛒</div>
          <p className="text-lg mb-4">购物车是空的</p>
          <Link to="/shop" className="bg-brand text-white px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-brand-dark transition-colors">
            去购物
          </Link>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Item list */}
          <div className="flex-1 min-w-0">
            {/* Select all row */}
            <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3 mb-3">
              <button
                onClick={toggleAll}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  allChecked ? 'bg-brand border-brand text-white' : 'border-gray-300'
                }`}
              >
                {allChecked && <span className="text-xs leading-none">✓</span>}
              </button>
              <span className="text-sm text-gray-600">全选</span>
              <span className="ml-auto text-xs text-gray-400">共 {items.length} 件商品</span>
            </div>

            {/* Items */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {items.map((item, idx) => (
                <div key={item.productId} className={`flex items-start gap-3 p-4 ${idx > 0 ? 'border-t border-gray-50' : ''}`}>
                  {/* Checkbox */}
                  <button
                    onClick={() => toggleCheck(item.productId)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-1 transition-colors ${
                      item.checked ? 'bg-brand border-brand text-white' : 'border-gray-300'
                    }`}
                  >
                    {item.checked && <span className="text-xs leading-none">✓</span>}
                  </button>

                  {/* Image */}
                  <div
                    className="w-16 h-16 rounded-lg flex items-center justify-center text-3xl flex-shrink-0"
                    style={{ background: item.bgGradient }}
                    aria-hidden="true"
                  >
                    {item.emoji}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${item.checked ? 'text-gray-900' : 'text-gray-400'}`}>
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">规格：{item.spec}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-base font-bold text-red-500">¥{item.price}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateQty(item.productId, -1)}
                          className="w-7 h-7 rounded border border-gray-200 flex items-center justify-center text-gray-500 hover:border-brand hover:text-brand transition-colors"
                        >
                          −
                        </button>
                        <span className="text-sm font-semibold w-6 text-center">{item.quantity}</span>
                        <button
                          onClick={() => updateQty(item.productId, 1)}
                          className="w-7 h-7 rounded border border-gray-200 flex items-center justify-center text-gray-500 hover:border-brand hover:text-brand transition-colors"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => removeItem(item.productId)}
                    className="text-gray-300 hover:text-red-400 transition-colors text-xs flex-shrink-0"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Order summary */}
          <div className="lg:w-72 flex-shrink-0">
            <div className="bg-white rounded-xl border border-gray-100 p-4 sticky top-24">
              <h2 className="font-bold text-gray-900 mb-4">订单摘要</h2>

              {/* Coupon */}
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2.5 mb-4">
                <span className="text-sm text-brand">🎫 使用优惠券</span>
                <span className="ml-auto text-xs text-gray-400">暂无可用 ›</span>
              </div>

              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between text-gray-600">
                  <span>商品总价</span>
                  <span>¥{subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>运费</span>
                  <span className="text-brand">免运费</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>优惠</span>
                  <span className="text-red-500">-¥0.00</span>
                </div>
              </div>

              <div className="flex justify-between font-bold text-base border-t border-gray-100 pt-3 mb-4">
                <span>合计</span>
                <span className="text-red-500">¥{subtotal.toFixed(2)}</span>
              </div>

              <button
                onClick={() => navigate('/shop/checkout')}
                disabled={checkedItems.length === 0}
                className="w-full py-3 rounded-xl font-bold text-sm bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white transition-colors"
              >
                结算 ({checkedItems.length} 件)
              </button>

              <p className="text-center text-xs text-gray-400 mt-3">
                🔒 安全支付 · 支持微信/支付宝
              </p>

              {/* Recommended */}
              {recommended.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-600 mb-3">猜你喜欢</p>
                  <div className="grid grid-cols-2 gap-2">
                    {recommended.slice(0, 2).map(p => (
                      <Link
                        key={p.id}
                        to={`/shop/product/${p.id}`}
                        className="block bg-gray-50 rounded-lg overflow-hidden hover:shadow-sm transition-shadow"
                      >
                        <div
                          className="h-12 flex items-center justify-center text-2xl"
                          style={{ background: p.bgGradient }}
                          aria-hidden="true"
                        >
                          {p.emoji}
                        </div>
                        <div className="p-1.5">
                          <p className="text-xs text-gray-700 font-medium truncate">{p.name}</p>
                          <p className="text-xs text-red-500 font-bold">¥{p.price}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/website" && npx tsc --noEmit
```

- [ ] **Step 3: 浏览器验证**

访问 `http://localhost:5175/shop/cart`，检查：
- 3 件商品正常显示（2件勾选，1件未勾选）
- 合计只计算勾选商品
- 数量 ± 正常，合计实时更新
- 删除后商品消失
- 结算按钮跳转 `/shop/checkout`

- [ ] **Step 4: Commit**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && git add website/src/pages/shop/ShopCart.tsx && git commit -m "feat(shop): implement ShopCart with check/qty/delete and order summary"
```

---

## Task 10: ShopCheckout 结账付款页

**Files:**
- Modify: `website/src/pages/shop/ShopCheckout.tsx`

- [ ] **Step 1: 实现 ShopCheckout.tsx**

```tsx
// website/src/pages/shop/ShopCheckout.tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MOCK_CART_ITEMS } from '@/data/shopMockData'

type DeliveryOption = 'sf_cold' | 'next_day'
type PaymentMethod = 'wechat' | 'alipay' | 'card'

const DELIVERY_OPTIONS = [
  { key: 'sf_cold' as DeliveryOption, label: '顺丰冷链专递', desc: '次日11:00前', price: 0 },
  { key: 'next_day' as DeliveryOption, label: '极速次日达', desc: '次日18:00前', price: 12 },
]

const PAYMENT_METHODS = [
  { key: 'wechat' as PaymentMethod, label: '微信支付', icon: '💚', desc: '推荐' },
  { key: 'alipay' as PaymentMethod, label: '支付宝', icon: '💙', desc: '' },
  { key: 'card' as PaymentMethod, label: '银行卡', icon: '💳', desc: '' },
]

function SuccessModal({ orderNo, onClose }: { orderNo: string; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
        <div className="text-6xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">支付成功！</h2>
        <p className="text-sm text-gray-500 mb-1">感谢您的购买</p>
        <p className="text-xs text-gray-400 mb-6">
          订单号：<span className="font-mono text-gray-600">{orderNo}</span>
        </p>
        <div className="bg-brand-soft rounded-xl p-3 text-sm text-brand mb-6 text-left">
          <p className="font-semibold mb-1">📦 预计配送时间</p>
          <p className="text-xs text-gray-600">顺丰冷链将于明日 11:00 前送达</p>
          <p className="text-xs text-gray-600">配送地址：广州市天河区珠江新城某小区 1栋101</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            继续购物
          </button>
          <button
            onClick={() => navigate('/shop/user')}
            className="flex-1 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-dark transition-colors"
          >
            查看订单
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ShopCheckout() {
  const navigate = useNavigate()
  const [delivery, setDelivery] = useState<DeliveryOption>('sf_cold')
  const [payment, setPayment] = useState<PaymentMethod>('wechat')
  const [remark, setRemark] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)

  const checkedItems = MOCK_CART_ITEMS.filter(i => i.checked)
  const subtotal = checkedItems.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const deliveryFee = DELIVERY_OPTIONS.find(o => o.key === delivery)?.price ?? 0
  const total = subtotal + deliveryFee

  const orderNo = `AMM${Date.now().toString().slice(-10)}`

  const handlePay = () => {
    setShowSuccess(true)
  }

  const handleCloseSuccess = () => {
    setShowSuccess(false)
    navigate('/shop')
  }

  return (
    <div className="max-w-page mx-auto px-4 sm:px-6 py-6">
      {showSuccess && <SuccessModal orderNo={orderNo} onClose={handleCloseSuccess} />}

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 transition-colors">
          ← 返回
        </button>
        <h1 className="text-xl font-bold text-gray-900">确认订单</h1>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: order details */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Delivery address */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span>📍</span> 收货地址
            </h2>
            <div className="flex items-start gap-3 p-3 border-2 border-brand rounded-xl bg-brand-soft">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-900">李** </span>
                  <span className="text-gray-600 text-sm">138****8888</span>
                  <span className="text-xs bg-brand text-white px-1.5 py-0.5 rounded">默认</span>
                </div>
                <p className="text-sm text-gray-600">广东省广州市天河区珠江新城花城大道88号某某小区 1栋101室</p>
              </div>
              <button className="text-xs text-brand flex-shrink-0">修改</button>
            </div>
          </div>

          {/* Product list */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span>📦</span> 商品清单
            </h2>
            <div className="space-y-3">
              {checkedItems.map(item => (
                <div key={item.productId} className="flex items-center gap-3">
                  <div
                    className="w-14 h-14 rounded-lg flex items-center justify-center text-2xl flex-shrink-0"
                    style={{ background: item.bgGradient }}
                    aria-hidden="true"
                  >
                    {item.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                    <p className="text-xs text-gray-400">规格：{item.spec} · 数量：×{item.quantity}</p>
                  </div>
                  <span className="text-sm font-bold text-gray-900 flex-shrink-0">
                    ¥{(item.price * item.quantity).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Delivery options */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span>🚚</span> 配送方式
            </h2>
            <div className="space-y-3">
              {DELIVERY_OPTIONS.map(opt => (
                <label
                  key={opt.key}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                    delivery === opt.key
                      ? 'border-brand bg-brand-soft'
                      : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery"
                    value={opt.key}
                    checked={delivery === opt.key}
                    onChange={() => setDelivery(opt.key)}
                    className="accent-brand"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                    <span className="text-xs text-gray-400 ml-2">{opt.desc}</span>
                  </div>
                  <span className={`text-sm font-bold ${opt.price === 0 ? 'text-brand' : 'text-gray-700'}`}>
                    {opt.price === 0 ? '免费' : `¥${opt.price}`}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Remark */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
              <span>💬</span> 买家备注
            </h2>
            <textarea
              value={remark}
              onChange={e => setRemark(e.target.value)}
              placeholder="如有特殊要求可在此备注（选填）"
              rows={3}
              className="w-full text-sm text-gray-600 placeholder-gray-300 border border-gray-200 rounded-xl p-3 resize-none outline-none focus:border-brand transition-colors"
            />
          </div>
        </div>

        {/* Right: payment summary */}
        <div className="lg:w-80 flex-shrink-0">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 sticky top-24 space-y-5">
            {/* Payment method */}
            <div>
              <h2 className="font-bold text-gray-900 mb-3">支付方式</h2>
              <div className="space-y-2">
                {PAYMENT_METHODS.map(method => (
                  <label
                    key={method.key}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                      payment === method.key
                        ? 'border-brand bg-brand-soft'
                        : 'border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value={method.key}
                      checked={payment === method.key}
                      onChange={() => setPayment(method.key)}
                      className="accent-brand"
                    />
                    <span className="text-xl">{method.icon}</span>
                    <span className="text-sm font-medium text-gray-900 flex-1">{method.label}</span>
                    {method.desc && (
                      <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">{method.desc}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            {/* Price breakdown */}
            <div className="space-y-2 text-sm border-t border-gray-100 pt-4">
              <div className="flex justify-between text-gray-600">
                <span>商品合计</span>
                <span>¥{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>运费</span>
                <span className={deliveryFee === 0 ? 'text-brand' : ''}>
                  {deliveryFee === 0 ? '免费' : `¥${deliveryFee}`}
                </span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>优惠</span>
                <span className="text-red-500">-¥0.00</span>
              </div>
            </div>

            {/* Total */}
            <div className="flex justify-between font-black text-lg border-t border-gray-100 pt-3">
              <span>实付金额</span>
              <span className="text-red-500">¥{total.toFixed(2)}</span>
            </div>

            {/* Pay button */}
            <button
              onClick={handlePay}
              className="w-full py-4 rounded-xl font-bold text-base bg-orange-500 hover:bg-orange-600 text-white transition-colors shadow-lg"
            >
              确认支付 ¥{total.toFixed(2)}
            </button>

            <p className="text-center text-xs text-gray-400 flex items-center justify-center gap-1">
              <span>🔒</span>
              <span>SSL 加密保护 · 支付信息安全</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/website" && npx tsc --noEmit
```

- [ ] **Step 3: 浏览器验证**

访问 `http://localhost:5175/shop/checkout`，检查：
- 收货地址、商品清单、配送方式、备注区正常显示
- 切换配送方式后总价更新
- 点击"确认支付"弹出支付成功弹窗
- 弹窗"查看订单"按钮跳转 `/shop/user`，"继续购物"返回首页

- [ ] **Step 4: Commit**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && git add website/src/pages/shop/ShopCheckout.tsx && git commit -m "feat(shop): implement ShopCheckout with delivery/payment selection and success modal"
```

---

## Task 11: ShopUser 个人中心

**Files:**
- Modify: `website/src/pages/shop/ShopUser.tsx`

- [ ] **Step 1: 实现 ShopUser.tsx**

```tsx
// website/src/pages/shop/ShopUser.tsx
import { Link } from 'react-router-dom'

const ORDER_STATS = [
  { label: '待付款', emoji: '💳', count: 0 },
  { label: '待发货', emoji: '📦', count: 1 },
  { label: '待收货', emoji: '🚚', count: 2 },
  { label: '已完成', emoji: '✅', count: 8 },
]

const RECENT_ORDERS = [
  {
    id: 'AMM2025040301',
    date: '2025-04-03',
    status: '待收货',
    statusColor: 'text-orange-500',
    items: [
      { emoji: '🦀', name: '阳江肉蟹', spec: '500g/只 ×1', price: 68 },
      { emoji: '🦐', name: '湛江大对虾', spec: '500g/袋 ×2', price: 90 },
    ],
    total: 158,
  },
  {
    id: 'AMM2025033101',
    date: '2025-03-31',
    status: '已完成',
    statusColor: 'text-green-600',
    items: [
      { emoji: '🐟', name: '顺德鲩鱼', spec: '约1.5kg/条 ×1', price: 32 },
    ],
    total: 32,
  },
]

const MENU_ITEMS = [
  { icon: '📋', label: '全部订单', to: '/shop/user' },
  { icon: '📍', label: '收货地址', to: '/shop/user' },
  { icon: '🎫', label: '我的优惠券', to: '/shop/user' },
  { icon: '👁️', label: '浏览历史', to: '/shop/user' },
  { icon: '❓', label: '帮助中心', to: '/shop/user' },
  { icon: '📞', label: '联系客服', to: '/shop/user' },
]

export default function ShopUser() {
  return (
    <div className="max-w-page mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* User info header */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-brand-soft flex items-center justify-center text-3xl flex-shrink-0">
            👩
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-lg font-bold text-gray-900">李**</h1>
              <span className="text-xs bg-gold text-white px-2 py-0.5 rounded-full font-semibold">
                🌟 VIP会员
              </span>
            </div>
            <p className="text-sm text-gray-500">手机：138****8888</p>
            <p className="text-xs text-gray-400 mt-0.5">注册时间：2024-08-15 · 累计消费 ¥1,286</p>
          </div>
          <Link to="/" className="ml-auto text-xs text-gray-400 hover:text-brand transition-colors flex-shrink-0">
            返回官网
          </Link>
        </div>
      </div>

      {/* Order status */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900">我的订单</h2>
          <button className="text-xs text-brand">查看全部 →</button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {ORDER_STATS.map(stat => (
            <button key={stat.label} className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-gray-50 transition-colors">
              <span className="text-2xl">{stat.emoji}</span>
              {stat.count > 0 && (
                <span className="text-base font-bold text-brand">{stat.count}</span>
              )}
              <span className="text-xs text-gray-500">{stat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Recent orders */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h2 className="font-bold text-gray-900 mb-4">最近订单</h2>
        <div className="space-y-4">
          {RECENT_ORDERS.map(order => (
            <div key={order.id} className="border border-gray-100 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 font-mono">{order.id}</span>
                  <span className="text-xs text-gray-400">{order.date}</span>
                </div>
                <span className={`text-xs font-semibold ${order.statusColor}`}>{order.status}</span>
              </div>
              <div className="px-4 py-3 space-y-2">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="text-xl">{item.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 font-medium truncate">{item.name}</p>
                      <p className="text-xs text-gray-400">{item.spec}</p>
                    </div>
                    <span className="text-sm font-semibold text-gray-700 flex-shrink-0">¥{item.price}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
                <span className="text-sm text-gray-500">
                  合计：<span className="font-bold text-gray-900">¥{order.total}</span>
                </span>
                <div className="flex gap-2">
                  {order.status === '待收货' && (
                    <button className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white font-medium">
                      确认收货
                    </button>
                  )}
                  <button className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600">
                    查看详情
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Menu list */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {MENU_ITEMS.map((item, idx) => (
          <Link
            key={item.label}
            to={item.to}
            className={`flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors ${idx > 0 ? 'border-t border-gray-50' : ''}`}
          >
            <span className="text-xl">{item.icon}</span>
            <span className="text-sm font-medium text-gray-700 flex-1">{item.label}</span>
            <span className="text-gray-300">›</span>
          </Link>
        ))}
        <button className="w-full flex items-center gap-3 px-5 py-4 border-t border-gray-50 hover:bg-red-50 transition-colors text-red-400">
          <span className="text-xl">🚪</span>
          <span className="text-sm font-medium flex-1 text-left">退出登录</span>
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/website" && npx tsc --noEmit
```

- [ ] **Step 3: 浏览器全面验证**

按以下顺序检查每个页面：

1. `http://localhost:5175` — 官网首页，顶部有"进入商城"按钮
2. 点击"进入商城" → `/shop` — 商城首页，绿色 ShopNavbar，3个商品分区，4列网格
3. 点击"海鲜水产"分类 → `/shop/category/seafood` — 分类页，子分类侧栏，排序功能
4. 点击任意商品 → `/shop/product/p001` — 详情页，SKU 选择，数量控制，加购成功提示
5. 点击"立即购买" → `/shop/checkout` — 结账页，配送选择，支付方式
6. 点击"确认支付" → 成功弹窗弹出，订单号显示
7. 点击"查看订单" → `/shop/user` — 个人中心，订单状态，最近订单
8. 点击购物车图标 → `/shop/cart` — 购物车，3件商品，勾选/增减/删除
9. 手机尺寸（375px）：所有页面 2 列商品网格，汉堡菜单正常

- [ ] **Step 4: 最终 commit**

```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && git add website/src/pages/shop/ShopUser.tsx && git commit -m "feat(shop): implement ShopUser with order history and menu"
```

---

## 自查结果

**Spec coverage：**
- ✅ 官网 Navbar "进入商城"按钮 → Task 4
- ✅ /shop/* 独立布局（ShopNavbar/ShopFooter）→ Task 3
- ✅ 响应式商品网格（2/3/4列）→ Task 5/6/7
- ✅ 首页 Banner + 秒杀条 + 3个商品分区 → Task 6
- ✅ 分类页（子分类 + 排序）→ Task 7
- ✅ 商品详情（SKU + 数量 + 加购 + 购买）→ Task 8
- ✅ 购物车（勾选 + 数量 + 删除 + 合计）→ Task 9
- ✅ 结账页（地址 + 配送 + 支付方式 + 成功弹窗）→ Task 10
- ✅ 个人中心（用户信息 + 订单状态 + 菜单）→ Task 11
- ✅ 广东海鲜生鲜 mock 数据（28件）→ Task 1
- ✅ 备案号/食品经营许可证 → Task 3（ShopFooter）
- ✅ TypeScript 编译验证 → 每个 Task 均有

**Type consistency：** `Product`/`CartItem`/`Category` 在 Task 1 定义，Task 5-11 均 import 自 `@/data/shopMockData`，无命名偏差。
