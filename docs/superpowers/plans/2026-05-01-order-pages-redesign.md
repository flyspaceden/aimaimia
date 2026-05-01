# 订单页面重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把买家 App 订单链路（列表 / 详情 / 物流 / 售后列表）升级到京东淘宝水准，含商品图、地址、店铺分组、底部 CTA、未完成订单横幅 + 续付页 + 防重锁。

**Architecture:** 三 Phase 渐进，每 Phase 独立可上线。Phase 1 前端重写 + 最小后端 DTO；Phase 2 后端剩余 DTO + 防重锁 + 续付链路 + 横幅；Phase 3 buyerNote 字段 + 收尾。

**Tech Stack:**
- 前端：React Native 0.81 / expo-router 6 / TypeScript / Zustand / @tanstack/react-query / expo-clipboard
- 后端：NestJS / Prisma / PostgreSQL / Jest（spec 文件 .spec.ts）
- 设计权威：`docs/superpowers/specs/2026-05-01-order-pages-redesign-design.md`

**全局规则：**
- 每个 Task 完成后跑 `npx tsc -b`（前端）或 `cd backend && npx tsc --noEmit`（后端）确认编译通过再 commit
- commit message 格式：`type(scope): 描述` (CLAUDE.md 约定)
- 每个 commit 一个逻辑单元，禁止合并不相关改动
- 三 Phase 各走一个 PR，回滚粒度细
- 推送 GitHub 前必须向用户确认（CLAUDE.md 强制规则）

---

## Phase 1 · 前端重写 + 最小后端 DTO（1.5-2 天）

### Task 1: 后端 mapOrder snapshot 函数补字段

**Files:**
- Modify: `backend/src/modules/order/order.service.ts:1019-1029`
- Test: `backend/src/modules/order/map-order.spec.ts`（新增）

**目标**：列表 DTO 的商品 snapshot 增加 `skuTitle / companyId / isPrize` 字段，让前端"淘宝展开风"卡片有数据可显示。

> **修正说明**：原稿写了 `isPostReplacement` 当作 OrderItem 字段，但 schema.prisma:2156 显示该字段在 `AfterSaleRequest` 模型上，**不在** `OrderItem` 上（schema.prisma:1418-1440 OrderItem 没有此列）。Phase 1 不暴露这个标记；Phase 2/3 如需展示"换货后商品不支持二次售后"，改成派生字段：在 mapOrder 阶段查 `AfterSaleRequest where orderItemId IN (...) && isPostReplacement = true`，然后在前端商品行处理"申请售后"按钮的隐藏逻辑。

- [ ] **Step 1: 写失败测试**

```ts
// backend/src/modules/order/map-order.spec.ts
import { Test } from '@nestjs/testing';
import { OrderService } from './order.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('OrderService.mapOrder snapshot', () => {
  let service: OrderService;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [OrderService, { provide: PrismaService, useValue: {} }],
    }).compile();
    service = module.get(OrderService);
  });

  it('snapshot returns extended fields', () => {
    const order = {
      id: 'o1', status: 'PAID', bizType: 'NORMAL_GOODS', totalAmount: 100,
      createdAt: new Date(), items: [{
        id: 'i1', skuId: 'sku1', unitPrice: 50, quantity: 1,
        companyId: 'c1', isPrize: false,
        productSnapshot: {
          productId: 'p1', title: '猕猴桃', skuTitle: '5斤装', image: 'http://img/1.jpg',
        },
      }], afterSaleRequests: [], refunds: [],
    };
    const out = (service as any).mapOrder(order);
    expect(out.items[0]).toMatchObject({
      skuTitle: '5斤装',
      companyId: 'c1',
      isPrize: false,
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest map-order.spec --no-coverage`
Expected: FAIL（snapshot 没有这些字段）

- [ ] **Step 3: 修改 mapOrder snapshot 函数**

在 `order.service.ts:1019-1029` 的 `snapshot` 闭包内补字段：

```ts
const snapshot = (item: any) => {
  const ps = (item.productSnapshot as any) || {};
  return {
    id: item.id,
    productId: ps.productId || item.skuId,
    title: ps.title || '',
    skuTitle: ps.skuTitle || '',           // 新增
    image: ps.image || '',
    price: item.unitPrice,
    quantity: item.quantity,
    companyId: item.companyId,             // 新增
    isPrize: !!item.isPrize,               // 新增
    // 注：isPostReplacement 实际在 AfterSaleRequest 模型，不在 OrderItem
    //     若需展示"二次售后限制"，Phase 2 改为按 orderItemId 反查 AfterSaleRequest 派生
  };
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest map-order.spec --no-coverage`
Expected: PASS

- [ ] **Step 5: 编译检查**

Run: `cd backend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/order/order.service.ts backend/src/modules/order/map-order.spec.ts
git commit -m "feat(backend/order): mapOrder snapshot 补 skuTitle/companyId/isPrize/isPostReplacement"
```

---

