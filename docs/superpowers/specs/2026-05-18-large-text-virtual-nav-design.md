# Large Text and Virtual Navigation Adaptation Design

> **Date:** 2026-05-18
> **Status:** Approved design, pending implementation plan
> **Authority:** This spec extends `docs/architecture/responsive-design.md` for the 2026-05-18 second-pass App adaptation work.

## Goal

Make the buyer App usable for older users and accessibility users across large-font, large-display, Android virtual navigation, Android gesture navigation, and iOS Dynamic Type scenarios.

The immediate objective is not visual perfection across every screen. The first objective is that payment, shopping, order, and after-sale flows remain readable, scrollable, tappable, and recoverable.

## Background

Real-device testing found that the current App still breaks under large text:

- The payment success page can hide the "查看订单 / 返回首页" buttons below the screen. The page cannot scroll, and Android back is swallowed, so the user feels trapped.
- The Me page can compress profile text, order shortcuts, and wallet/VIP cards until text wraps vertically or clips.
- The cart page can become cramped because product rows and the bottom checkout bar assume a fixed horizontal layout and fixed bottom clearance.

This is not a Huawei-only issue. Android brands commonly provide large font and display-size modes, and different devices use virtual three-button navigation or gesture navigation. iOS Dynamic Type creates similar pressure.

## Design Decision

Use a staged, pattern-based remediation.

We will not immediately create a large abstraction layer for all typography and bottom bars. Instead, we will define reusable layout patterns and apply them to high-risk pages first. If the same implementation repeats across several pages, the later P2 pass may extract focused helpers or layout components.

## Scope

### P0: Result Page Escape Hatch

Primary target:

- `app/payment-success.tsx`

Related audit target:

- Any result page, payment result page, submit success page, auth result page, or lottery result surface that hides the normal header/back affordance.

Requirements:

- Result pages must use a scrollable container or another layout that guarantees all CTA buttons are reachable on small screens with large text.
- Large success artwork must shrink with explicit thresholds. For `payment-success.tsx`, use `const compactResult = isLargeText || height < 700`, with a 140 dp success circle in compact mode and 200 dp otherwise. The check icon should scale with the circle, for example 64 dp in compact mode and 96 dp otherwise.
- Amount text must use `priceTextProps`.
- CTA text must use `compactActionTextProps`.
- Android `BackHandler` must not silently return `true` and trap the user. Because payment success is entered with `router.replace` to prevent returning to checkout, it is also unsafe to simply return `false`. The allowed pattern is `return true` only after synchronously navigating to a safe page such as `/orders` or `/(tabs)/home`.
- iOS swipe-back must be disabled on payment/result pages that would otherwise return to checkout or another repeat-action page. Use `Stack.Screen options={{ gestureEnabled: false }}` or the equivalent expo-router screen configuration for the route.

Known result-page candidates:

- `app/payment-success.tsx`: P0 implementation target. Must fix scrollability, Android back handling, iOS swipe-back, success circle sizing, and CTA text.
- `app/lottery.tsx`: P0 audit target for the result `AppBottomSheet`. It does not need the same navigation lock as payment success, but the result content and CTA must remain reachable in large-font mode.
- `app/checkout-pending.tsx`: P1 bottom-fixed-bar target, not a P0 result page. It has a header and StickyCTABar; focus is dynamic bottom padding and CTA readability.
- `app/orders/after-sale-detail/[id].tsx`: P1 after-sale flow target, not a no-back-header P0 result page. It has `AppHeader` and a scroll container; focus is large-font row wrapping and bottom/action reachability.

### P1: High-Frequency Shopping Loop

Targets:

- `app/(tabs)/me.tsx`
- `app/cart.tsx`
- `app/checkout.tsx`
- `app/product/[id].tsx`
- `app/vip/gifts.tsx`
- `app/checkout-coupon.tsx`
- `app/orders/index.tsx`
- `app/orders/[id].tsx`
- `app/orders/after-sale/index.tsx`
- `app/orders/after-sale/[id].tsx`
- `app/orders/after-sale-detail/[id].tsx`
- Shared order bottom CTA components, especially `src/components/orders/StickyCTABar.tsx`

Requirements:

- Payment, order, and form pages prioritize readability.
- Marketing cards and decorative areas prioritize avoiding deformation.
- Bottom fixed bars must use `useBottomInset()`.
- Scroll content beneath bottom fixed bars must reserve enough bottom padding for the actual bar height plus inset.
- For shared bottom bars such as `StickyCTABar`, do not rely only on hard-coded estimates like `80 + safeBottom`. The preferred pattern is dynamic measurement: the bar exposes its rendered height via `onLayout` / callback, the page stores that height in state, and the `ScrollView` / `FlatList` `contentContainerStyle.paddingBottom` uses `measuredBarHeight + extraSpacing`. A conservative initial fallback is allowed before the first layout event.
- Fixed horizontal cards must degrade to wrap or single-column layouts when `isLargeText || isCompact`.
- Product rows, order item rows, and cart item rows must keep primary text readable and prevent price/quantity controls from being pushed off-screen.

### P2: Whole-App Audit

Targets:

- All `app/` pages
- Shared components under `src/components/`

Requirements:

