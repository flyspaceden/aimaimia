# 公司详情页优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将公司详情页从 7-Tab 活动为主结构重构为 4-Tab 电商+农业展示结构，新增商品展示、关注、分享、评分、联系等功能。

**Architecture:** 后端新增公司商品分页接口 + 详情接口扩展 isFollowed/servicePhone。前端完全重写 `app/company/[id].tsx`，商品 Tab 使用 FlatList 作为父容器解决嵌套滚动问题，其他 Tab 使用 ScrollView。4 Tab 使用图标+文字垂直布局。

**Tech Stack:** React Native 0.81 + Expo 54 / expo-router 6 / @tanstack/react-query / Zustand / NestJS + Prisma

**Spec:** `docs/superpowers/specs/2026-03-23-company-detail-redesign.md`
**Mockup:** `docs/mockup-company-detail.html`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/src/modules/company/company.controller.ts` | Modify | 新增 `GET /:id/products` 路由 |
| `backend/src/modules/company/company.service.ts` | Modify | 新增 `listCompanyProducts()` 方法 + 扩展 `getById()` 添加 isFollowed/servicePhone |
| `src/types/domain/Company.ts` | Modify | 新增 `isFollowed` 字段，新增 `CompanyProduct` 类型 |
| `src/repos/CompanyRepo.ts` | Modify | 新增 `listProducts()` 方法 |
| `app/company/[id].tsx` | Rewrite | 主页面完全重构 |

---

## Task 1: 后端 — 新增公司商品分页接口

**Files:**
- Modify: `backend/src/modules/company/company.controller.ts`
- Modify: `backend/src/modules/company/company.service.ts`

- [ ] **Step 1: 在 company.service.ts 中新增 listCompanyProducts 方法**

在 `CompanyService` 类中添加：

```typescript
async listCompanyProducts(
  companyId: string,
  options: { page?: number; pageSize?: number; category?: string },
) {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 10;
  const skip = (page - 1) * pageSize;

  const where: any = {
    companyId,
    status: 'ACTIVE',
    auditStatus: 'APPROVED',
    isReward: false,
  };

  if (options.category) {
    where.category = { name: options.category };
  }

  const [items, total] = await Promise.all([
    this.prisma.product.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        media: { take: 1, orderBy: { sortOrder: 'asc' } },
        skus: { take: 1, orderBy: { sortOrder: 'asc' } },
        category: { select: { name: true } },
        tags: { include: { tag: true } },
      },
    }),
    this.prisma.product.count({ where }),
  ]);

  // 获取该公司所有商品的去重分类列表
  const allCategories = await this.prisma.product.findMany({
    where: {
      companyId,
      status: 'ACTIVE',
      auditStatus: 'APPROVED',
      isReward: false,
    },
    select: { category: { select: { name: true } } },
    distinct: ['categoryId'],
  });

  const categories = allCategories
    .map((p) => p.category?.name)
    .filter(Boolean) as string[];

  return {
    items: items.map((p) => ({
      id: p.id,
      title: p.title,
      price: p.skus[0]?.price ?? 0,
      image: p.media[0]?.url ?? '',
      defaultSkuId: p.skus[0]?.id ?? '',
      tags: p.tags.map((pt) => pt.tag.name),
      unit: (p.attributes as any)?.unit ?? '',
      origin: (p.origin as any)?.text ?? p.originRegion ?? '',
      categoryName: p.category?.name ?? '',
    })),
    total,
    page,
    pageSize,
    nextPage: skip + pageSize < total ? page + 1 : undefined,
    categories,
  };
}
```

- [ ] **Step 2: 在 company.controller.ts 中新增路由**

在 `CompanyController` 类中，`listEvents` 方法之前添加：

```typescript
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
```

注意：此路由必须放在 `@Get(':id')` 之后、`@Get(':id/events')` 附近，确保路由不被 `:id` 参数拦截。由于 `products` 是固定路径段，NestJS 会正确匹配。

- [ ] **Step 3: 验证编译通过**

Run: `cd backend && npx tsc --noEmit`
Expected: 编译无错误

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/company/company.controller.ts backend/src/modules/company/company.service.ts
git commit -m "feat(company): add GET /companies/:id/products paginated endpoint"
```

---

## Task 2: 后端 — 扩展详情接口返回 isFollowed 和 servicePhone

**Files:**
- Modify: `backend/src/modules/company/company.service.ts`
- Modify: `backend/src/modules/company/company.controller.ts`

- [ ] **Step 1: 修改 getById 方法，接受可选 userId 参数**

在 `company.service.ts` 的 `getById` 方法中：