### Task 2: 后端列表 DTO 加时间节点字段

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`（mapOrder 主体，约 line 1095-1100 输出对象）
- Test: 复用 Task 1 的 `map-order.spec.ts`

**目标**：列表卡片要显示发货时间倒计时副文案、待收货倒计时，所以 `paidAt / shippedAt / deliveredAt` 必须暴露。

- [ ] **Step 1: 加测试断言**

在已有 spec 加 it：

```ts
it('mapOrder exposes paidAt/shippedAt/deliveredAt', () => {
  const now = new Date();
  const order = {
    id: 'o1', status: 'SHIPPED', bizType: 'NORMAL_GOODS', totalAmount: 100,
    createdAt: now, paidAt: now, deliveredAt: null,
    items: [], afterSaleRequests: [], refunds: [],
    shipments: [{ shippedAt: now, deliveredAt: null, trackingEvents: [] }],
  };
  const out = (service as any).mapOrder(order);
  expect(out.paidAt).toBe(now.toISOString());
  expect(out.shippedAt).toBe(now.toISOString());
  expect(out.deliveredAt).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest map-order.spec --no-coverage`
Expected: FAIL

- [ ] **Step 3: 修改 mapOrder 主体输出对象**

在 mapOrder 返回对象里加（注意：shippedAt 取 `summarizeShipments` 结果的 `shipments[0]?.shippedAt` 的最早值）：

```ts
return {
  // ... existing fields ...
  paidAt: order.paidAt?.toISOString() ?? null,
  shippedAt: this.earliestShippedAt(order.shipments) ?? null,
  deliveredAt: order.deliveredAt?.toISOString() ?? null,
  // ... existing fields ...
};
```

并加 helper：

```ts
private earliestShippedAt(shipments?: any[]): string | null {
  if (!shipments || shipments.length === 0) return null;
  const times = shipments.map((s) => s.shippedAt).filter(Boolean).map((d: Date) => d.getTime());
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest map-order.spec --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/order/order.service.ts backend/src/modules/order/map-order.spec.ts
git commit -m "feat(backend/order): mapOrder 列表暴露 paidAt/shippedAt/deliveredAt"
```

---

### Task 3: 前端 Order 类型扩展

**Files:**
- Modify: `src/types/domain/Order.ts`

**目标**：Phase 1 后端字段对齐前端类型；保持枚举大小写不变。

- [ ] **Step 1: 修改 OrderItem 类型加可选字段**

在 `src/types/domain/Order.ts` 的 `OrderItem` 类型加：

```ts
export type OrderItem = {
  id: string;
  productId: string;
  skuId?: string;
  title: string;
  skuTitle?: string;        // 新增 — SKU 规格如 "5斤装"
  image: string;
  price: number;
  quantity: number;
  companyId?: string;       // 新增
  isPrize?: boolean;
  // isPostReplacement 字段保留（已存在于现有类型，前端逻辑使用）
  // 但 Phase 1 后端不暴露该字段（只在 Phase 2 派生时再补）
  isPostReplacement?: boolean;
};
```

- [ ] **Step 2: Order 类型加时间节点**

```ts
export type Order = {
  // ... existing fields ...
  paidAt?: string;          // 新增
  shippedAt?: string;       // 新增
  // deliveredAt?: string;  // （已有，确认）
  autoReceiveAt?: string;   // 新增（Phase 2 暴露，先在类型里占位）
  // ... existing fields ...
};
```

- [ ] **Step 3: 编译检查**

Run: `npx tsc -b`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/types/domain/Order.ts
git commit -m "feat(types): Order 类型加 skuTitle/companyId/paidAt/shippedAt/autoReceiveAt"
```

---

### Task 4: 通用倒计时组件

**Files:**
- Create: `src/components/ui/Countdown.tsx`

**目标**：横幅、状态头、待收货 CTA 复用同一倒计时逻辑（基于绝对过期时间，不依赖定时器累积误差）。

- [ ] **Step 1: 写组件**

```tsx
// src/components/ui/Countdown.tsx
import React, { useEffect, useState } from 'react';
import { Text, TextProps } from 'react-native';

interface Props extends TextProps {
  /** ISO timestamp，绝对过期时间 */
  expiresAt: string;
  /** 显示格式 */
  format?: 'mm:ss' | 'hh:mm:ss' | 'days';
  /** 倒计时归零回调 */
  onExpire?: () => void;
  /** 前缀文案 */
  prefix?: string;
}

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

export function Countdown({ expiresAt, format = 'mm:ss', onExpire, prefix, ...rest }: Props) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));

  useEffect(() => {
    if (remaining <= 0) { onExpire?.(); return; }
    const id = setInterval(() => {
      const r = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setRemaining(r);
      if (r <= 0) { clearInterval(id); onExpire?.(); }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire, remaining]);

  const totalSec = Math.floor(remaining / 1000);
  let label: string;
  if (format === 'days') {
    const days = Math.floor(totalSec / 86400);
    const hrs = Math.floor((totalSec % 86400) / 3600);
    label = `${days} 天 ${hrs} 小时`;
  } else if (format === 'hh:mm:ss') {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    label = `${pad(h)}:${pad(m)}:${pad(s)}`;
  } else {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    label = `${pad(m)}:${pad(s)}`;
  }

  return <Text {...rest}>{prefix ? `${prefix} ` : ''}{label}</Text>;
}
```

- [ ] **Step 2: 编译检查**

Run: `npx tsc -b`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Countdown.tsx
git commit -m "feat(ui): 新增 Countdown 通用倒计时组件"
```

---

### Task 5: OrderItemRow 组件（商品行）

**Files:**
- Create: `src/components/cards/OrderItemRow.tsx`

**目标**：列表卡 + 详情页商品清单都用这个行组件（图、标题、SKU、单价、数量、可选申请售后按钮）。

- [ ] **Step 1: 写组件**

```tsx
// src/components/cards/OrderItemRow.tsx
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

interface Props {
  image: string;
  title: string;
  skuTitle?: string;
  unitPrice: number;
  quantity: number;
  /** 是否显示"申请售后"按钮 */
  showAfterSaleAction?: boolean;
  onAfterSale?: () => void;
}

export function OrderItemRow({ image, title, skuTitle, unitPrice, quantity, showAfterSaleAction, onAfterSale }: Props) {
  const { colors, radius, typography } = useTheme();
  return (
    <View style={styles.row}>
      {image ? (
        <Image source={{ uri: image }} style={[styles.image, { borderRadius: radius.md, backgroundColor: colors.muted }]} />
      ) : (
        <View style={[styles.image, { borderRadius: radius.md, backgroundColor: colors.muted }]} />
      )}
      <View style={styles.body}>
        <Text style={[typography.body, { color: colors.text.primary }]} numberOfLines={2}>{title}</Text>
        {skuTitle ? (
          <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: 2 }]} numberOfLines={1}>
            规格：{skuTitle}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>x{quantity}</Text>
          {showAfterSaleAction ? (
            <Pressable onPress={onAfterSale}>
              <Text style={[typography.caption, { color: colors.text.secondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }]}>
                申请售后
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>¥{unitPrice.toFixed(2)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 },
  image: { width: 56, height: 56, marginRight: 10 },
  body: { flex: 1, marginRight: 8 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
});
```

- [ ] **Step 2: 编译检查**

Run: `npx tsc -b`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/cards/OrderItemRow.tsx
git commit -m "feat(cards): 新增 OrderItemRow 商品行组件"
```

---

### Task 6: OrderCard 组件（列表卡）

**Files:**
- Create: `src/components/cards/OrderCard.tsx`

**目标**：列表页淘宝展开风卡片，按店铺分组、显示商品行、底部主次 CTA。

- [ ] **Step 1: 写组件**

```tsx
// src/components/cards/OrderCard.tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { OrderItemRow } from './OrderItemRow';
import { Order, OrderStatus } from '../../types';

interface Props {
  order: Order;
  onPress: () => void;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
  primaryLabel?: string;
  secondaryLabel?: string;
}

const STATUS_COLOR: Record<OrderStatus, string> = {
  pendingPay: '#FF6B35',
  pendingShip: '#3B82F6',
  shipping: '#3B82F6',
  delivered: '#3B82F6',
  afterSale: '#DC2626',
  completed: '#2E7D32',
  canceled: '#9CA3AF',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pendingPay: '待付款',
  pendingShip: '待发货',
  shipping: '运输中',
  delivered: '待收货',
  afterSale: '售后中',
  completed: '已完成',
  canceled: '已取消',
};

export function OrderCard({ order, onPress, onPrimaryAction, onSecondaryAction, primaryLabel, secondaryLabel }: Props) {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const statusColor = STATUS_COLOR[order.status];
  // 第一组商家（多商户场景下后端会拆单，单卡只对应一家店）
  const companyId = order.items[0]?.companyId;
  const companyName = (order as any).companyName || '商家';  // Phase 1 fallback

  return (
    <Pressable onPress={onPress} style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[typography.bodyStrong, { color: colors.text.primary, flex: 1 }]} numberOfLines={1}>
          🏪 {companyName}
        </Text>
        <Text style={[typography.caption, { color: statusColor, fontWeight: '600' }]}>
          {STATUS_LABEL[order.status]}
        </Text>
      </View>

      {order.items.map((item) => (
        <OrderItemRow
          key={item.id}
          image={item.image}
          title={item.title}
          skuTitle={item.skuTitle}
          unitPrice={item.price}
          quantity={item.quantity}
        />
      ))}

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>
          共 {order.items.reduce((s, i) => s + i.quantity, 0)} 件，实付 <Text style={{ fontWeight: '600', color: colors.text.primary }}>¥{order.totalPrice.toFixed(2)}</Text>
        </Text>
        <View style={styles.actionRow}>
          {secondaryLabel ? (
            <Pressable onPress={onSecondaryAction}>
              <Text style={[typography.caption, { color: colors.text.secondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4, marginRight: 8 }]}>
                {secondaryLabel}
              </Text>
            </Pressable>
          ) : null}
          {primaryLabel ? (
            <Pressable onPress={onPrimaryAction}>
              <Text style={[typography.caption, { color: colors.text.inverse, backgroundColor: statusColor, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 4, fontWeight: '600' }]}>
                {primaryLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 12, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingBottom: 6, marginBottom: 4 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, paddingTop: 8, marginTop: 4 },
  actionRow: { flexDirection: 'row', alignItems: 'center' },
});
```

- [ ] **Step 2: 编译检查**

Run: `npx tsc -b`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/cards/OrderCard.tsx
git commit -m "feat(cards): 新增 OrderCard 淘宝展开风卡片"
```

---

### Task 7: StatusHero 组件（详情页状态头）

**Files:**
- Create: `src/components/orders/StatusHero.tsx`

**目标**：详情页顶部彩色背景大字状态头，颜色随状态变。

- [ ] **Step 1: 写组件**

```tsx
// src/components/orders/StatusHero.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Countdown } from '../ui/Countdown';
import { useTheme } from '../../theme';
import { OrderStatus } from '../../types';

interface Props {
  status: OrderStatus;
  /** VIP 礼包标记 */
  isVipPackage?: boolean;
  /** 副文案 */
  subtitle?: string;
  /** 倒计时（待收货时传 autoReceiveAt） */
  countdownExpiresAt?: string;
  countdownPrefix?: string;
}

const STATUS_GRADIENTS: Record<OrderStatus, [string, string]> = {
  pendingPay: ['#FF6B35', '#FF8C42'],
  pendingShip: ['#3B82F6', '#60A5FA'],
  shipping: ['#3B82F6', '#60A5FA'],
  delivered: ['#3B82F6', '#60A5FA'],
  afterSale: ['#DC2626', '#EF4444'],
  completed: ['#2E7D32', '#4CAF50'],
  canceled: ['#9CA3AF', '#D1D5DB'],
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pendingPay: '待付款',
  pendingShip: '待发货',
  shipping: '运输中',
  delivered: '待收货',
  afterSale: '售后中',
  completed: '已完成',
  canceled: '已取消',
};

export function StatusHero({ status, isVipPackage, subtitle, countdownExpiresAt, countdownPrefix }: Props) {
  const { typography } = useTheme();
  const [from, to] = STATUS_GRADIENTS[status];

  return (
    <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.container}>
      <View style={styles.row}>
        <Text style={[typography.title3, { color: '#fff' }]}>{STATUS_LABEL[status]}</Text>
        {isVipPackage ? (
          <View style={styles.vipBadge}>
            <Text style={styles.vipBadgeText}>VIP 开通礼包</Text>
          </View>
        ) : null}
      </View>
      {countdownExpiresAt ? (
        <Countdown
          expiresAt={countdownExpiresAt}
          format={status === 'delivered' ? 'days' : 'mm:ss'}
          prefix={countdownPrefix}
          style={[typography.caption, { color: 'rgba(255,255,255,0.9)', marginTop: 4 }]}
        />
      ) : null}
      {subtitle ? (
        <Text style={[typography.caption, { color: 'rgba(255,255,255,0.85)', marginTop: 2 }]}>{subtitle}</Text>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 18, paddingVertical: 18 },
  row: { flexDirection: 'row', alignItems: 'center' },
  vipBadge: { marginLeft: 8, backgroundColor: '#C9A96E', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  vipBadgeText: { color: '#fff', fontSize: 10, fontWeight: '600' },
});
```

- [ ] **Step 2: 编译检查 + Commit**

```bash
npx tsc -b
git add src/components/orders/StatusHero.tsx
git commit -m "feat(orders): 新增 StatusHero 状态头组件（按状态变色）"
```

---

### Task 8: AddressCard / AmountSummary / OrderInfoBlock / StickyCTABar / ShopGroup 组件

**Files:**
- Create: `src/components/orders/AddressCard.tsx`
- Create: `src/components/orders/AmountSummary.tsx`
- Create: `src/components/orders/OrderInfoBlock.tsx`
- Create: `src/components/orders/StickyCTABar.tsx`
- Create: `src/components/orders/ShopGroup.tsx`

**目标**：详情页其余区块组件。每个组件单独提交。

- [ ] **Step 1: AddressCard**

```tsx
// src/components/orders/AddressCard.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface Props {
  recipientName: string;
  recipientPhone: string;
  fullAddress: string;
}

export function AddressCard({ recipientName, recipientPhone, fullAddress }: Props) {
  const { colors, radius, spacing, typography } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md }]}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="map-marker" size={18} color={colors.brand.primary} />
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
            {recipientName} <Text style={{ color: colors.text.secondary, fontWeight: '400' }}>{recipientPhone}</Text>
          </Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>{fullAddress}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {},
  row: { flexDirection: 'row', alignItems: 'flex-start' },
});
```

```bash
npx tsc -b
git add src/components/orders/AddressCard.tsx
git commit -m "feat(orders): 新增 AddressCard 收货地址卡"
```

- [ ] **Step 2: AmountSummary**

```tsx
// src/components/orders/AmountSummary.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

interface Props {
  goodsAmount: number;
  shippingFee: number;
  vipDiscountAmount?: number;
  discountAmount?: number;
  totalCouponDiscount?: number;
  totalPrice: number;
}

export function AmountSummary({ goodsAmount, shippingFee, vipDiscountAmount, discountAmount, totalCouponDiscount, totalPrice }: Props) {
  const { colors, typography } = useTheme();
  const Row = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <View style={styles.row}>
      <Text style={[typography.bodySm, { color: colors.text.secondary }]}>{label}</Text>
      <Text style={[typography.bodySm, { color: color || colors.text.primary }]}>{value}</Text>
    </View>
  );
  return (
    <View>
      <Row label="商品金额" value={`¥${goodsAmount.toFixed(2)}`} />
      <Row label="运费" value={shippingFee === 0 ? '免运费' : `¥${shippingFee.toFixed(2)}`} color={shippingFee === 0 ? colors.brand.primary : undefined} />
      {vipDiscountAmount && vipDiscountAmount > 0 ? <Row label="VIP折扣" value={`-¥${vipDiscountAmount.toFixed(2)}`} color={colors.brand.primary} /> : null}
      {discountAmount && discountAmount > 0 ? <Row label="奖励抵扣" value={`-¥${discountAmount.toFixed(2)}`} color={colors.brand.primary} /> : null}
      {totalCouponDiscount && totalCouponDiscount > 0 ? <Row label="红包抵扣" value={`-¥${totalCouponDiscount.toFixed(2)}`} color={colors.danger} /> : null}
      <View style={[styles.row, { marginTop: 8 }]}>
        <Text style={[typography.body, { color: colors.text.secondary }]}>实付</Text>
        <Text style={[typography.title3, { color: '#FF6B35', fontWeight: '600' }]}>¥{totalPrice.toFixed(2)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
});
```

```bash
npx tsc -b
git add src/components/orders/AmountSummary.tsx
git commit -m "feat(orders): 新增 AmountSummary 金额明细块"
```

- [ ] **Step 3: OrderInfoBlock**

```tsx
// src/components/orders/OrderInfoBlock.tsx
import React from 'react';
import * as Clipboard from 'expo-clipboard';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { useToast } from '../feedback';

interface Props {
  orderId: string;
  createdAt: string;
  paidAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  paymentMethod?: 'wechat' | 'alipay' | 'bankcard' | null;
  buyerNote?: string;
  isVipPackage?: boolean;
  onApplyInvoice?: () => void;
}

const PAY_LABEL: Record<string, string> = { wechat: '微信支付', alipay: '支付宝', bankcard: '银行卡' };

function formatTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function OrderInfoBlock({ orderId, createdAt, paidAt, shippedAt, deliveredAt, paymentMethod, buyerNote, isVipPackage, onApplyInvoice }: Props) {
  const { colors, radius, typography } = useTheme();
  const { show } = useToast();

  const handleCopy = async () => {
    await Clipboard.setStringAsync(orderId);
    show({ message: '已复制', type: 'success' });
  };

  const Row = ({ label, value, action }: { label: string; value: React.ReactNode; action?: React.ReactNode }) => (
    <View style={styles.row}>
      <Text style={[typography.caption, { color: colors.text.secondary }]}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={[typography.caption, { color: colors.text.primary }]}>{value}</Text>
        {action}
      </View>
    </View>
  );

  return (
    <View>
      <Row label="订单号" value={orderId} action={
        <Pressable onPress={handleCopy} style={[styles.copyBtn, { backgroundColor: colors.muted, borderRadius: radius.sm }]}>
          <Text style={[typography.caption, { color: colors.text.secondary, fontSize: 10 }]}>复制</Text>
        </Pressable>
      } />
      <Row label="下单时间" value={formatTime(createdAt)} />
      {paidAt ? <Row label="付款时间" value={formatTime(paidAt)} /> : null}
      {shippedAt ? <Row label="发货时间" value={formatTime(shippedAt)} /> : null}
      {deliveredAt ? <Row label="送达时间" value={formatTime(deliveredAt)} /> : null}
      {paymentMethod ? <Row label="付款方式" value={PAY_LABEL[paymentMethod] ?? paymentMethod} /> : null}
      {buyerNote ? <Row label="买家留言" value={buyerNote} /> : null}
      {!isVipPackage && onApplyInvoice ? (
        <Row label="发票" value={
          <Pressable onPress={onApplyInvoice}>
            <Text style={[typography.caption, { color: colors.accent.blue }]}>申请发票 ›</Text>
          </Pressable>
        } />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  copyBtn: { paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 },
});
```

```bash
npx tsc -b
git add src/components/orders/OrderInfoBlock.tsx
git commit -m "feat(orders): 新增 OrderInfoBlock 订单信息块（含订单号复制）"
```

- [ ] **Step 4: StickyCTABar**

```tsx
// src/components/orders/StickyCTABar.tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

interface CTAItem {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}

interface Props {
  primary?: CTAItem;
  secondary?: CTAItem[];
}

export function StickyCTABar({ primary, secondary }: Props) {
  const { colors, radius, typography } = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      {(secondary || []).map((cta, i) => (
        <Pressable key={i} onPress={cta.onPress} style={[styles.btn, { borderColor: colors.border, borderRadius: radius.pill }]}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>{cta.label}</Text>
        </Pressable>
      ))}
      {primary ? (
        <Pressable onPress={primary.onPress} style={[styles.btnPrimary, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}>
          <Text style={[typography.caption, { color: colors.text.inverse, fontWeight: '600' }]}>{primary.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', padding: 10, borderTopWidth: 1, gap: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1 },
  btnPrimary: { paddingHorizontal: 18, paddingVertical: 8 },
});
```

```bash
npx tsc -b
git add src/components/orders/StickyCTABar.tsx
git commit -m "feat(orders): 新增 StickyCTABar 底部固定操作栏"
```

- [ ] **Step 5: ShopGroup**

```tsx
// src/components/orders/ShopGroup.tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { OrderItemRow } from '../cards/OrderItemRow';
import { OrderItem } from '../../types';

interface Props {
  companyName: string;
  items: OrderItem[];
  onContactSeller?: () => void;
  showAfterSaleAction?: boolean;
  onItemAfterSale?: (item: OrderItem) => void;
}

export function ShopGroup({ companyName, items, onContactSeller, showAfterSaleAction, onItemAfterSale }: Props) {
  const { colors, typography } = useTheme();
  return (
    <View>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[typography.bodyStrong, { color: colors.text.primary, flex: 1 }]}>🏪 {companyName}</Text>
        {onContactSeller ? (
          <Pressable onPress={onContactSeller}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>联系卖家 ›</Text>
          </Pressable>
        ) : null}
      </View>
      {items.map((item) => (
        <OrderItemRow
          key={item.id}
          image={item.image}
          title={item.title}
          skuTitle={item.skuTitle}
          unitPrice={item.price}
          quantity={item.quantity}
          showAfterSaleAction={showAfterSaleAction && !item.isPrize}
          onAfterSale={() => onItemAfterSale?.(item)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingBottom: 6, marginBottom: 4 },
});
```

```bash
npx tsc -b
git add src/components/orders/ShopGroup.tsx
git commit -m "feat(orders): 新增 ShopGroup 店铺分组组件"
```

---

### Task 9: 重写 app/orders/index.tsx 列表页（FlatList + 新卡片）

**Files:**
- Modify: `app/orders/index.tsx`（整文件重写）

**目标**：用 FlatList + OrderCard，删除"待付款" filter chip。

- [ ] **Step 1: 重写文件**

```tsx
// app/orders/index.tsx
import React, { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { OrderCard } from '../../src/components/cards/OrderCard';
import { orderStatusLabels } from '../../src/constants/statuses';
import { OrderRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AppError, Order, OrderStatus } from '../../src/types';

const statusOptions: Array<{ id: OrderStatus | 'afterSaleList'; label: string }> = [
  { id: 'pendingShip', label: '待发货' },
  { id: 'shipping', label: '待收货' },
  { id: 'afterSaleList', label: '售后' },
  { id: 'completed', label: '已完成' },
];

const isOrderStatus = (v?: string): v is OrderStatus =>
  v === 'pendingShip' || v === 'shipping' || v === 'delivered' || v === 'afterSale' || v === 'completed';

function getCTAs(order: Order, router: ReturnType<typeof useRouter>) {
  switch (order.status) {
    case 'pendingShip':
      return { primaryLabel: '联系客服', primaryAction: () => router.push(`/cs?source=ORDER_DETAIL&sourceId=${order.id}`) };
    case 'shipping':
    case 'delivered':
      return {
        primaryLabel: '确认收货',
        primaryAction: async () => { await OrderRepo.confirmReceive(order.id); },
        secondaryLabel: '查看物流',
        secondaryAction: () => router.push({ pathname: '/orders/track', params: { orderId: order.id } }),
      };
    case 'completed':
      return {
        primaryLabel: '再次购买',
        // 用户决策：再次购买功能暂不做，按钮显示提示 toast，未来另立任务
        primaryAction: () => { /* 在 OrderCard 父组件用 useToast 提示"功能即将上线" */ },
      };
    default:
      return {};
  }
}

export default function OrdersScreen() {
  const params = useLocalSearchParams<{ status?: string }>();
  const { colors, radius, spacing, typography } = useTheme();
  const router = useRouter();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const selectedStatus = isOrderStatus(params.status) ? params.status : undefined;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['orders', selectedStatus ?? 'all'],
    queryFn: () => OrderRepo.list(selectedStatus),
    enabled: isLoggedIn,
  });

  const listError = data && !data.ok ? data.error : null;
  const orders: Order[] = data?.ok ? data.data.items : [];
  const title = useMemo(() => selectedStatus ? (orderStatusLabels[selectedStatus] ?? '订单') : '全部订单', [selectedStatus]);

  const renderHeader = () => (
    <View style={styles.filterRow}>
      <FilterChip active={!selectedStatus} label="全部" onPress={() => router.replace('/orders')} colors={colors} radius={radius} typography={typography} />
      {statusOptions.map((opt) => {
        if (opt.id === 'afterSaleList') {
          return <FilterChip key={opt.id} active={false} label={opt.label} onPress={() => router.push('/orders/after-sale')} colors={colors} radius={radius} typography={typography} />;
        }
        return <FilterChip key={opt.id} active={opt.id === selectedStatus} label={opt.label} onPress={() => router.replace({ pathname: '/orders', params: { status: opt.id } })} colors={colors} radius={radius} typography={typography} />;
      })}
    </View>
  );

  const renderItem = ({ item }: { item: Order }) => {
    const ctas = getCTAs(item, router);
    return (
      <OrderCard
        order={item}
        onPress={() => router.push({ pathname: '/orders/[id]', params: { id: item.id } })}
        primaryLabel={ctas.primaryLabel}
        onPrimaryAction={ctas.primaryAction}
        secondaryLabel={ctas.secondaryLabel}
        onSecondaryAction={ctas.secondaryAction}
      />
    );
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title={title} />
      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={140} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={140} radius={radius.lg} />
        </View>
      ) : listError ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState title="订单加载失败" description={(listError as AppError).displayMessage ?? '请稍后重试'} onAction={refetch} />
        </View>
      ) : (
        <FlatList
          data={orders}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={<View style={{ padding: spacing.xl }}><EmptyState title="暂无订单" description="去首页看看新鲜好物" /></View>}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
        />
      )}
    </Screen>
  );
}

function FilterChip({ active, label, onPress, colors, radius, typography }: any) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, { borderRadius: radius.pill, overflow: 'hidden' }]}>
      {active ? (
        <LinearGradient colors={[colors.brand.primarySoft, colors.ai.soft]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.chipInner, { borderRadius: radius.pill }]}>
          <Text style={[typography.caption, { color: colors.brand.primary }]}>{label}</Text>
        </LinearGradient>
      ) : (
        <View style={[styles.chipInner, { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill }]}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  chip: { marginRight: 8, marginBottom: 8 },
  chipInner: { paddingHorizontal: 12, paddingVertical: 6 },
});
```

- [ ] **Step 2: 编译检查**

Run: `npx tsc -b`
Expected: 无错误

- [ ] **Step 3: 真机自测**

启动 dev server 进入"我的→全部订单"，确认：
- 列表用 FlatList 渲染（滚动流畅）
- 没有"待付款" chip
- 卡片显示店铺名（Phase 1 fallback "商家"）+ 商品图 + SKU 规格
- 状态文字按状态变色

- [ ] **Step 4: Commit**

```bash
git add app/orders/index.tsx
git commit -m "refactor(app/orders): 列表页改 FlatList + OrderCard 淘宝展开风，删除待付款 chip"
```

---

### Task 10: 重写 app/orders/[id].tsx 详情页（七区块）

**Files:**
- Modify: `app/orders/[id].tsx`（重写）

**目标**：详情页七区块结构（StatusHero / 物流卡 / AddressCard / ShopGroup / AmountSummary / OrderInfoBlock / StickyCTABar）。

- [ ] **Step 1: 重写文件**

```tsx
// app/orders/[id].tsx
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { StatusHero } from '../../src/components/orders/StatusHero';
import { AddressCard } from '../../src/components/orders/AddressCard';
import { ShopGroup } from '../../src/components/orders/ShopGroup';
import { AmountSummary } from '../../src/components/orders/AmountSummary';
import { OrderInfoBlock } from '../../src/components/orders/OrderInfoBlock';
import { StickyCTABar } from '../../src/components/orders/StickyCTABar';
import { OrderRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id ?? '');
  const { colors, radius, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => OrderRepo.getById(orderId),
    enabled: isLoggedIn && Boolean(orderId),
  });

  if (isLoading) {
    return <Screen><AppHeader title="订单详情" /><View style={{ padding: spacing.xl }}><Skeleton height={160} radius={radius.lg} /></View></Screen>;
  }
  if (!data || !data.ok) {
    return <Screen><AppHeader title="订单详情" /><ErrorState title="加载失败" description={data?.ok === false ? data.error.displayMessage ?? '请重试' : '请重试'} onAction={refetch} /></Screen>;
  }

  const order = data.data;
  const isVip = order.bizType === 'VIP_PACKAGE';
  // Phase 1 fallback: 用 deliveredAt + 7 天 模拟 autoReceiveAt
  const autoReceiveAt = order.autoReceiveAt ?? (order.deliveredAt ? new Date(new Date(order.deliveredAt).getTime() + 7 * 86400_000).toISOString() : undefined);

  const handleConfirmReceive = async () => {
    const r = await OrderRepo.confirmReceive(order.id);
    if (!r.ok) return show({ message: r.error.displayMessage ?? '失败', type: 'error' });
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    show({ message: '已确认收货', type: 'success' });
    refetch();
  };
  const handleCancel = async () => {
    const r = await OrderRepo.cancelOrder(order.id);
    if (!r.ok) return show({ message: r.error.displayMessage ?? '失败', type: 'error' });
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    show({ message: '已取消', type: 'success' });
    refetch();
  };

  // CTA 映射
  let primary: any, secondary: any[] = [];
  switch (order.status) {
    case 'pendingPay':
      // Phase 1 历史订单（F1 后不存在新的待付款）：仅显示提示，不实际支付
      primary = { label: '已停用', onPress: () => show({ message: '历史订单不可支付，请重新下单', type: 'error' }) };
      secondary = [{ label: '取消订单', onPress: handleCancel }];
      break;
    case 'shipping':
    case 'delivered':
      primary = { label: '确认收货', onPress: handleConfirmReceive };
      secondary = [{ label: '查看物流', onPress: () => router.push({ pathname: '/orders/track', params: { orderId: order.id } }) }];
      break;
    case 'completed':
      primary = { label: '再次购买', onPress: () => show({ message: '功能即将上线', type: 'info' }) };
      break;
  }
  secondary.push({ label: '联系客服', onPress: () => router.push(`/cs?source=ORDER_DETAIL&sourceId=${orderId}`) });

  // 物流摘要（Phase 1 取 shipments 第一条最新事件）
  const latestEvent = order.shipments?.[0]?.trackingEvents?.[0];
  const showLogistics = ['pendingShip', 'shipping', 'delivered', 'completed'].includes(order.status);

  // 按 companyId 分组
  const groups = new Map<string, typeof order.items>();
  for (const it of order.items) {
    const k = it.companyId ?? 'unknown';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }

  // Phase 1 地址 fallback：addressSnapshotMasked（详情已暴露，结构 recipientName/phone/province/city/district/detail）
  // Phase 2 后端会直接给 order.address.fullAddress 拼好的字段
  const addr = (order as any).address || (order as any).addressSnapshotMasked;
  const addrFullText = addr?.fullAddress
    || [addr?.province, addr?.city, addr?.district, addr?.detail].filter(Boolean).join(' ');

  return (
    <Screen>
      <AppHeader title="订单详情" />
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        <StatusHero
          status={order.status}
          isVipPackage={isVip}
          countdownExpiresAt={order.status === 'delivered' && autoReceiveAt ? autoReceiveAt : undefined}
          countdownPrefix={order.status === 'delivered' ? '还剩' : undefined}
          subtitle={order.status === 'pendingShip' ? '商家正在打包，预计 24 小时内发出' : undefined}
        />

        {showLogistics && latestEvent ? (
          <Pressable onPress={() => router.push({ pathname: '/orders/track', params: { orderId: order.id } })} style={[styles.section, { backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons name="package-variant" size={18} color={colors.brand.primary} />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={[typography.body, { color: colors.text.primary }]}>{latestEvent.message}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>{latestEvent.time}</Text>
            </View>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>查看物流 ›</Text>
          </Pressable>
        ) : null}

        {addr ? (
          <View style={[styles.section, { backgroundColor: colors.surface, paddingHorizontal: spacing.md }]}>
            <AddressCard
              recipientName={addr.recipientName || '收件人'}
              recipientPhone={addr.phone || ''}
              fullAddress={addrFullText}
            />
          </View>
        ) : null}

        {Array.from(groups.entries()).map(([cid, items]) => (
          <View key={cid} style={[styles.section, { backgroundColor: colors.surface, paddingHorizontal: spacing.md }]}>
            <ShopGroup
              companyName={(items[0] as any).companyName || '商家'}
              items={items}
              showAfterSaleAction={['delivered', 'completed'].includes(order.status) && !isVip}
              onItemAfterSale={() => router.push({ pathname: '/orders/after-sale/[id]', params: { id: order.id } })}
            />
          </View>
        ))}

        <View style={[styles.section, { backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.md }]}>
          <AmountSummary
            goodsAmount={order.goodsAmount ?? 0}
            shippingFee={order.shippingFee ?? 0}
            vipDiscountAmount={order.vipDiscountAmount}
            discountAmount={order.discountAmount}
            totalPrice={order.totalPrice}
          />
        </View>

        <View style={[styles.section, { backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.md }]}>
          <OrderInfoBlock
            orderId={order.id}
            createdAt={order.createdAt}
            paidAt={order.paidAt}
            shippedAt={order.shippedAt}
            deliveredAt={order.deliveredAt}
            paymentMethod={(order as any).paymentMethod}
            buyerNote={(order as any).buyerNote}
            isVipPackage={isVip}
            onApplyInvoice={!isVip ? () => router.push(`/invoice/apply?orderId=${order.id}`) : undefined}
          />
        </View>
      </ScrollView>

      <StickyCTABar primary={primary} secondary={secondary} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 8 },
});
```

- [ ] **Step 2: 编译检查 + 真机自测**

```bash
npx tsc -b
```

真机进入任一订单详情，确认 7 区块按顺序渲染、状态头颜色正确、订单号能复制。

- [ ] **Step 3: Commit**

```bash
git add app/orders/\[id\].tsx
git commit -m "refactor(app/orders): 详情页改七区块结构（状态头/物流/地址/店铺/金额/信息/CTA）"
```

---

### Task 11: 优化 app/orders/track.tsx（删地图 + 复制运单 + 快递电话）

**Files:**
- Modify: `app/orders/track.tsx:235-244, 32-34`

**目标**：删除地图占位区，运单号支持复制，承运商显示客服电话。

- [ ] **Step 1: 删除 mapPlaceholder 区块**

定位 `app/orders/track.tsx:235-244`（heroCard 下方的 mapPlaceholder View），整段删除。

- [ ] **Step 2: 加运单号复制 + 快递电话映射**

在文件顶部加 import：

```tsx
import * as Clipboard from 'expo-clipboard';
import { Linking, Pressable } from 'react-native';
import { useToast } from '../../src/components/feedback';
```

在 `maskTrackingNo` 函数下方加：

```tsx
const CARRIER_PHONES: Record<string, string> = {
  SF: '95338', YTO: '95554', ZTO: '95311', STO: '95543', YD: '95546', JD: '95311', EMS: '11183',
};
```

在 carrierInfo 渲染处（约 line:228）改成可点击：

```tsx
{!isMultiPackage && shipment ? (
  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
    <Text style={[typography.caption, { color: colors.text.secondary }]}>{shipment.carrierName}</Text>
    {shipment.trackingNo ? (
      <Pressable
        onPress={async () => {
          await Clipboard.setStringAsync(shipment.trackingNo!);
          toast.show({ message: '运单号已复制', type: 'success' });
        }}
        style={{ marginLeft: 6 }}
      >
        <Text style={[typography.caption, { color: colors.accent.blue }]}>{maskTrackingNo(shipment.trackingNo)} [复制]</Text>
      </Pressable>
    ) : null}
    {CARRIER_PHONES[shipment.carrierCode] ? (
      <Pressable onPress={() => Linking.openURL(`tel:${CARRIER_PHONES[shipment.carrierCode]}`)} style={{ marginLeft: 6 }}>
        <Text style={[typography.caption, { color: colors.brand.primary }]}>📞 客服</Text>
      </Pressable>
    ) : null}
  </View>
) : null}
```

加 `const toast = useToast();` 到组件顶部。

- [ ] **Step 3: 编译检查 + 真机**

```bash
npx tsc -b
```

进任一物流页确认：地图区已删；运单号点击复制弹 toast；快递公司客服图标可拨号。

- [ ] **Step 4: Commit**

```bash
git add app/orders/track.tsx
git commit -m "refactor(app/orders/track): 删地图占位，加运单复制+快递电话"
```

---

### Task 12: 售后列表卡片补 SKU 规格 + 店铺名

**Files:**
- Modify: `app/orders/after-sale/index.tsx`

**目标**：现有售后列表卡片（已有商品图、状态色、左侧色条、类型标签 — 见 line 119-184）整体已经接近订单列表风格，**只缺**：
1. 店铺名（与订单列表风格统一）
2. SKU 规格（productSnapshot.skuTitle 当前没显示）
3. 商品标题用 `productSnapshot.title` 已有但缺 fallback

> **后端依赖**：当前 `AfterSaleRepo.list` 返回的 `request.orderItem.productSnapshot` JSON 是否带 `skuTitle / companyId` 取决于建单时写入的内容。Task 1 已经在 OrderItem.productSnapshot 写入这些字段，老售后单可能没有 — 加 fallback。
> **店铺名**：需要后端 AfterSale list DTO 把店铺名 join 过来（同 Task 14 思路）。Phase 1 先在前端 fallback 显示"商家"，Phase 2 后端补完后自动消费。

- [ ] **Step 1: 在卡片顶部加店铺名行**

定位 line:135（`<View style={styles.cardHeader}>`），在它**之前**新加一行店铺名：

```tsx
{/* 店铺名（Phase 1 fallback "商家"，Phase 2 由后端 join Company 暴露） */}
<View style={[styles.shopRow, { borderBottomColor: colors.border }]}>
  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
    🏪 {(snapshot as any)?.companyName || '商家'}
  </Text>
</View>
```

styles 加：

```tsx
shopRow: {
  paddingBottom: 8,
  marginBottom: 10,
  borderBottomWidth: StyleSheet.hairlineWidth,
},
```

- [ ] **Step 2: 商品行加 SKU 规格**

定位 line:163-170 productInfo View，在 productTitle 下方加 skuTitle 行：

```tsx
<View style={styles.productInfo}>
  <Text style={[typography.bodySm, { color: colors.text.primary }]} numberOfLines={2}>
    {productTitle}
  </Text>
  {snapshot?.skuTitle ? (
    <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: 2 }]} numberOfLines={1}>
      规格：{snapshot.skuTitle}
    </Text>
  ) : null}
  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
    ¥{unitPrice.toFixed(2)} x{quantity}
  </Text>
