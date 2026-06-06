# VIP 首页礼包推荐展示（方案 B 轻改版）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VIP 用户首页恢复礼包跑马灯（推荐语境文案），并解锁 `/vip/gifts` 为浏览模式，让 VIP 推荐好友时有可展示的礼包内容与权益，且不产生"再买一次"误解。

**Architecture:** 纯前端（买家 App）3 文件 + 1 工具函数 + 1 测试文件。文案差异收口为 `vipHomePromo.ts` 中的纯函数（可单测）；`VipHomePromoCarousel` 加 `mode` prop 只换文案；`gifts.tsx` 移除 VIP 硬拦截、CTA 按身份分流、`handleCheckout` 加 VIP 守卫做物理隔离。后端零改动（`GET /bonus/vip/gift-options` 为公开接口）。

**Tech Stack:** React Native 0.81 + Expo 54 / expo-router 6 / @tanstack/react-query / jest (ts-jest)

**Spec:** `docs/superpowers/specs/2026-06-05-vip-home-referral-promo-design.md`

---

### Task 1: 跑马灯文案纯函数 + 单元测试

**Files:**
- Modify: `src/utils/vipHomePromo.ts`（文件末尾追加）
- Create: `src/utils/__tests__/vipHomePromo.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/utils/__tests__/vipHomePromo.test.ts`：

```typescript
import { getVipPromoCarouselCopy } from '../vipHomePromo';

describe('getVipPromoCarouselCopy', () => {
  it('purchase 模式返回非 VIP 购买语境文案（与改动前 UI 文案一致）', () => {
    expect(getVipPromoCarouselCopy('purchase')).toEqual({
      title: 'VIP 开通礼包',
      cardActionHint: '点击查看赠品详情',
    });
  });

  it('referral 模式返回 VIP 推荐语境文案（主语是好友，不出现"开通 VIP"歧义）', () => {
    expect(getVipPromoCarouselCopy('referral')).toEqual({
      title: '好友开通可得礼包',
      cardActionHint: '点击查看礼包详情，可分享给好友',
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest src/utils/__tests__/vipHomePromo.test.ts`
Expected: FAIL —— `getVipPromoCarouselCopy` is not exported / not a function

- [ ] **Step 3: 实现纯函数**

在 `src/utils/vipHomePromo.ts` 文件末尾（`buildVipReferralHomePrompt` 之后）追加：

```typescript
export type VipPromoMode = 'purchase' | 'referral';

export type VipPromoCarouselCopy = {
  title: string;
  cardActionHint: string;
};

// 首页礼包跑马灯文案按身份分流：
// purchase = 非 VIP 购买语境（默认）；referral = VIP 推荐语境（主语是"好友"，避免"再买一次"误解）
export function getVipPromoCarouselCopy(mode: VipPromoMode): VipPromoCarouselCopy {
  if (mode === 'referral') {
    return {
      title: '好友开通可得礼包',
      cardActionHint: '点击查看礼包详情，可分享给好友',
    };
  }
  return {
    title: 'VIP 开通礼包',
    cardActionHint: '点击查看赠品详情',
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest src/utils/__tests__/vipHomePromo.test.ts`
Expected: PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add src/utils/vipHomePromo.ts src/utils/__tests__/vipHomePromo.test.ts
git commit -m "feat(app/home): VIP礼包跑马灯文案纯函数（purchase/referral双语境）+ 单测"
```

---

### Task 2: VipHomePromoCarousel 增加 mode prop

**Files:**
- Modify: `src/components/data/VipHomePromoCarousel.tsx`

- [ ] **Step 1: 改 import 与 Props 类型**

第 7 行 import 改为（增加 `getVipPromoCarouselCopy` 与 `VipPromoMode`）：

```typescript
import {
  buildVipHomePromoCards,
  getVipPromoCarouselCopy,
  type VipHomePromoCard,
  type VipPromoMode,
} from '../../utils/vipHomePromo';
```

Props 类型（第 9-12 行）改为：

```typescript
type VipHomePromoCarouselProps = {
  packages: VipPackage[];
  onPressCard: (card: VipHomePromoCard) => void;
  // purchase = 非 VIP 购买语境（默认，现有调用零破坏）；referral = VIP 推荐语境，仅替换标题与无障碍文案
  mode?: VipPromoMode;
};
```

- [ ] **Step 2: 组件内取文案并替换两处**

函数签名（第 21 行）改为：

```typescript
export function VipHomePromoCarousel({ packages, onPressCard, mode = 'purchase' }: VipHomePromoCarouselProps) {
```

组件体内（`const cards = ...` 之后）加：

```typescript
const copy = getVipPromoCarouselCopy(mode);
```

标题（原第 101-103 行）：

```tsx
<Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: 6 }]}>
  {copy.title}