```typescript
async getById(id: string, userId?: string) {
  const company = await this.prisma.company.findUnique({
    where: { id },
    include: { profile: true },
  });
  if (!company) throw new NotFoundException('企业不存在');

  let isFollowed = false;
  if (userId) {
    // Follow 模型使用 followerId + followedId 复合唯一键
    const follow = await this.prisma.follow.findUnique({
      where: { followerId_followedId: { followerId: userId, followedId: id } },
    });
    isFollowed = !!follow;
  }

  return {
    ...this.mapToFrontend(company),
    servicePhone: company.servicePhone ?? null,
    isFollowed,
  };
}
```

- [ ] **Step 2: 在 controller 中注入 JwtService 并修改 getById 路由**

首先确保 `company.module.ts` 导入 `JwtModule`：
```typescript
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [JwtModule.register({})],  // 添加此行
  // ...
})
```

然后在 `company.controller.ts` 中：

1. 添加 imports：
```typescript
import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
```

2. 注入 JwtService：
```typescript
constructor(
  private readonly companyService: CompanyService,
  private readonly jwtService: JwtService,  // 新增
) {}
```

3. 修改 getById 方法：
```typescript
@Public()
@Get(':id')
async getById(@Param('id') id: string, @Req() req: any) {
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
```

- [ ] **Step 3: 验证编译通过**

Run: `cd backend && npx tsc --noEmit`
Expected: 编译无错误

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/company/company.controller.ts backend/src/modules/company/company.service.ts
git commit -m "feat(company): add isFollowed and servicePhone to detail response"
```

---

## Task 3: 前端 — 更新类型定义和 Repo

**Files:**
- Modify: `src/types/domain/Company.ts`
- Modify: `src/repos/CompanyRepo.ts`

- [ ] **Step 1: 更新 Company 类型，新增 CompanyProduct 类型**

在 `src/types/domain/Company.ts` 中：

在 `Company` 类型中新增字段：
```typescript
isFollowed?: boolean;
```

在文件末尾新增：
```typescript
export type CompanyProduct = {
  id: string;
  title: string;
  price: number;
  image: string;
  defaultSkuId: string;
  tags: string[];
  unit: string;
  origin: string;
  categoryName: string;
};

export type CompanyProductsResponse = {
  items: CompanyProduct[];
  total: number;
  page: number;
  pageSize: number;
  nextPage?: number;
  categories: string[];
};
```

- [ ] **Step 2: 在 CompanyRepo 中新增 listProducts 方法**

在 `src/repos/CompanyRepo.ts` 中，`getById` 方法之后添加：

```typescript
async listProducts(
  companyId: string,
  options?: { page?: number; pageSize?: number; category?: string },
): Promise<Result<CompanyProductsResponse>> {
  if (USE_MOCK) {
    // mock 数据：从已有的 topProducts 扩展
    const company = mockCompanies.find((c) => c.id === companyId);
    const products = (company?.topProducts ?? []).map((p, i) => ({
      ...p,
      defaultSkuId: p.defaultSkuId ?? `sku-${p.id}`,
      tags: ['有机', '当季'].slice(0, (i % 2) + 1),
      unit: ['斤', '盒', '袋'][i % 3],
      origin: '湖南长沙',
      categoryName: ['有机蔬菜', '精品水果', '生态禽蛋'][i % 3],
    }));

    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 10;
    const filtered = options?.category
      ? products.filter((p) => p.categoryName === options.category)
      : products;
    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);
    const categories = [...new Set(products.map((p) => p.categoryName))];

    return simulateRequest({
      items: paged,
      total: filtered.length,
      page,
      pageSize,
      nextPage: start + pageSize < filtered.length ? page + 1 : undefined,
      categories,
    });
  }

  // ApiClient.get 第二个参数直接是 Record<string, string | number | undefined>
  return ApiClient.get<CompanyProductsResponse>(
    `/companies/${companyId}/products`,
    { page: options?.page, pageSize: options?.pageSize, category: options?.category },
  );
},
```

确保 import 中包含 `CompanyProductsResponse`：
```typescript
import { Company, CompanyProductsResponse } from '../types/domain/Company';
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 编译无错误

- [ ] **Step 4: Commit**

```bash
git add src/types/domain/Company.ts src/repos/CompanyRepo.ts
git commit -m "feat(company): add CompanyProduct type and listProducts repo method"
```

---

## Task 4: 前端 — 重写封面区 + 信息条 + Tab 栏

**Files:**
- Modify: `app/company/[id].tsx`

这是主要的前端重构任务。由于文件较大（1047行），分步进行。

- [ ] **Step 1: 更新 imports**

替换文件顶部 imports 为：

