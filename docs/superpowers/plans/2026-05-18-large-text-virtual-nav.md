# Large Text and Virtual Navigation Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the buyer App payment, shopping, order, and after-sale flows usable when users enable large text, large display size, Android virtual navigation, Android gesture navigation, or iOS Dynamic Type.

**Architecture:** Implement the approved design in focused batches. P0 removes the payment-success trap first. P1 applies dynamic bottom-bar measurement and page-specific large-text degradation to the shopping loop. P2 runs a whole-App audit and records every remaining hit as protected, needs-fix, or exempt.

**Tech Stack:** React Native 0.81, Expo 54, expo-router 6, TypeScript, React Query, Zustand, existing `src/theme/responsive.ts` helpers.

---

## File Structure

- Modify `app/payment-success.tsx`: P0 scrollability, safe Android back navigation, iOS swipe-back lock, compact success artwork, compact CTA text.
- Modify `src/components/orders/StickyCTABar.tsx`: report actual rendered height and use compact CTA text.
- Modify `app/checkout-pending.tsx`: reserve scroll bottom padding from measured `StickyCTABar` height.
- Modify `app/orders/[id].tsx`: reserve scroll bottom padding from measured `StickyCTABar` height.
- Create `src/hooks/useMeasuredBottomBar.ts`: small hook for custom bottom bars that are not `StickyCTABar`.
- Modify `app/cart.tsx`: dynamic checkout-bar padding, compact cart rows, compact total/CTA text.
- Modify `app/checkout.tsx`: dynamic submit-bar padding, compact submit bar, compact total/CTA text.
- Modify `app/product/[id].tsx`: dynamic CTA-bar padding, compact product action bar, compact button text.
- Modify `app/vip/gifts.tsx`: dynamic VIP bottom-bar padding and compact VIP CTA text.
- Modify `app/(tabs)/me.tsx`: large-text degradation for user card, order shortcuts, wallet/VIP cards, and tool grids.
- Modify `app/lottery.tsx`: audit result BottomSheet for reachable CTA and compact result visual/text if needed.
- Modify `docs/architecture/responsive-design.md`, `docs/issues/tofix-app-frontend.md`, `docs/architecture/frontend.md`, `docs/operations/app-发布与OTA手册.md`, and `plan.md`: record implementation status, audit commands, and release notes.

## Task 1: P0 Payment Success Escape Hatch

**Files:**
- Modify: `app/payment-success.tsx`

- [ ] **Step 1: Confirm the current trap before editing**

Run:

```bash
rg -n "onBack = \\(\\) => true|flex: 1|width: 200|height: 200|MaterialCommunityIcons name=\"check\"" app/payment-success.tsx
```

Expected: output includes `onBack = () => true`, the `flex: 1` spacer, and fixed `200` success circle sizing.

- [ ] **Step 2: Update imports**

Replace the import block at the top of `app/payment-success.tsx` with:

```tsx
import React from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../src/components/layout';
import { compactActionTextProps, priceTextProps, useResponsiveLayout, useTheme } from '../src/theme';
```

- [ ] **Step 3: Add responsive sizing constants**

Inside `PaymentSuccessScreen`, immediately after `const { colors, radius, shadow, spacing, typography, gradients } = useTheme();`, add:

```tsx
  const { height, isLargeText } = useResponsiveLayout();
  const compactResult = isLargeText || height < 700;
  const successCircleSize = compactResult ? 140 : 200;
  const successIconSize = compactResult ? 64 : 96;
  const topPadding = compactResult ? spacing.xl : spacing['3xl'];
  const checkMarginTop = compactResult ? spacing.lg : spacing['2xl'];
```

- [ ] **Step 4: Replace the Android back handler**

Replace the existing `useFocusEffect` block with:

```tsx
  const handleSystemBack = React.useCallback(() => {
    router.replace('/orders');
    return true;
  }, [router]);

  // Android: 成功页不能回 checkout，但也不能静默吞返回键。
  // 拦截后同步跳到安全页，避免用户卡死或重复支付。
  useFocusEffect(
    React.useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', handleSystemBack);
      return () => sub.remove();
    }, [handleSystemBack]),
  );
```

- [ ] **Step 5: Make the page scrollable and disable dangerous iOS swipe-back**

In the returned JSX, keep `<Screen contentStyle={{ flex: 1 }}>`, then replace the inner top-level `<View style={{ flex: 1, padding: spacing.xl, paddingTop: spacing['3xl'] }}>` wrapper with:

```tsx
      <Stack.Screen options={{ gestureEnabled: false }} />
      {/* 顶部不放 AppHeader（无返回按钮，防回 checkout），但内容必须可滚动。 */}
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            padding: spacing.xl,
            paddingTop: topPadding,
            paddingBottom: spacing['3xl'],
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
```

Replace the closing `</View>` just before `</Screen>` with `</ScrollView>`.

Delete this spacer completely:

```tsx
        {/* spacer that pushes buttons down */}
        <View style={{ flex: 1 }} />
```

- [ ] **Step 6: Use dynamic success artwork sizing**

Replace the success animation block style and icon size with:

```tsx
        <Animated.View
          entering={ZoomIn.duration(600)}
          style={[
            styles.checkWrap,
            {
              width: successCircleSize,
              height: successCircleSize,
              alignSelf: 'center',
              marginTop: checkMarginTop,
            },
          ]}
        >
          <LinearGradient
            colors={[colors.brand.primary, colors.ai.end]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.checkCircle,
              {
                width: successCircleSize,
                height: successCircleSize,
                borderRadius: successCircleSize / 2,
              },
              shadow.lg,
            ]}
          >
            <MaterialCommunityIcons name="check" size={successIconSize} color="#FFFFFF" />
          </LinearGradient>
        </Animated.View>
```

- [ ] **Step 7: Apply text helpers to amount and CTAs**

Change the amount text to:

```tsx
            <Text
              {...priceTextProps}
              style={[
                {
                  color: colors.brand.primary,
                  marginTop: spacing.xs,
                  fontSize: compactResult ? 28 : 32,
                  fontWeight: '700',
                  fontVariant: ['tabular-nums'],
                },
              ]}
            >
              ¥ {amountStr}
            </Text>
```

Change the primary button text to:

```tsx
              <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: '#FFFFFF' }]}>
                {primaryBtnText}
              </Text>
```

Change the secondary button text to:

```tsx
            <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.primary }]}>
              返回首页
            </Text>
```

- [ ] **Step 8: Update styles**

Replace the `checkWrap`, `checkCircle`, `primaryBtn`, and `secondaryBtn` styles with:

```tsx
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  checkWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtn: {
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
```

Keep `card`, `divider`, and `metaRow`.

- [ ] **Step 9: Verify P0 statically**

Run:

```bash
rg -n "onBack = \\(\\) => true|<View style=\\{\\{ flex: 1 \\}\\} />|width: 200|height: 200" app/payment-success.tsx
rg -n "gestureEnabled: false|router.replace\\('/orders'\\)" app/payment-success.tsx
npx tsc -b
```

Expected: first command has no output for the old trap patterns; second command shows both safe route and iOS gesture lock; `npx tsc -b` exits 0.

- [ ] **Step 10: Commit P0**

```bash
git add app/payment-success.tsx
git commit -m "fix(app): make payment success reachable in large text"
```

## Task 2: Measured Sticky CTA Bars

**Files:**
- Modify: `src/components/orders/StickyCTABar.tsx`
- Modify: `app/checkout-pending.tsx`
- Modify: `app/orders/[id].tsx`

- [ ] **Step 1: Add height reporting to StickyCTABar**

In `src/components/orders/StickyCTABar.tsx`, replace imports and props with:

```tsx
import React from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { compactActionTextProps, useBottomInset, useResponsiveLayout, useTheme } from '../../theme';

interface CTAItem {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

interface Props {
  primary?: CTAItem;
  secondary?: CTAItem[];
  onHeightChange?: (height: number) => void;
}
```

Replace the component body header with:

```tsx
export function StickyCTABar({ primary, secondary, onHeightChange }: Props) {
  const { colors, radius, typography } = useTheme();
  const { isCompact, isLargeText } = useResponsiveLayout();
  const compact = isCompact || isLargeText;
  const paddingBottom = useBottomInset(10);

  const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight > 0) onHeightChange?.(nextHeight);
  }, [onHeightChange]);
```

Add `onLayout={handleLayout}` and compact layout styles to the root `<View>`:

```tsx
    <View
      onLayout={handleLayout}
      style={[
        styles.bar,
        compact && styles.barCompact,
        { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom },
      ]}
    >
```

Apply compact text props to both CTA labels:

```tsx
          <Text {...compactActionTextProps} style={[typography.caption, { color: colors.text.secondary }]}>
            {cta.label}
          </Text>
```

```tsx
          <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>
            {primary.label}
          </Text>
```

Add compact styles:

```tsx
  barCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
```

Update `btn` and `btnPrimary` styles:

```tsx
  btn: { minHeight: 36, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { minHeight: 40, paddingHorizontal: 18, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
```

- [ ] **Step 2: Use measured height in checkout-pending**

In `app/checkout-pending.tsx`, change the React import to:

```tsx
import React, { useState } from 'react';
```

After `const confirmPayment = useConfirmPayment();`, add:

```tsx
  const [ctaBarHeight, setCtaBarHeight] = useState(96);
```

Replace:

```tsx
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
```

with:

```tsx
      <ScrollView contentContainerStyle={{ paddingBottom: ctaBarHeight + spacing.lg }}>
```

Pass the height callback:

```tsx
      <StickyCTABar
        onHeightChange={setCtaBarHeight}
        primary={{ label: `继续支付 ¥${pending.expectedTotal.toFixed(2)}`, onPress: handleResume }}
        secondary={[{ label: '取消订单', onPress: handleCancel }]}
      />
```

- [ ] **Step 3: Use measured height in order detail**

In `app/orders/[id].tsx`, delete the `safeBottom` constant and its adjacent comment.

Add this state after `const [repurchasing, setRepurchasing] = React.useState(false);`:

```tsx
  const [ctaBarHeight, setCtaBarHeight] = React.useState(96);
```

Replace:

```tsx
        contentContainerStyle={{ paddingBottom: 80 + safeBottom }}
```

with:

```tsx
        contentContainerStyle={{ paddingBottom: ctaBarHeight + spacing.lg }}
```

Replace the final CTA render with:

```tsx
      <StickyCTABar primary={primary} secondary={secondary} onHeightChange={setCtaBarHeight} />
```

Remove `useBottomInset` from the imports in this file if it is no longer used.

- [ ] **Step 4: Verify StickyCTABar batch**

Run:

```bash
rg -n "paddingBottom: 80|80 \\+ safeBottom|StickyCTABar" app/checkout-pending.tsx app/orders/[id].tsx src/components/orders/StickyCTABar.tsx
npx tsc -b
```

Expected: old fixed `80` padding is gone from these two pages; `StickyCTABar` usages include `onHeightChange`; TypeScript exits 0.

- [ ] **Step 5: Commit Sticky CTA batch**

```bash
git add src/components/orders/StickyCTABar.tsx app/checkout-pending.tsx app/orders/[id].tsx
git commit -m "fix(app): measure order sticky cta height"
```

## Task 3: Cart Large-Text Layout and Measured Checkout Bar

**Files:**
- Create: `src/hooks/useMeasuredBottomBar.ts`
- Modify: `app/cart.tsx`

- [ ] **Step 1: Create the bottom-bar measurement hook**

Create `src/hooks/useMeasuredBottomBar.ts`:

```tsx
import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/**
 * Measures a fixed bottom bar after first layout.
 * fallbackHeight is only the first-frame placeholder; onLayout self-corrects
 * to the actual rendered height before the user reaches the bottom content.
 */
export function useMeasuredBottomBar(fallbackHeight: number, extraSpacing: number) {
  const [barHeight, setBarHeight] = useState(fallbackHeight);

  const onBarLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight > 0) {
      setBarHeight((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));
    }
  }, []);

  return {
    barHeight,
    bottomPadding: barHeight + extraSpacing,
    onBarLayout,
  };
}
```

- [ ] **Step 2: Update cart imports**

In `app/cart.tsx`, change:

```tsx
import { useBottomInset, useTheme } from '../src/theme';
```

to:

```tsx
import { compactActionTextProps, fitTextProps, priceTextProps, useBottomInset, useResponsiveLayout, useTheme } from '../src/theme';
import { useMeasuredBottomBar } from '../src/hooks/useMeasuredBottomBar';
```

- [ ] **Step 3: Replace fixed scroll padding with measured padding**

Replace the two bottom padding constants:

```tsx
  const scrollBottomPad = useBottomInset(100);
  const barBottomPad = useBottomInset(spacing.sm);
```

with:

```tsx
  const { isCompact, isLargeText } = useResponsiveLayout();
  const compactRows = isCompact || isLargeText;
  const barBottomPad = useBottomInset(spacing.sm);
  const { bottomPadding: scrollBottomPad, onBarLayout: handleCheckoutBarLayout } =
    useMeasuredBottomBar(compactRows ? 148 : 112, spacing.lg);
```

- [ ] **Step 4: Make cart item rows degrade instead of squeezing**

In `renderItem`, change the card root style to include compact rows:

```tsx
              style={[
                styles.card,
                compactRows && styles.cardCompact,
                shadow.sm,
                {
                  backgroundColor: colors.surface,
                  borderRadius: radius.lg,
                  marginBottom: spacing.md,
                  opacity: isLocked || isUnavailable ? 0.5 : 1,
                },
              ]}
```

Change the image style to:

```tsx
                <Image
                  source={{ uri: item.image }}
                  style={[styles.cover, compactRows && styles.coverCompact, { borderRadius: radius.md }]}
                  contentFit="cover"
                />
```

Change the content wrapper to:

```tsx
              <View style={[styles.content, compactRows && styles.contentCompact]}>
```

Change the title text to:

```tsx
                <Text
                  {...fitTextProps}
                  style={[typography.bodyStrong, { color: colors.text.primary }]}
                  numberOfLines={compactRows ? 3 : 2}
                >
                  {item.title}
                </Text>
```

Change the quantity/delete row wrapper to:

```tsx
                <View style={[styles.metaRow, compactRows && styles.metaRowCompact]}>
```

- [ ] **Step 5: Measure the cart checkout bar and protect amount/CTA text**

Add `onLayout={handleCheckoutBarLayout}` to both the iOS `<BlurView>` checkout bar and the Android `<View>` checkout bar.

Change both total texts to:

```tsx
            <Text {...priceTextProps} style={[typography.title3, { color: colors.text.primary }]}>
              ¥{total.toFixed(2)}
            </Text>
```

Change both checkout button texts to:

```tsx
              <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                去结算({selCount})
              </Text>
```

- [ ] **Step 6: Add compact cart styles**

Add these styles in `StyleSheet.create`:

```tsx
  cardCompact: {
    alignItems: 'flex-start',
  },
  coverCompact: {
    width: 64,
    height: 64,
  },
  contentCompact: {
    minWidth: 0,
  },
  metaRowCompact: {
    alignItems: 'flex-start',
    gap: 8,
  },
```

Update `checkoutButton` style:

```tsx
  checkoutButton: {
    minHeight: 48,
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
```

- [ ] **Step 7: Verify cart batch**

Run:

```bash
rg -n "useMeasuredBottomBar|onLayout=\\{handleCheckoutBarLayout\\}|compactRows|priceTextProps|compactActionTextProps" app/cart.tsx src/hooks/useMeasuredBottomBar.ts
npx tsc -b
```

Expected: all new patterns are present and TypeScript exits 0.

- [ ] **Step 8: Commit cart batch**

```bash
git add src/hooks/useMeasuredBottomBar.ts app/cart.tsx
git commit -m "fix(app): adapt cart for large text bottom bars"
```

## Task 4: Checkout, Product, and VIP Bottom Bars

**Files:**
- Modify: `app/checkout.tsx`
- Modify: `app/product/[id].tsx`
- Modify: `app/vip/gifts.tsx`

- [ ] **Step 1: Apply measured bottom padding to checkout**

In `app/checkout.tsx`, add imports:

```tsx
import { useMeasuredBottomBar } from '../src/hooks/useMeasuredBottomBar';
import { compactActionTextProps, priceTextProps, useBottomInset, useResponsiveLayout, useTheme } from '../src/theme';
```

Replace the existing theme import so there is only one import from `../src/theme`.

Replace:

```tsx
  const scrollBottomPad = useBottomInset(100);
  const barBottomPad = useBottomInset(spacing.sm);
```

with:

```tsx
  const { isCompact, isLargeText } = useResponsiveLayout();
  const compactSubmitBar = isCompact || isLargeText;
  const barBottomPad = useBottomInset(spacing.sm);
  const { bottomPadding: scrollBottomPad, onBarLayout: handleBottomBarLayout } =
    useMeasuredBottomBar(compactSubmitBar ? 150 : 112, spacing.lg);
```

Add `onLayout={handleBottomBarLayout}` to both bottom submit bar roots. Add `compactSubmitBar && styles.bottomBarCompact` beside `styles.bottomBar`.

Change both amount texts to:

```tsx
              <Text
                {...priceTextProps}
                style={[typography.title3, { color: isVipMode ? '#C9A96E' : colors.text.primary }]}
              >
                {displayTotalText}
              </Text>
```

Change all submit CTA texts in the bottom bar to include `compactActionTextProps`.

Add:

```tsx
  bottomBarCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
```

Update:

```tsx
  submitButton: {
    minHeight: 48,
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
```

- [ ] **Step 2: Apply measured bottom padding to product detail**

In `app/product/[id].tsx`, replace:

```tsx
import { useTheme, useBottomInset } from '../../src/theme';
```

with:

```tsx
import { compactActionTextProps, useBottomInset, useResponsiveLayout, useTheme } from '../../src/theme';
import { useMeasuredBottomBar } from '../../src/hooks/useMeasuredBottomBar';
```

Replace:

```tsx
  const contentBottomPad = useBottomInset(120);
```

with:

```tsx
  const { isCompact, isLargeText } = useResponsiveLayout();
  const compactCtaBar = isCompact || isLargeText;
  const { bottomPadding: contentBottomPad, onBarLayout: handleCtaBarLayout } =
    useMeasuredBottomBar(compactCtaBar ? 148 : 112, spacing.xl);
```

Add `onLayout={handleCtaBarLayout}` to both `styles.ctaBar` roots and add `compactCtaBar && styles.ctaBarCompact`.

Change all CTA texts inside the bottom action bar to:

```tsx
            <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.brand.primary }]}>
              加入购物车
            </Text>
```

```tsx
              <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                ✦ 立即购买
              </Text>
```

Add:

```tsx
  ctaBarCompact: {
    flexDirection: 'column',
    gap: 10,
  },
```

- [ ] **Step 3: Apply measured bottom padding to VIP gifts**

In `app/vip/gifts.tsx`, add:

```tsx
import { useMeasuredBottomBar } from '../../src/hooks/useMeasuredBottomBar';
import { compactActionTextProps, priceTextProps, useBottomInset, useResponsiveLayout } from '../../src/theme';
```

Replace the existing theme import so `priceTextProps` is not imported twice.

Add after `const barBottomPad = useBottomInset(16);`:

```tsx
  const { isCompact, isLargeText } = useResponsiveLayout();
  const compactBottomBar = isCompact || isLargeText;
  const { bottomPadding: contentBottomPad, onBarLayout: handleBottomBarLayout } =
    useMeasuredBottomBar(compactBottomBar ? 156 : 124, 24);
```

Replace:

```tsx
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 + safeBottomBare }]}
```

with:

```tsx
        contentContainerStyle={[styles.scrollContent, { paddingBottom: contentBottomPad }]}
```

If `safeBottomBare` becomes unused, remove it.

Add `onLayout={handleBottomBarLayout}` and `compactBottomBar && styles.bottomBarCompact` to the root bottom bar.

Change bottom price and CTA texts to:

```tsx
            <Text {...priceTextProps} style={styles.bottomPrice}>¥{vipPrice}</Text>
```

```tsx
              <Text
                {...compactActionTextProps}
                style={[
                  styles.checkoutButtonText,
                  selectedIndex === null && styles.checkoutButtonTextDisabled,
                ]}
              >
                立即开通
              </Text>
```

Add:

```tsx
  bottomBarCompact: {
    paddingHorizontal: 16,
  },
  bottomBarContentCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
```

Apply `compactBottomBar && styles.bottomBarContentCompact` to `styles.bottomBarContent`.

- [ ] **Step 4: Verify checkout/product/VIP batch**

Run:

```bash
rg -n "useMeasuredBottomBar|onBarLayout|bottomBarCompact|ctaBarCompact|compactActionTextProps|priceTextProps" app/checkout.tsx app/product/[id].tsx app/vip/gifts.tsx
npx tsc -b
```

Expected: all three pages use measured bottom padding and compact text helpers; TypeScript exits 0.

- [ ] **Step 5: Commit checkout/product/VIP batch**

```bash
git add app/checkout.tsx app/product/[id].tsx app/vip/gifts.tsx
git commit -m "fix(app): measure shopping bottom bars for large text"
```

## Task 5: Me Page Large-Text Degradation

**Files:**
- Modify: `app/(tabs)/me.tsx`

- [ ] **Step 1: Add responsive helpers**

Change:

```tsx
import { useTheme, fitTextProps, priceTextProps } from '../../src/theme';
```

to:

```tsx
import { compactActionTextProps, fitTextProps, priceTextProps, useResponsiveLayout, useTheme } from '../../src/theme';
```

After `const { colors, radius, shadow, spacing, typography, gradients, isDark } = useTheme();`, add:

```tsx
  const { isCompact, isLargeText } = useResponsiveLayout();
  const compactMe = isCompact || isLargeText;
```

- [ ] **Step 2: Make login and profile cards wrap safely**

Apply compact styles:

```tsx
style={[
  styles.loginCard,
  compactMe && styles.loginCardCompact,
  { margin: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.lg },
  shadow.sm,
]}
```

```tsx
style={[styles.loginActions, compactMe && styles.loginActionsCompact]}
```

```tsx
style={[styles.userCardTop, compactMe && styles.userCardTopCompact]}
```

```tsx
style={[styles.nameRow, compactMe && styles.nameRowCompact]}
```

Apply `fitTextProps` to `greeting` and `profile.name`. Apply `compactActionTextProps` to `扫一扫`, `编辑`, `立即登录/注册`, and `推荐码` chip text.

- [ ] **Step 3: Make order shortcuts wrap instead of becoming vertical text**

Change the order row style to:

```tsx
            <View
              style={[
                styles.orderRow,
                compactMe && styles.orderRowCompact,
                { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
                shadow.sm,
              ]}
            >
```

Change each order item style to:

```tsx
                    style={[styles.orderItem, compactMe && styles.orderItemCompact]}
```

Apply `compactActionTextProps` to each order shortcut label and the pending payment label.

- [ ] **Step 4: Stack wallet/VIP cards on large text**

Change:

```tsx
          <View style={[styles.dualCards, { marginBottom: spacing.lg }]}>
```

to:

```tsx
          <View style={[styles.dualCards, compactMe && styles.dualCardsCompact, { marginBottom: spacing.lg }]}>
```

Change wallet card style to:

```tsx
              style={[styles.dualCardItem, compactMe ? styles.dualCardItemStacked : { marginRight: spacing.sm }]}
```

Change VIP card style to:

```tsx
              style={[styles.dualCardItem, compactMe ? styles.dualCardItemStacked : { marginLeft: spacing.sm }]}
```

Apply `compactActionTextProps` to `去提现`, `查看权益`, and VIP benefit lines.

- [ ] **Step 5: Add compact Me styles**

Add:

```tsx
  loginCardCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
  },
  loginActionsCompact: {
    alignSelf: 'stretch',
    justifyContent: 'space-between',
  },
  userCardTopCompact: {
    alignItems: 'flex-start',
  },
  nameRowCompact: {
    flexWrap: 'wrap',
    gap: 6,
  },
  orderRowCompact: {
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    rowGap: 12,
  },
  orderItemCompact: {
    width: '33.333%',
    flex: 0,
    minHeight: 68,
  },
  dualCardsCompact: {
    flexDirection: 'column',
    gap: 12,
  },
  dualCardItemStacked: {
    flex: 0,
    marginLeft: 0,
    marginRight: 0,
  },
```

- [ ] **Step 6: Verify Me page batch**

Run:

```bash
rg -n "compactMe|orderRowCompact|dualCardsCompact|compactActionTextProps|useResponsiveLayout" 'app/(tabs)/me.tsx'
npx tsc -b
```

Expected: compact branches are present and TypeScript exits 0.

- [ ] **Step 7: Commit Me page batch**

```bash
git add 'app/(tabs)/me.tsx'
git commit -m "fix(app): adapt me page for large text"
```

## Task 6: P0 Result Surface Audit and P2 Classification

**Files:**
- Modify if needed: `app/lottery.tsx`
- Modify: `docs/issues/tofix-app-frontend.md`
- Modify: `docs/architecture/responsive-design.md`

- [ ] **Step 1: Run result/back-handler audit commands**

Run:

```bash
rg -n "BackHandler\\.addEventListener|hardwareBackPress" app src
rg -nU "BackHandler\\.addEventListener[\\s\\S]{0,300}(=>\\s*true|return true)" app src
rg -n "const\\s+\\w*Back\\w*\\s*=\\s*\\([^)]*\\)\\s*=>\\s*true|const\\s+\\w*Back\\w*\\s*=\\s*function" app src
rg -n "gestureEnabled" app src
rg -n "AppBottomSheet|支付成功|成功|完成|已提交|开奖|中奖" app src
```