- Run the audit commands listed in `docs/architecture/responsive-design.md`.
- Classify every hit as protected, needs fix, or explicitly exempt.
- Add newly discovered issues to `docs/issues/tofix-app-frontend.md` or the responsive design progress table.
- Extract shared helpers only after repeated implementation patterns are proven.
- Re-review every file previously listed as "clean" in the 2026-05-04 responsive audit. That historical clean list is not accepted as evidence for P2 completion after the `payment-success.tsx` miss.
- P2 is limited to `docs/architecture/responsive-design.md` sections 1-8: geometry, text scaling, bottom safe area, result-page reachability, and navigation traps. The adjacent R-UX issues in section 9 remain separate backlog unless they directly block these checks.

## Page Pattern Rules

### Result Pages

Use this rule for payment success, submit success, and any page where the normal back affordance is hidden.

- Top-level content should be scrollable with `contentContainerStyle.flexGrow = 1`.
- Do not use a `flex: 1` spacer to force CTAs to the bottom.
- Use `marginTop`, `gap`, or a content wrapper to create breathing room.
- Visual symbols and illustrations must have compact sizes for large text or short screens.
- A blocked Android back gesture must perform safe navigation, not silent suppression. A `return true` handler is allowed only when it first routes to a safe destination.
- A blocked iOS swipe gesture must be explicitly disabled for routes that protect payment, checkout, or another repeat-action flow.

### Bottom Fixed Bar Pages

Use this rule for cart, checkout, product detail, VIP gifts, order detail, and after-sale pages.

- Bottom bars must apply `useBottomInset(extra)`.
- Scrollable content must reserve bottom padding equal to the bottom bar's possible large-text height plus bottom inset.
- Shared bars should be measured with `onLayout` and report actual height to the screen. Screens should use the reported height for bottom padding instead of guessing the bar height from font size and padding constants.
- Button labels use `compactActionTextProps`.
- Price and order-number text uses `priceTextProps`.
- Large-font mode may stack the summary and CTA vertically if horizontal space is unsafe.

### Horizontal Card and Row Pages

Use this rule for profile cards, order shortcuts, wallet/VIP cards, cart rows, and order item rows.

- `flexDirection: 'row'` with multiple text nodes must be reviewed.
- When `isLargeText || isCompact`, cards should wrap, reduce image size, or switch to a single-column layout.
- Product title, merchant name, and list-row headings should use `fitTextProps` or explicit `numberOfLines` with a clear ellipsis mode.
- Body text should remain accessible and should not globally disable font scaling.

### Text Semantics

Use the existing responsive helpers according to text purpose:

- `priceTextProps`: prices, order numbers, badge counts, compact numeric values.
- `fitTextProps`: headings, product names, merchant names, list item titles.
- `compactActionTextProps`: buttons, chips, tabs, compact CTAs.
- Default text scaling: body copy, policies, customer service messages, and explanatory text.

## Validation

### P0 Validation

P0 can ship after:

- TypeScript and export checks pass.
- The payment success screen is manually reviewed in compact dimensions.
- Android back behavior is verified from code and, where possible, on a device.
- The OTA message explicitly identifies the result-page escape fix.

P0 is allowed to ship before the full matrix because it fixes a payment-flow trap.

### P1 Validation

P1 must run the real-device matrix before being called complete:

- Android default text and display size.
- Android large font.
- Android large display size.
- Android large font plus large display size.
- Android virtual three-button navigation.
- Android gesture navigation.
- iOS default Dynamic Type.
- iOS enlarged Dynamic Type.
- Small-screen payment success/result-page flow.
- Shopping loop: Me -> cart -> checkout -> payment success -> order detail -> after-sale entry.

### P2 Validation

P2 is complete only after:

- All audit command hits are classified.
- No unreviewed `BackHandler` use remains.
- No silent `BackHandler` swallow remains. Any `hardwareBackPress` handler returning `true` must either close a visible modal/sheet or navigate to a safe page before returning.
- No unreviewed bottom fixed bar remains.
- No high-risk result page remains without an escape path.
- Every 2026-05-04 "clean" file has been re-reviewed against the 10-scenario matrix or explicitly marked exempt with rationale.
- Documentation reflects any newly added helper or exemption.

## Release and Rollback

Use separate commits:

1. P0 result page fix.
2. P1 Me/cart/checkout/product/VIP/order pages, split further if needed.
3. P2 audit-only and follow-up fixes.

Each App code batch should be eligible for EAS OTA because these changes are React Native JS/TS layout changes and should not require native rebuild unless a native configuration file changes.

Rollback path:

- Revert the specific commit.
- Push the revert.
- Republish the previous stable EAS update group if the bad change was already OTA'd.

## Documentation Updates

Implementation must keep these files in sync:

- `docs/architecture/responsive-design.md`
- `docs/issues/tofix-app-frontend.md`
- `docs/architecture/frontend.md`
- `docs/operations/app-发布与OTA手册.md`
- `plan.md`
- `docs/operations/app-发布与OTA手册.md` section 6 after every EAS update

## Out of Scope

- Full App-wide component abstraction before P0/P1.
- Native rebuild work, unless later implementation changes native config.
- Dark mode coverage.
- General design refresh unrelated to large text and virtual navigation.
- Reworking business logic, payments, inventory, rewards, or after-sale state machines.
