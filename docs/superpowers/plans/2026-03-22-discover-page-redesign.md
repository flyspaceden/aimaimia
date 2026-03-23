# 发现页 UIUX 重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Discover page (museum.tsx) with tab-based product/company browsing, AI horizontal scroll recommendations, masonry waterfall product grid, and full-screen map mode.

**Architecture:** Replace the current linear-stacked layout with a two-tab (商品/企业) structure. Products tab uses horizontal scroll for AI picks + masonry waterfall for browsing. Companies tab uses single-column cards with embedded product thumbnails. Map mode becomes full-screen with floating controls. Cross-linking between products and companies via embedded source labels.

**Tech Stack:** React Native 0.81 + Expo 54 / expo-router 6 / FlashList / react-native-reanimated / @tanstack/react-query / Zustand

**Spec:** `docs/superpowers/specs/2026-03-22-discover-page-redesign.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `app/(tabs)/museum.tsx` | Rewrite | Main discover page — tab state, sticky header, tab content routing |
| `src/components/cards/ProductCard.tsx` | Modify | Add company source label at bottom of card |
| `src/components/cards/CompanyCard.tsx` | Rewrite | New full-width card layout with top products thumbnails |
| `src/components/overlay/MapView.tsx` | Modify | Full-screen layout support with floating controls + bottom card popup |
| `src/types/domain/Company.ts` | Modify | Add `topProducts` field |
| `src/repos/CompanyRepo.ts` | Modify | Add pagination + filter params to list() |

---

### Task 1: Add company source label to ProductCard

**Files:**
- Modify: `src/components/cards/ProductCard.tsx`
- Modify: `src/types/domain/Product.ts`

- [ ] **Step 1: Verify Product type has companyId and companyName**

Read `src/types/domain/Product.ts`. The `Product` type has `companyId?: string` but no `companyName`. `ProductDetail` has `companyName?: string`. Add `companyName` to `Product`:

```typescript
// In Product type, add:
companyName?: string;
```

- [ ] **Step 2: Add company source label to ProductCard**

At the bottom of ProductCard (after the price/add-to-cart row), add a company source row. Only shown when `product.companyName` exists:

```tsx
{product.companyName && (
  <Pressable
    onPress={(e) => {
      e.stopPropagation();
      if (product.companyId) {
        router.push({ pathname: '/company/[id]', params: { id: product.companyId } });
      }
    }}
    style={{
      marginTop: spacing.xs,
      paddingTop: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    }}
  >
    <Text style={[typography.captionSm, { color: colors.brand.primary }]}>
      {product.companyName}
    </Text>
    <MaterialCommunityIcons name="chevron-right" size={12} color={colors.muted} />
  </Pressable>
)}
```

Required imports to add at top of ProductCard.tsx:
- `import { useRouter } from 'expo-router';` (new)
- `Pressable` from react-native (verify already imported)
- `MaterialCommunityIcons` (verify already imported — it is)

Inside the component function, add: `const router = useRouter();`

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/jamesheden/Desktop/农脉\ -\ AI赋能农业电商平台 && npx tsc --noEmit --project tsconfig.json 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src/components/cards/ProductCard.tsx src/types/domain/Product.ts
git commit -m "feat(discover): add company source label to ProductCard"
```

---

### Task 2: Redesign CompanyCard with top products thumbnails

**Files:**
- Modify: `src/types/domain/Company.ts`
- Rewrite: `src/components/cards/CompanyCard.tsx`

- [ ] **Step 1: Add topProducts to Company type**

In `src/types/domain/Company.ts`, add to the Company type:

```typescript
topProducts?: Array<{
  id: string;
  title: string;
  price: number;
  image: string;
}>;
```

- [ ] **Step 2: Rewrite CompanyCard component**

Replace the current CompanyCard with a new full-width layout:

```
┌──────────────────────────────────────┐
│ [Logo 48px]  CompanyName  [认证标签]  │
│              地区 · 距离 · 好评率     │
├──────────────────────────────────────┤
│ [商品1缩略图] [商品2缩略图] [商品3] +N│
│  名称 ¥价格   名称 ¥价格  名称 ¥价格 │
└──────────────────────────────────────┘
```