</Text>
```

卡片 accessibilityLabel（原第 124 行）：

```tsx
accessibilityLabel={`${card.price}元 VIP 礼包，${card.title}，${copy.cardActionHint}`}
```

其余（卡片视觉、跑马灯动画、长按暂停）零改动。

- [ ] **Step 3: TypeScript 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/components/data/VipHomePromoCarousel.tsx
git commit -m "feat(app/home): 礼包跑马灯组件支持 mode prop（referral 推荐语境文案）"
```

---

### Task 3: 首页放开显示条件 + 按身份传 mode

**Files:**
- Modify: `app/(tabs)/home.tsx`（两处：172-186 行数据区、550-557 行渲染区）

- [ ] **Step 1: 改数据区（原 172-186 行）**

将：

```typescript
  // VIP 首页广告：未登录/普通用户展示，VIP 用户隐藏
  const { data: memberData } = useQuery({
    queryKey: ['bonus-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });
  const member = memberData?.ok ? memberData.data : null;
  const shouldShowVipPromo = !isLoggedIn || member?.tier === 'NORMAL';
  const vipReferralPrompt = buildVipReferralHomePrompt(member);
  const { data: vipGiftOptionsData } = useQuery({
    queryKey: ['vip-gift-options'],
    queryFn: () => BonusRepo.getVipGiftOptions(),
    enabled: shouldShowVipPromo,
  });
  const vipPackages = vipGiftOptionsData?.ok ? vipGiftOptionsData.data.packages : [];
```

改为（跑马灯对所有用户显示；VIP 切到推荐语境）：

```typescript
  // VIP 首页礼包展示：非 VIP 为购买语境；VIP 切推荐语境（好友开通可得），作为推荐弹药
  const { data: memberData } = useQuery({
    queryKey: ['bonus-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });
  const member = memberData?.ok ? memberData.data : null;
  const vipPromoMode: VipPromoMode = member?.tier === 'VIP' ? 'referral' : 'purchase';
  const vipReferralPrompt = buildVipReferralHomePrompt(member);
  const { data: vipGiftOptionsData } = useQuery({
    queryKey: ['vip-gift-options'],
    queryFn: () => BonusRepo.getVipGiftOptions(),
  });
  const vipPackages = vipGiftOptionsData?.ok ? vipGiftOptionsData.data.packages : [];
```

同时在文件顶部 vipHomePromo 的 import 中追加 `type VipPromoMode`（与现有 `buildVipReferralHomePrompt` / `VipHomePromoCard` 同一来源，找到该 import 行追加即可）。

- [ ] **Step 2: 改渲染区（原 550-557 行）**

将：

```tsx
        {shouldShowVipPromo ? (
          <Animated.View entering={FadeInDown.duration(300).delay(40)}>
            <VipHomePromoCarousel
              packages={vipPackages}
              onPressCard={handleVipPromoPress}
            />
          </Animated.View>
        ) : null}
```

改为（跑马灯自身在 cards 为空时返回 null，无需外层条件）：

```tsx
        <Animated.View entering={FadeInDown.duration(300).delay(40)}>
          <VipHomePromoCarousel
            packages={vipPackages}
            onPressCard={handleVipPromoPress}
            mode={vipPromoMode}
          />
        </Animated.View>
```

注意：其下方 `{vipReferralPrompt ? ...}` 金色横幅块（原 559-584 行）**原样保留，不动**。

- [ ] **Step 3: 确认 `shouldShowVipPromo` 无残留引用**

