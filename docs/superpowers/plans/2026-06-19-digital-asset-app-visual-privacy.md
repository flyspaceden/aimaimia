# Digital Asset App Visual Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the buyer App digital asset page with the approved C v2 agricultural-tech visual direction while hiding all front-end asset acquisition rules.

**Architecture:** Keep the existing `/me/digital-assets` page and `DigitalAssetRepo.getSummary()` API. Refactor page-only presentation helpers so the App renders balances and recent ledgers, but no longer reads `currentCreditTier`, `nextCreditTier`, or `vipSeedRules` for visible rule cards. Ledger rows receive a deterministic tone from `subjectType`, `sourceType`, and `direction`.

**Tech Stack:** React Native 0.81 + Expo 54, expo-router, React Query, `expo-linear-gradient`, `@expo/vector-icons/MaterialCommunityIcons`, existing theme utilities and Node `node:test` static UI tests.

## Global Constraints

- Scope is buyer App `/me/digital-assets`; do not modify admin rules configuration pages.
- Do not change backend digital asset calculation, VIP package seed asset configuration, consumption asset multiplier configuration, refund reversal logic, or API shapes.
- App `/me/digital-assets` must not display acquisition rules, multipliers, tiers, package-to-asset values, long-term modules, or an asset explanation section.
- App `/me/digital-assets` must continue to display digital asset total, seed asset, consumption asset, cumulative spend amount, and recent ledger rows.
- Non-VIP users do not have digital assets; they may see cumulative spend and a VIP activation CTA, but no seed/consumption balances.
- Recent ledgers must use fixed type colors: seed asset `#1F8A5F`, consumption asset `#267B93`, cumulative spend `#A87918`, debit/refund `#B65347`, admin adjustment `#6E7B72`.
- Color cannot be the only type signal; row icon and visible title must remain.
- All App UI text must avoid `信用资产`; use `消费资产`.
- Preserve existing responsive tools: `useResponsiveLayout`, `useBottomInset`, `priceTextProps`, `fitTextProps`, `compactActionTextProps`.

---

## File Structure

- Modify `scripts/__tests__/digital-assets-ui.test.mjs`: expand static tests so rule-leaking strings cannot return and C v2 required labels remain.
- Modify `app/me/digital-assets.tsx`: page-only visual refactor, remove rule sections, add C v2 hero card, add ledger tone helpers, update non-VIP hero, update empty and footer copy.
- Modify `docs/architecture/frontend.md`: update the Digital Asset Center row to document C v2 and hidden-rule front-end boundary.
- Modify `plan.md`: add a completed frontend item after implementation.
- Modify `docs/operations/app-发布与OTA手册.md`: only if a production OTA is sent; record the new runtime 1.0.4 OTA group and verification.

---

### Task 1: Lock Front-End Rule Hiding With Static Tests

**Files:**
- Modify: `scripts/__tests__/digital-assets-ui.test.mjs`

**Interfaces:**
- Consumes: existing `read(path)` helper.
- Produces: static tests that fail until `/me/digital-assets` removes rule and placeholder copy.

- [ ] **Step 1: Replace the current test file with expanded assertions**

Use this complete file content:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('digital asset page does not expose unfinished long-term modules', () => {
  const page = read('app/me/digital-assets.tsx');

  assert.doesNotMatch(page, /PENDING_MODULES/);
  assert.doesNotMatch(page, /长期模块/);
  assert.doesNotMatch(page, /未来权益模块/);
  assert.doesNotMatch(page, /权益规则待开放/);
});

test('digital asset page does not expose front-end acquisition rules', () => {
  const page = read('app/me/digital-assets.tsx');

  [
    /消费资产规则/,
    /VIP 种子资产规则/,
    /当前档位/,
    /下一档/,
    /当前套餐规则/,
    /暂无档位规则/,
    /规则待开放/,
    /规则待配置/,
    /暂无可展示的套餐规则/,
    /按套餐配置/,
    /按规则转化/,
    /currentCreditTier\?\.multiplier/,
    /nextCreditTier\?\.multiplier/,
    /buildTierProgress/,
    /renderVipSeedRule/,
  ].forEach((pattern) => assert.doesNotMatch(page, pattern));
});