Props interface stays the same: `{ company, onPress }`. Add optional `onProductPress?: (productId: string) => void`.

Key implementation details:
- Outer `Pressable` wraps entire card → `onPress(company)`
- Inner product thumbnails each have `Pressable` with `e.stopPropagation()` → `onProductPress(product.id)`
- Company logo: 48px rounded square, uses `company.cover` as Image source; if no cover, show first character of `company.name` as text fallback on gradient background
- Certification badges: use `company.certifications` array if present, else fall back to `company.badges`
- Product thumbnails: show first 3 items from `company.topProducts`, each thumbnail is `flex:1` with 52px image height + name + price below
- Show `+N` indicator after 3rd thumbnail where N = `topProducts.length - 3`
- If `topProducts` is empty/undefined, don't render the thumbnail row at all (card is shorter)
- Card style: `backgroundColor: colors.surface`, `borderRadius: radius.lg`, `borderWidth: 1`, `borderColor: colors.border`, `padding: spacing.md`, `marginBottom: spacing.sm`

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src/types/domain/Company.ts src/components/cards/CompanyCard.tsx
git commit -m "feat(discover): redesign CompanyCard with top products thumbnails"
```

---

### Task 3: Update CompanyRepo with pagination and filters

**Files:**
- Modify: `src/repos/CompanyRepo.ts`

- [ ] **Step 1: Read current CompanyRepo implementation**

Read `src/repos/CompanyRepo.ts` to understand the current API structure (mock vs real).

- [ ] **Step 2: Add paginated list with filters**

Add a new method or update existing `list()` to support:

```typescript
CompanyRepo.list(options?: {
  page?: number;
  pageSize?: number;
  certified?: boolean;
  productCategory?: string;
  sortBy?: 'distance' | 'rating';
  includeTopProducts?: boolean;
}): Promise<Result<PaginationResult<Company>>>
```

Mock mode implementation:
- Page size: 6 (companies are larger cards than products, fewer per page)
- Filter mock data in-memory: `certified` filters by `company.certifications?.length > 0`, `productCategory` matches `company.industryTags`
- Sort: `distance` sorts by `company.distanceKm` ascending
- Slice for pagination: `data.slice((page-1)*pageSize, page*pageSize)`
- Calculate `total`, `nextPage` (same pattern as ProductRepo)
- Attach mock `topProducts` to each company: generate 3-5 fake products with id/title/price/image from existing product mock data

Real API mode: pass params to `GET /api/v1/companies` with query string: `?page=&pageSize=6&certified=true&productCategory=fruit&sortBy=distance&includeTopProducts=true`

**Breaking change**: `list()` return type changes from `Result<Company[]>` to `Result<PaginationResult<Company>>`. Update all existing call sites (museum.tsx is the primary consumer — will be rewritten in Task 4).

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src/repos/CompanyRepo.ts
git commit -m "feat(discover): add pagination and filters to CompanyRepo"
```

---

### Task 4: Rewrite museum.tsx — sticky header + tab structure

This is the main task. Rewrite `app/(tabs)/museum.tsx` with the new layout.

**Files:**
- Rewrite: `app/(tabs)/museum.tsx`

- [ ] **Step 1: Set up tab state and data queries**

Replace the current component with a new structure:

```typescript
// State
const [activeTab, setActiveTab] = useState<'products' | 'companies'>('products');
const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
const [searchActive, setSearchActive] = useState(false);
const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
const [companyFilter, setCompanyFilter] = useState<string | null>(null);

// Products query — same useInfiniteQuery as current (60s stale)
// Categories query — same useQuery as current (5min stale)

// Companies — lazy load, only fetches when tab is active
const companiesQuery = useInfiniteQuery({
  queryKey: ['companies', 'discovery', companyFilter],
  queryFn: ({ pageParam = 1 }) => CompanyRepo.list({
    page: pageParam,
    includeTopProducts: true,
    ...(companyFilter === 'certified' ? { certified: true } : {}),
    ...(companyFilter === 'nearby' ? { sortBy: 'distance' } : {}),
    ...(companyFilter && !['certified', 'nearby'].includes(companyFilter)
      ? { productCategory: companyFilter } : {}),
  }),
  getNextPageParam: (lastPage) => {
    if (lastPage.ok && lastPage.data.nextPage) return lastPage.data.nextPage;
    return undefined;
  },
  initialPageParam: 1,
  enabled: activeTab === 'companies',
  staleTime: 3 * 60_000,
});
```