</View>
```

- [ ] **Step 3: 编译 + 真机自测**

```bash
npx tsc -b
```

进入"我的→售后"，确认：
- 卡片顶部出现店铺名行（Phase 1 显示"商家"）
- 商品标题下面有"规格：XXX"行（如有 skuTitle）
- 类型标签 / 状态色 / 退款金额 等原有元素不动

- [ ] **Step 4: Commit**

```bash
git add app/orders/after-sale/index.tsx
git commit -m "refactor(app/orders/after-sale): 卡片加店铺名行 + SKU 规格行"
```

---

### Task 13: Phase 1 删 me 页 pendingPay 入口

**Files:**
- Modify: `app/(tabs)/me.tsx:25-32`

**目标**：Phase 1 列表 chip 删了"待付款"，me 页入口（`{ id: 'pendingPay', label: '待付款' }`）点击会跳到 `/orders?status=pendingPay` 但 chip 不存在 → 体验断裂。Phase 1 直接把这个入口**移除**（Phase 2 横幅做完后再以"未完成支付"形式回归 — 见 Task 25）。

- [ ] **Step 1: 删除 entries 数组里的 pendingPay**

定位 `app/(tabs)/me.tsx:25` 附近的 entries 数组，删除：

```tsx
{ id: 'pendingPay', label: '待付款', icon: 'credit-card-outline' },
```

- [ ] **Step 2: 编译 + 真机自测 + Commit**

```bash
npx tsc -b
```

真机进入"我的"页面，确认订单状态入口只剩 4 个（待发货/待收货/售后/已完成 — 或当前实际剩余项）。

```bash
git add 'app/(tabs)/me.tsx'
git commit -m "refactor(app/me): 暂时移除 pendingPay 入口（Phase 2 重构为'未完成支付'）"
```

---

### Phase 1 验收（不算单独 Task，跑完 Task 1-13 后执行）

- [ ] **Step 1: 全量 TypeScript 编译**

```bash
npx tsc -b && cd backend && npx tsc --noEmit && cd ..
```

- [ ] **Step 2: 后端单测全跑**

```bash
cd backend && npx jest --no-coverage
```

- [ ] **Step 3: 真机回归测试清单**

- [ ] 列表 FlatList 滚 100 单不掉帧
- [ ] 列表 4 个 chip（全部/待发货/待收货/售后/已完成），无"待付款"
- [ ] 卡片显示商品图、SKU 规格、店铺名（fallback "商家"）、状态色 CTA
- [ ] 详情七区块按顺序渲染
- [ ] 状态头按状态变色：待发货蓝、运输中蓝、已完成绿、售后红
- [ ] 待收货状态显示"还剩 X 天 X 小时"
- [ ] 订单号点"复制"成功 toast
- [ ] VIP 礼包订单状态头显示金色徽章
- [ ] 物流页无地图，运单号可复制，快递公司可拨号
- [ ] 售后列表卡片样式统一

- [ ] **Step 4: Phase 1 完成 commit**

```bash
git commit --allow-empty -m "milestone(orders): Phase 1 完成 - 前端 UI 重写 + 最小后端 DTO"
```

---

## Phase 2 · 后端剩余 DTO + 防重锁 + 续付链路 + 横幅（1.5-2 天）

### Task 14: mapOrder 完整版（店铺 join + logisticsSummary + autoReceiveAt）

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`（list 方法的 shipments include + mapOrder）
- Test: `backend/src/modules/order/map-order.spec.ts`