```typescript
import React, { useCallback, useMemo, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CalendarStrip } from '../../src/components/data';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { BookingForm, BookingFormValues } from '../../src/components/forms';
import { AppHeader, Screen } from '../../src/components/layout';
import { AppBottomSheet } from '../../src/components/overlay';
import { ProductCard } from '../../src/components/cards';
import { Tag } from '../../src/components/ui/Tag';
import { bookingStatusLabels, groupStatusLabels, identityOptions, paymentMethods } from '../../src/constants';
import { BookingRepo, CompanyEventRepo, CompanyRepo, FollowRepo, GroupRepo } from '../../src/repos';
import { useAuthStore, useCartStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AppError, CompanyEvent, CompanyProduct, CompanyProductsResponse, Group, PaymentMethod } from '../../src/types';
```

- [ ] **Step 2: 重写 Tab 定义和状态变量**

替换 tabs 数组和相关 state：

```typescript
const TABS = [
  { key: 'products', label: '商品', icon: 'cart-outline' },
  { key: 'events', label: '活动预约', icon: 'calendar-clock' },
  { key: 'profile', label: '企业档案', icon: 'file-document-outline' },
  { key: 'group', label: '组团', icon: 'account-group-outline' },
] as const;

type TabKey = (typeof TABS)[number]['key'];
```

state 变量中将 `activeTab` 默认值改为 `'products'`：
```typescript
const [activeTab, setActiveTab] = useState<TabKey>('products');
```

新增状态：
```typescript
const [isFollowed, setIsFollowed] = useState(false);
const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
```

- [ ] **Step 3: 新增数据获取 hooks**

在现有的 useQuery 之后添加：

```typescript
// 公司商品无限加载
const {
  data: productsData,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading: productsLoading,
  isError: productsError,
  refetch: refetchProducts,
} = useInfiniteQuery<CompanyProductsResponse, AppError>({
  queryKey: ['companyProducts', companyId, selectedCategory],
  queryFn: async ({ pageParam = 1 }) => {
    const result = await CompanyRepo.listProducts(companyId ?? '', {
      page: typeof pageParam === 'number' ? pageParam : 1,
      pageSize: 10,
      category: selectedCategory ?? undefined,
    });
    if (!result.ok) throw result.error;
    return result.data;
  },
  getNextPageParam: (lastPage) => lastPage.nextPage,
  initialPageParam: 1,
  enabled: Boolean(companyId),
});

const allProducts = useMemo(
  () => productsData?.pages.flatMap((p) => p.items) ?? [],
  [productsData],
);
const categories = productsData?.pages[0]?.categories ?? [];
```

同步关注状态（在 company useQuery 成功后）：

在 company 的 useQuery 配置中，确保读取 `isFollowed`。在 company 数据加载后：
```typescript
// 在组件中、company 数据变化时同步关注状态
React.useEffect(() => {
  if (company) {
    setIsFollowed(company.isFollowed ?? false);
  }
}, [company]);
```

- [ ] **Step 4: 编写封面区 JSX**

替换旧的 cover 部分为以下渲染函数（方便在 FlatList ListHeaderComponent 中复用）：

