# SKU 单笔订单限购 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 卖家可为每个 SKU 设置单笔订单限购数量，买家在加购、购物车、结账三层校验。

**Architecture:** 在 ProductSKU 新增 `maxPerOrder Int?` 字段，null 表示不限制。后端在购物车服务和结账服务做校验兜底，前端在 addItem/updateQty/商品详情页做拦截展示。卖家后台商品编辑页新增输入框，管理后台 SKU 表格新增展示列。

**Tech Stack:** Prisma / NestJS / React Native (Expo) / React + Ant Design (seller & admin)

---

### Task 1: Schema 迁移

**Files:**
- Modify: `backend/prisma/schema.prisma:1143-1164` (ProductSKU model)

- [ ] **Step 1: 添加 maxPerOrder 字段**

在 `backend/prisma/schema.prisma` 的 ProductSKU model 中，`stock` 字段之后添加：

```prisma
  maxPerOrder  Int?      // 单笔订单限购数量，null = 不限制
```

完整上下文（stock 行之后、weightGram 行之前）：

```prisma
  stock      Int       @default(0)
  maxPerOrder  Int?      // 单笔订单限购数量，null = 不限制
  weightGram Int?
```

- [ ] **Step 2: 生成并应用迁移**

```bash
cd backend && npx prisma migrate dev --name add-sku-max-per-order
```

Expected: Migration applied successfully, `maxPerOrder` column added with default NULL.

- [ ] **Step 3: 验证 Schema**

```bash
cd backend && npx prisma validate
```

Expected: `✔ Prisma schema is valid.`

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(schema): add maxPerOrder field to ProductSKU"
```

---

### Task 2: 后端 — 卖家商品 DTO + Service

**Files:**
- Modify: `backend/src/modules/seller/products/seller-products.dto.ts:13-30, 177-197`
- Modify: `backend/src/modules/seller/products/seller-products.service.ts:120-128, 399-421`

- [ ] **Step 1: CreateSkuDto 添加字段**

在 `backend/src/modules/seller/products/seller-products.dto.ts` 的 `CreateSkuDto` 中，`weightGram` 字段之前添加：

```typescript
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerOrder?: number; // 单笔限购，null/不传 = 不限制
```

- [ ] **Step 2: SkuItemDto 添加字段**

同文件 `SkuItemDto` 中，`weightGram` 字段之前添加同样的字段：

```typescript
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerOrder?: number;
```

确保文件顶部已导入 `IsInt`（已有 `IsNumber`，需新增 `IsInt`）：

```typescript
import { IsString, IsNotEmpty, IsNumber, Min, IsOptional, IsInt, ... } from 'class-validator';
```

- [ ] **Step 3: seller-products.service.ts — create 方法添加字段**

在 `seller-products.service.ts` 的 `create()` 方法中，SKU 创建部分（约 line 120-128），在 `weightGram: sku.weightGram` 后添加：

```typescript
skus: {
  create: dto.skus.map((sku) => ({
    title: sku.specName,
    price: +(sku.cost * markupRate).toFixed(2),
    cost: sku.cost,
    stock: sku.stock,
    weightGram: sku.weightGram,
    maxPerOrder: sku.maxPerOrder ?? null,
  })),
},
```

- [ ] **Step 4: seller-products.service.ts — updateSkus 方法添加字段**

在 `updateSkus()` 方法的 `tx.productSKU.update` data 对象（约 line 400-407）中添加 `maxPerOrder`：

```typescript
await tx.productSKU.update({
  where: { id: sku.id },
  data: {
    title: sku.specName,
    price: autoPrice,
    cost: sku.cost,
    stock: sku.stock,
    weightGram: sku.weightGram,
    maxPerOrder: sku.maxPerOrder ?? null,
  },
});
```

同样在 `tx.productSKU.create` data 对象（约 line 412-421）中添加：

```typescript
const created = await tx.productSKU.create({
  data: {
    productId,
    title: sku.specName,
    price: autoPrice,
    cost: sku.cost,
    stock: sku.stock,
    weightGram: sku.weightGram,
    maxPerOrder: sku.maxPerOrder ?? null,
  },
});
```

- [ ] **Step 5: 验证 TypeScript 编译**

```bash
cd backend && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/seller/products/
git commit -m "feat(seller): support maxPerOrder in SKU create/update"
```

---

### Task 3: 后端 — 购物车服务校验 + 响应

**Files:**
- Modify: `backend/src/modules/cart/cart.service.ts:160-215, 218-237, 778-832`

- [ ] **Step 1: addItem 方法添加限购校验**

在 `cart.service.ts` 的 `addItem()` 方法中，SKU 状态校验之后（`if (sku.product.status !== 'ACTIVE')` 后面，`const cart = await this.ensureCart(userId)` 之前），添加：

```typescript
    // 单笔限购校验（放在事务外做初步检查，事务内做精确检查）
    if (sku.maxPerOrder !== null && quantity > sku.maxPerOrder) {
      throw new BadRequestException(`该商品每单限购 ${sku.maxPerOrder} 件`);
    }