> **重要前置**：当前 `list()` 方法（order.service.ts:275）的 shipments include **只 select 了 `status` 和 `trackingNo`**，logisticsSummary 拿不到 shippedAt/deliveredAt/trackingEvents。本任务必须先扩 include。

- [ ] **Step 0: 扩展 list 查询的 shipments include**

定位 `order.service.ts:275`，把：

```ts
shipments: { select: { status: true, trackingNo: true } },
```

改为：

```ts
shipments: {
  select: {
    status: true,
    trackingNo: true,
    trackingNoMasked: true,
    carrierCode: true,
    carrierName: true,
    shippedAt: true,
    deliveredAt: true,
    trackingEvents: {
      orderBy: { occurredAt: 'desc' },
      take: 1,                                // 列表只要最新一条
      select: { occurredAt: true, message: true, location: true },
    },
  },
},
```

**性能注意**：take: 1 + 索引（已有 `Index trackingEvents.shipmentId+occurredAt` 应该在 schema 里有）保证 N+1 在可控范围。如索引缺失，本任务额外加索引。

- [ ] **Step 1: 写测试断言店铺名**

```ts
it('mapOrder includes companyName/companyLogo via join', async () => {
  // mock prisma.company.findMany 返回 [{ id: 'c1', name: '青禾农场', logoUrl: 'http://logo' }]
  // 测略 — 实际接入数据库 fixtures
  const out = (service as any).mapOrder({ /* ... items with companyId: 'c1' ... */ });
  expect(out.items[0].companyName).toBe('青禾农场');
});
```