```typescript
const { width: screenWidth } = Dimensions.get('window');

const handleShare = useCallback(async () => {
  if (!company) return;
  try {
    await Share.share({
      message: `${company.name} - ${company.mainBusiness}`,
    });
  } catch {}
}, [company]);

const handleFollow = useCallback(async () => {
  if (!isLoggedIn) {
    // 显示登录提示
    show({ message: '请先登录', type: 'info' });
    return;
  }
  if (!companyId) return;
  setIsFollowed((prev) => !prev);
  const result = await FollowRepo.toggleFollow(companyId, '');
  if (!result.ok) {
    setIsFollowed((prev) => !prev);
    show({ message: '操作失败', type: 'error' });
  }
}, [isLoggedIn, companyId, show]);

const handleCall = useCallback(() => {
  if (company?.servicePhone) {
    Linking.openURL(`tel:${company.servicePhone}`);
  }
}, [company?.servicePhone]);

// 封面区渲染
const renderCover = () => (
  <View>
    {/* 封面图 */}
    <View style={styles.cover}>
      <Image
        source={{ uri: company?.cover }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient
        colors={['rgba(0,0,0,0.1)', 'rgba(0,0,0,0.65)']}
        style={StyleSheet.absoluteFill}
      />
      {/* 顶部按钮 */}
      <View style={styles.coverTop}>
        <Pressable style={styles.coverTopBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <View style={styles.coverTopRight}>
          <Pressable style={styles.coverTopBtn} onPress={handleShare}>
            <MaterialCommunityIcons name="share-variant-outline" size={18} color="#fff" />
          </Pressable>
          <Pressable style={styles.coverTopBtn}>
            <MaterialCommunityIcons name="dots-horizontal" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>
      {/* 底部信息 */}
      <View style={styles.coverBottom}>
        <View style={styles.coverInfo}>
          {company?.cover ? (
            <Image
              source={{ uri: company.cover }}
              style={styles.companyLogo}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.companyLogo, { backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }]}>
              <MaterialCommunityIcons name="storefront-outline" size={24} color="#fff" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.companyName}>{company?.name}</Text>
            <Text style={styles.companyBiz}>{company?.mainBusiness}</Text>
            <View style={styles.companyLocRow}>
              <Text style={styles.companyLoc}>📍 {company?.location}</Text>
              {company?.distanceKm != null && (
                <Text style={styles.companyLoc}>{company.distanceKm.toFixed(1)} km</Text>
              )}
            </View>
          </View>
        </View>
        <Pressable
          style={[styles.followBtn, isFollowed && styles.followBtnActive]}
          onPress={handleFollow}
        >
          <Text style={[styles.followBtnText, isFollowed && styles.followBtnTextActive]}>
            {isFollowed ? '✓ 已关注' : '+ 关注'}
          </Text>
        </Pressable>
      </View>
    </View>

    {/* 信息条：评分 + 联系电话 */}
    <View style={styles.infoBar}>
      <View style={styles.ratingArea}>
        <Text style={{ color: '#f5a623', fontSize: 13 }}>★★★★★</Text>
        <Text style={[styles.ratingNum, { color: colors.text.primary }]}>4.8</Text>
        <Text style={{ fontSize: 11, color: colors.text.tertiary }}>暂无评价</Text>
      </View>
      {company?.servicePhone ? (
        <Pressable style={[styles.phoneBtn, { backgroundColor: colors.primary + '15' }]} onPress={handleCall}>
          <MaterialCommunityIcons name="phone-outline" size={16} color={colors.primary} />
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.primary }}>联系商家</Text>
        </Pressable>
      ) : null}
    </View>

    {/* 认证标签行 */}
    {company?.badges && company.badges.length > 0 && (
      <View style={styles.badgeRow}>
        {company.badges.map((badge, i) => (
          <Tag key={i} label={`✓ ${badge}`} />
        ))}
      </View>
    )}
  </View>
);
```

- [ ] **Step 5: 编写 Tab 栏 JSX**

```typescript
const renderTabBar = () => (
  <View style={styles.tabBar}>
    {TABS.map((tab) => {
      const active = activeTab === tab.key;
      return (
        <Pressable
          key={tab.key}
          style={styles.tabItem}
          onPress={() => setActiveTab(tab.key)}
        >
          <View style={[
            styles.tabIcon,
            { backgroundColor: active ? colors.primary : colors.surface.secondary },
          ]}>
            <MaterialCommunityIcons
              name={tab.icon as any}
              size={20}
              color={active ? '#fff' : colors.text.tertiary}
            />
          </View>
          <Text style={[
            styles.tabLabel,
            { color: active ? colors.primary : colors.text.tertiary },
            active && { fontWeight: '600' },
          ]}>
            {tab.label}
          </Text>
          {active && <View style={[styles.tabIndicator, { backgroundColor: colors.primary }]} />}
        </Pressable>
      );
    })}
  </View>
);
```

- [ ] **Step 6: 中间检查点**

此时旧 tab 内容的引用会导致编译错误，这是预期的。不要在此处 commit，继续 Task 5-8 完成全部 tab 重写后再统一 commit。

---

## Task 5: 前端 — 商品 Tab + 滚动架构

**Files:**
- Modify: `app/company/[id].tsx`

- [ ] **Step 1: 编写商品列表渲染函数**

```typescript
const { addItem } = useCartStore();

const renderProductItem = useCallback(
  ({ item, index }: { item: CompanyProduct; index: number }) => {
    const gap = spacing.md;
    const cardWidth = (screenWidth - spacing.xl * 2 - gap) / 2;
    const imageHeight = cardWidth * 0.85;

    return (
      <Animated.View
        entering={FadeInDown.duration(300).delay(50 + (index % 6) * 30)}
        style={{ width: cardWidth, marginBottom: gap }}
      >
        <ProductCard
          product={{
            id: item.id,
            title: item.title,
            price: item.price,
            image: item.image,
            tags: item.tags,
            unit: item.unit,
            origin: item.origin,
            defaultSkuId: item.defaultSkuId,
          }}
          width={cardWidth}
          imageHeight={imageHeight}
          onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
          onAdd={(p) => {
            addItem(p, 1, item.defaultSkuId, item.price);
            show({ message: '已加入购物车', type: 'success' });
          }}
        />
      </Animated.View>
    );
  },
  [spacing, screenWidth, router, addItem, show],
);
```