test('digital asset page keeps result-only asset surface', () => {
  const page = read('app/me/digital-assets.tsx');

  [
    /数字资产总额/,
    /种子资产/,
    /消费资产/,
    /累计消费金额/,
    /最近资产流水/,
    /查看全部/,
    /开通 VIP 激活数字资产/,
  ].forEach((pattern) => assert.match(page, pattern));
});

test('digital asset page defines restrained ledger type colors', () => {
  const page = read('app/me/digital-assets.tsx');

  [
    /#1F8A5F/,
    /#267B93/,
    /#A87918/,
    /#B65347/,
    /#6E7B72/,
    /getLedgerTone/,
  ].forEach((pattern) => assert.match(page, pattern));
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
node --test scripts/__tests__/digital-assets-ui.test.mjs
```

Expected: FAIL. The failure should mention at least one current forbidden string such as `消费资产规则`, `VIP 种子资产规则`, `buildTierProgress`, or missing `最近资产流水`.

- [ ] **Step 3: Commit the failing test**

```bash
git add scripts/__tests__/digital-assets-ui.test.mjs
git commit -m "test(app): lock digital asset page rule privacy"
```

---

### Task 2: Refactor Digital Asset Page Helpers For Result-Only UI

**Files:**
- Modify: `app/me/digital-assets.tsx`

**Interfaces:**
- Consumes: `DigitalAssetLedger` from `src/types`.
- Produces: `getLedgerTone(item: DigitalAssetLedger): LedgerTone`, `getLedgerIcon(item: DigitalAssetLedger): keyof typeof MaterialCommunityIcons.glyphMap`, and `ASSET_VISUAL` constants used by Task 3 and Task 4.

- [ ] **Step 1: Remove unused rule types from imports**

Change this import:

```ts
import type {
  DigitalAssetCreditTierInfo,
  DigitalAssetLedger,
  DigitalAssetVipSeedRule,
} from '../../src/types';
```

to:

```ts
import type { DigitalAssetLedger } from '../../src/types';
```

- [ ] **Step 2: Replace the non-VIP activation prompt**

Replace:

```ts
const NON_VIP_ACTIVATION_PROMPT = {
  title: '让每一次消费，都成为你的数字资产基础',
  description: '成为 VIP 后，累计消费可按规则转化为消费资产。',
  actionLabel: '开通 VIP 激活资产',
} as const;
```

with:

```ts
const NON_VIP_ACTIVATION_PROMPT = {
  title: '开通 VIP 激活数字资产',
  actionLabel: '开通 VIP 激活资产',
} as const;
```

- [ ] **Step 3: Add the C v2 visual constants below the prompt**

Insert:

```ts
type LedgerTone = 'seed' | 'consumption' | 'spend' | 'refund' | 'adjustment';

const ASSET_VISUAL = {
  heroGradient: ['#15364B', '#116150', '#C2A03E'] as const,
  nonVipGradient: ['#15364B', '#116150'] as const,
  heroBorder: 'rgba(255,255,255,0.18)',
  heroLine: 'rgba(255,255,255,0.34)',
  heroTile: 'rgba(255,255,255,0.10)',
  heroTileBorder: 'rgba(255,255,255,0.18)',
  screenWash: '#EEF6F1',
  tones: {
    seed: {
      color: '#1F8A5F',
      bg: '#DFF1E6',
      border: 'rgba(31,138,95,0.28)',
      icon: 'sprout-outline',
      badge: '种',
    },
    consumption: {
      color: '#267B93',
      bg: '#DFF1F3',
      border: 'rgba(38,123,147,0.28)',
      icon: 'chart-line',
      badge: '消',
    },
    spend: {
      color: '#A87918',
      bg: '#F3ECD8',
      border: 'rgba(168,121,24,0.26)',
      icon: 'shopping-outline',
      badge: '单',
    },
    refund: {
      color: '#B65347',
      bg: '#F7E3DF',
      border: 'rgba(182,83,71,0.28)',
      icon: 'cash-refund',
      badge: '扣',
    },
    adjustment: {
      color: '#6E7B72',
      bg: '#E7ECE8',
      border: 'rgba(110,123,114,0.28)',
      icon: 'tune-variant',
      badge: '调',
    },
  },
} as const;
```

- [ ] **Step 4: Replace `getLedgerIcon` and delete tier helpers**

Delete the current `getLedgerIcon` function and `buildTierProgress` function. Add:

```ts
const getLedgerTone = (item: DigitalAssetLedger): LedgerTone => {
  if (item.direction === 'DEBIT' || item.sourceType === 'REFUND_REVERSAL') return 'refund';
  if (item.sourceType === 'ADMIN_ADJUSTMENT') return 'adjustment';
  if (item.subjectType === 'SEED_ASSET') return 'seed';
  if (item.subjectType === 'CREDIT_ASSET') return 'consumption';
  return 'spend';
};

const getLedgerVisual = (item: DigitalAssetLedger) => ASSET_VISUAL.tones[getLedgerTone(item)];
```

- [ ] **Step 5: Remove now-unused derived state from the component**

Delete:

```ts
const hasCreditTierRules = Boolean(summary?.currentCreditTier);

const tierProgress = useMemo(
  () => buildTierProgress(summary?.currentCreditTier, summary?.nextCreditTier),
  [summary?.currentCreditTier, summary?.nextCreditTier],
);
```

- [ ] **Step 6: Run the focused test and confirm it still fails on required UI labels**

Run:

```bash
node --test scripts/__tests__/digital-assets-ui.test.mjs
```

Expected: FAIL. Forbidden helper failures should be gone. Remaining failures should be from visible labels or missing C v2 labels/styles that Task 3 and Task 4 implement.

- [ ] **Step 7: Commit helper refactor**

```bash
git add app/me/digital-assets.tsx
git commit -m "refactor(app): prepare digital asset result-only visuals"
```

---

### Task 3: Implement C v2 Hero And Remove Rule Sections

**Files:**
- Modify: `app/me/digital-assets.tsx`

**Interfaces:**
- Consumes: `ASSET_VISUAL` from Task 2 and existing `formatAssetValue`, `formatCurrency`.
- Produces: visible C v2 page header without acquisition rule sections.

- [ ] **Step 1: Delete rule rendering functions**

Delete `renderMetricCard` and `renderVipSeedRule` entirely.

- [ ] **Step 2: Add a local hero asset tile helper inside `DigitalAssetsScreen` before `renderRecentRecord`**

```tsx
const renderAssetTile = (label: string, value: number) => (
  <View style={[styles.heroAssetTile, { borderColor: ASSET_VISUAL.heroTileBorder, backgroundColor: ASSET_VISUAL.heroTile }]}>
    <Text style={styles.heroAssetLabel} {...fitTextProps}>
      {label}
    </Text>
    <Text style={styles.heroAssetValue} {...priceTextProps}>
      {formatAssetValue(value)}
    </Text>
  </View>
);
```

- [ ] **Step 3: Replace the VIP hero in `listHeader`**

Replace the current VIP `LinearGradient` and following metric grid with:

```tsx
{isVip ? (
  <LinearGradient
    colors={ASSET_VISUAL.heroGradient}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 1 }}
    style={[styles.heroCard, styles.assetHeroCard, { borderRadius: radius.xl }]}
  >
    <View pointerEvents="none" style={styles.heroFieldLines}>
      <View style={[styles.heroFieldLine, styles.heroFieldLinePrimary]} />
      <View style={[styles.heroFieldLine, styles.heroFieldLineSecondary]} />
      <View style={[styles.heroFieldLine, styles.heroFieldLineThird]} />
    </View>
    <View pointerEvents="none" style={[styles.heroInsetBorder, { borderColor: ASSET_VISUAL.heroBorder, borderRadius: radius.lg }]} />

    <Text style={styles.heroLabel}>数字资产总额</Text>
    <Text style={styles.heroValue} {...priceTextProps}>
      {formatAssetValue(summary?.totalAssetBalance ?? 0)}
    </Text>
    <View style={styles.heroFootRow}>
      <Text style={styles.heroFootLabel}>累计消费金额</Text>
      <Text style={styles.heroFootValue} {...priceTextProps}>
        {formatCurrency(summary?.cumulativeSpendAmount ?? 0)}
      </Text>
    </View>
    <View style={styles.heroAssetGrid}>
      {renderAssetTile('种子资产', summary?.seedAssetBalance ?? 0)}
      {renderAssetTile('消费资产', summary?.creditAssetBalance ?? 0)}
    </View>
  </LinearGradient>
) : (
```

Remove this old block:

```tsx
{isVip ? (
  <View style={[styles.metricGrid, { marginTop: spacing.md }]}>
    ...
  </View>
) : null}
```

- [ ] **Step 4: Replace the non-VIP hero**

Use this content for the non-VIP `LinearGradient`:

```tsx
<LinearGradient
  colors={ASSET_VISUAL.nonVipGradient}
  start={{ x: 0, y: 0 }}
  end={{ x: 1, y: 1 }}
  style={[styles.heroCard, styles.assetHeroCard, { borderRadius: radius.xl }]}
>
  <View pointerEvents="none" style={styles.heroFieldLines}>
    <View style={[styles.heroFieldLine, styles.heroFieldLinePrimary]} />
    <View style={[styles.heroFieldLine, styles.heroFieldLineSecondary]} />
  </View>
  <View pointerEvents="none" style={[styles.heroInsetBorder, { borderColor: ASSET_VISUAL.heroBorder, borderRadius: radius.lg }]} />

  <Text style={styles.heroLabel}>累计消费金额</Text>
  <Text style={styles.heroValue} {...priceTextProps}>
    {formatCurrency(summary?.cumulativeSpendAmount ?? 0)}
  </Text>
  <Text style={styles.heroPromptTitle}>{NON_VIP_ACTIVATION_PROMPT.title}</Text>
  <Pressable
    onPress={() => router.push('/me/vip')}
    style={[styles.heroButton, { borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.18)' }]}
  >
    <Text style={[typography.bodyStrong, { color: '#FFFFFF' }]} {...compactActionTextProps}>
      {NON_VIP_ACTIVATION_PROMPT.actionLabel}
    </Text>
  </Pressable>
</LinearGradient>
```

- [ ] **Step 5: Delete both rule section blocks**

Delete the entire `sectionBlock` that starts with:

```tsx
<Text style={[typography.bodyStrong, { color: colors.text.primary }]}>消费资产规则</Text>
```

Delete the entire `sectionBlock` that starts with:

```tsx
<Text style={[typography.bodyStrong, { color: colors.text.primary }]}>VIP 种子资产规则</Text>
```

- [ ] **Step 6: Change recent section title**

Replace:

```tsx
<Text style={[typography.bodyStrong, { color: colors.text.primary }]}>最近消费记录</Text>
```

with:

```tsx
<Text style={[typography.bodyStrong, { color: colors.text.primary }]}>最近资产流水</Text>
```

- [ ] **Step 7: Add or replace hero styles**

Replace the current hero-related style entries from `heroCard` through `heroPromptDesc` with:

```ts
heroCard: {
  paddingHorizontal: 22,
  paddingVertical: 22,
  overflow: 'hidden',
},
assetHeroCard: {
  minHeight: 250,
  shadowColor: '#115240',
  shadowOpacity: 0.28,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 16 },
  elevation: 5,
},
heroInsetBorder: {
  position: 'absolute',
  top: 14,
  right: 14,
  bottom: 14,
  left: 14,
  borderWidth: StyleSheet.hairlineWidth,
},
heroFieldLines: {
  position: 'absolute',
  right: -24,
  bottom: -8,
  width: 250,
  height: 120,
  opacity: 0.42,
},
heroFieldLine: {
  position: 'absolute',
  height: 1,
  backgroundColor: ASSET_VISUAL.heroLine,
},
heroFieldLinePrimary: {
  left: 0,
  right: 4,
  bottom: 28,
  transform: [{ rotate: '13deg' }],
},
heroFieldLineSecondary: {
  left: 12,
  right: 20,
  bottom: 56,
  transform: [{ rotate: '-13deg' }],
},
heroFieldLineThird: {
  left: 30,
  right: 0,
  bottom: 84,
  transform: [{ rotate: '8deg' }],
},
heroLabel: {
  color: 'rgba(255,255,255,0.74)',
  fontSize: 13,
  fontWeight: '700',
},
heroValue: {
  color: '#FFFFFF',
  fontSize: 46,
  fontWeight: '900',
  lineHeight: 54,
  marginTop: 9,
},
heroFootRow: {
  flexDirection: 'row',
  alignItems: 'baseline',
  marginTop: 12,
  gap: 8,
},
heroFootLabel: {
  color: 'rgba(255,255,255,0.76)',
  fontSize: 12,
  fontWeight: '600',
},
heroFootValue: {
  color: '#FFFFFF',
  fontSize: 18,
  fontWeight: '800',
},
heroAssetGrid: {
  flexDirection: 'row',
  gap: 10,
  marginTop: 24,
},
heroAssetTile: {
  flex: 1,
  borderWidth: StyleSheet.hairlineWidth,
  paddingHorizontal: 12,
  paddingVertical: 12,
  borderRadius: 17,
},
heroAssetLabel: {
  color: 'rgba(255,255,255,0.65)',
  fontSize: 11,
  fontWeight: '700',
},
heroAssetValue: {
  color: '#FFFFFF',
  fontSize: 21,
  fontWeight: '900',
  lineHeight: 25,
  marginTop: 6,
},
heroPromptTitle: {
  color: '#FFFFFF',
  fontSize: 16,
  fontWeight: '800',
  marginTop: 18,
  lineHeight: 22,
},
```

Delete `heroPromptDesc`, `metricGrid`, `metricCard`, `metricValue`, `sectionCard`, `ruleCard`, `ruleHeader`, `pendingPill`, `progressTrack`, and `progressFill` style entries if they are unused after the JSX deletion.

- [ ] **Step 8: Run the focused test**

```bash
node --test scripts/__tests__/digital-assets-ui.test.mjs
```

Expected: FAIL only if Task 4 has not yet added `getLedgerTone` colors or if unused forbidden strings remain. Fix any remaining forbidden visible strings before proceeding.

- [ ] **Step 9: Commit hero and rule removal**

```bash
git add app/me/digital-assets.tsx
git commit -m "feat(app): hide digital asset rules on app page"
```

---

### Task 4: Add Ledger Type Colors And Result-Only Copy

**Files:**
- Modify: `app/me/digital-assets.tsx`

**Interfaces:**
- Consumes: `getLedgerVisual(item)` and `ASSET_VISUAL.tones` from Task 2.
- Produces: colored ledger rows and final App copy that passes Task 1 tests.

- [ ] **Step 1: Replace `renderRecentRecord` tone logic**

Inside `renderRecentRecord`, replace:

```ts
const isPositive = item.direction === 'CREDIT';
const accent = isPositive ? colors.success : colors.danger;
```

with:

```ts
const visual = getLedgerVisual(item);
```

- [ ] **Step 2: Replace the ledger icon block**

Replace the `styles.ledgerIcon` container and icon content with:

```tsx
<View
  style={[
    styles.ledgerIcon,
    {
      borderColor: visual.border,
      backgroundColor: visual.bg,
    },
  ]}
>
  <MaterialCommunityIcons
    name={visual.icon as any}
    size={19}
    color={visual.color}
  />
</View>
```

- [ ] **Step 3: Allow long ledger titles to wrap without pushing amounts off-screen**

Replace:

```tsx
<Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
  {item.title}
</Text>
```

with:

```tsx
<Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={2}>
  {item.title}
</Text>
```

- [ ] **Step 4: Replace amount color usage**

Replace:

```tsx
<Text style={[typography.bodyStrong, { color: accent }]} {...priceTextProps}>
```

with:

```tsx
<Text style={[typography.bodyStrong, { color: visual.color }]} {...priceTextProps}>
```

- [ ] **Step 5: Update empty and footer copy**

Replace:

```tsx
<EmptyState title="暂无消费记录" description="确认收货后开始累计" />
```

with:

```tsx
<EmptyState title="暂无资产流水" description="系统结算后会显示记录" />
```

Replace:

```tsx
查看全部消费记录
```

with:

```tsx
查看全部
```

- [ ] **Step 6: Update ledger styles**

Replace `ledgerRow`, `ledgerIcon`, `ledgerMain`, and `ledgerAmountBox` with:

```ts
ledgerRow: {
  flexDirection: 'row',
  alignItems: 'center',
  borderWidth: StyleSheet.hairlineWidth,
  paddingHorizontal: 14,
  paddingVertical: 14,
  marginBottom: 10,
  shadowColor: '#16241F',
  shadowOpacity: 0.045,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 6 },
  elevation: 1,
},
ledgerIcon: {
  width: 40,
  height: 40,
  borderRadius: 15,
  borderWidth: StyleSheet.hairlineWidth,
  alignItems: 'center',
  justifyContent: 'center',
},
ledgerMain: {
  flex: 1,
  minWidth: 0,
  marginLeft: 12,
},
ledgerAmountBox: {
  alignItems: 'flex-end',
  marginLeft: 12,
  maxWidth: 112,
},
```

- [ ] **Step 7: Run all local static checks**

```bash
node --test scripts/__tests__/digital-assets-ui.test.mjs
npm run test:legal
```

Expected: both commands PASS.

- [ ] **Step 8: Run TypeScript**

```bash
npx tsc -b --noEmit --pretty false
```

Expected: PASS with no output.

- [ ] **Step 9: Commit final UI copy and ledger colors**

```bash
git add app/me/digital-assets.tsx scripts/__tests__/digital-assets-ui.test.mjs
git commit -m "feat(app): color code digital asset ledgers"
```

---

### Task 5: Documentation, Export Verification, And Release Notes

**Files:**
- Modify: `docs/architecture/frontend.md`
- Modify: `plan.md`
- Modify after OTA only: `docs/operations/app-发布与OTA手册.md`

**Interfaces:**
- Consumes: implementation from Tasks 1-4.
- Produces: documented App behavior and release verification record.

- [ ] **Step 1: Update `docs/architecture/frontend.md` digital asset row**

Find the `数字资产中心` row and replace its description with this text:

```markdown
我的页常用工具新增“数字资产”入口；`/me/digital-assets` 按会员态分流：普通用户只展示累计消费金额和“开通 VIP 激活资产”引导，VIP 用户展示 C v2 农业科技感数字资产卡，包含数字资产总额、种子资产、消费资产、累计消费金额和最近 5 条资产流水；App 前台不展示消费资产倍率、VIP 种子资产套餐规则、档位进度、长期权益模块或资产说明，具体规则仅在后台配置和系统结算中生效；最近资产流水按类型配色（种子资产青绿、消费资产湖蓝、累计消费麦金、扣回柔红、后台调整灰）；“查看全部”进入 `/me/consumption-records`，非 VIP 只可查看 `CUMULATIVE_SPEND` 流水，VIP 可查看累计消费/种子资产/消费资产全量流水；通过 `DigitalAssetRepo` 调用 `/me/digital-assets/summary` 与 `/me/digital-assets/ledgers`，使用 React Query 刷新，金额文本使用 `priceTextProps`，列表底部使用 `useBottomInset` 适配安全区
```

Set the date column to `2026-06-19`.

- [ ] **Step 2: Add a completed item to `plan.md`**

Insert under `### 近期完成补充`:

```markdown
- [x] **数字资产 App 页面视觉升级与规则隐藏**（2026-06-19 新增并完成）
  - **来源**: 用户确认 App 数字资产页选 C v2 农业科技感，保留种子资产/消费资产分项，但不展示怎么获得数字资产的规则，最近资产流水按类型使用不同颜色
  - **实际做了**: 买家 App `/me/digital-assets` 删除消费资产规则、VIP 种子资产规则、资产说明和所有前台倍率/档位/套餐规则展示；顶部改为农业科技感资产卡，保留数字资产总额、种子资产、消费资产、累计消费金额；最近资产流水改为按类型配色
  - **验证**: `node --test scripts/__tests__/digital-assets-ui.test.mjs`、`npm run test:legal`、`npx tsc -b --noEmit --pretty false`、production Android `expo export --platform android` 通过
```

- [ ] **Step 3: Run production Android export**

```bash
EXPO_PUBLIC_ENV=production EXPO_PUBLIC_USE_MOCK=false EXPO_PUBLIC_API_BASE_URL=https://api.ai-maimai.com/api/v1 EXPO_PUBLIC_ALIPAY_SANDBOX=false EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true NODE_ENV=production npx expo export --platform android
```

Expected: PASS and `dist/metadata.json` exists.

- [ ] **Step 4: Capture export metadata**

```bash
node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('dist/metadata.json','utf8')); const a=m.fileMetadata.android.assets || []; console.log(JSON.stringify({androidBundle:m.fileMetadata.android.bundle, assetCount:a.length, ttf:a.filter(x=>x.ext==='ttf').length, png:a.filter(x=>x.ext==='png').length}, null, 2));"
```

Expected: JSON with `androidBundle`, `assetCount`, `ttf`, and `png`. Record the exact bundle path and counts in the final release summary.

- [ ] **Step 5: Commit docs and verification notes**

```bash
git add docs/architecture/frontend.md plan.md
git commit -m "docs(app): record digital asset visual privacy update"
```

- [ ] **Step 6: If the user asks to publish OTA, publish runtime 1.0.4 production OTA**

Run only after code and docs are committed:

```bash
EXPO_PUBLIC_ENV=production EXPO_PUBLIC_USE_MOCK=false EXPO_PUBLIC_API_BASE_URL=https://api.ai-maimai.com/api/v1 EXPO_PUBLIC_ALIPAY_SANDBOX=false EXPO_PUBLIC_WECHAT_PAY_AVAILABLE=true npx eas update --branch production --message "数字资产页视觉升级并隐藏规则（1.0.4）" --clear-cache --emit-metadata --non-interactive
```

Expected: EAS reports `Branch production`, `Runtime version 1.0.4`, Android update ID, iOS update ID, and update group ID.

- [ ] **Step 7: Verify OTA latest if published**

```bash
npx eas update:list --branch production --limit 1 --non-interactive
```

Expected: latest production group message is `数字资产页视觉升级并隐藏规则（1.0.4）`.

- [ ] **Step 8: Update `docs/operations/app-发布与OTA手册.md` if OTA was published**

Add a new latest production OTA entry with:

- Date `2026-06-19`
- Commit SHA used for OTA
- EAS group ID
- Android update ID
- iOS update ID
- Dashboard URL
- Verification commands from this task
- Note that it only covers runtime `1.0.4`

- [ ] **Step 9: Commit OTA docs if Step 8 ran**

```bash
git add docs/operations/app-发布与OTA手册.md
git commit -m "docs(ops): record production OTA 1.0.4 digital asset visual privacy"
```