- [ ] **Step 2: 修改 mapOrder 加 Company batch fetch**

策略：在 `list()` 方法内对一批订单一次性 `findMany Company where id IN (...)`，map 到内存，再传给 mapOrder。

```ts
// list() 方法内
const companyIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.companyId)).filter(Boolean))];
const companies = companyIds.length ? await this.prisma.company.findMany({
  where: { id: { in: companyIds } },
  select: { id: true, name: true, logoUrl: true },
}) : [];
const companyMap = new Map(companies.map((c) => [c.id, c]));

const mapped = orders.map((o) => this.mapOrder(o, companyMap));
```

修改 `mapOrder(order, companyMap?)` 签名，snapshot 函数内：

```ts
const company = companyMap?.get(item.companyId);
return { /* ... */ companyName: company?.name, companyLogo: company?.logoUrl };
```

- [ ] **Step 3: 加 logisticsSummary**

在 mapOrder 输出对象加：

```ts
logisticsSummary: this.summarizeLatestEvent(order.shipments),
autoReceiveAt: order.autoReceiveAt?.toISOString() ?? null,
```

helper：

```ts
private summarizeLatestEvent(shipments?: any[]) {
  if (!shipments || shipments.length === 0) return null;
  const allEvents = shipments.flatMap((s) => s.trackingEvents || []);
  if (allEvents.length === 0) return { status: shipments[0].status, latestEventMessage: null, latestEventTime: null };
  const latest = allEvents.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0];
  return {
    status: shipments[0].status,
    latestEventMessage: latest.message,
    latestEventTime: latest.occurredAt.toISOString?.() ?? latest.occurredAt,
  };
}
```

- [ ] **Step 4: 跑测试 + Commit**

```bash
cd backend && npx jest map-order --no-coverage && cd ..
git add backend/src/modules/order/order.service.ts backend/src/modules/order/map-order.spec.ts
git commit -m "feat(backend/order): mapOrder 加 companyName/companyLogo/logisticsSummary/autoReceiveAt"
```

---

### Task 15: mapOrderDetail 暴露完整地址

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`（mapOrderDetail，约 line 1110-1147）

- [ ] **Step 1: 修改 detail 输出加 address 块**

> **真实字段名**：`addressSnapshotMasked` 字段是 `recipientName / phone / regionText / province / city / district / detail`（参考 backend/src/common/security/privacy-mask.ts:81 maskAddressSnapshot 实现）。

```ts
// 在 mapOrderDetail 返回对象加（不要写 .name —— 实际字段是 .recipientName）：
const m = order.addressSnapshotMasked;
const address = m ? {
  recipientName: m.recipientName,             // 已脱敏（"张*"）
  recipientPhone: m.phone,                    // 已脱敏（"138****8888"）
  fullAddress: [m.province, m.city, m.district, m.detail].filter(Boolean).join(' '),
} : null;