- [ ] **Step 2: 编写分类筛选条**

```typescript
const renderCategoryFilter = () => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.sm }}
  >
    <Pressable
      style={[
        styles.catChip,
        !selectedCategory && { backgroundColor: colors.primary, borderColor: colors.primary },
      ]}
      onPress={() => setSelectedCategory(null)}
    >
      <Text style={[styles.catChipText, !selectedCategory && { color: '#fff' }]}>
        全部
      </Text>
    </Pressable>
    {categories.map((cat) => (
      <Pressable
        key={cat}
        style={[
          styles.catChip,
          selectedCategory === cat && { backgroundColor: colors.primary, borderColor: colors.primary },
        ]}
        onPress={() => setSelectedCategory(cat)}
      >
        <Text style={[styles.catChipText, selectedCategory === cat && { color: '#fff' }]}>
          {cat}
        </Text>
      </Pressable>
    ))}
  </ScrollView>
);
```

- [ ] **Step 3: 编写商品 Tab 的 FlatList 父容器模式**

核心滚动架构 — 商品 Tab 使用 FlatList 作为父容器：

```typescript
const renderProductsTab = () => {
  if (productsLoading) {
    const gap = spacing.md;
    const cardW = (screenWidth - spacing.xl * 2 - gap) / 2;
    return (
      <View style={{ padding: spacing.xl, flexDirection: 'row', flexWrap: 'wrap', gap }}>
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} width={cardW} height={cardW * 1.3} radius={radius.lg} />
        ))}
      </View>
    );
  }

  if (productsError) {
    return <ErrorState title="商品加载失败" onAction={() => refetchProducts()} />;
  }

  if (allProducts.length === 0) {
    return <EmptyState title="暂无商品" description="该企业还未上架商品" />;
  }

  return null; // 商品数据由父 FlatList 直接渲染
};
```

- [ ] **Step 4: 重写主渲染结构 — 按 Tab 切换容器类型**

```typescript
// 主组件 return 中：
if (loading) return <Screen><Skeleton ... /></Screen>;
if (error || !company) return <Screen><ErrorState ... /></Screen>;

// 商品 Tab — 使用 FlatList 作为最外层容器
if (activeTab === 'products') {
  const productsTabHeader = (
    <>
      {renderCover()}
      {renderTabBar()}
      {renderCategoryFilter()}
    </>
  );

  // 三态：加载/错误/空
  if (productsLoading || productsError || allProducts.length === 0) {
    return (
      <Screen>
        <ScrollView>
          {productsTabHeader}
          {renderProductsTab()}
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={allProducts}
        numColumns={2}
        keyExtractor={(item) => item.id}
        columnWrapperStyle={{ justifyContent: 'space-between', paddingHorizontal: spacing.xl }}
        ListHeaderComponent={productsTabHeader}
        renderItem={renderProductItem}
        onEndReachedThreshold={0.3}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={{ padding: spacing.xl, alignItems: 'center' }}>
              <Text style={{ color: colors.text.tertiary, fontSize: 12 }}>加载更多...</Text>
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

// 其他 Tab — 使用 ScrollView 作为最外层容器
// onRefresh 定义（复用现有 refetch 逻辑）：
// const onRefresh = useCallback(async () => {
//   setRefreshing(true);
//   await Promise.all([refetchCompany(), refetchEvents(), refetchBookings(), refetchGroups()]);
//   setRefreshing(false);
// }, [refetchCompany, refetchEvents, refetchBookings, refetchGroups]);
return (
  <Screen>
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {renderCover()}
      {renderTabBar()}

      {activeTab === 'events' && renderEventsTab()}
      {activeTab === 'profile' && renderProfileTab()}
      {activeTab === 'group' && renderGroupTab()}
    </ScrollView>

    {/* Bottom Sheets（保留现有） */}
    {/* ... booking sheet, agenda sheet, group sheet ... */}
  </Screen>
);
```

- [ ] **Step 5: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 编译无错误

- [ ] **Step 6: Commit**

```bash
git add app/company/[id].tsx
git commit -m "feat(company): add products tab with FlatList scroll architecture"
```

---

## Task 6: 前端 — 活动预约 Tab（合并日历+预约）

**Files:**
- Modify: `app/company/[id].tsx`

- [ ] **Step 1: 编写 renderEventsTab 函数**