```

然后在事务内，`existing` 分支中（`const newQty = existing.quantity + quantity` 之后），把已有的库存检查之前，添加限购检查：

```typescript
        if (existing) {
          const newQty = existing.quantity + quantity;
          if (sku.maxPerOrder !== null && newQty > sku.maxPerOrder) {
            throw new BadRequestException(
              `该商品每单限购 ${sku.maxPerOrder} 件，购物车已有 ${existing.quantity} 件`,
            );
          }
          if (newQty > sku.stock) throw new BadRequestException('库存不足');
```

在 `else`（新建）分支中，库存检查之前添加：

```typescript
        } else {
          if (sku.maxPerOrder !== null && quantity > sku.maxPerOrder) {
            throw new BadRequestException(`该商品每单限购 ${sku.maxPerOrder} 件`);
          }
          if (quantity > sku.stock) throw new BadRequestException('库存不足');
```

- [ ] **Step 2: updateItemQuantity 方法添加限购校验**

在 `updateItemQuantity()` 方法中，库存检查之后（`if (sku && quantity > sku.stock)` 之后），添加：

```typescript
    if (sku && sku.maxPerOrder !== null && quantity > sku.maxPerOrder) {
      throw new BadRequestException(`该商品每单限购 ${sku.maxPerOrder} 件`);
    }
```

- [ ] **Step 3: mapCartItem 响应添加 maxPerOrder**

在 `mapCartItem()` 方法（约 line 778-832）返回的 `product` 对象中，`stock` 字段之后添加 `maxPerOrder`：

```typescript
  product: {
    id: product?.id || '',
    title: product?.title || '',
    image: firstImage || null,
    price,
    originalPrice,
    stock: sku?.stock || 0,
    maxPerOrder: sku?.maxPerOrder ?? null,
    categoryId: product?.categoryId || null,
    companyId: product?.companyId || null,
  },
```

- [ ] **Step 4: 验证编译**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/cart/
git commit -m "feat(cart): validate maxPerOrder on add/update and include in response"
```

---

### Task 4: 后端 — 结账服务兜底校验

**Files:**
- Modify: `backend/src/modules/order/checkout.service.ts:195-204`

- [ ] **Step 1: 添加限购校验**

在 `checkout.service.ts` 的 SKU 验证循环中，库存 warn 之后（`if (sku.stock <= 0)` 块之后），添加：

```typescript
      // 单笔限购校验
      if (sku.maxPerOrder !== null && item.quantity > sku.maxPerOrder) {
        throw new BadRequestException(
          `商品规格「${sku.title}」每单限购 ${sku.maxPerOrder} 件`,
        );
      }
```

- [ ] **Step 2: 验证编译**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/order/checkout.service.ts
git commit -m "feat(checkout): add maxPerOrder validation as backend safeguard"
```

---

### Task 5: 后端 — 商品详情接口返回 maxPerOrder

**Files:**
- Modify: `backend/src/modules/product/product.service.ts:878-915` (mapToDetail)
- Modify: `backend/src/modules/admin/products/admin-products.service.ts:43` (SKU select)

- [ ] **Step 1: product.service.ts — mapToDetail 添加字段**

在 `product.service.ts` 的 `mapToDetail()` 方法中，SKU 映射部分（约 line 908），`skuCode` 之后添加 `maxPerOrder`：

```typescript
skus: (product.skus || []).map((s: any) => ({
  id: s.id,
  title: s.title,
  price: s.price,
  stock: s.stock,
  skuCode: s.skuCode,
  maxPerOrder: s.maxPerOrder ?? null,
})),
```

- [ ] **Step 2: admin-products.service.ts — SKU select 添加字段**

在 `admin-products.service.ts` 的 SKU select 中（约 line 43），添加 `maxPerOrder`：

```typescript
skus: { select: { id: true, price: true, cost: true, stock: true, maxPerOrder: true } },
```

如有多处 SKU select/include，全部补上 `maxPerOrder: true`。

- [ ] **Step 3: 验证编译**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/product/ backend/src/modules/admin/products/
git commit -m "feat(product): include maxPerOrder in product detail and admin responses"
```

---

### Task 6: 前端类型定义

**Files:**
- Modify: `src/types/domain/Product.ts:39-45`
- Modify: `src/types/domain/ServerCart.ts` (product object in ServerCartItem)
- Modify: `src/store/useCartStore.ts:45-74` (CartItem type)

- [ ] **Step 1: Product.ts — SKU 类型添加字段**

在 `src/types/domain/Product.ts` 的 `ProductDetail` 类型中，`skus` 数组的对象类型里，`stock` 之后添加：

```typescript
skus: Array<{
  id: string;
  title: string;
  price: number;
  stock: number;
  maxPerOrder?: number | null;
  skuCode?: string;
}>;
```

- [ ] **Step 2: ServerCart.ts — 添加字段**

在 `src/types/domain/ServerCart.ts` 的 `ServerCartItem` 中 `product` 对象里，`stock` 之后添加：

```typescript
  product: {
    id: string;
    title: string;
    image: string | null;
    price: number;
    categoryId?: string | null;
    companyId?: string | null;
    originalPrice: number | null;
    stock: number;
    maxPerOrder?: number | null;
  };
```

- [ ] **Step 3: useCartStore.ts — CartItem 类型添加字段**

在 `src/store/useCartStore.ts` 的 `CartItem` 类型中，`quantity` 之后添加：

```typescript
  maxPerOrder?: number | null;
```

- [ ] **Step 4: serverToLocal 映射添加字段**

在同文件的 `serverToLocal()` 函数（约 line 88-105）中，`originalPrice` 之后添加：

```typescript
  maxPerOrder: si.product.maxPerOrder ?? null,
```

- [ ] **Step 5: Commit**

```bash
git add src/types/domain/Product.ts src/types/domain/ServerCart.ts src/store/useCartStore.ts
git commit -m "feat(types): add maxPerOrder to SKU, ServerCart, and CartItem types"
```

---

### Task 7: 前端 — useCartStore 加购 / 改数量校验

**Files:**
- Modify: `src/store/useCartStore.ts:182-252` (addItem)
- Modify: `src/store/useCartStore.ts:332-358` (updateQty)

- [ ] **Step 1: addItem 添加限购校验**

在 `useCartStore.ts` 的 `addItem` 方法中，乐观更新之前（`set((state) => {` 之前），添加限购检查：

```typescript
addItem: (product, quantity = 1, skuId, skuPrice) => {
  const key = cartKey(product.id, skuId);

  // 单笔限购校验
  const maxPerOrder = product.maxPerOrder;
  if (maxPerOrder != null) {
    const existing = get().items.find((item) => itemKey(item) === key);
    const currentQty = existing?.quantity ?? 0;
    if (currentQty + Math.max(1, quantity) > maxPerOrder) {
      Toast.show({
        type: 'info',
        text1: `该商品每单限购 ${maxPerOrder} 件`,
        text2: currentQty > 0 ? `购物车已有 ${currentQty} 件` : undefined,
      });
      return;
    }
  }

  // 乐观更新（现有代码继续）
  set((state) => {
```

注意：`addItem` 的 `product` 参数类型需要能携带 `maxPerOrder`。检查 `addItem` 的参数类型定义，如果是内联对象类型，添加 `maxPerOrder?: number | null`。

- [ ] **Step 2: updateQty 添加限购校验**

在 `updateQty` 方法中，`quantity <= 0` 检查之后、乐观更新之前，添加：

```typescript
updateQty: (productId, quantity, skuId) => {
  const key = cartKey(productId, skuId);

  if (quantity <= 0) {
    get().removeItem(productId, skuId);
    return;
  }

  // 单笔限购校验
  const item = get().items.find((i) => itemKey(i) === key);
  if (item?.maxPerOrder != null && quantity > item.maxPerOrder) {
    Toast.show({
      type: 'info',
      text1: `该商品每单限购 ${item.maxPerOrder} 件`,
    });
    return;
  }

  const snapshot = get().items;
  // 乐观更新（现有代码继续）
```

- [ ] **Step 3: addItem 乐观新增时保存 maxPerOrder**

在 `addItem` 的乐观更新中，新建 item 时保存 `maxPerOrder`：

```typescript
return {
  items: [
    ...state.items,
    {
      productId: product.id,
      skuId,
      categoryId: product.categoryId,
      companyId: product.companyId,
      title: product.title,
      price: skuPrice ?? product.price,
      image: product.image,
      quantity: Math.max(1, quantity),
      maxPerOrder: product.maxPerOrder ?? null,
    },
  ],
  selectedIds: newSelectedIds,
};
```

- [ ] **Step 4: 确认 Toast 导入**

确保 `useCartStore.ts` 文件顶部已导入 Toast：

```typescript
import Toast from 'react-native-toast-message';
```

如果未导入，添加此行。

- [ ] **Step 5: Commit**

```bash
git add src/store/useCartStore.ts
git commit -m "feat(cart-store): validate maxPerOrder on addItem and updateQty"
```

---

### Task 8: 前端 — 商品详情页

**Files:**
- Modify: `app/product/[id].tsx`

- [ ] **Step 1: 传递 maxPerOrder 到 addItem**

在 `app/product/[id].tsx` 中，找到调用 `addItem` 的位置（约 line 529, 553, 577, 601）。当前调用形如：

```typescript
addItem(product!, 1, activeSkuId, activeSkuPrice);
```

需要确保传入的 `product` 对象包含当前选中 SKU 的 `maxPerOrder`。在调用前构造带 `maxPerOrder` 的产品对象：

```typescript
const selectedSku = product!.skus.find((s) => s.id === activeSkuId);
addItem(
  { ...product!, maxPerOrder: selectedSku?.maxPerOrder ?? null },
  1,
  activeSkuId,
  activeSkuPrice,
);
```

对所有 `addItem` 调用点做同样修改。

- [ ] **Step 2: 展示限购标签**

在商品详情页的价格区域附近（SKU 选择器或价格显示区域），当选中的 SKU 有 `maxPerOrder` 时，显示限购提示：

```tsx
{selectedSku?.maxPerOrder != null && (
  <Text style={{
    fontSize: typography.sizes.xs,
    color: colors.warning,
    marginTop: spacing.xs,
  }}>
    每单限购 {selectedSku.maxPerOrder} 件
  </Text>
)}
```

- [ ] **Step 3: Commit**

```bash
git add app/product/
git commit -m "feat(product-detail): pass maxPerOrder to addItem and show limit tag"
```

---

### Task 9: 前端 — 购物车页

**Files:**
- Modify: `app/cart.tsx:339`

- [ ] **Step 1: QuantityStepper 传入 max**

在 `app/cart.tsx` 中，找到 `QuantityStepper` 的使用（约 line 339），将 `maxPerOrder` 作为 `max` 传入：

```tsx
<QuantityStepper
  value={item.quantity}
  max={item.maxPerOrder ?? 99}
  onChange={(next) => updateQty(item.productId, next, item.skuId)}
/>
```

`QuantityStepper` 组件已支持 `max` prop（默认 99），达到 max 时 `+` 按钮自动置灰，无需修改组件本身。

- [ ] **Step 2: 展示限购提示（可选）**

在购物车商品行中，如果该 item 有限购，在数量 stepper 下方显示小字提示：

```tsx
{item.maxPerOrder != null && (
  <Text style={{ fontSize: typography.sizes.xs, color: colors.textTertiary }}>
    限购 {item.maxPerOrder} 件
  </Text>
)}
```

- [ ] **Step 3: Commit**

```bash
git add app/cart.tsx
git commit -m "feat(cart-page): pass maxPerOrder to QuantityStepper and show limit hint"
```

---

### Task 10: 卖家后台 — 商品编辑页

**Files:**
- Modify: `seller/src/pages/products/edit.tsx:122-219, 353-359`

- [ ] **Step 1: MultiSpecRows 添加限购输入框**

在 `seller/src/pages/products/edit.tsx` 的 `MultiSpecRows` 组件中，库存 `<Col>` 之后、重量 `<Col>` 之前，添加一个新的列：

```tsx
<Col span={3}>
  <Form.Item
    {...field}
    name={[field.name, 'maxPerOrder']}
    label="单笔限购"
    rules={[
      { type: 'number', min: 1, message: '最少为1' },
    ]}
    style={{ marginBottom: 0 }}
  >
    <InputNumber placeholder="不限" min={1} precision={0} style={{ width: '100%' }} />
  </Form.Item>
</Col>
```

注意：可能需要调整其他列的 `span` 值使总和不超过 24。检查当前列布局，酌情缩减其他列宽度。

- [ ] **Step 2: buildPayload 添加字段映射**

在 `buildPayload` 函数（约 line 353-359）的 SKU 映射中，添加 `maxPerOrder`：

```typescript
const skus = skuList.map((s) => ({
  id: s.id as string | undefined,
  specName: (s.specName as string) || '默认规格',
  cost: Number(s.cost),
  stock: Number(s.stock),
  weightGram: s.weightGram === undefined || s.weightGram === null ? undefined : Number(s.weightGram),
  maxPerOrder: s.maxPerOrder === undefined || s.maxPerOrder === null ? undefined : Number(s.maxPerOrder),
}));
```

- [ ] **Step 3: 编辑页加载时回填 maxPerOrder**

确认编辑页加载商品数据时，SKU 的 `maxPerOrder` 字段能正确回填到表单。检查数据加载逻辑中 SKU 字段的映射，确保 `maxPerOrder` 被包含。如果现有逻辑是直接用后端返回的 SKU 对象填充表单，则 Prisma 返回的字段已包含 `maxPerOrder`，无需额外处理。

- [ ] **Step 4: Commit**

```bash
git add seller/src/pages/products/edit.tsx
git commit -m "feat(seller): add maxPerOrder input to SKU edit form"
```

---

### Task 11: 管理后台 — SKU 表格展示

**Files:**
- Modify: `admin/src/pages/products/edit.tsx:131-168`

- [ ] **Step 1: SKU 表格添加限购列**

在 `admin/src/pages/products/edit.tsx` 的 `skuColumns` 数组中，`库存` 列之后、`状态` 列之前，添加：

```typescript
{
  title: '单笔限购',
  dataIndex: 'maxPerOrder',
  key: 'maxPerOrder',
  width: 100,
  render: (v: number | null) => v != null ? `${v} 件` : '不限',
},
```

- [ ] **Step 2: Commit**

```bash
git add admin/src/pages/products/edit.tsx
git commit -m "feat(admin): display maxPerOrder in SKU table"
```

---

### Task 12: 全栈验证

- [ ] **Step 1: Prisma validate + TypeScript 编译**

```bash
cd backend && npx prisma validate && npx tsc --noEmit
```

- [ ] **Step 2: 卖家后台编译**

```bash
cd seller && npx tsc --noEmit
```

- [ ] **Step 3: 管理后台编译**

```bash
cd admin && npx tsc --noEmit
```

- [ ] **Step 4: 功能自测清单**

手动验证：
- 卖家后台：创建商品时设置 SKU 限购 → 保存 → 重新编辑查看回填正确
- 买家 App 商品详情页：显示"每单限购 X 件"标签
- 买家 App 商品详情页：连续点击加入购物车 → 超限时 Toast 提示
- 买家 App 购物车页：数量 stepper `+` 按钮在达到限额时置灰
- 结账：超限数量直接调 API → 返回 400 错误
- 管理后台：商品详情 SKU 表格显示限购值
- 无限购 SKU：所有流程正常，无多余提示

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat: SKU per-order purchase limit - full stack implementation"
```