return {
  // ... existing fields ...
  address,
  // ...
};
```

- [ ] **Step 2: 编译 + Commit**

```bash
cd backend && npx tsc --noEmit && cd ..
git add backend/src/modules/order/order.service.ts
git commit -m "feat(backend/order): mapOrderDetail 暴露完整 address 块"
```

---

### Task 16: 后端 GET /orders/checkout/me/pending

**Files:**
- Modify: `backend/src/modules/order/checkout.service.ts`（加方法）
- Modify: `backend/src/modules/order/order.controller.ts`（挂路由）
- Test: `backend/src/modules/order/checkout-pending.spec.ts`（新增）

> **风格对齐**：项目 OrderController 不用 `@UseGuards(JwtAuthGuard)` + `@CurrentUser() user`，全部用 `@CurrentUser('sub') userId: string` 取 ID（全局守卫已挂在 module 层）。本任务必须按此风格写。

- [ ] **Step 1: 写失败测试**

```ts
// backend/src/modules/order/checkout-pending.spec.ts
describe('CheckoutService.getPendingForUser', () => {
  it('returns ACTIVE non-expired session', async () => {
    // mock prisma.checkoutSession.findFirst 返回一条 ACTIVE + expiresAt 在未来
    const result = await service.getPendingForUser('user1');
    expect(result).toMatchObject({
      sessionId: expect.any(String),
      expectedTotal: expect.any(Number),
      expiresAt: expect.any(String),
      preview: expect.objectContaining({
        firstItemImage: expect.any(String),
        firstItemTitle: expect.any(String),
      }),
    });
  });
  it('returns null when no active session', async () => {
    // mock 返回 null
    const result = await service.getPendingForUser('user1');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Service 加方法**

```ts
// checkout.service.ts
async getPendingForUser(userId: string) {
  const session = await this.prisma.checkoutSession.findFirst({
    where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!session) return null;
  const items = (session.itemsSnapshot as any[]) || [];
  const first = items[0];
  return {
    sessionId: session.id,
    merchantOrderNo: session.merchantOrderNo,
    expectedTotal: session.expectedTotal,
    goodsAmount: session.goodsAmount,
    shippingFee: session.shippingFee,
    expiresAt: session.expiresAt.toISOString(),
    itemCount: items.reduce((s, i) => s + (i.quantity || 1), 0),
    bizType: session.bizType,
    preview: {
      firstItemImage: first?.productSnapshot?.image || '',
      firstItemTitle: first?.productSnapshot?.title || '',
      extraCount: Math.max(0, items.length - 1),
    },
    items: items.map((i) => ({
      image: i.productSnapshot?.image || '',
      title: i.productSnapshot?.title || '',
      skuTitle: i.productSnapshot?.skuTitle || '',
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
  };
}
```

- [ ] **Step 3: Controller 挂路由（对齐项目 @CurrentUser('sub') 风格）**

```ts
// order.controller.ts — 与 line:23 的 checkout / line:43 的 cancelCheckout 同款写法
@Get('checkout/me/pending')
getMyPendingCheckout(@CurrentUser('sub') userId: string) {
  return this.checkoutService.getPendingForUser(userId);
}
```

不要用 `@UseGuards(JwtAuthGuard)` — module 层已挂全局守卫。

- [ ] **Step 4: 跑测试 + Commit**

```bash
cd backend && npx jest checkout-pending --no-coverage && npx tsc --noEmit && cd ..
git add backend/src/modules/order/checkout.service.ts backend/src/modules/order/order.controller.ts backend/src/modules/order/checkout-pending.spec.ts
git commit -m "feat(backend/order): 新增 GET /orders/checkout/me/pending 接口"
```

---

### Task 17: 后端 POST /orders/checkout/:sessionId/resume

**Files:**
- Modify: `backend/src/modules/order/checkout.service.ts`
- Modify: `backend/src/modules/order/order.controller.ts`

- [ ] **Step 1: Service 加方法**

```ts
async resumeSession(userId: string, sessionId: string) {
  const session = await this.prisma.checkoutSession.findFirst({
    where: { id: sessionId, userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
  });
  if (!session) throw new NotFoundException('session 不存在或已过期');
  if (!session.merchantOrderNo) throw new BadRequestException('merchantOrderNo 缺失');

  let paymentParams: Record<string, any> = {};
  if (session.paymentChannel === 'ALIPAY' && this.alipayService?.isAvailable()) {
    const orderStr = await this.alipayService.createAppPayOrder({
      merchantOrderNo: session.merchantOrderNo,
      totalAmount: session.expectedTotal,
      subject: `爱买买订单-${session.merchantOrderNo}`,
    });
    paymentParams = { channel: 'alipay', orderStr };
  }

  return {
    sessionId: session.id,
    merchantOrderNo: session.merchantOrderNo,
    expectedTotal: session.expectedTotal,
    paymentParams,
  };
}
```

- [ ] **Step 2: Controller 挂路由（对齐项目风格）**

```ts
@Post('checkout/:sessionId/resume')
resumeCheckout(
  @CurrentUser('sub') userId: string,
  @Param('sessionId') sessionId: string,
) {
  return this.checkoutService.resumeSession(userId, sessionId);
}
```

不要用 `@UseGuards(JwtAuthGuard)`。

- [ ] **Step 3: 编译 + Commit**

```bash
cd backend && npx tsc --noEmit && cd ..
git add backend/src/modules/order/checkout.service.ts backend/src/modules/order/order.controller.ts
git commit -m "feat(backend/order): 新增 POST /orders/checkout/:sessionId/resume 续付接口"
```

---

### Task 18: 后端 Checkout 防重锁

**Files:**
- Modify: `backend/src/modules/order/checkout.service.ts`（checkout + checkoutVipPackage）
- Test: `backend/src/modules/order/checkout-active-guard.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('CheckoutService.checkout active session guard', () => {
  it('rejects with PENDING_CHECKOUT_EXISTS when active session exists', async () => {
    // mock prisma.checkoutSession.findFirst 返回一条 ACTIVE 未过期 session
    await expect(service.checkout('user1', { /* dto */ })).rejects.toMatchObject({
      response: { code: 'PENDING_CHECKOUT_EXISTS' },
      status: 409,
    });
  });
  it('proceeds when idempotencyKey matches existing', async () => {
    // mock 已有匹配 idempotencyKey 的 session → 直接返回
    const result = await service.checkout('user1', { idempotencyKey: 'k1', items: [] });
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 2: 在 checkout() 入口加守卫**

定位 `checkout.service.ts:92` checkout 方法，在幂等性检查之后、SKU 查询之前加：

```ts
// 已有 idempotency 检查走完后
const activeSession = await this.prisma.checkoutSession.findFirst({
  where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
  orderBy: { createdAt: 'desc' },
});
if (activeSession && (!dto.idempotencyKey || activeSession.idempotencyKey !== dto.idempotencyKey)) {
  // 注意：项目 AppExceptionFilter (app-exception.filter.ts:160-172) 不透传自定义字段，
  //       所以这里只用 code 让前端识别，前端拿到 code='PENDING_CHECKOUT_EXISTS' 后
  //       额外调一次 GET /orders/checkout/me/pending 取商品列表（见 Task 24）
  throw new ConflictException({
    code: 'PENDING_CHECKOUT_EXISTS',
    message: '你有未完成的订单，请先完成支付或取消',
  });
}
```

- [ ] **Step 3: checkoutVipPackage 同样加守卫**

定位 `checkout.service.ts:689` `checkoutVipPackage` 方法，加同样逻辑。

- [ ] **Step 4: 跑测试 + Commit**

```bash
cd backend && npx jest checkout-active-guard --no-coverage && cd ..
git add backend/src/modules/order/checkout.service.ts backend/src/modules/order/checkout-active-guard.spec.ts
git commit -m "feat(backend/order): checkout 加 ACTIVE Session 防重锁（普通+VIP）"
```

---

### Task 19: 前端 OrderRepo 加 getPendingCheckout / resumeCheckout

**Files:**
- Modify: `src/repos/OrderRepo.ts`
- Modify: `src/types/domain/Checkout.ts`（如已存在则补类型，没有则新增）
- Modify: `src/types/index.ts`（导出新类型）

> **风格对齐**：项目 OrderRepo 是 **对象字面量**（`export const OrderRepo = { ... }`），HTTP 调用用 `ApiClient.get/post`，**不是** class 风格。Mock 模式有专用 `simulateRequest` 分支。本任务必须按此风格。

- [ ] **Step 1: 在 src/types/domain/Checkout.ts 加类型**

如果文件已存在，追加：

```ts
export type PendingCheckout = {
  sessionId: string;
  merchantOrderNo: string | null;
  expectedTotal: number;
  goodsAmount: number;
  shippingFee: number;
  expiresAt: string;
  itemCount: number;
  bizType: 'NORMAL_GOODS' | 'VIP_PACKAGE';
  preview: { firstItemImage: string; firstItemTitle: string; extraCount: number };
  items: Array<{ image: string; title: string; skuTitle: string; quantity: number; unitPrice: number }>;
};
```

如果 Checkout.ts 不存在，先 grep 确认实际文件名（可能是 `Checkout.ts` 或 `CheckoutSession.ts`）。

- [ ] **Step 2: 在 src/types/index.ts 导出**

加：

```ts
export type { PendingCheckout } from './domain/Checkout';
```

- [ ] **Step 3: OrderRepo 加方法（对象字面量风格 + ApiClient + USE_MOCK 分支）**

在 `OrderRepo` 对象字面量内追加（参考 `createCheckoutSession` 写法）：

```ts
  /**
   * 获取当前用户最新一条 ACTIVE CheckoutSession
   * - 后端接口：GET /api/v1/orders/checkout/me/pending
   * - 返回 null 表示没有未完成订单
   */
  getPendingCheckout: async (): Promise<Result<PendingCheckout | null>> => {
    if (USE_MOCK) {
      return simulateRequest<PendingCheckout | null>(null, { delay: 200 });
    }
    return ApiClient.get<PendingCheckout | null>('/orders/checkout/me/pending');
  },

  /**
   * 续付未完成订单（重新生成支付参数）
   * - 后端接口：POST /api/v1/orders/checkout/:sessionId/resume
   * - 返回新的 paymentParams（含支付宝 orderStr）
   */
  resumeCheckout: async (sessionId: string): Promise<Result<{ paymentParams: { channel?: string; orderStr?: string } }>> => {
    if (USE_MOCK) {
      return simulateRequest({ paymentParams: { channel: 'alipay', orderStr: 'mock-order-str' } }, { delay: 300 });
    }
    return ApiClient.post(`/orders/checkout/${sessionId}/resume`, {});
  },
```

加 import（如果还没）：

```ts
import { PendingCheckout } from '../types/domain/Checkout';
```

- [ ] **Step 4: 编译 + Commit**

```bash
npx tsc -b
git add src/repos/OrderRepo.ts src/types/domain/Checkout.ts src/types/index.ts
git commit -m "feat(repos): OrderRepo 加 getPendingCheckout / resumeCheckout（对象字面量+ApiClient 风格）"
```

---

### Task 20: PendingCheckoutBanner 组件

**Files:**
- Create: `src/components/overlay/PendingCheckoutBanner.tsx`

- [ ] **Step 1: 写组件**

```tsx
// src/components/overlay/PendingCheckoutBanner.tsx
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { OrderRepo } from '../../repos';
import { useAuthStore } from '../../store';
import { useTheme } from '../../theme';
import { useToast } from '../feedback';
import { Countdown } from '../ui/Countdown';
import { payWithAlipay } from '../../utils/alipay';

export function PendingCheckoutBanner() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const { colors, radius, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();

  const { data, refetch } = useQuery({
    queryKey: ['pending-checkout'],
    queryFn: () => OrderRepo.getPendingCheckout(),
    enabled: isLoggedIn,
    refetchInterval: 30_000,
  });

  if (!data?.ok || !data.data) return null;
  const pending = data.data;

  const handleResume = async () => {
    const r = await OrderRepo.resumeCheckout(pending.sessionId);
    if (!r.ok) return show({ message: r.error.displayMessage ?? '续付失败', type: 'error' });
    const orderStr = r.data.paymentParams?.orderStr;
    if (!orderStr) {
      show({ message: '支付参数获取失败，请重试', type: 'error' });
      return;
    }
    // 项目支付封装在 src/utils/alipay.ts，参考 app/checkout.tsx:19, 445
    const result = await payWithAlipay(orderStr);
    if (result.resultStatus === '9000') {
      show({ message: '支付成功', type: 'success' });
      // 跳订单详情或全部订单
      router.replace('/orders');
    } else if (result.resultStatus === '6001') {
      // 用户又取消 — Session 仍 ACTIVE，跳 /checkout-pending
      router.push({ pathname: '/checkout-pending', params: { sessionId: pending.sessionId } });
    } else {
      show({ message: '支付失败，请重试', type: 'error' });
    }
  };

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/checkout-pending', params: { sessionId: pending.sessionId } })}
      style={[styles.banner, { backgroundColor: '#FFF8E1', borderRadius: radius.md }]}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[typography.caption, { color: '#FF6B35', fontWeight: '600' }]}>⏱ </Text>
          <Text style={[typography.caption, { color: '#FF6B35', fontWeight: '600' }]}>你有未完成的订单 </Text>
          <Countdown
            expiresAt={pending.expiresAt}
            format="mm:ss"
            onExpire={refetch}
            style={[typography.caption, { color: '#FF6B35', fontWeight: '600' }]}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          {pending.preview.firstItemImage ? (
            <Image source={{ uri: pending.preview.firstItemImage }} style={{ width: 24, height: 24, borderRadius: 4 }} />
          ) : null}
          <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 6, flex: 1 }]} numberOfLines={1}>
            {pending.preview.firstItemTitle}{pending.preview.extraCount > 0 ? ` 等共 ${pending.preview.extraCount + 1} 件` : ''} · ¥{pending.expectedTotal.toFixed(2)}
          </Text>
        </View>
      </View>
      <Pressable onPress={handleResume} style={[styles.cta, { backgroundColor: '#FF6B35', borderRadius: radius.pill }]}>
        <Text style={[typography.caption, { color: '#fff', fontWeight: '600' }]}>继续支付</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', padding: 10, marginHorizontal: 12, marginTop: 8 },
  cta: { paddingHorizontal: 14, paddingVertical: 6, marginLeft: 8 },
});
```

- [ ] **Step 2: 编译 + Commit**

```bash
npx tsc -b
git add src/components/overlay/PendingCheckoutBanner.tsx
git commit -m "feat(overlay): 新增 PendingCheckoutBanner 未完成订单横幅"
```

---

### Task 21: Mount 横幅到 home.tsx 与 cart.tsx

**Files:**
- Modify: `app/(tabs)/home.tsx`
- Modify: `app/cart.tsx`

- [ ] **Step 1: home.tsx 顶部 mount**

在 home 页 ScrollView 第一个子节点位置加：

```tsx
import { PendingCheckoutBanner } from '../../src/components/overlay/PendingCheckoutBanner';
// ...
<PendingCheckoutBanner />
```

- [ ] **Step 2: cart.tsx 顶部 mount**

同理在 cart 页顶部加。

- [ ] **Step 3: 编译 + 真机验证 + Commit**

```bash
npx tsc -b
git add 'app/(tabs)/home.tsx' app/cart.tsx
git commit -m "feat(app/home,cart): mount PendingCheckoutBanner 横幅"
```

---

### Task 22: app/checkout-pending.tsx 续付页

**Files:**
- Create: `app/checkout-pending.tsx`

- [ ] **Step 1: 写页面**

```tsx
// app/checkout-pending.tsx
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../src/components/feedback';
import { OrderItemRow } from '../src/components/cards/OrderItemRow';
import { AmountSummary } from '../src/components/orders/AmountSummary';
import { StickyCTABar } from '../src/components/orders/StickyCTABar';
import { Countdown } from '../src/components/ui/Countdown';
import { OrderRepo } from '../src/repos';
import { useTheme } from '../src/theme';
import { payWithAlipay } from '../src/utils/alipay';