合并原 `calendar` 和 `booking` tab 的逻辑为一个渲染函数：

```typescript
const renderEventsTab = () => (
  <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
    {/* 活动日历部分 — 复用现有 CalendarStrip + 活动卡片逻辑 */}
    <Text style={[typography.h3, { color: colors.text.primary, marginBottom: spacing.sm }]}>
      可预约日历
    </Text>

    {/* CalendarStrip 组件（保留现有） */}
    <CalendarStrip
      selectedDate={selectedDate}
      onSelectDate={setSelectedDate}
      eventDates={eventDates}
    />

    {/* 当天活动列表（保留现有渲染逻辑） */}
    {/* ... 现有的 agenda 卡片渲染代码，从旧 calendar tab 复制 ... */}

    {/* 查看全部日程按钮 */}
    <Pressable
      style={[styles.outlineBtn, { borderColor: colors.primary }]}
      onPress={() => { setAgendaSheetDate(selectedDate); setAgendaSheetOpen(true); }}
    >
      <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '500' }}>查看全部日程</Text>
    </Pressable>

    {/* 分隔线 — 我的预约 */}
    <View style={styles.sectionDivider}>
      <Text style={[styles.sectionDividerText, { color: colors.text.secondary }]}>
        我的预约
      </Text>
      <View style={[styles.sectionDividerLine, { backgroundColor: colors.border.primary }]} />
    </View>

    {/* 我的预约列表（从旧 booking tab 移入） */}
    {!isLoggedIn ? (
      <EmptyState title="请先登录" description="登录后查看您的预约记录" />
    ) : !bookings || bookings.length === 0 ? (
      <EmptyState title="暂无预约" description="参与企业活动，预约后在此查看" />
    ) : (
      bookings.map((booking: any) => (
        /* 保留现有 booking card 渲染逻辑 */
        <View key={booking.id} style={styles.bookingCard}>
          {/* ... */}
        </View>
      ))
    )}
  </View>
);
```

具体实现：从旧文件中的 `{activeTab === 'calendar' && ...}` 和 `{activeTab === 'booking' && ...}` 两个条件块中提取 JSX，合并到此函数中。日历部分在上方，预约部分在下方，用分隔线隔开。

- [ ] **Step 2: Commit**

```bash
git add app/company/[id].tsx
git commit -m "feat(company): merge calendar and booking into events tab"
```

---

## Task 7: 前端 — 企业档案 Tab（合并 4 个旧 Tab）

**Files:**
- Modify: `app/company/[id].tsx`

- [ ] **Step 1: 编写 renderProfileTab 函数**

