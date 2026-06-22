import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AuthModal } from '../../src/components/overlay';
import { GROUP_BUY_COLORS } from '../../src/components/group-buy';
import { GroupBuyRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useMeasuredBottomBar } from '../../src/hooks/useMeasuredBottomBar';
import { compactActionTextProps, fitTextProps, priceTextProps, useBottomInset, useTheme } from '../../src/theme';

const formatPrice = (value: number) => `¥${Number(value || 0).toFixed(2)}`;

export default function GroupBuyLandingScreen() {
  const { code: rawCode } = useLocalSearchParams<{ code: string }>();
  const code = Array.isArray(rawCode) ? rawCode[0] : rawCode;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const bottomInset = useBottomInset(spacing.md);
  const { bottomPadding, onBarLayout } = useMeasuredBottomBar(92, spacing.xl);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [navigating, setNavigating] = useState(false);

  const landingQuery = useQuery({
    queryKey: ['group-buy-landing', code],
    queryFn: () => GroupBuyRepo.getLanding(String(code)),
    enabled: Boolean(code),
  });

  const landing = landingQuery.data?.ok ? landingQuery.data.data : null;
  const activity = landing?.activity ?? null;

  const goToCheckout = () => {
    if (!landing?.valid || !activity) {
      show({ message: landing?.reason ?? '团购推荐码不可用', type: 'warning' });
      return;
    }
    setNavigating(true);
    router.replace({
      pathname: '/group-buy/checkout' as any,
      params: { activityId: activity.id, shareCode: landing.code },
    });
  };

  const proceed = () => {
    if (!landing?.valid || !activity) {
      show({ message: landing?.reason ?? '团购推荐码不可用', type: 'warning' });
      return;
    }
    if (!isLoggedIn) {
      setAuthModalOpen(true);
      return;
    }
    goToCheckout();
  };

  if (landingQuery.isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购推荐" />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton height={300} radius={8} />
          <Skeleton height={120} radius={8} />
        </ScrollView>
      </Screen>
    );
  }

  if (!landingQuery.data || !landingQuery.data.ok) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购推荐" />
        <ErrorState
          title="推荐码加载失败"
          description={landingQuery.data?.ok === false ? landingQuery.data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={() => landingQuery.refetch()}
        />
      </Screen>
    );
  }

  if (!landing?.valid || !activity) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购推荐" />
        <ErrorState
          title="推荐码不可用"
          description={landing?.reason ?? '该团购推荐码已失效或活动已结束'}
          actionLabel="查看团购商品"
          onAction={() => router.replace('/group-buy')}
        />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }} statusBarStyle="dark">
      <AppHeader title="团购推荐" subtitle="分享回馈活动" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomPadding, gap: spacing.lg }}
      >
        <LinearGradient
          colors={[GROUP_BUY_COLORS.ivory, GROUP_BUY_COLORS.porcelain, '#EEF6F2']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, shadow.sm, { borderRadius: 8, borderColor: GROUP_BUY_COLORS.mist }]}
        >
          <View style={[styles.heroIcon, { backgroundColor: `${GROUP_BUY_COLORS.tide}12` }]}>
            <MaterialCommunityIcons name="account-heart-outline" size={34} color={GROUP_BUY_COLORS.tide} />
          </View>
          <Text style={[typography.headingLg, styles.heroTitle, { color: GROUP_BUY_COLORS.pine }]}>
            好友分享的团购商品
          </Text>
          <Text style={[typography.bodySm, styles.heroCopy, { color: GROUP_BUY_COLORS.inkSoft }]}>
            你将购买同款商品，正常享受商品服务；本活动仅统计直接推荐的新用户有效订单。
          </Text>
        </LinearGradient>

        <View style={[styles.inviterBox, { borderRadius: 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.inviterAvatar, { backgroundColor: GROUP_BUY_COLORS.porcelain }]}>
            <MaterialCommunityIcons name="account-outline" size={24} color={GROUP_BUY_COLORS.tide} />
          </View>
          <View style={styles.inviterText}>
            <Text {...fitTextProps} style={[typography.bodyStrong, { color: colors.text.primary }]}>
              {landing.inviter?.nickname || '分享用户'}
            </Text>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
              推荐码 {landing.code}
            </Text>
          </View>
        </View>

        <View style={[styles.productCard, shadow.sm, { borderRadius: 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.productImage, { borderRadius: 8, backgroundColor: GROUP_BUY_COLORS.mist }]}>
            {activity.product.imageUrl ? (
              <Image source={{ uri: activity.product.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <MaterialCommunityIcons name="shopping-outline" size={42} color={GROUP_BUY_COLORS.tide} />
            )}
          </View>
          <View style={styles.productBody}>
            <Text {...fitTextProps} style={[typography.headingSm, { color: colors.text.primary }]}>
              {activity.title}
            </Text>
            <Text {...fitTextProps} style={[typography.bodySm, { color: colors.text.secondary, marginTop: 4 }]}>
              {activity.product.title} · {activity.sku.title}
            </Text>
            <View style={styles.productMeta}>
              <Text {...priceTextProps} style={[typography.headingMd, { color: GROUP_BUY_COLORS.coral, fontWeight: '800' }]}>
                {formatPrice(activity.price)}
              </Text>
              <View style={[styles.shippingPill, { borderColor: GROUP_BUY_COLORS.mist, backgroundColor: GROUP_BUY_COLORS.porcelain }]}>
                <Text {...compactActionTextProps} style={[typography.caption, { color: GROUP_BUY_COLORS.tide }]}>
                  {activity.freeShipping ? '包邮' : '按配置运费'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.complianceBox, { borderRadius: 8, borderColor: GROUP_BUY_COLORS.mist, backgroundColor: GROUP_BUY_COLORS.porcelain }]}>
          <MaterialCommunityIcons name="shield-check-outline" size={18} color={GROUP_BUY_COLORS.brass} />
          <Text style={[typography.caption, styles.complianceText, { color: GROUP_BUY_COLORS.inkSoft }]}>
            活动为品牌购物回馈，仅一级直接推荐；订单发生退换货不计入有效名额。
          </Text>
        </View>
      </ScrollView>

      <View
        onLayout={onBarLayout}
        style={[styles.bottomBar, shadow.lg, { paddingBottom: bottomInset, backgroundColor: colors.surface, borderTopColor: colors.border }]}
      >
        <Pressable
          onPress={proceed}
          disabled={navigating}
          style={[styles.cta, { borderRadius: radius.pill, backgroundColor: GROUP_BUY_COLORS.pine }]}
        >
          {navigating ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: '#FFFFFF' }]}>
              去付款
            </Text>
          )}
        </Pressable>
      </View>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={async () => {
          await queryClient.invalidateQueries({ queryKey: ['group-buy-current'] });
          setTimeout(goToCheckout, 160);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    minHeight: 190,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  heroIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    marginTop: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  heroCopy: {
    marginTop: 8,
    textAlign: 'center',
  },
  inviterBox: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 13,
    gap: 11,
  },
  inviterAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviterText: {
    flex: 1,
    minWidth: 0,
  },
  productCard: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  productImage: {
    height: 190,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productBody: {
    padding: 16,
  },
  productMeta: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  shippingPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  complianceBox: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 13,
    gap: 8,
  },
  complianceText: {
    flex: 1,
    minWidth: 0,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  cta: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