**Tab state behavior:**
- Tab switch preserves data cache (React Query handles this) — switching back doesn't refetch if data is fresh
- Both tabs render in the component tree but only the active one is visible (`display: activeTab === 'products' ? 'flex' : 'none'`). This preserves scroll position for both tabs.
- Companies data stays cached when switching to products tab (staleTime: 3 min)

- [ ] **Step 2: Build sticky header (title + search + tabs)**

The header area is fixed at top and doesn't scroll with content:

```
[发现]                    [🗺] [🛒]
[🔍 搜索商品、品类、企业...]
[  商品  |  企业  ]
```

Use a `View` with `position: absolute` or render outside the ScrollView/FlatList. The tab underline indicator should animate when switching tabs.

- [ ] **Step 3: Build Products Tab content**

Products Tab content (rendered when `activeTab === 'products'`):

1. **Category chips** — horizontal ScrollView, from `CategoryRepo.list()`, filter level===1
2. **AI Recommendation section** — horizontal ScrollView with equal-height ProductCards
   - Title: `✦ 脉脉精选` + "为你推荐"
   - Cards: use `aiProducts` data (same mock logic as current)
   - Fixed card width: 140px. Fixed image height: 110px. Card total height is uniform because all cards have same structure (image + title + reason + price + source)
   - Pass to ProductCard: `width={140}`, `imageHeight={110}`, `aiRecommend`, `aiReason`
   - Last card half-visible (container paddingRight < card width) as scroll hint
   - If AI recommendation fetch fails, hide entire section gracefully (no error shown)
3. **Separator** — 6px gray background divider
4. **Hot Products title** — "热门商品"
5. **Masonry waterfall** — two columns, unequal height

For the masonry layout, split `allProducts` into two columns:

```typescript
const { leftColumn, rightColumn } = useMemo(() => {
  const left: Product[] = [];
  const right: Product[] = [];
  allProducts.forEach((product, index) => {
    if (index % 2 === 0) left.push(product);
    else right.push(product);
  });
  return { leftColumn: left, rightColumn: right };
}, [allProducts]);
```

Render as two side-by-side `View` columns inside a `ScrollView`. Image height strategy: cycle through preset heights `[130, 90, 110, 140, 95, 120]` based on product index to create visual variety. This avoids needing backend image ratio data. When real images are loaded, `Image.onLoad` can measure actual dimensions for future optimization.

Search bar placeholder text: "搜索商品、品类、企业..."（统一新文案）

- [ ] **Step 4: Build Companies Tab content**

Companies Tab content (rendered when `activeTab === 'companies'`):