```typescript
const renderProfileTab = () => (
  <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.md }}>
    {/* 卡片 1：企业简介 */}
    <View style={[styles.profileCard, { backgroundColor: colors.surface.primary }]}>
      <View style={styles.profileCardTitle}>
        <View style={[styles.profileCardIcon, { backgroundColor: colors.primary + '15' }]}>
          <MaterialCommunityIcons name="file-document-outline" size={16} color={colors.primary} />
        </View>
        <Text style={[typography.h4, { color: colors.text.primary }]}>企业简介</Text>
      </View>
      {company?.description && (
        <Text style={{ fontSize: 13, color: colors.text.secondary, lineHeight: 22, marginBottom: spacing.md }}>
          {company.description}
        </Text>
      )}
      <View>
        {[
          { key: '主营业务', val: company?.mainBusiness },
          { key: '企业类型', val: company?.companyType },
          { key: '地址', val: company?.address?.text || company?.location },
          { key: '距离', val: company?.distanceKm != null ? `${company.distanceKm.toFixed(1)} km` : undefined },
        ].filter(({ val }) => val).map(({ key, val }) => (
          <View key={key} style={styles.profileKv}>
            <Text style={[styles.profileKey, { color: colors.text.tertiary }]}>{key}</Text>
            <Text style={[styles.profileVal, { color: colors.text.primary }]}>{val}</Text>
          </View>
        ))}
      </View>
      {/* 企业亮点（如有） */}
      {company?.highlights && Object.keys(company.highlights).length > 0 && (
        <View style={{ marginTop: spacing.md }}>
          {Object.entries(company.highlights).map(([k, v]) => (
            <View key={k} style={styles.profileKv}>
              <Text style={[styles.profileKey, { color: colors.text.tertiary }]}>{k}</Text>
              <Text style={[styles.profileVal, { color: colors.text.primary }]}>{v}</Text>
            </View>
          ))}
        </View>
      )}
    </View>

    {/* 卡片 2：资质认证 */}
    <View style={[styles.profileCard, { backgroundColor: colors.surface.primary }]}>
      <View style={styles.profileCardTitle}>
        <View style={[styles.profileCardIcon, { backgroundColor: '#fff3e0' }]}>
          <MaterialCommunityIcons name="certificate-outline" size={16} color="#e65100" />
        </View>
        <Text style={[typography.h4, { color: colors.text.primary }]}>资质认证</Text>
      </View>
      <View style={styles.certGrid}>
        {[...(company?.badges ?? []), ...(company?.certifications ?? [])].map((cert, i) => (
          <View key={i} style={[styles.certItem, { backgroundColor: colors.primary + '10' }]}>
            <MaterialCommunityIcons name="check-circle-outline" size={14} color={colors.primary} />
            <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '500' }}>{cert}</Text>
          </View>
        ))}
      </View>
    </View>

    {/* 卡片 3：检测报告 */}
    <View style={[styles.profileCard, { backgroundColor: colors.surface.primary }]}>
      <View style={styles.profileCardTitle}>
        <View style={[styles.profileCardIcon, { backgroundColor: '#e3f2fd' }]}>
          <MaterialCommunityIcons name="flask-outline" size={16} color="#1565c0" />
        </View>
        <Text style={[typography.h4, { color: colors.text.primary }]}>检测报告</Text>
      </View>
      <View style={styles.testSummary}>
        {[
          { num: '—', label: '检测批次' },
          { num: '—', label: '合格率' },
          { num: company?.latestTestedAt ? new Date(company.latestTestedAt).toLocaleDateString('zh-CN', { month: 'long' }) : '暂无', label: '最近检测' },
        ].map(({ num, label }) => (
          <View key={label} style={[styles.testStat, { backgroundColor: colors.surface.secondary }]}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text.tertiary }}>{num}</Text>
            <Text style={{ fontSize: 11, color: colors.text.tertiary, marginTop: 4 }}>{label}</Text>
          </View>
        ))}
      </View>
      <Pressable style={[styles.reportLink, { backgroundColor: colors.surface.secondary }]}>
        <Text style={{ fontSize: 12, color: colors.text.tertiary, textAlign: 'center' }}>
          点击查看完整检测报告 →
        </Text>
      </Pressable>
    </View>

    {/* 卡片 4：企业风采 */}
    <View style={[styles.profileCard, { backgroundColor: colors.surface.primary }]}>
      <View style={styles.profileCardTitle}>
        <View style={[styles.profileCardIcon, { backgroundColor: '#fce4ec' }]}>
          <MaterialCommunityIcons name="image-multiple-outline" size={16} color="#c62828" />
        </View>
        <Text style={[typography.h4, { color: colors.text.primary }]}>企业风采</Text>
      </View>
      <View style={styles.galleryGrid}>
        {/* 使用 cover 重复展示，第一张跨两列 */}
        {company?.cover && (
          <>
            <Image source={{ uri: company.cover }} style={styles.galleryWide} contentFit="cover" />
            <Image source={{ uri: company.cover }} style={styles.gallerySquare} contentFit="cover" />
            <Image source={{ uri: company.cover }} style={styles.gallerySquare} contentFit="cover" />
            <Image source={{ uri: company.cover }} style={styles.gallerySquare} contentFit="cover" />
            <Image source={{ uri: company.cover }} style={styles.gallerySquare} contentFit="cover" />
          </>
        )}
      </View>
    </View>
  </View>
);
```

- [ ] **Step 2: Commit**

```bash
git add app/company/[id].tsx
git commit -m "feat(company): merge profile/cert/test/gallery into profile tab"
```

---

## Task 8: 前端 — 组团 Tab 微调 + 样式定义

**Files:**
- Modify: `app/company/[id].tsx`

- [ ] **Step 1: 编写 renderGroupTab 函数**

保留现有组团逻辑，微调状态说明卡为渐变背景：

```typescript
const renderGroupTab = () => (
  <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
    {/* 渐变状态说明卡 */}
    <LinearGradient
      colors={[colors.primary + '15', '#e3f2fd30']}
      style={[styles.profileCard, { borderWidth: 0 }]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <Text style={[typography.h4, { color: colors.text.primary }]}>组团状态看板</Text>
      <Text style={{ fontSize: 12, color: colors.text.secondary, marginTop: 4 }}>
        目标成团人数由后台配置，当前默认 {company?.groupTargetSize ?? 30} 人
      </Text>
    </LinearGradient>

    {/* 组团列表（保留现有渲染逻辑） */}
    {/* ... 从旧 group tab 复制组团卡片渲染代码 ... */}
  </View>
);
```

- [ ] **Step 2: 编写完整的 StyleSheet**