export default function CheckoutPendingScreen() {
  const { colors, spacing, typography } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show } = useToast();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pending-checkout'],
    queryFn: () => OrderRepo.getPendingCheckout(),
  });

  if (isLoading) {
    return <Screen><AppHeader title="未完成订单" /><View style={{ padding: spacing.xl }}><Skeleton height={200} radius={8} /></View></Screen>;
  }

  if (!data?.ok || !data.data) {
    return (
      <Screen>
        <AppHeader title="未完成订单" />
        <ErrorState title="该订单已过期" description="未完成订单可能已自动取消，库存已释放" onAction={() => router.replace('/cart')} actionLabel="去购物车" />
      </Screen>
    );
  }

  const pending = data.data;

  const handleResume = async () => {
    const r = await OrderRepo.resumeCheckout(pending.sessionId);
    if (!r.ok) return show({ message: r.error.displayMessage ?? '续付失败', type: 'error' });
    const orderStr = r.data.paymentParams?.orderStr;
    if (!orderStr) {
      show({ message: '支付参数获取失败', type: 'error' });
      return;
    }
    const result = await payWithAlipay(orderStr);
    if (result.resultStatus === '9000') {
      await queryClient.invalidateQueries({ queryKey: ['pending-checkout'] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      show({ message: '支付成功', type: 'success' });
      router.replace('/orders');
    } else if (result.resultStatus === '6001') {
      // 用户取消，Session 仍 ACTIVE — 留在本页
    } else {
      show({ message: '支付失败，请重试', type: 'error' });
    }
  };

  const handleCancel = () => {
    Alert.alert('确定取消？', '库存将释放，需要重新下单', [
      { text: '不取消' },
      {
        text: '取消订单',
        style: 'destructive',
        onPress: async () => {
          const r = await OrderRepo.cancelCheckoutSession(pending.sessionId);
          if (!r.ok) return show({ message: r.error.displayMessage ?? '取消失败', type: 'error' });
          await queryClient.invalidateQueries({ queryKey: ['pending-checkout'] });
          show({ message: '已取消', type: 'success' });
          router.replace('/cart');
        },
      },
    ]);
  };

  return (
    <Screen>
      <AppHeader title="未完成订单" />
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        <LinearGradient colors={['#FF6B35', '#FF8C42']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.hero}>
          <Text style={[typography.title3, { color: '#fff' }]}>订单未完成支付</Text>
          <Countdown expiresAt={pending.expiresAt} prefix="⏱ 剩" onExpire={refetch} style={[typography.caption, { color: 'rgba(255,255,255,0.9)', marginTop: 4 }]} />
          <Text style={[typography.caption, { color: 'rgba(255,255,255,0.85)', marginTop: 2 }]}>取消后库存将释放，需要重新下单</Text>
        </LinearGradient>

        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: 8 }]}>商品清单</Text>
          {pending.items.map((it, i) => (
            <OrderItemRow
              key={i}
              image={it.image}
              title={it.title}
              skuTitle={it.skuTitle}
              unitPrice={it.unitPrice}
              quantity={it.quantity}
            />
          ))}
        </View>

        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <AmountSummary
            goodsAmount={pending.goodsAmount}
            shippingFee={pending.shippingFee}
            totalPrice={pending.expectedTotal}
          />
        </View>
      </ScrollView>

      <StickyCTABar
        primary={{ label: `继续支付 ¥${pending.expectedTotal.toFixed(2)}`, onPress: handleResume }}
        secondary={[{ label: '取消订单', onPress: handleCancel }]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 18 },
  section: { padding: 12, marginTop: 8 },
});
```

- [ ] **Step 2: 编译 + Commit**

```bash
npx tsc -b
git add app/checkout-pending.tsx
git commit -m "feat(app): 新增 /checkout-pending 续付页（横幅/我的页/6001 共用入口）"
```

---

### Task 23: app/checkout.tsx 6001 改造（普通 + VIP 两个分支都改）

**Files:**
- Modify: `app/checkout.tsx:460-465`（普通商品结算）
- Modify: `app/checkout.tsx:560 附近`（VIP 礼包结算 — 同样有 6001 分支）

> **重要**：项目里 6001 分支出现**两次**（普通和 VIP），grep `'6001'` 验证: line 460 + 560。Phase 1 用户决策"VIP 走相同流程"，所以两处都要改。

- [ ] **Step 1: 修改普通商品 6001 分支（line ~460）**

```tsx
} else if (alipayResult.resultStatus === '6001') {
  // 用户取消 — 保留 Session ACTIVE，跳到 /checkout-pending 让用户决定续付或取消
  // （不再调用 OrderRepo.cancelCheckoutSession）
  router.replace({ pathname: '/checkout-pending', params: { sessionId } });
  return;
}
```

- [ ] **Step 2: 修改 VIP 6001 分支（line ~560）**

定位文件第二处 `alipayResult.resultStatus === '6001'`（grep `'6001'` 找到所有位置），用同样代码替换。**注意**：sessionId 变量名在 VIP 分支可能不同（如 vipSessionId），按现有作用域取实际变量。

- [ ] **Step 3: 编译 + 真机验证**

```bash
npx tsc -b
```

真机：
- 普通商品下单 → 调起支付宝 → 点 X → 跳 /checkout-pending
- VIP 礼包下单 → 调起支付宝 → 点 X → 跳 /checkout-pending（同样行为）

- [ ] **Step 4: Commit**

```bash
git add app/checkout.tsx
git commit -m "fix(app/checkout): 支付宝 6001 取消改为跳 /checkout-pending（普通+VIP 两个分支）"
```

---

### Task 24: app/checkout.tsx 409 内联 Modal

**Files:**
- Modify: `app/checkout.tsx`（提交订单按钮 onPress）

- [ ] **Step 1: 加 Modal state + 提交订单 409 捕获 + 二次拉取**

在 checkout.tsx 顶部加 state 和 Modal 组件。提交订单按钮的 onPress 包装：

```tsx
import type { PendingCheckout } from '../src/types/domain/Checkout';

const [pendingModal, setPendingModal] = useState<PendingCheckout | null>(null);

const handleSubmit = async () => {
  // 现有 checkout 调用
  const result = await OrderRepo.createCheckoutSession({ /* dto */ });
  if (!result.ok) {
    // 检查是否 409 PENDING_CHECKOUT_EXISTS
    if ((result.error as any).code === 'PENDING_CHECKOUT_EXISTS') {
      // 后端 filter 只透传 code，自定义字段会被吞 — 这里额外调一次拿商品列表
      const pending = await OrderRepo.getPendingCheckout();
      if (pending.ok && pending.data) {
        setPendingModal(pending.data);
      } else {
        // Session 可能恰好刚过期 — 提示用户重试
        show({ message: '订单状态异常，请重试', type: 'error' });
      }
      return;
    }
    show({ message: result.error.displayMessage ?? '提交失败', type: 'error' });
    return;
  }
  // 现有成功路径
};
```

- [ ] **Step 2: 渲染 Modal（展开商品列表）**

```tsx
{pendingModal ? (
  <Modal transparent animationType="fade" visible>
    <Pressable onPress={() => setPendingModal(null)} style={modalStyles.backdrop}>
      <Pressable onPress={(e) => e.stopPropagation()} style={[modalStyles.card, { backgroundColor: colors.surface }]}>
        <View style={modalStyles.header}>
          <Text style={typography.title3}>你有一个未完成的订单</Text>
          <Countdown expiresAt={pendingModal.expiresAt} style={[typography.caption, { color: '#FF6B35', fontWeight: '600' }]} />
        </View>
        <ScrollView style={{ maxHeight: 280 }}>
          {pendingModal.items.map((it, i) => (
            <OrderItemRow key={i} image={it.image} title={it.title} skuTitle={it.skuTitle} unitPrice={it.unitPrice} quantity={it.quantity} />
          ))}
        </ScrollView>
        <View style={modalStyles.totalRow}>
          <Text style={typography.caption}>共 {pendingModal.itemCount} 件</Text>
          <Text style={[typography.bodyStrong, { color: '#FF6B35' }]}>实付 ¥{pendingModal.expectedTotal.toFixed(2)}</Text>
        </View>
        <Pressable onPress={async () => {
          // 取消旧订单 → 重试当前 checkout
          const c = await OrderRepo.cancelCheckoutSession(pendingModal.sessionId);
          if (!c.ok) { show({ message: '取消旧订单失败', type: 'error' }); return; }
          setPendingModal(null);
          await handleSubmit();
        }} style={[modalStyles.btnPrimary, { backgroundColor: colors.brand.primary }]}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>取消旧订单，重新下这单</Text>
        </Pressable>
        <Pressable onPress={() => {
          setPendingModal(null);
          router.push({ pathname: '/checkout-pending', params: { sessionId: pendingModal.sessionId } });
        }} style={modalStyles.btnSecondary}>
          <Text style={{ color: colors.text.secondary }}>先去支付这单</Text>
        </Pressable>
        <Pressable onPress={() => setPendingModal(null)} style={modalStyles.btnText}>
          <Text style={{ color: colors.text.tertiary }}>关闭</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  </Modal>
) : null}
```

> **注意**：不再需要"OrderRepo 错误透传 detail"，因为我们改用 `getPendingCheckout` 二次拉取拿商品列表，绕开了 AppExceptionFilter 透传限制。

样式：

```tsx
const modalStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  card: { width: '88%', borderRadius: 12, padding: 16, gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, marginTop: 4 },
  btnPrimary: { padding: 12, borderRadius: 18, alignItems: 'center' },
  btnSecondary: { padding: 12, borderRadius: 18, alignItems: 'center', borderWidth: 1, borderColor: '#ddd' },
  btnText: { padding: 8, alignItems: 'center' },
});
```

- [ ] **Step 3: 真机验证**

故意在购物车下两次单（第一次 6001 取消保留 Session → 再下一次 → 弹 Modal 显示完整商品列表）。

- [ ] **Step 4: Commit**

```bash
git add app/checkout.tsx
git commit -m "feat(app/checkout): 加 409 防重 Modal（展开商品列表 + 三按钮）"
```

---

### Task 25: 我的页 pendingPay 入口改造

**Files:**
- Modify: `app/(tabs)/me.tsx:25-32`

- [ ] **Step 1: 改 entries 数组 + 数据源**

定位 me.tsx 的 entries 数组（含 pendingPay）。改成：

```tsx
const { data: pendingData } = useQuery({
  queryKey: ['pending-checkout'],
  queryFn: () => OrderRepo.getPendingCheckout(),
});
const hasPending = pendingData?.ok && pendingData.data;