1. **Filter chips** — mutually exclusive (only one active at a time):
   - `全部` → `companyFilter = null`
   - `🌿 有机认证` → `companyFilter = 'certified'`
   - `🍎 水果` → `companyFilter = 'fruit'` (filters by company's primary product category)
   - `🍵 茶叶` → `companyFilter = 'tea'`
   - `📍 附近` → `companyFilter = 'nearby'` (sorts by distance; if location permission not granted, prompt user)
2. **Company list** — FlatList of new CompanyCard components, single column, full width
   - Pass `onPress` → navigate to `/company/[id]`
   - Pass `onProductPress` → navigate to `/product/[id]`
3. Infinite scroll with `onEndReached`

- [ ] **Step 5: Handle map mode**

When `viewMode === 'map'`:
- Render `MapView` as full-screen
- Overlay floating controls on top (search bar, tab pills, title)
- Tab switching changes map markers (companies vs product origins)
- Clicking a marker shows bottom floating card

- [ ] **Step 6: Wire up pull-to-refresh**

Both tabs support pull-to-refresh via `RefreshControl`:
- Products tab: refetch products + categories
- Companies tab: refetch companies

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -30`

- [ ] **Step 8: Commit**

```bash
git add app/(tabs)/museum.tsx
git commit -m "feat(discover): rewrite discover page with tab layout and masonry grid"
```

---

### Task 5: Full-screen map mode with floating controls

**Files:**
- Modify: `src/components/overlay/MapView.tsx`
- Modify: `app/(tabs)/museum.tsx` (map section from Task 4)

- [ ] **Step 1: Update MapView to support full-screen layout**

Add props for floating controls and bottom card:

```typescript
type MapViewProps = {
  provider?: MapProvider;
  markers: Company[];
  onSelect?: (company: Company) => void;
  sdkReady?: boolean;
  fullScreen?: boolean;           // NEW: full-screen mode
  selectedMarker?: Company | null; // NEW: currently selected marker
};
```

When `fullScreen=true`:
- Map takes full available height
- Remove map provider toggle from MapView (it moves to museum.tsx floating controls)

- [ ] **Step 2: Build floating bottom card for selected marker**

In museum.tsx map mode, when a marker is selected, show a bottom floating card:

```
┌─────────────────────────────────────┐
│ [Logo]  企业名  认证标签             │
│         距离信息                      │
│ [商品1] [商品2] [商品3]  +N          │
│                          进店 →      │
└─────────────────────────────────────┘
```

Use `Animated.View` with `translateY` slide-up animation.

- [ ] **Step 3: Style floating search and tab pills**

In map mode, the search bar and tab pills float over the map:
- Search bar: white background, border-radius pill, shadow
- Tab pills: capsule buttons side by side, selected = green fill, unselected = white with shadow
- All with `position: absolute` positioning

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add src/components/overlay/MapView.tsx app/(tabs)/museum.tsx
git commit -m "feat(discover): full-screen map mode with floating controls"
```

---

### Task 6: Visual polish and animation

**Files:**
- Modify: `app/(tabs)/museum.tsx`

- [ ] **Step 1: Add tab switch animation**

Tab content fade in/out on switch (200ms):

```typescript
const tabOpacity = useSharedValue(1);

// On tab switch:
tabOpacity.value = withSequence(
  withTiming(0, { duration: 100 }),
  withTiming(1, { duration: 100 }),
);
```

- [ ] **Step 2: Add AI recommendation scroll hint animation**

On first load, the AI horizontal scroll list plays a subtle left-nudge animation:

```typescript
const scrollHintX = useSharedValue(0);
useEffect(() => {
  scrollHintX.value = withSequence(
    withDelay(500, withTiming(-20, { duration: 300 })),
    withTiming(0, { duration: 300 }),
  );
}, []);
```

- [ ] **Step 3: Add staggered entry animations**

Use `FadeInDown` with increasing delays for sections:
- Category chips: delay 0
- AI recommendation: delay 80ms
- Hot products: delay 160ms

Same as current implementation pattern.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add app/(tabs)/museum.tsx
git commit -m "feat(discover): add tab transition and scroll hint animations"
```

---

### Task 7: Update documentation

**Files:**
- Modify: `frontend.md`
- Modify: `plan.md`

- [ ] **Step 1: Update frontend.md**

Update the 发现页 section in `frontend.md` to reflect new layout:
- Tab-based structure (商品/企业)
- AI recommendation horizontal scroll
- Masonry waterfall product grid
- Full-screen map mode
- Cross-linking between products and companies

- [ ] **Step 2: Update plan.md**

Mark the discover page redesign task as completed in `plan.md`.

- [ ] **Step 3: Commit**

```bash
git add frontend.md plan.md
git commit -m "docs: update frontend.md and plan.md for discover page redesign"
```

---

## Task Dependencies

```
Task 1 (ProductCard) ──┐
Task 2 (CompanyCard) ──┼──→ Task 4 (museum.tsx rewrite) ──→ Task 5 (Map mode) ──→ Task 6 (Polish) ──→ Task 7 (Docs)
Task 3 (CompanyRepo) ──┘
```

Tasks 1, 2, 3 can run in parallel. Tasks 4-7 are sequential.