新增所有新样式定义（替换旧样式中不再需要的部分，保留仍在使用的部分）：

```typescript
// 在 StyleSheet.create 中新增：
cover: { height: 260, position: 'relative' },
coverTop: {
  position: 'absolute', top: 48, left: 16, right: 16, zIndex: 2,
  flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
},
coverTopBtn: {
  width: 36, height: 36, borderRadius: 18,
  backgroundColor: 'rgba(255,255,255,0.18)',
  alignItems: 'center', justifyContent: 'center',
},
coverTopRight: { flexDirection: 'row', gap: 8 },
coverBottom: {
  position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 2,
  flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
},
coverInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
companyLogo: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' },
companyName: { fontSize: 20, fontWeight: '700', color: '#fff', lineHeight: 26 },
companyBiz: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
companyLocRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
companyLoc: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
followBtn: {
  backgroundColor: '#2E7D32', paddingHorizontal: 20, paddingVertical: 8,
  borderRadius: 20, flexShrink: 0,
},
followBtnActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
followBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
followBtnTextActive: { color: '#fff' },

// 信息条
infoBar: {
  paddingHorizontal: 16, paddingVertical: 14,
  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
},
ratingArea: { flexDirection: 'row', alignItems: 'center', gap: 8 },
ratingNum: { fontSize: 16, fontWeight: '700' },
phoneBtn: {
  flexDirection: 'row', alignItems: 'center', gap: 6,
  paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
},
badgeRow: {
  paddingHorizontal: 16, paddingBottom: 6,
  flexDirection: 'row', flexWrap: 'wrap', gap: 6,
},

// Tab 栏
tabBar: {
  flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 16,
  borderBottomWidth: 1,
},
tabItem: { flex: 1, alignItems: 'center', gap: 4, position: 'relative', paddingVertical: 4 },
tabIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
tabLabel: { fontSize: 11 },
tabIndicator: {
  position: 'absolute', bottom: 0, width: 24, height: 2, borderRadius: 1,
  alignSelf: 'center',
},

// 分类筛选
catChip: {
  paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16,
  borderWidth: 1, borderColor: '#e0e0d8',
},
catChipText: { fontSize: 12, color: '#666' },

// 企业档案
profileCard: { borderRadius: 12, padding: 16 },
profileCardTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
profileCardIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
profileKv: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
profileKey: { width: 70, fontSize: 12, flexShrink: 0 },
profileVal: { fontSize: 12, flex: 1 },
certGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
certItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
testSummary: { flexDirection: 'row', gap: 12, marginBottom: 12 },
testStat: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
reportLink: { padding: 12, borderRadius: 8 },
galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
galleryWide: { width: '65%', aspectRatio: 2, borderRadius: 8 },
gallerySquare: { width: '31%', aspectRatio: 1, borderRadius: 8 },

// 活动预约
sectionDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 16 },
sectionDividerText: { fontSize: 13, fontWeight: '600' },
sectionDividerLine: { flex: 1, height: 1 },
outlineBtn: { borderWidth: 1, borderRadius: 20, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
bookingCard: { borderRadius: 12, padding: 14, marginBottom: 10 },
```

- [ ] **Step 3: 清理旧代码**

删除不再使用的旧样式定义（旧 tab 样式、旧 cover 样式、旧快捷信息卡样式等）。删除不再使用的旧 tab 渲染代码。

- [ ] **Step 4: 确保 CompanyProductsResponse 在 types/index.ts 中导出**

在 `src/types/domain/index.ts` 中确认 Company 导出包含新类型：
```typescript
export * from './Company';  // 应已存在
```

在 `src/types/index.ts` 中确认：
```typescript
export * from './domain';  // 应已存在
```

- [ ] **Step 5: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 编译无错误

- [ ] **Step 6: Commit**

```bash
git add app/company/[id].tsx src/types/domain/index.ts
git commit -m "feat(company): complete page redesign with all tabs and styles"
```

---

## Task 9: 整体验证 + 清理

**Files:**
- All modified files

- [ ] **Step 1: 后端编译验证**

Run: `cd backend && npx tsc --noEmit`
Expected: 编译无错误

- [ ] **Step 2: 前端编译验证**

Run: `npx tsc --noEmit`
Expected: 编译无错误

- [ ] **Step 3: 检查未使用的 imports**

确保 `app/company/[id].tsx` 中没有未使用的 import（如旧的组件、类型等）。

- [ ] **Step 4: 删除 mockup 文件（可选）**

`docs/mockup-company-detail.html` 设计稿文件可以保留作为参考，不需要删除。

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore(company): cleanup unused imports and verify build"
```