Run: `grep -n "shouldShowVipPromo" "app/(tabs)/home.tsx"`
Expected: 无输出

- [ ] **Step 4: TypeScript 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add "app/(tabs)/home.tsx"
git commit -m "feat(app/home): VIP用户首页恢复礼包跑马灯（推荐语境），横幅保留"
```

---

### Task 4: /vip/gifts 解除 VIP 拦截，改浏览模式

**Files:**
- Modify: `app/vip/gifts.tsx`

- [ ] **Step 1: 删除 VIP 硬拦截块（原 388-417 行）**

删除整段：

```tsx
  // 已是 VIP — 显示提示页
  if (isLoggedIn && isVip) {
    return (
      <LinearGradient ...>
        ...
        <Text style={styles.vipAlreadyTitle}>您已是 VIP 会员</Text>
        ...
      </LinearGradient>
    );
  }
```

同时删除样式表中已无引用的 6 个样式：`vipAlreadyContainer`、`vipAlreadyTitle`、`vipAlreadySubtitle`、`vipAlreadyButton`、`vipAlreadyButtonGradient`、`vipAlreadyButtonText`（原 1014-1046 行附近，保留 `// 加载态` 及之后内容）。

- [ ] **Step 2: handleCheckout 加 VIP 守卫（物理隔离）+ 新增分享 handler**

`handleCheckout`（原 367-386 行）改为：

```typescript
  // 选中赠品并进入结账
  const handleCheckout = useCallback(() => {
    // VIP 浏览模式物理隔离：任何路径不得写入结算选择
    if (isVip) return;
    if (selectedIndex === null || !currentPackage) return;
    const selected = giftOptions[selectedIndex];
    if (!selected || !selected.available) return;

    // 持久化选择到 store
    setVipPackageSelection({
      packageId: currentPackage.id,
      giftOptionId: selected.id,
      title: selected.title,
      coverMode: selected.coverMode,
      coverUrl: selected.coverUrl ?? undefined,
      totalPrice: selected.totalPrice,
      price: currentPackage.price,
      items: selected.items,
    });

    // 进入结账页（结账页会处理登录判断）
    router.push('/checkout');
  }, [isVip, selectedIndex, giftOptions, currentPackage, setVipPackageSelection, router]);

  // VIP 浏览模式：分享给好友开通（跳推荐码页，面对面扫码最顺）
  const handleShareToFriend = useCallback(() => {
    router.push('/me/referral');
  }, [router]);
```

- [ ] **Step 3: 标题区下方加 VIP 浏览提示条**

在 `{/* 标题区 */}` 块（原 460-467 行）之后、`{/* 价格档位选择 */}` 之前插入：

```tsx
        {/* VIP 浏览模式提示条：明确"这不是让你再买"，是给好友看的 */}
        {isVip ? (
          <Animated.View entering={FadeInDown.delay(150).duration(500)} style={styles.vipBrowseBar}>
            <MaterialCommunityIcons name="crown" size={16} color={VIP.goldPrimary} />
            <Text style={styles.vipBrowseText}>您已是 VIP 会员 · 以下为礼包内容，可展示给好友</Text>
          </Animated.View>
        ) : null}
```

样式表追加（放在 `// 推荐人提示条` 组附近）：

```typescript
  // VIP 浏览模式提示条
  vipBrowseBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 24,
    marginBottom: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: VIP.referralBg,
    borderWidth: 1,
    borderColor: VIP.cardBorder,
    borderRadius: 8,
  },
  vipBrowseText: {
    fontSize: 13,
    color: VIP.warmWhite,
    fontWeight: '600',
    flexShrink: 1,
  },
```

- [ ] **Step 4: 推荐人提示条对 VIP 隐藏**

「扫描好友邀请码」提示条（原 507-512 行）是购买前绑定推荐人的引导，对 VIP 无意义。条件改为：

```tsx
        {!isVip && (!isLoggedIn || (member && !member.inviterUserId)) ? (
```

- [ ] **Step 5: 底部固定栏按身份分流**

底部栏内容（原 606-641 行）改为（`ctaEnabled` 在组件体内、`handleShareToFriend` 之后定义）：