// entries 数组里 pendingPay 那一项条件渲染：
const orderEntries = [
  ...(hasPending ? [{ id: 'pending', label: '未完成支付', icon: 'credit-card-clock-outline', badge: 'pending' }] : []),
  // ... 其他原有 entries（删掉旧的 pendingPay）
];
```

入口点击：

```tsx
if (entry.id === 'pending') {
  router.push('/checkout-pending');
} else {
  router.push({ pathname: '/orders', params: { status: entry.id } });
}
```

徽标：在 pending 入口右上角渲染 `<Countdown expiresAt={pendingData.data.expiresAt} format="mm:ss" />`。

- [ ] **Step 2: 编译 + 真机 + Commit**

```bash
npx tsc -b
git add 'app/(tabs)/me.tsx'
git commit -m "refactor(app/me): pendingPay 入口改为'未完成支付' + 数据源换 pending checkout"
```

---

### Task 26: 列表/详情消费完整字段（去 fallback）

**Files:**
- Modify: `app/orders/index.tsx`
- Modify: `app/orders/[id].tsx`

- [ ] **Step 1: 列表卡片读 companyName**

把 `OrderCard.tsx` 内的 `(order as any).companyName || '商家'` fallback 改为 `order.items[0]?.companyName || '商家'`（Phase 2 后端在 item 上挂 companyName）。

- [ ] **Step 2: 详情页 ShopGroup 读真实 companyName**

把 `(items[0] as any).companyName || '商家'` 改为 `items[0].companyName || '商家'`（同上）。

- [ ] **Step 3: 详情页用真实 autoReceiveAt**

删掉 Phase 1 fallback `order.autoReceiveAt ?? (order.deliveredAt ? ...)`，改为直接 `order.autoReceiveAt`。

- [ ] **Step 4: Order 类型补 companyName 到 OrderItem**

```ts
// src/types/domain/Order.ts
export type OrderItem = {
  // ... existing
  companyName?: string;
  companyLogo?: string;
};
```

- [ ] **Step 5: 编译 + Commit**

```bash
npx tsc -b
git add app/orders/ src/types/domain/Order.ts src/components/cards/OrderCard.tsx src/components/orders/ShopGroup.tsx
git commit -m "refactor(app/orders): 消费真实 companyName/autoReceiveAt 字段"
```

---

### Task 27: Phase 2 验收

- [ ] **全量编译**

```bash
npx tsc -b && cd backend && npx tsc --noEmit && cd ..
```

- [ ] **后端单测**

```bash
cd backend && npx jest --no-coverage
```

- [ ] **真机回归清单**

- [ ] 取消支付宝（6001）后**直接跳 /checkout-pending**
- [ ] 首页 / 购物车顶部能看到横幅 + 倒计时
- [ ] 横幅"继续支付"按钮直接续付
- [ ] 横幅其他区域跳 /checkout-pending
- [ ] /checkout-pending 完整展示商品列表 + 倒计时 + 取消订单 + 继续支付
- [ ] 我的页"未完成支付"入口在有 Session 时显示徽标+倒计时，无 Session 时隐藏
- [ ] 重复点提交订单被 409 拦截，弹 Modal 展开商品列表
- [ ] 在 409 Modal 点"取消旧订单，重新下这单" → 调起支付宝支付新订单
- [ ] 在 409 Modal 点"先去支付这单" → 跳 /checkout-pending
- [ ] 30 分钟后横幅自动消失
- [ ] 列表卡片真实店铺名（非"商家"占位）
- [ ] 详情页真实 autoReceiveAt 倒计时

- [ ] **Phase 2 完成 commit**

```bash
git commit --allow-empty -m "milestone(orders): Phase 2 完成 - 后端 DTO + 防重锁 + 续付链路 + 横幅"
```

---

## Phase 3 · buyerNote 字段 + 收尾（0.5 天）

### Task 28: Schema 新增 buyerNote 字段

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: 加字段**

定位 `model CheckoutSession` 和 `model Order`，分别加：

```prisma
buyerNote   String?  @db.VarChar(200)
```

- [ ] **Step 2: 跑 migration**

```bash
cd backend && npx prisma migrate dev --name add_buyer_note_to_checkout_and_order
```

确认生成的 migration 文件 SQL 是 `ADD COLUMN buyerNote VARCHAR(200)`，**不影响现有数据**。

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(prisma): CheckoutSession + Order 加 buyerNote 字段（VARCHAR 200）"
```

---

### Task 29: CheckoutDto + Service 透传 buyerNote

**Files:**
- Modify: `backend/src/modules/order/checkout.dto.ts`
- Modify: `backend/src/modules/order/checkout.service.ts`（checkout / checkoutVipPackage / handlePaymentSuccess）

- [ ] **Step 1: DTO 加 buyerNote**

```ts
// checkout.dto.ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CheckoutDto {
  // ... existing fields ...

  @IsOptional()
  @IsString()
  @MaxLength(200)
  buyerNote?: string;
}
```

VipCheckoutDto 同样加。

- [ ] **Step 2: checkout() 创建 Session 时落库**

定位 `checkout.service.ts` 内 `prisma.checkoutSession.create({ data: { ... } })`，加 `buyerNote: dto.buyerNote || null`。

`checkoutVipPackage()` 同样加。

- [ ] **Step 3: handlePaymentSuccess 透传**

定位 `checkout.service.ts:1186` `tx.order.create({ data: { ... } })`，加 `buyerNote: session.buyerNote`。

- [ ] **Step 4: 编译 + Commit**

```bash
cd backend && npx tsc --noEmit && cd ..
git add backend/src/modules/order/checkout.dto.ts backend/src/modules/order/checkout.service.ts
git commit -m "feat(backend/order): checkout 透传 buyerNote 到 Session 和 Order"
```

---

### Task 30: 详情 DTO 暴露 buyerNote + mapOrderDetail

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`（mapOrderDetail）

- [ ] **Step 1: 输出对象加字段**

```ts
buyerNote: order.buyerNote ?? null,
```

- [ ] **Step 2: 编译 + Commit**

```bash
cd backend && npx tsc --noEmit && cd ..
git add backend/src/modules/order/order.service.ts
git commit -m "feat(backend/order): mapOrderDetail 暴露 buyerNote"
```

---

### Task 31: 结算页加买家留言输入框

**Files:**
- Modify: `app/checkout.tsx`

- [ ] **Step 1: 加输入框**

在 checkout.tsx 表单区找一个合适位置（地址下方、商品列表上方）加：

```tsx
const [buyerNote, setBuyerNote] = useState('');
// ...
<View style={{ padding: 12, backgroundColor: colors.surface, marginTop: 8 }}>
  <Text style={[typography.caption, { color: colors.text.secondary, marginBottom: 6 }]}>买家留言（非必填，给商家的话）</Text>
  <TextInput
    value={buyerNote}
    onChangeText={(t) => setBuyerNote(t.slice(0, 200))}
    placeholder="例如：尽快发货 / 不要冰品"
    placeholderTextColor={colors.text.tertiary}
    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, color: colors.text.primary }}
    multiline
    maxLength={200}
  />
  <Text style={[typography.caption, { color: colors.text.tertiary, textAlign: 'right', marginTop: 4 }]}>{buyerNote.length}/200</Text>
</View>
```

- [ ] **Step 2: 提交订单时透传**

在 `OrderRepo.checkout` 调用处加上 `buyerNote: buyerNote.trim() || undefined`。

- [ ] **Step 3: 真机自测 + Commit**

下单填留言 → 付款成功 → 详情页 ⑥ 区块能看到留言行。

```bash
npx tsc -b
git add app/checkout.tsx
git commit -m "feat(app/checkout): 结算页加买家留言输入框（200 字限制）"
```

---

### Task 32: Phase 3 验收 + 文档同步

**Files:**
- Modify: `CLAUDE.md`
- Modify: `plan.md`

- [ ] **Step 1: CLAUDE.md 加文档引用**

在「相关文档 / 设计方案与实施计划 (`docs/superpowers/`)」段落加：

```md
- `docs/superpowers/specs/2026-05-01-order-pages-redesign-design.md` — 订单页面重做设计方案（列表/详情/物流/售后/横幅/续付页/防重锁，**订单链路 UX 升级权威来源**）
- `docs/superpowers/plans/2026-05-01-order-pages-redesign.md` — 订单页面重做实施计划（32 任务，3 Phase）
```

- [ ] **Step 2: plan.md 加 checkbox 段**

在 plan.md 末尾追加：

```md
## 订单页面重做（2026-05-01）
- [ ] Phase 1 · 前端重写 + 最小后端 DTO（13 任务）
- [ ] Phase 2 · 后端剩余 DTO + 防重锁 + 续付链路 + 横幅（14 任务）
- [ ] Phase 3 · buyerNote 字段 + 收尾（5 任务）
```

- [ ] **Step 3: Phase 3 真机回归**

- [ ] 结算页能填买家留言（200 字限制 + 计数显示）
- [ ] 留言显示在订单详情 ⑥ 信息块
- [ ] 留言为空时详情页该行不显示

- [ ] **Step 4: Commit + 推送（向用户确认）**

```bash
git add CLAUDE.md plan.md
git commit -m "docs(orders): 订单页面重做完成，更新 CLAUDE.md/plan.md 引用"
```

**重要**：完成后向用户复述所有 Phase 改动 + 询问是否 push。**禁止自动 push**（CLAUDE.md 强制规则）。

---

## 全局完成清单

- [ ] Phase 1（13 任务）全部 commit
- [ ] Phase 2（14 任务）全部 commit
- [ ] Phase 3（5 任务）全部 commit
- [ ] CLAUDE.md 更新
- [ ] plan.md 更新
- [ ] 总计 32 个任务，每个独立 commit，回滚粒度细
- [ ] 三 Phase 各走一个 PR（在 staging 分支测通后再合 main）

---

**作者**：Claude (主 Agent)
**计划状态**：草案，待用户启动执行