Expected: the first command defines the BackHandler review set; the two focused swallow commands catch direct and alias-style traps without classifying unrelated predicates across the whole App. Every BackHandler hit is manually classified as protected, needs-fix, or exempt.

- [ ] **Step 2: Fix lottery result surface if it is not reachable in large text**

If `app/lottery.tsx` result `AppBottomSheet` uses a non-scrollable result body or oversized result visual, change the result sheet body to use compact sizes. The compact values must follow this shape:

Add these imports if they are not already present:

```tsx
import { compactActionTextProps, fitTextProps, useResponsiveLayout } from '../src/theme';
```

```tsx
const { isCompact, isLargeText, height } = useResponsiveLayout();
const compactLotteryResult = isCompact || isLargeText || height < 700;
const resultIconSize = compactLotteryResult ? 48 : 64;
const resultTitleLines = compactLotteryResult ? 2 : 1;
```

Result title text must use:

```tsx
<Text {...fitTextProps} numberOfLines={resultTitleLines}>
```

Result CTA text must use:

```tsx
<Text {...compactActionTextProps}>
```

- [ ] **Step 3: Record the P2 audit table**

Append a dated audit note to `docs/issues/tofix-app-frontend.md` under the responsive section. Use one row per command and record the hit count plus classification details from the command output:

```markdown
#### 2026-05-18 P2 audit classification

| Command | Hits | Protected | Needs fix | Exempt | Classification note |
|---------|------|-----------|-----------|--------|---------------------|
```

Also re-review every file in `docs/architecture/responsive-design.md` §6.1 "干净文件" against the §5 grep blacklist and the §4 10-scenario matrix. Any file that now matches a high-risk pattern or is covered by the new result-page / bottom-bar / fixed-row rules must be removed from the clean list and appended to the §6.3 progress table or the R-RS-LF backlog with a concrete reason.

- [ ] **Step 4: Verify P2 audit docs**

Run:

```bash
npx tsc -b
git diff --check -- docs/issues/tofix-app-frontend.md docs/architecture/responsive-design.md
```

Expected: TypeScript exits 0 and the docs diff has no whitespace errors. Manually confirm the audit table contains actual rows from the command outputs.

- [ ] **Step 5: Commit audit batch**

```bash
git add app/lottery.tsx docs/issues/tofix-app-frontend.md docs/architecture/responsive-design.md
git commit -m "fix(app): classify large text result surfaces"
```

If `app/lottery.tsx` did not need code changes, omit it from `git add` and use:

```bash
git add docs/issues/tofix-app-frontend.md docs/architecture/responsive-design.md
git commit -m "docs(app): classify large text result surfaces"
```

## Task 7: Documentation, Full Verification, and Release Prep

**Files:**
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/responsive-design.md`
- Modify: `docs/issues/tofix-app-frontend.md`
- Modify: `docs/operations/app-发布与OTA手册.md`
- Modify: `plan.md`

- [ ] **Step 1: Update implementation status docs**

In `docs/architecture/responsive-design.md`, mark P0/P1 implemented with the exact page list:

```markdown
### 2026-05-18 二轮适配执行状态

- P0 支付成功页：已修复滚动可达、Android 安全返回、iOS 危险左滑、成功图标降级、金额/CTA 紧凑文本。
- P1 底部固定栏：购物车、结算页、商品详情、VIP 礼包、未完成订单、订单详情已改为实际 bar 高度测量或 `StickyCTABar` 高度回传。
- P1 我的页：用户卡片、订单快捷入口、钱包/VIP 双卡已按大字体切换为换行/堆叠布局。
- P2 审计：见 `docs/issues/tofix-app-frontend.md` 的 2026-05-18 P2 audit classification。
```

In `docs/architecture/frontend.md`, add a concise App responsive note:

```markdown
#### 大字体 / 虚拟导航二轮适配（2026-05-18）