```typescript
  // VIP 浏览模式 CTA 恒可点（分享不依赖选中赠品）；非 VIP 需先选赠品
  const ctaEnabled = isVip || selectedIndex !== null;
```

```tsx
        <View style={[styles.bottomBarContent, compactBottomBar && styles.bottomBarContentCompact]}>
          <View style={[styles.bottomPriceSection, compactBottomBar && styles.bottomPriceSectionCompact]}>
            <Text style={styles.bottomLabel}>{isVip ? 'VIP 礼包' : '开通 VIP'}</Text>
            <Text {...priceTextProps} style={styles.bottomPrice}>¥{vipPrice}</Text>
          </View>
          <Pressable
            onPress={isVip ? handleShareToFriend : handleCheckout}
            disabled={!ctaEnabled}
            style={({ pressed }) => [
              styles.checkoutButton,
              !ctaEnabled && styles.checkoutButtonDisabled,
              pressed && ctaEnabled && styles.checkoutButtonPressed,
            ]}
          >
            <LinearGradient
              colors={ctaEnabled ? [VIP.goldPrimary, VIP.goldLight] : ['#999', '#777']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.checkoutButtonGradient}
            >
              {ctaEnabled ? (
                <GoldShineSweep width={80} duration={3500} travel={300} />
              ) : null}
              <Text
                {...compactActionTextProps}
                style={[
                  styles.checkoutButtonText,
                  !ctaEnabled && styles.checkoutButtonTextDisabled,
                ]}
              >
                {isVip ? '分享给好友开通' : '立即开通'}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
        <Text style={styles.bottomHint}>
          {isVip ? '好友支付即开通 VIP · 您可获得推荐奖励' : '包邮 · 支付即开通 VIP'}
        </Text>
```

- [ ] **Step 6: TypeScript 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add app/vip/gifts.tsx
git commit -m "feat(app/vip): 礼包页解除VIP拦截改浏览模式——提示条+分享CTA+购买链路物理隔离"
```

---

### Task 5: 全量验证

- [ ] **Step 1: 全量单测**

Run: `npx jest`
Expected: 全部 PASS（含既有 7 个测试文件 + 新增 vipHomePromo.test.ts）

- [ ] **Step 2: 全量 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 手工验收清单（模拟器/真机，对照 spec 第 6 节）**

- VIP 登录：首页可见跑马灯，标题「好友开通可得礼包」，金色横幅仍在其下方
- VIP 点卡片 → `/vip/gifts`：无拦截页；顶部有"您已是 VIP"提示条；无「扫描好友邀请码」条；可切换档位/选赠品浏览；底部「分享给好友开通」恒可点，点击跳 `/me/referral`
- VIP 在礼包页选中赠品后点 CTA：跳 `/me/referral` 而非 checkout（AsyncStorage 中 `vipPackageSelection` 不变）
- 退出登录 / NORMAL 账号：首页标题仍「VIP 开通礼包」；礼包页购买流程照常（选赠品 → 立即开通 → checkout）

---

### Task 6: 文档同步 + 代码审查

- [ ] **Step 1: 文档同步**

- `CLAUDE.md` 相关文档列表登记本计划文件（`docs/superpowers/plans/2026-06-06-vip-home-referral-promo.md`）
- `docs/architecture/frontend.md` 对应 Section 标注 VIP 首页推荐展示已实现
- `plan.md` 追加条目并打勾

- [ ] **Step 2: 提交文档**

```bash
git add CLAUDE.md docs/architecture/frontend.md plan.md
git commit -m "docs: 登记VIP首页礼包推荐展示实施计划+同步frontend.md/plan.md"
```

- [ ] **Step 3: 审查 Agent（CLAUDE.md 强制流程 9）**

派发只读 Explore agent 审查本次全部改动（4 个 commit），维度：买家 App 前端审查（类型一致 / 文案防混淆 / 三态完整 / 设计令牌）+ 跨页面一致性（home ↔ carousel ↔ gifts 的 mode 判定均以 `member?.tier === 'VIP'` 为准）+ 物理隔离验证（VIP 路径确实无法写 `vipPackageSelection`）。修复全部 High/Critical 问题后向用户汇报。