- 支付成功页已具备滚动逃生、Android 安全返回和 iOS 危险手势禁用。
- 购物车、结算、商品详情、VIP 礼包、订单详情等底部固定栏页面使用实际 bar 高度预留内容底部空间。
- 我的页高频横排区域在大字体 / 紧凑屏下改为换行或堆叠。
```

In `plan.md`, add or check one sprint item:

```markdown
- [x] 买家 App 大字体 / Android 虚拟导航 / iOS Dynamic Type 二轮适配：P0 支付成功逃生 + P1 购物闭环高频页。
```

- [ ] **Step 2: Run full static verification**

Run:

```bash
npx tsc -b
rg -n "BackHandler\\.addEventListener|hardwareBackPress" app src
rg -nU "BackHandler\\.addEventListener[\\s\\S]{0,300}(=>\\s*true|return true)" app src
rg -n "const\\s+\\w*Back\\w*\\s*=\\s*\\([^)]*\\)\\s*=>\\s*true|const\\s+\\w*Back\\w*\\s*=\\s*function" app src
rg -n "gestureEnabled" app src
rg -n -B1 -A8 "position: 'absolute'" app src | rg -B3 -A8 "bottom: 0"
git diff --check
```

Expected: TypeScript exits 0; BackHandler and bottom-bar audit hits are manually classified; `git diff --check` exits 0.

- [ ] **Step 3: Run App bundle smoke checks**

Run:

```bash
npx expo-doctor
npx expo export --platform android --output-dir /tmp/aimaimai-large-text-export
```

Expected: `expo-doctor` exits 0 or reports only documented non-blocking warnings; Android export exits 0 and proves the native-App bundle can be generated. Delete `/tmp/aimaimai-large-text-export` after checking if disk space matters.

- [ ] **Step 4: Run real-device matrix checkpoint**

Run the spec §P1 validation matrix before marking P1 complete:

```markdown
| Scenario | Device / OS | Result | Notes |
|----------|-------------|--------|-------|
| Android default text and display size |  |  |  |
| Android large font |  |  |  |
| Android large display size |  |  |  |
| Android large font plus large display size |  |  |  |
| Android virtual three-button navigation |  |  |  |
| Android gesture navigation |  |  |  |
| iOS default Dynamic Type |  |  |  |
| iOS enlarged Dynamic Type |  |  |  |
| Small-screen payment success/result-page flow |  |  |  |
| Shopping loop: Me -> cart -> checkout -> payment success -> order detail -> after-sale entry |  |  |  |
```

Expected: every row has a concrete pass/fail result. Record the matrix summary in `docs/operations/app-发布与OTA手册.md` section 6 for the same batch before OTA.

- [ ] **Step 5: Update OTA manual section 6 only if an EAS update is published**

If the user explicitly asks for OTA, append a new 2026-05-18 entry to `docs/operations/app-发布与OTA手册.md` section 6 with:

```markdown
### 2026-05-18 大字体 / 虚拟导航二轮适配 OTA

- 分支：`staging`
- 内容：支付成功页逃生、底部固定栏真实高度测量、购物闭环大字体适配、P2 响应式审计。
- OTA 命令：`EXPO_PUBLIC_ALIPAY_SANDBOX=true eas update --branch preview --message "大字体/虚拟导航二轮适配：支付成功逃生 + 购物闭环"`
- 验证：`npx tsc -b`、`npx expo-doctor`、`npx expo export --platform android --output-dir /tmp/aimaimai-large-text-export`、响应式审计命令、spec §P1 真机矩阵。
- 回滚：使用本次代码提交 SHA 执行 `git revert`，重新推送，并使用上一稳定 EAS update group 回退。
```

- [ ] **Step 6: Commit final docs**

```bash
git add docs/architecture/frontend.md docs/architecture/responsive-design.md docs/issues/tofix-app-frontend.md docs/operations/app-发布与OTA手册.md plan.md
git commit -m "docs(app): record large text adaptation rollout"
```

If no OTA was published, omit `docs/operations/app-发布与OTA手册.md` from the commit unless it changed for checklist wording.

## Rollback Notes

- P0 rollback: revert the P0 payment-success commit. If this was already OTA'd, republish the previous stable EAS update group.
- P1 rollback: revert the specific page batch commit. The measurement hook can remain if still referenced by other committed batches; if reverting the last user, remove `src/hooks/useMeasuredBottomBar.ts`.
- No database migration is involved. These are JS/TS layout and navigation changes only.

## Execution Order

1. Task 1 first because it fixes the payment-flow trap.
2. Task 2 second because order pages share `StickyCTABar`.
3. Task 3 and Task 4 can be separate commits; they touch different pages but both depend on the measurement hook from Task 3.
4. Task 5 is independent of bottom-bar measurement.
5. Task 6 and Task 7 close audit, docs, and release readiness.
